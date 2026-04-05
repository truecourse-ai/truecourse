import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const redundantTypeConstraintVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-type-constraint',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['type_parameter'],
  visit(node, filePath, sourceCode) {
    const constraint = node.namedChildren.find((c) => c.type === 'constraint')
    if (!constraint) return null

    const constraintType = constraint.namedChildren[0]
    if (!constraintType) return null

    const constraintText = constraintType.text
    if (constraintText === 'any' || constraintText === 'unknown') {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text ?? 'T'
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant type constraint',
        `\`${name} extends ${constraintText}\` is redundant — all types satisfy \`${constraintText}\`.`,
        sourceCode,
        `Remove the \`extends ${constraintText}\` constraint.`,
      )
    }
    return null
  },
}
