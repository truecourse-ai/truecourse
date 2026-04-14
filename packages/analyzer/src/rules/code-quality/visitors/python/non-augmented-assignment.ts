import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

const AUGMENT_OPS: Record<string, string> = {
  '+': '+=',
  '-': '-=',
  '*': '*=',
  '/': '/=',
  '//': '//=',
  '%': '%=',
  '**': '**=',
  '&': '&=',
  '|': '|=',
  '^': '^=',
  '<<': '<<=',
  '>>': '>>=',
}

function getBinaryOp(node: SyntaxNode): string | null {
  for (const child of node.children) {
    if (!child.isNamed && AUGMENT_OPS[child.text]) return child.text
  }
  return null
}

export const pythonNonAugmentedAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/non-augmented-assignment',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')

    if (!left || !right) return null
    if (left.type !== 'identifier') return null
    if (right.type !== 'binary_operator') return null

    // Check if right side is: left_identifier op something
    const rightLeft = right.namedChildren[0]
    const op = getBinaryOp(right)
    if (!op) return null
    if (!rightLeft || rightLeft.type !== 'identifier') return null
    if (rightLeft.text !== left.text) return null

    const augOp = AUGMENT_OPS[op]
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Non-augmented assignment',
      `\`${left.text} = ${left.text} ${op} ...\` can be simplified to \`${left.text} ${augOp} ...\`.`,
      sourceCode,
      `Use the augmented assignment operator \`${augOp}\`.`,
    )
  },
}
