import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'

/**
 * `span.Fill(default)` writes the default value element-by-element where
 * `span.Clear()` zeroes the whole span in one operation. `Fill` is a
 * Span/Memory-specific method, so a `default` / `default(T)` argument is a
 * strong signal. Fires when `Fill` is called with a single `default_expression`.
 */
export const csharpSpanFillDefaultOverClearVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/span-fill-default-over-clear',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'Fill') return null
    if (node.childForFieldName('function')?.type !== 'member_access_expression') return null

    const args = getCSharpArguments(node)
    if (args.length !== 1) return null
    if (args[0]!.type !== 'default_expression') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Span.Fill(default) over Clear',
      'Fill(default) writes the default value into every element; Clear() zeroes the whole span in a single, more efficient operation.',
      sourceCode,
      'Replace Fill(default) with Clear().',
    )
  },
}
