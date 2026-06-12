import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'

/**
 * A statement-position call to a pure method whose only effect is its
 * return value: string transforms (`name.Trim();`) and deferred LINQ
 * operators (`items.Where(…);` — not even enumerated). The result must be
 * assigned or the call is a no-op.
 *
 * Method names that mutating BCL types share (List.Reverse, Region.Union,
 * StringBuilder.Replace, List.Remove…) are deliberately excluded.
 * PascalCase receivers are skipped too — they may be static classes with
 * unrelated semantics (e.g. Socket.Select).
 */
const PURE_METHODS = new Set([
  'Trim', 'TrimStart', 'TrimEnd', 'ToUpper', 'ToLower',
  'ToUpperInvariant', 'ToLowerInvariant', 'Substring', 'PadLeft', 'PadRight',
  'Where', 'Select', 'SelectMany', 'OrderBy', 'OrderByDescending', 'ThenBy',
  'ThenByDescending', 'GroupBy', 'Distinct', 'DistinctBy', 'Skip', 'Take',
  'OfType', 'Append', 'Prepend',
])

export const csharpIgnoredReturnValueVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/ignored-return-value',
  languages: ['csharp'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'invocation_expression') return null

    const method = getCSharpMethodName(expr)
    if (!PURE_METHODS.has(method)) return null

    const receiver = getCSharpReceiver(expr)
    if (!receiver) return null
    const lastSegment = receiver.split('.').pop() ?? receiver
    // PascalCase receiver: probably a static class or property — skip
    if (/^[A-Z]/.test(lastSegment)) return null

    return makeViolation(
      this.ruleKey, expr, filePath, 'high',
      'Ignored return value',
      `The result of \`.${method}()\` is discarded — it does not modify \`${receiver}\` in place${method[0] === 'T' || method[0] === 'S' || method[0] === 'P' ? '' : ' (LINQ operators are lazy and never even execute here)'}. The statement has no effect.`,
      sourceCode,
      `Assign the result: \`var result = ${receiver}.${method}(...);\`.`,
    )
  },
}
