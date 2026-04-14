import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const preferOptionalChainVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-optional-chain',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['logical_expression', 'binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.type === '&&')
    if (!op) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    if (left.type === 'identifier') {
      if (right.type === 'member_expression') {
        const rightObj = right.childForFieldName('object')
        if (rightObj?.text === left.text) {
          const parent = node.parent
          if (parent?.type === 'logical_expression' || parent?.type === 'binary_expression') {
            const parentOp = parent.children.find((c) => c.type === '&&')
            if (parentOp) return null
          }
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Prefer optional chaining',
            `\`${left.text} && ${right.text}\` can be simplified to \`${left.text}?.${right.childForFieldName('property')?.text}\`.`,
            sourceCode,
            'Use optional chaining (?.) instead of the && guard.',
          )
        }
      }
    }
    return null
  },
}
