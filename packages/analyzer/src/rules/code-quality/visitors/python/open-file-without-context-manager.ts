import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

function isInsideWith(node: SyntaxNode): boolean {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (cur.type === 'with_statement') return true
    if (cur.type === 'assignment') {
      // Could be: f = open(...)  → check if parent is with statement
      const p = cur.parent
      if (p?.type === 'with_item' || p?.type === 'with_clause') return true
    }
    if (cur.type === 'function_definition' || cur.type === 'class_definition') return false
    cur = cur.parent
  }
  return false
}

export const pythonOpenFileWithoutContextManagerVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/open-file-without-context-manager',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'open') return null

    if (isInsideWith(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'File opened without context manager',
      '`open()` called without a `with` statement — the file handle may not be closed if an exception occurs.',
      sourceCode,
      'Wrap with `with open(...) as f:` to ensure the file is closed automatically.',
    )
  },
}
