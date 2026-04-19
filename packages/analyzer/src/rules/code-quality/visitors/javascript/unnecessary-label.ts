import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

function hasLabelReference(labelName: string, node: SyntaxNode): boolean {
  if (
    (node.type === 'break_statement' || node.type === 'continue_statement') &&
    node.namedChildren.some((c) => c.type === 'statement_identifier' && c.text === labelName)
  ) {
    return true
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && hasLabelReference(labelName, child)) return true
  }
  return false
}

export const unnecessaryLabelVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-label',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['labeled_statement'],
  visit(node, filePath, sourceCode) {
    const labelNode = node.childForFieldName('label')
    if (!labelNode) return null

    const labelName = labelNode.text
    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if the label is actually referenced by any break/continue
    const isReferenced = hasLabelReference(labelName, body)
    if (isReferenced) return null

    return makeViolation(
      this.ruleKey, labelNode, filePath, 'low',
      `Unnecessary label: ${labelName}`,
      `Label \`${labelName}\` is never referenced by a break or continue statement.`,
      sourceCode,
      `Remove the unused label \`${labelName}:\`.`,
    )
  },
}
