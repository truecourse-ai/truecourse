import type { SyntaxNode } from 'tree-sitter'
import type { CodeViolation, SupportedLanguage } from '@truecourse/shared'

export interface CodeRuleVisitor {
  ruleKey: string
  nodeTypes: string[]
  languages?: SupportedLanguage[]
  visit(node: SyntaxNode, filePath: string, sourceCode: string): CodeViolation | null
}

export function makeViolation(
  ruleKey: string,
  node: SyntaxNode,
  filePath: string,
  severity: string,
  title: string,
  content: string,
  sourceCode: string,
  fixPrompt?: string,
): CodeViolation {
  const lineStart = node.startPosition.row + 1
  const lineEnd = node.endPosition.row + 1
  const lines = sourceCode.split('\n')
  const snippetLines = lines.slice(node.startPosition.row, Math.min(node.endPosition.row + 1, node.startPosition.row + 3))
  const snippet = snippetLines.join('\n')

  return {
    ruleKey,
    filePath,
    lineStart,
    lineEnd,
    columnStart: node.startPosition.column,
    columnEnd: node.endPosition.column,
    severity,
    title,
    content,
    snippet,
    fixPrompt,
  }
}
