import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: x in [] or x in {} or x in set() — membership test on empty collection (always False)

function isEmptyCollection(node: SyntaxNode): boolean {
  if (node.type === 'list' && node.namedChildren.length === 0) return true
  if (node.type === 'set' && node.namedChildren.length === 0) return true
  if (node.type === 'dictionary' && node.namedChildren.length === 0) return true
  // set() call
  if (node.type === 'call') {
    const fn = node.childForFieldName('function')
    const args = node.childForFieldName('arguments')
    if (fn?.text === 'set' && args?.namedChildren.length === 0) return true
  }
  return false
}

export const pythonInEmptyCollectionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/in-empty-collection',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    // comparison_operator: x in [] or x not in []
    const children = node.children
    let inIdx = -1
    for (let i = 0; i < children.length; i++) {
      if (children[i].text === 'in') { inIdx = i; break }
      if (children[i].text === 'not' && children[i + 1]?.text === 'in') { inIdx = i + 1; break }
    }
    if (inIdx < 0) return null

    const rightOperand = node.namedChildren[node.namedChildren.length - 1]
    if (!rightOperand || !isEmptyCollection(rightOperand)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Membership test on empty collection',
      `\`in ${rightOperand.text}\` always returns \`False\` because the collection is empty.`,
      sourceCode,
      'Remove the membership test or use a non-empty collection.',
    )
  },
}
