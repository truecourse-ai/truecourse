import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { TypeQueryService } from '../../../../ts-compiler.js'
import { getMethodName, ORM_WRITE_METHODS, getEnclosingFunctionBody, bodyHasTransactionCall, isInsideTransactionCallback } from './_helpers.js'

// `destroy()` and `save()` are common method names on non-ORM objects
// (Konva nodes, pdf-lib documents, signature pads, DOM cleanup, etc.).
// Real ORM `destroy(...)` / `save(...)` calls almost always carry an
// options object (`{ where }`, `{ data }`, …); the bare zero-argument
// shape is the dead giveaway of a UI/PDF library cleanup and a frequent
// FP source for this rule.
const ZERO_ARG_AMBIGUOUS_WRITE_METHODS = new Set(['destroy', 'save'])

// In-memory containers share method names with ORMs (`.delete`, `.set`).
// When the receiver's type is one of these, the call is not a DB write.
const IN_MEMORY_CONTAINER_TYPES = /^(?:Readonly)?(?:Map|Set|WeakMap|WeakSet)\b/

function isInMemoryContainerReceiver(call: SyntaxNode, typeQuery: TypeQueryService | undefined, filePath: string): boolean {
  if (!typeQuery) return false
  const fn = call.childForFieldName('function')
  if (fn?.type !== 'member_expression') return false
  const receiver = fn.childForFieldName('object')
  if (!receiver) return false
  const typeStr = typeQuery.getTypeAtPosition(
    filePath,
    receiver.startPosition.row,
    receiver.startPosition.column,
    receiver.endPosition.row,
    receiver.endPosition.column,
  )
  if (!typeStr) return false
  return IN_MEMORY_CONTAINER_TYPES.test(typeStr.trim())
}

function looksLikeOrmWriteCall(call: SyntaxNode, methodName: string): boolean {
  if (!ORM_WRITE_METHODS.has(methodName)) return false
  if (ZERO_ARG_AMBIGUOUS_WRITE_METHODS.has(methodName)) {
    const args = call.childForFieldName('arguments')
    if (!args || args.namedChildCount === 0) return false
  }
  return true
}

export const missingTransactionVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-transaction',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    const methodName = getMethodName(node)
    if (!looksLikeOrmWriteCall(node, methodName)) return null
    if (isInMemoryContainerReceiver(node, typeQuery, filePath)) return null

    const body = getEnclosingFunctionBody(node)
    if (!body) return null

    // If there's already a transaction call in this body, skip
    if (bodyHasTransactionCall(body)) return null

    // If this function is itself the callback to a *.transaction() /
    // *.$transaction() call, the writes are already inside a transaction.
    if (isInsideTransactionCallback(node)) return null

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
        if (looksLikeOrmWriteCall(n, mName) && !isInMemoryContainerReceiver(n, typeQuery, filePath)) {
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
