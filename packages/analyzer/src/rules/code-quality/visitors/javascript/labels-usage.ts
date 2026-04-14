import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const labelsUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/labels-usage',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['labeled_statement'],
  visit(node, filePath, sourceCode) {
    const labelNode = node.children[0]
    const labelName = labelNode?.text ?? 'label'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Labeled statement',
      `Label \`${labelName}\` makes control flow hard to follow. Refactor using helper functions or early returns.`,
      sourceCode,
      'Refactor to remove the label — use functions or break/continue without labels.',
    )
  },
}
