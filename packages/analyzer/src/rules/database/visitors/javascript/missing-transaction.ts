import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getMethodName, ORM_WRITE_METHODS, getEnclosingFunctionBody, bodyHasTransactionCall } from './_helpers.js'

// Receiver chain root identifiers that indicate the call is already inside
// a transaction context (the parameter of a `prisma.$transaction((tx) => ...)`
// callback, a Sequelize transaction handle, etc.). Calls under these roots
// must not be counted as missing-transaction writes — they ARE the transaction.
const TRANSACTION_RECEIVER_ROOTS = new Set(['tx', 'trx', 't', 'transaction', 'txn'])

// Walk a member_expression / call_expression chain to its leftmost identifier.
function getReceiverRoot(node: SyntaxNode | null): SyntaxNode | null {
  let cursor: SyntaxNode | null = node
  while (cursor) {
    if (cursor.type === 'identifier') return cursor
    if (cursor.type === 'member_expression') {
      cursor = cursor.childForFieldName('object')
    } else if (cursor.type === 'call_expression') {
      cursor = cursor.childForFieldName('function')
    } else {
      return null
    }
  }
  return null
}

// Heuristic: the call shape resembles an ORM/query-builder write
// (`prisma.user.create(...)`, `User.destroy(...)`, `db('users').update(...)`).
// Bare camelCase identifier receivers like `loadedPdf.destroy()` are likely
// non-DB cleanup methods that share a name with an ORM verb.
function isOrmShapedWriteCall(call: SyntaxNode): boolean {
  const fn = call.childForFieldName('function')
  if (fn?.type !== 'member_expression') return false
  const method = fn.childForFieldName('property')?.text ?? ''
  if (!ORM_WRITE_METHODS.has(method)) return false
  const object = fn.childForFieldName('object')
  if (!object) return false

  // Inside-transaction guard: if the receiver chain roots in a known
  // transaction client name, this write is already in a transaction.
  const root = getReceiverRoot(object)
  if (root && TRANSACTION_RECEIVER_ROOTS.has(root.text)) return false

  // ORM-shaped receivers:
  //   member_expression  →  prisma.user / db.users
  //   call_expression    →  knex('users') / db('users')
  //   identifier         →  PascalCase only (Sequelize Model)
  if (object.type === 'member_expression') return true
  if (object.type === 'call_expression') return true
  if (object.type === 'identifier') return /^[A-Z]/.test(object.text)
  return false
}

export const missingTransactionVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-transaction',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getMethodName(node)
    if (!ORM_WRITE_METHODS.has(methodName)) return null

    // Trigger call must itself be ORM-shaped + outside any transaction
    if (!isOrmShapedWriteCall(node)) return null

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
      if (n.type === 'call_expression' && isOrmShapedWriteCall(n)) {
        const fn = n.childForFieldName('function')!
        const tableName = fn.childForFieldName('object')?.text ?? ''
        writeCount++
        if (tableName) tableNames.add(tableName)
        if (n.id === node.id) {
          seenSelf = true
        } else if (seenSelf) {
          isSecondOccurrence = true
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
