import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: Union[Never, T] or Never | T in type hints
// This simplifies to just T

export const pythonNeverUnionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/never-union',
  languages: ['python'],
  nodeTypes: ['subscript', 'binary_operator', 'generic_type'],
  visit(node, filePath, sourceCode) {
    // Pattern 1a: Union[Never, T] as subscript (outside type annotation contexts)
    if (node.type === 'subscript') {
      const value = node.childForFieldName('value')
      const valueName = value?.text
      if (valueName !== 'Union') return null

      const nodeText = node.text
      if (nodeText.includes('Never') || nodeText.includes('NoReturn')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Never type in union',
          `\`${nodeText}\` contains \`Never\` in a union — this simplifies to just the other type(s). \`Never\` in a union is always redundant.`,
          sourceCode,
          'Remove `Never` from the union type.',
        )
      }
    }

    // Pattern 1b: Union[Never, T] as generic_type (inside type annotation contexts)
    if (node.type === 'generic_type') {
      // First named child is the identifier (Union)
      const nameNode = node.namedChildren[0]
      if (!nameNode || nameNode.text !== 'Union') return null

      const nodeText = node.text
      if (nodeText.includes('Never') || nodeText.includes('NoReturn')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Never type in union',
          `\`${nodeText}\` contains \`Never\` in a union — this simplifies to just the other type(s). \`Never\` in a union is always redundant.`,
          sourceCode,
          'Remove `Never` from the union type.',
        )
      }
    }

    // Pattern 2: Never | T using | syntax
    if (node.type === 'binary_operator') {
      const op = node.children.find(c => !c.isNamed)?.text
      if (op !== '|') return null
      const left = node.childForFieldName('left')
      const right = node.childForFieldName('right')
      if (!left || !right) return null

      if (left.text === 'Never' || right.text === 'Never' || left.text === 'NoReturn' || right.text === 'NoReturn') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Never type in union',
          `\`${node.text}\` contains \`Never\` in a union — this simplifies to just the other type. \`Never\` in a union is always redundant.`,
          sourceCode,
          'Remove `Never` from the union type.',
        )
      }
    }

    return null
  },
}
