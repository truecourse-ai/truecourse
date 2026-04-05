import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: seq[N] where seq is a literal list/tuple with fewer than N+1 elements

export const pythonPotentialIndexErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/potential-index-error',
  languages: ['python'],
  nodeTypes: ['subscript'],
  visit(node, filePath, sourceCode) {
    const value = node.childForFieldName('value')
    const subscript = node.childForFieldName('subscript')
    if (!value || !subscript) return null

    // Only check literal lists and tuples
    if (value.type !== 'list' && value.type !== 'tuple') return null

    // Only check integer literal indices
    if (subscript.type !== 'integer') return null
    const index = parseInt(subscript.text, 10)
    if (isNaN(index)) return null

    const elementCount = value.namedChildren.length
    const effectiveIndex = index < 0 ? elementCount + index : index

    if (effectiveIndex >= elementCount || effectiveIndex < 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Potential IndexError',
        `Accessing index \`${index}\` on a ${value.type} with ${elementCount} element${elementCount !== 1 ? 's' : ''} — this will raise \`IndexError\` at runtime.`,
        sourceCode,
        `Use an index between 0 and ${elementCount - 1} (or ${-elementCount} to -1 for negative indices).`,
      )
    }
    return null
  },
}
