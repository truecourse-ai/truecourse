import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { SourceLocation } from '@truecourse/shared'

/**
 * Create source location from node
 * This is the same for all languages
 */
export function createSourceLocation(node: SyntaxNode, filePath: string): SourceLocation {
  return {
    filePath,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    startColumn: node.startPosition.column,
    endColumn: node.endPosition.column,
  }
}

/**
 * Extract doc comment if available
 * Works for JSDoc-style comments
 */
export function extractDocComment(node: SyntaxNode): string | undefined {
  const previousSibling = node.previousNamedSibling
  if (previousSibling?.type === 'comment') {
    const text = previousSibling.text
    // Check if it's a JSDoc comment (starts with /**)
    if (text.startsWith('/**')) {
      return text
    }
  }
  return undefined
}

const NESTING_NODE_TYPES = new Set([
  'if_statement',
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
  'try_statement',
  'switch_statement',
])

const STATEMENT_NODE_TYPES = new Set([
  'expression_statement',
  'return_statement',
  'if_statement',
  'for_statement',
  'for_in_statement',
  'while_statement',
  'do_statement',
  'try_statement',
  'switch_statement',
  'throw_statement',
  'variable_declaration',
  'lexical_declaration',
])

/**
 * Compute function body metrics: statementCount, maxNestingDepth, lineCount
 */
export function computeFunctionMetrics(node: SyntaxNode): {
  lineCount: number
  statementCount: number
  maxNestingDepth: number
} {
  const lineCount = node.endPosition.row - node.startPosition.row + 1

  const bodyNode = node.childForFieldName('body')
  if (!bodyNode) {
    return { lineCount, statementCount: 0, maxNestingDepth: 0 }
  }

  let statementCount = 0
  for (const child of bodyNode.namedChildren) {
    if (STATEMENT_NODE_TYPES.has(child.type)) {
      statementCount++
    }
  }

  let maxNestingDepth = 0
  function walkNesting(n: SyntaxNode, depth: number) {
    for (const child of n.namedChildren) {
      if (NESTING_NODE_TYPES.has(child.type)) {
        const newDepth = depth + 1
        if (newDepth > maxNestingDepth) maxNestingDepth = newDepth
        walkNesting(child, newDepth)
      } else {
        walkNesting(child, depth)
      }
    }
  }
  walkNesting(bodyNode, 0)

  return { lineCount, statementCount, maxNestingDepth }
}
