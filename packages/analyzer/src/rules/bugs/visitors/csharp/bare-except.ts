import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES, findInSameFunction } from './_helpers.js'

/**
 * Catch-all clause (`catch { … }` / `catch (Exception) { … }` with no
 * exception variable and no `when` filter) whose body does real work and
 * then falls through — every exception, including fatal ones, is swallowed
 * without being logged, rethrown, or signalled to the caller.
 *
 * Idiomatic C# that is NOT flagged:
 *   - `catch (Exception ex)` — the exception is bound and may be inspected
 *   - bodies that log (any logger/Console/Trace mention)
 *   - bodies that rethrow (`throw;` / `throw new …`)
 *   - single-statement bodies — best-effort cleanup, fallback assignment,
 *     `return false;`, `continue;` and friends
 *   - bodies ending in return/break/continue — the failure is communicated
 *     through control flow (TryX wrappers, skip-bad-item loops)
 *   - bodies that branch (if/switch/ternary) — owned by
 *     reliability/deterministic/catch-without-error-type
 *   - retry back-off bodies (Thread.Sleep / Task.Delay)
 *   - `Try*` bool-returning wrapper methods
 */
const JUMP_STATEMENTS = new Set(['return_statement', 'break_statement', 'continue_statement', 'goto_statement'])

const BRANCHING_TYPES = new Set([
  'if_statement',
  'switch_statement',
  'switch_expression',
  'conditional_expression',
])

// Blunt on purpose: ANY mention of log/logger (fields, methods, LogError, …)
// or of the console/trace diagnostics counts as "not silent". Suppression
// can afford to over-match; firing cannot.
const LOGGING_TEXT = /log|\b(Console|Trace|Debug|EventLog)\s*\.|\bWriteLine\b/i
const BACKOFF_CALLS = new Set(['Sleep', 'Delay'])

function isInsideTryBoolMethod(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'method_declaration' || current.type === 'local_function_statement') {
      const name = current.childForFieldName('name')?.text ?? ''
      const returns = current.childForFieldName('returns')?.text ?? ''
      return /^Try[A-Z0-9_]/.test(name) && (returns === 'bool' || returns === 'Boolean')
    }
    if (CSHARP_FUNCTION_BOUNDARIES.has(current.type)) return false
    current = current.parent
  }
  return false
}

export const csharpBareExceptVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/bare-except',
  languages: ['csharp'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    // Only the unbound catch-all forms: `catch` / `catch (Exception)`.
    const decl = node.namedChildren.find((c) => c?.type === 'catch_declaration')
    if (decl) {
      const typeName = decl.childForFieldName('type')?.text.split('.').pop() ?? ''
      if (typeName !== 'Exception') return null
      if (decl.childForFieldName('name')) return null
    }
    // A `when (…)` filter is deliberate discrimination.
    if (node.namedChildren.some((c) => c?.type === 'catch_filter_clause')) return null

    const body = node.childForFieldName('body')
    if (!body) return null
    const statements = body.namedChildren.filter((c): c is SyntaxNode => !!c && c.type !== 'comment')
    // Empty bodies are empty-catch's; single statements are idiomatic
    // fallbacks/cleanup.
    if (statements.length < 2) return null

    // Any jump anywhere in the body communicates the failure through
    // control flow (over-suppressing here is fine — firing must be sure).
    if (findInSameFunction(body, (n) => JUMP_STATEMENTS.has(n.type))) return null

    if (findInSameFunction(body, (n) => n.type === 'throw_statement' || n.type === 'throw_expression')) return null
    if (findInSameFunction(body, (n) => BRANCHING_TYPES.has(n.type))) return null
    if (LOGGING_TEXT.test(body.text)) return null
    if (findInSameFunction(body, (n) => {
      if (n.type !== 'invocation_expression') return false
      const fn = n.childForFieldName('function')
      const method = fn?.type === 'member_access_expression' ? (fn.childForFieldName('name')?.text ?? '') : (fn?.text ?? '')
      return BACKOFF_CALLS.has(method)
    })) return null
    if (isInsideTryBoolMethod(node)) return null

    const form = decl ? 'catch (Exception)' : 'catch'
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Bare except clause',
      `\`${form}\` swallows every exception — including fatal ones — without binding, logging, or rethrowing it, then continues as if nothing failed.`,
      sourceCode,
      'Bind the exception and log it (`catch (Exception ex) { _logger.LogError(ex, …); }`), rethrow, or catch the specific exception type you expect.',
    )
  },
}
