import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getMethodName, ORM_WRITE_METHODS, getEnclosingFunctionBody, bodyHasTransactionCall } from './_helpers.js'

export const missingTransactionVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-transaction',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getMethodName(node)
    if (!ORM_WRITE_METHODS.has(methodName)) return null

    const body = getEnclosingFunctionBody(node)
    if (!body) return null

    // If there's already a transaction call in this body, skip
    if (bodyHasTransactionCall(body)) return null

    // Count write calls in the body
    let writeCount = 0
    let isSecondOccurrence = false
    let seenSelf = false

    function countWrites(n: SyntaxNode) {
      if (n.type === 'call_expression') {
        const fn = n.childForFieldName('function')
        let mName = ''
        if (fn?.type === 'member_expression') {
          mName = fn.childForFieldName('property')?.text ?? ''
        } else if (fn?.type === 'identifier') {
          mName = fn.text
        }
        if (ORM_WRITE_METHODS.has(mName)) {
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

    // Only flag on the second occurrence (to avoid N reports for N writes)
    if (writeCount >= 2 && isSecondOccurrence) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Multiple writes without transaction',
        `Found ${writeCount} database write operations in the same function without a transaction. If one fails, earlier writes will not be rolled back.`,
        sourceCode,
        'Wrap all related writes in a transaction to ensure atomicity.',
      )
    }

    return null
  },
}
