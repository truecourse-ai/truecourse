import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

function bodyHasReraise(bodyNode: SyntaxNode, excVarName: string | null): boolean {
  for (const stmt of bodyNode.namedChildren) {
    if (stmt.type === 'raise_statement') {
      // bare raise or raise <excVar>
      if (stmt.namedChildren.length === 0) return true
      if (excVarName) {
        const expr = stmt.namedChildren[0]
        if (expr?.type === 'identifier' && expr.text === excVarName) return true
      }
    }
  }
  return false
}

export const pythonSystemExitNotReraisedVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/system-exit-not-reraised',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    // Check if the except clause catches SystemExit or BaseException
    const excType = node.namedChildren.find((c) => c.type !== 'block' && c.type !== 'as_pattern')
    // Look for exception type
    let catchesSystemExit = false
    for (const child of node.namedChildren) {
      if (child.type === 'block') continue
      const text = child.text
      if (text.includes('SystemExit') || text.includes('BaseException') || text === '(SystemExit)') {
        catchesSystemExit = true
        break
      }
    }
    if (!catchesSystemExit) return null

    const body = node.namedChildren.find((c) => c.type === 'block')
    if (!body) return null

    // Check for as_pattern to get variable name
    const asPattern = node.namedChildren.find((c) => c.type === 'as_pattern')
    const excVarName = asPattern?.namedChildren.find((c) => c.type === 'identifier')?.text ?? null

    if (!bodyHasReraise(body, excVarName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'SystemExit not re-raised',
        'Catching `SystemExit` without re-raising prevents clean process shutdown.',
        sourceCode,
        'Add `raise` at the end of the except block to re-raise `SystemExit`.',
      )
    }
    return null
  },
}
