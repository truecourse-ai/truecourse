import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

const MAX_DEPTH = 4

const NESTING_TYPES = new Set([
  'if_statement', 'for_statement', 'for_in_statement', 'while_statement',
  'do_statement', 'try_statement', 'switch_statement', 'with_statement',
])

function getNestingDepth(node: SyntaxNode): number {
  let depth = 0
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (NESTING_TYPES.has(current.type)) {
      depth++
    }
    // Stop at function boundary
    if (
      current.type === 'function_declaration' ||
      current.type === 'function' ||
      current.type === 'arrow_function' ||
      current.type === 'method_definition'
    ) {
      break
    }
    current = current.parent
  }
  return depth
}

export const maxNestingDepthVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/max-nesting-depth',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement'],
  visit(node, filePath, sourceCode) {
    const depth = getNestingDepth(node)
    if (depth < MAX_DEPTH) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Block nested ${depth + 1} levels deep`,
      `Block is nested ${depth + 1} levels deep — maximum is ${MAX_DEPTH}. Extract logic into helper functions.`,
      sourceCode,
      'Extract the deeply nested code into a named function.',
    )
  },
}
