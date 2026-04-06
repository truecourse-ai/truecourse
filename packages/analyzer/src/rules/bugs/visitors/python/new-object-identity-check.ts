import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonNewObjectIdentityCheckVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/new-object-identity-check',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const children = node.children

    const opNode = children.find((c) => c.text === 'is' || c.text === 'is not')
    if (!opNode) return null

    const namedChildren = node.namedChildren
    if (namedChildren.length !== 2) return null

    const [left, right] = namedChildren

    // One side is a call (new object creation), the other is NOT None
    const isNewObject = (n: import('tree-sitter').SyntaxNode): boolean => {
      if (n.type !== 'call') return false
      const fn = n.childForFieldName('function')
      if (!fn) return false
      // Heuristic: PascalCase name is a class constructor
      const name = fn.type === 'identifier' ? fn.text
        : fn.type === 'attribute' ? fn.childForFieldName('attribute')?.text ?? '' : ''
      return name.length > 0 && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()
    }

    const leftIsNew = isNewObject(left)
    const rightIsNew = isNewObject(right)

    if (!leftIsNew && !rightIsNew) return null

    const newSide = leftIsNew ? left : right
    const otherSide = leftIsNew ? right : left

    // Skip the None check (handled by comparison-to-none-constant)
    if (otherSide.type === 'none') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Identity check on new object',
      `\`${node.text}\` — \`${newSide.text}\` creates a new object on every evaluation, so \`${opNode.text}\` with \`${otherSide.text}\` is always \`${opNode.text === 'is' ? 'False' : 'True'}\`.`,
      sourceCode,
      'Use `==` for value equality, or store the object in a variable before comparing.',
    )
  },
}
