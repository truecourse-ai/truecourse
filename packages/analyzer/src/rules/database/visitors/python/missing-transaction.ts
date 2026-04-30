import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonMethodName, PYTHON_WRITE_METHODS, getPythonEnclosingFunctionBody } from './_helpers.js'

/**
 * Known ORM session / database receiver names. When we see `receiver.add()`,
 * we only count it as a DB write if the receiver looks like an ORM object —
 * `my_set.add(item)` and `my_list.update(vals)` are not DB writes.
 */
const ORM_RECEIVER_NAMES = new Set([
  'session', 'db', 'conn', 'connection', 'cursor', 'engine',
  'database', 'self', 'objects', 'manager', 'queryset', 'qs',
])

/** Methods that are unambiguously DB writes regardless of receiver. */
const UNAMBIGUOUS_DB_WRITES = new Set([
  'add_all', 'bulk_create', 'bulk_update', 'executemany',
])

// Cursor / connection / session parameter names. When a function takes
// one of these as a parameter, write calls on it are scoped by the caller.
const CURSOR_PARAM_NAMES = new Set([
  'cur', 'cursor', 'conn', 'connection', 'session', 'db', 'tx', 'trans', 'transaction',
])

function hasCursorLikeParam(params: SyntaxNode): boolean {
  for (let i = 0; i < params.namedChildCount; i++) {
    const p = params.namedChild(i)
    if (!p) continue
    let nameNode: SyntaxNode | null = null
    if (p.type === 'identifier') {
      nameNode = p
    } else if (p.type === 'typed_parameter' || p.type === 'default_parameter' || p.type === 'typed_default_parameter') {
      nameNode = p.childForFieldName('name') ?? p.namedChild(0)
    }
    if (nameNode && nameNode.type === 'identifier' && CURSOR_PARAM_NAMES.has(nameNode.text)) {
      return true
    }
  }
  return false
}

function isOrmWriteCall(n: SyntaxNode): boolean {
  const name = getPythonMethodName(n)

  // Raw SQL writes: execute("INSERT/UPDATE/DELETE ...")
  if (name === 'execute' || name === 'executemany') {
    const args = n.childForFieldName('arguments')
    const firstArg = args?.namedChildren[0]
    if (firstArg?.type === 'string') {
      const sql = firstArg.text.toLowerCase()
      // Word-bounded so `update` doesn't match inside identifiers like
      // `updated_at` / `created_at` / `deleted_at` and misclassify pure
      // SELECTs as writes.
      if (/\b(insert|update|delete|alter|create|drop)\b/.test(sql)) return true
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
    // If there's already a transaction context, skip. Two signals:
    //   1. Explicit transaction keyword (`transaction.atomic()`, `session.begin()`,
    //      raw SQL `BEGIN;`, or `autocommit = False`).
    //   2. A `with` block whose context manager produces a connection/session
    //      binding — sqlite3 / psycopg / SQLAlchemy context managers commit on
    //      success and roll back on exception, so they ARE the transaction.
    //
    // A bare `.commit()` call is *not* sufficient: writers commonly call
    // `commit()` once at the end of a loop without any rollback path, which
    // is exactly the bug this rule catches.
    if (/transaction|atomic|begin\b|autocommit\s*=\s*false/.test(bodyText)) return null
    if (/\bwith\s+[^:]*\bas\s+(conn|connection|cursor|cur|session|engine|tx|trans)\b[^:]*:/.test(bodyText)) return null

    // Private helpers (leading-underscore name) that take a cursor /
    // connection / session as a parameter are by convention called from
    // controlled in-module sites that manage the scope - flagging them
    // produces noise (the rule has no way to inspect the caller). Public
    // functions with the same shape stay flagged because they may be
    // called from anywhere, including sites that don't wrap.
    const funcDef = body.parent
    if (funcDef?.type === 'function_definition') {
      const nameNode = funcDef.childForFieldName('name')
      const params = funcDef.childForFieldName('parameters')
      if (
        nameNode?.text.startsWith('_') &&
        params &&
        hasCursorLikeParam(params)
      ) {
        return null
      }
    }

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
