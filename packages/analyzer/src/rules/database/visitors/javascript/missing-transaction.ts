import type { Node as SyntaxNode } from 'web-tree-sitter'
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

    // Count write calls in the body, tracking DIFFERENT table names.
    // A single insert or single update on the same table doesn't need a transaction.
    const tableNames = new Set<string>()
    let isSecondOccurrence = false
    let seenSelf = false
    let writeCount = 0

    function countWrites(n: SyntaxNode) {
      if (n.type === 'call_expression') {
        const fn = n.childForFieldName('function')
        let mName = ''
        let tableName = ''
        if (fn?.type === 'member_expression') {
          mName = fn.childForFieldName('property')?.text ?? ''
          tableName = fn.childForFieldName('object')?.text ?? ''
        } else if (fn?.type === 'identifier') {
          mName = fn.text
        }
        if (ORM_WRITE_METHODS.has(mName)) {
          writeCount++
          if (tableName) tableNames.add(tableName)
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

    // Only flag when there are 2+ writes to DIFFERENT tables in the same function.
    // A single table with multiple writes (e.g., upsert pattern) typically doesn't need a transaction.
    if (writeCount >= 2 && tableNames.size >= 2 && isSecondOccurrence) {
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
