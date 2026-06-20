import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCSharpReceiverSimpleName } from './_helpers.js'

/**
 * `Regex.Match(input, pattern).Success` materializes a `Match` object (and its
 * capture groups) only to test whether the pattern matched. `Regex.IsMatch`
 * returns the boolean directly with no `Match` allocation. Matches the static
 * `Regex.Match(...).Success` shape.
 */
export const csharpPreferRegexIsMatchVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/prefer-regex-ismatch',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('name')?.text !== 'Success') return null

    const inner = node.childForFieldName('expression')
    if (inner?.type !== 'invocation_expression') return null
    if (getCSharpMethodName(inner) !== 'Match') return null
    if (getCSharpReceiverSimpleName(inner) !== 'Regex') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Prefer Regex.IsMatch',
      'Regex.Match(...).Success allocates a Match object and its capture groups only to read a boolean. Regex.IsMatch returns that boolean directly without materializing a Match.',
      sourceCode,
      'Replace Regex.Match(...).Success with Regex.IsMatch(...).',
    )
  },
}
