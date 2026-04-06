import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

const MAX_NESTING = 5

const NESTING_TYPES = new Set([
  'if_statement', 'for_statement', 'while_statement', 'try_statement',
  'with_statement', 'except_clause',
])

function maxNestingDepth(node: SyntaxNode, currentDepth: number): number {
  let maxDepth = currentDepth
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    // Don't descend into nested function/class definitions
    if (child.type === 'function_definition' || child.type === 'class_definition') continue

    const childDepth = NESTING_TYPES.has(child.type) ? currentDepth + 1 : currentDepth
    const childMax = maxNestingDepth(child, childDepth)
    if (childMax > maxDepth) maxDepth = childMax
  }
  return maxDepth
}

export const pythonTooManyNestedBlocksVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-nested-blocks',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const depth = maxNestingDepth(body, 0)
    if (depth > MAX_NESTING) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'function'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Too many nested blocks',
        `Function \`${name}\` has ${depth} levels of nesting (threshold: ${MAX_NESTING}). Deep nesting makes code hard to read and test.`,
        sourceCode,
        'Use early returns to reduce nesting, or extract nested logic into helper functions.',
      )
    }

    return null
  },
}
