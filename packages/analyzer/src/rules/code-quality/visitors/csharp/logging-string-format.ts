import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'

const LOG_METHODS = new Set([
  'LogTrace', 'LogDebug', 'LogInformation', 'LogWarning', 'LogError', 'LogCritical', 'Log',
])

const STRING_LITERAL_TYPES = new Set(['string_literal', 'verbatim_string_literal', 'raw_string_literal'])

function isStringFormatCall(n: SyntaxNode): boolean {
  if (n.type !== 'invocation_expression') return false
  if (getCSharpMethodName(n) !== 'Format') return false
  const receiver = getCSharpReceiver(n)
  return receiver === 'string' || receiver === 'String'
}

/** `+` concatenation that mixes a string literal with non-literal values. */
function isMixedConcat(n: SyntaxNode): boolean {
  if (n.type !== 'binary_expression' || n.childForFieldName('operator')?.text !== '+') return false
  let sawLiteral = false
  let sawValue = false
  function scan(e: SyntaxNode | null): void {
    if (!e) return
    if (e.type === 'binary_expression' && e.childForFieldName('operator')?.text === '+') {
      scan(e.childForFieldName('left'))
      scan(e.childForFieldName('right'))
      return
    }
    if (STRING_LITERAL_TYPES.has(e.type)) sawLiteral = true
    else sawValue = true
  }
  scan(n)
  return sawLiteral && sawValue
}

/** What kind of pre-formatted message this argument is, or null. */
function preformattedKind(arg: SyntaxNode): string | null {
  if (arg.type === 'interpolated_string_expression') {
    return arg.namedChildren.some((c) => c?.type === 'interpolation') ? 'an interpolated string' : null
  }
  if (isStringFormatCall(arg)) return 'string.Format()'
  if (isMixedConcat(arg)) return 'string concatenation'
  return null
}

/**
 * `_logger.LogInformation($"Order {id} shipped")` — pre-formatting the
 * message defeats structured logging: the template is no longer constant, so
 * log aggregation loses the event identity and the parameter values (CA2254).
 */
export const csharpLoggingStringFormatVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/logging-string-format',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const method = getCSharpMethodName(node)
    if (!LOG_METHODS.has(method)) return null
    if (!getCSharpReceiver(node).toLowerCase().includes('log')) return null

    for (const arg of getCSharpArguments(node)) {
      const kind = preformattedKind(arg)
      if (!kind) continue
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Pre-formatted message in logging call',
        `\`${method}\` is given ${kind} — the message template is no longer constant, so structured logging loses the event identity and parameter values (CA2254).`,
        sourceCode,
        `Use a message template with named placeholders: \`${method}("Order {OrderId} shipped", orderId)\`.`,
      )
    }
    return null
  },
}
