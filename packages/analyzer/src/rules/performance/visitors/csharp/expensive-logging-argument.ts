import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// The verbose levels that are routinely turned off in production, so any work done
// to build their arguments is wasted whenever the level is disabled.
const VERBOSE_METHODS = new Set(['LogDebug', 'LogTrace'])
const VERBOSE_LEVELS = new Set(['Debug', 'Trace'])
const TEMPLATE_LITERALS = new Set(['string_literal', 'verbatim_string_literal', 'raw_string_literal'])

/**
 * A verbose logging call (<c>LogDebug</c>/<c>LogTrace</c>, or <c>Log(LogLevel.Debug/Trace, …)</c>)
 * that passes a method call as one of its template arguments. The argument is
 * evaluated eagerly every time, even when the level is filtered out and the message
 * is discarded — so the expensive call runs for nothing in production (CA1873).
 * Guard the call with <c>ILogger.IsEnabled</c>. Scoped to a constant message template
 * with a method-call argument: an interpolated template is left to the non-constant
 * template rule, and field/property/literal arguments (which are cheap) are ignored,
 * as are calls already wrapped in an <c>IsEnabled</c> check.
 */
export const csharpExpensiveLoggingArgumentVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/expensive-logging-argument',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const method = fn.childForFieldName('name')?.text ?? ''
    const receiver = fn.childForFieldName('expression')
    if (!looksLikeLogger(receiver)) return null

    const args = (node.childForFieldName('arguments')?.namedChildren ?? [])
      .filter((a): a is SyntaxNode => a?.type === 'argument')
      .map(argumentValue)

    let level: string
    let templateIndex: number
    if (VERBOSE_METHODS.has(method)) {
      level = method === 'LogTrace' ? 'Trace' : 'Debug'
      templateIndex = args.findIndex((a) => a && TEMPLATE_LITERALS.has(a.type))
    } else if (method === 'Log' && args[0] && isVerboseLevel(args[0])) {
      level = args[0].childForFieldName('name')?.text ?? 'Debug'
      templateIndex = args.findIndex((a, i) => i > 0 && a !== null && TEMPLATE_LITERALS.has(a.type))
    } else {
      return null
    }
    if (templateIndex < 0) return null

    // Look past the constant template for an argument that is a method call.
    // nameof(...) parses as an invocation but is a compile-time constant, never work.
    const expensive = args.slice(templateIndex + 1).find(
      (a) => a?.type === 'invocation_expression' && a.childForFieldName('function')?.text !== 'nameof',
    )
    if (!expensive) return null
    if (isGuardedByIsEnabled(node)) return null

    return makeViolation(
      this.ruleKey, expensive, filePath, 'low',
      'Expensive argument in verbose logging call',
      `'${expensive.text}' is evaluated even when ${level} logging is disabled, wasting the call in production. Guard the log with ILogger.IsEnabled(LogLevel.${level}).`,
      sourceCode,
      `Wrap the ${method === 'Log' ? 'Log' : method} call in if (logger.IsEnabled(LogLevel.${level})), or move the work behind the guard.`,
    )
  },
}

/** The value expression of an argument node (handles `name: expr` named arguments). */
function argumentValue(arg: SyntaxNode): SyntaxNode | null {
  const named = arg.namedChildren.filter((c): c is SyntaxNode => c !== null)
  return named.length ? named[named.length - 1] : null
}

/** True when the receiver identifier reads like a logger (`logger`, `_log`, `Logger`). */
function looksLikeLogger(node: SyntaxNode | null): boolean {
  if (!node) return false
  const name = node.type === 'member_access_expression' ? node.childForFieldName('name')?.text : node.text
  return /log/i.test(name ?? '')
}

/** True for a `LogLevel.Debug`/`LogLevel.Trace` member access. */
function isVerboseLevel(node: SyntaxNode | null): boolean {
  return (
    node?.type === 'member_access_expression' &&
    node.childForFieldName('expression')?.text === 'LogLevel' &&
    VERBOSE_LEVELS.has(node.childForFieldName('name')?.text ?? '')
  )
}

/** True when an enclosing `if` already gates the call on an `IsEnabled` check. */
function isGuardedByIsEnabled(node: SyntaxNode): boolean {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (cur.type === 'method_declaration' || cur.type === 'class_declaration') return false
    if (cur.type === 'if_statement' && (cur.childForFieldName('condition')?.text ?? '').includes('IsEnabled')) {
      return true
    }
  }
  return false
}
