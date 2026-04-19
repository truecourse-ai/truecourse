import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: seq[1.5] or seq[True] or seq["key"] (using non-integer to index sequence)
// Float, None, or string literals used as list/tuple index

export const pythonInvalidIndexTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-index-type',
  languages: ['python'],
  nodeTypes: ['subscript'],
  visit(node, filePath, sourceCode) {
    const subscriptNode = node.childForFieldName('subscript')
    if (!subscriptNode) return null

    // Float literal index
    if (subscriptNode.type === 'float') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Invalid index type',
        `Using a float \`${subscriptNode.text}\` as a sequence index will raise \`TypeError\` — use an integer index.`,
        sourceCode,
        'Replace the float index with an integer.',
      )
    }

    // None literal index on likely sequences
    if (subscriptNode.type === 'none') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Invalid index type',
        `Using \`None\` as a sequence index will raise \`TypeError\`.`,
        sourceCode,
        'Replace the None index with a valid integer index.',
      )
    }

    return null
  },
}
