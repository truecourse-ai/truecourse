import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCSharpReceiverSimpleName } from './_helpers.js'

/**
 * `Regex.Matches(input, pattern).Count` builds the full `MatchCollection`,
 * materializing every `Match` and its capture groups, only to count them.
 * `Regex.Count` counts matches without allocating the collection. Matches the
 * static `Regex.Matches(...).Count` shape.
 */
export const csharpPreferRegexCountVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/prefer-regex-count',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('name')?.text !== 'Count') return null

    const inner = node.childForFieldName('expression')
    if (inner?.type !== 'invocation_expression') return null
    if (getCSharpMethodName(inner) !== 'Matches') return null
    if (getCSharpReceiverSimpleName(inner) !== 'Regex') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Prefer Regex.Count',
      'Regex.Matches(...).Count materializes the whole MatchCollection (every Match and its capture groups) only to count it. Regex.Count counts matches without allocating the collection.',
      sourceCode,
      'Replace Regex.Matches(...).Count with Regex.Count(...).',
    )
  },
}
