import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import {
  getCSharpMethodName,
  getCSharpReceiver,
  getCSharpArguments,
  isCSharpStringNode,
  getCSharpStringText,
} from '../../../_shared/csharp-helpers.js'

/**
 * `string.Join("", values)` joins with no separator, which is exactly what
 * `string.Concat(values)` does. The `Concat` form states the intent directly
 * and skips the separator handling. The check fires on a `string.Join` (or
 * `String.Join`) call whose first argument is an empty string literal.
 */
export const csharpUseStringConcatOverJoinVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/use-string-concat-over-join',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'Join') return null
    const receiver = getCSharpReceiver(node)
    if (receiver !== 'string' && receiver !== 'String') return null

    const args = getCSharpArguments(node)
    const first = args[0]
    if (!first || !isCSharpStringNode(first)) return null
    if (getCSharpStringText(first) !== '') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use string.Concat instead of string.Join with empty separator',
      '`string.Join("", values)` joins with no separator, which is exactly `string.Concat(values)`.',
      sourceCode,
      'Replace `string.Join("", …)` with `string.Concat(…)`.',
    )
  },
}
