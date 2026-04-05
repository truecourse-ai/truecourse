import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonMethodName, PYTHON_WRITE_METHODS, getPythonEnclosingFunctionBody } from './_helpers.js'

export const pythonMissingTransactionVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-transaction',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const methodName = getPythonMethodName(node)
    if (!PYTHON_WRITE_METHODS.has(methodName)) return null

    const body = getPythonEnclosingFunctionBody(node)
    if (!body) return null

    const bodyText = body.text.toLowerCase()
    // If there's already a transaction context, skip
    if (/transaction|atomic|begin\b/.test(bodyText)) return null

    // Count write calls in the body
    let writeCount = 0
    let seenSelf = false
    let isSecondOccurrence = false

    function countWrites(n: SyntaxNode) {
      if (n.type === 'call') {
        const name = getPythonMethodName(n)
        if (PYTHON_WRITE_METHODS.has(name)) {
          writeCount++
          if (n.id === node.id) {
            seenSelf = true
          } else if (seenSelf) {
            isSecondOccurrence = true
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) countWrites(child)
      }
    }

    countWrites(body)

    if (writeCount >= 2 && isSecondOccurrence) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Multiple writes without transaction',
        `Found ${writeCount} database write operations in the same function without a transaction. If one fails, earlier writes will not be rolled back.`,
        sourceCode,
        'Wrap all related writes in a transaction (e.g., with transaction.atomic():).',
      )
    }

    return null
  },
}
