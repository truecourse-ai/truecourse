import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonMethodName, PYTHON_WRITE_METHODS, getPythonEnclosingFunctionBody } from './_helpers.js'

/**
 * Known ORM session / database receiver names. When we see `receiver.add()`,
 * we only count it as a DB write if the receiver looks like an ORM object.
 * This avoids false positives from `my_set.add(item)` or `my_list.update(vals)`.
 */
const ORM_RECEIVER_NAMES = new Set([
  'session', 'db', 'conn', 'connection', 'cursor', 'engine',
  'database', 'self', 'objects', 'manager', 'queryset', 'qs',
])

/** Methods that are unambiguously DB writes regardless of receiver. */
const UNAMBIGUOUS_DB_WRITES = new Set([
  'add_all', 'bulk_create', 'bulk_update', 'executemany',
])

function isOrmWriteCall(n: SyntaxNode): boolean {
  const name = getPythonMethodName(n)

  // Raw SQL writes: execute("INSERT/UPDATE/DELETE ...")
  if (name === 'execute' || name === 'executemany') {
    const args = n.childForFieldName('arguments')
    const firstArg = args?.namedChildren[0]
    if (firstArg?.type === 'string') {
      const sql = firstArg.text.toLowerCase()
      if (/insert|update|delete|alter|create|drop/.test(sql)) return true
    }
    return false
  }

  if (!PYTHON_WRITE_METHODS.has(name)) return false

  // Unambiguous DB write methods — always count
  if (UNAMBIGUOUS_DB_WRITES.has(name)) return true

  // For ambiguous methods (add, update, delete, save, create, insert, merge, filter),
  // check the receiver to confirm it looks like an ORM object.
  const fn = n.childForFieldName('function')
  if (fn?.type === 'attribute') {
    const receiver = fn.childForFieldName('object')
    if (receiver?.type === 'identifier') {
      return ORM_RECEIVER_NAMES.has(receiver.text)
    }
    // Chained call: db.session.add() — check the root identifier
    if (receiver?.type === 'attribute') {
      const attrText = receiver.childForFieldName('attribute')?.text
      if (attrText && ORM_RECEIVER_NAMES.has(attrText)) return true
      const rootObj = receiver.childForFieldName('object')
      if (rootObj?.type === 'identifier' && ORM_RECEIVER_NAMES.has(rootObj.text)) return true
    }
  }

  return false
}

export const pythonMissingTransactionVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-transaction',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Gate: the triggering node itself must be an ORM write call
    if (!isOrmWriteCall(node)) return null

    const body = getPythonEnclosingFunctionBody(node)
    if (!body) return null

    const bodyText = body.text.toLowerCase()
    // If there's already a transaction context, skip
    if (/transaction|atomic|begin\b/.test(bodyText)) return null

    // Count ORM write calls in the body
    let writeCount = 0
    let seenSelf = false
    let isSecondOccurrence = false

    function countWrites(n: SyntaxNode) {
      if (n.type === 'call' && isOrmWriteCall(n)) {
        writeCount++
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
