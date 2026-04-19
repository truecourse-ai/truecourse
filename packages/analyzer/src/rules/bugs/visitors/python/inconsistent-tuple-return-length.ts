import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: function returns tuples of different lengths from different paths

function getTupleLength(node: SyntaxNode): number | null {
  if (node.type === 'tuple') return node.namedChildren.length
  // Also handle parenthesized expressions containing commas
  return null
}

function collectTupleLengths(body: SyntaxNode): number[] {
  const lengths: number[] = []
  function walk(n: SyntaxNode) {
    if (n.type === 'return_statement') {
      const value = n.namedChildren[0]
      if (value) {
        const len = getTupleLength(value)
        if (len !== null && len > 1) lengths.push(len)
      }
    }
    // Don't recurse into nested functions
    if (n.type === 'function_definition' && n.id !== body.id) return
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(body)
  return lengths
}

export const pythonInconsistentTupleReturnLengthVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/inconsistent-tuple-return-length',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const lengths = collectTupleLengths(body)
    if (lengths.length < 2) return null

    const unique = new Set(lengths)
    if (unique.size <= 1) return null

    const sorted = [...unique].sort((a, b) => a - b)
    return makeViolation(
      this.ruleKey, node.childForFieldName('name') ?? node, filePath, 'medium',
      'Inconsistent tuple return length',
      `This function returns tuples of different lengths: ${sorted.join(', ')} elements from different paths — tuple unpacking will fail on the shorter paths.`,
      sourceCode,
      'Ensure all return paths return tuples of the same length, or use a named tuple/dataclass.',
    )
  },
}
