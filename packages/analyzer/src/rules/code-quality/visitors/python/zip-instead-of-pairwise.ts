import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

function isSliceFrom1(node: SyntaxNode): string | null {
  // Detect x[1:] pattern
  if (node.type !== 'subscript') return null
  const obj = node.childForFieldName('value')
  const slice = node.childForFieldName('subscript')
  if (!obj || !slice) return null
  if (slice.type !== 'slice') return null

  const sliceChildren = slice.namedChildren
  // slice: [start:end] - start should be 1, end should be empty
  if (sliceChildren.length === 0) return null
  const start = slice.childForFieldName('start') ?? sliceChildren[0]
  if (!start) return null
  if (start.text !== '1') return null

  return obj.text
}

export const pythonZipInsteadOfPairwiseVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/zip-instead-of-pairwise',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'zip') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const positionalArgs = args.namedChildren.filter((c) => c.type !== 'keyword_argument')
    if (positionalArgs.length !== 2) return null

    const [first, second] = positionalArgs

    // Check if second is first[1:]
    const slicedFrom = isSliceFrom1(second)
    if (!slicedFrom || slicedFrom !== first.text) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'zip() instead of pairwise()',
      `\`zip(${first.text}, ${first.text}[1:])\` reimplements \`itertools.pairwise()\` which is more efficient and expressive.`,
      sourceCode,
      'Replace `zip(x, x[1:])` with `itertools.pairwise(x)` (Python 3.10+).',
    )
  },
}
