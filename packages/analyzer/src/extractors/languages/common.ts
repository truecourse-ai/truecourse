import type { SyntaxNode } from 'tree-sitter'
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
