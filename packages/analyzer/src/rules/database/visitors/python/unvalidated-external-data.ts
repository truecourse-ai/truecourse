import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonMethodName, PYTHON_WRITE_METHODS, PYTHON_SQL_METHODS } from './_helpers.js'

const PYTHON_EXTERNAL_SOURCES = new Set([
  'request', 'req', 'response', 'event', 'message', 'payload',
])

const PYTHON_EXTERNAL_PROPERTIES = new Set([
  'data', 'json', 'body', 'payload', 'form', 'GET', 'POST',
])

// Receiver names that signal an ORM/DB context. Pydantic
// `BaseModel.update(payload)` is in-memory merge, not a DB write —
// ignore .update() unless the receiver looks like an ORM session /
// engine / queryset / model class.
const ORM_RECEIVER_HINTS = new Set([
  'session', 'db', 'conn', 'connection', 'cursor', 'engine', 'database',
  'objects', 'manager', 'queryset', 'qs', 'tx', 'trx', 'transaction',
])

function hasOrmShapedReceiver(node: SyntaxNode): boolean {
  const fn = node.childForFieldName('function')
  if (fn?.type !== 'attribute') return false
  let receiver: SyntaxNode | null = fn.childForFieldName('object')
  while (receiver?.type === 'attribute') {
    receiver = receiver.childForFieldName('object')
  }
  if (!receiver) return false
  // PascalCase identifier — likely a Model class (Django ORM, Tortoise)
  if (receiver.type === 'identifier' && /^[A-Z]/.test(receiver.text)) return true
  // Lowercase identifier matching ORM-receiver allowlist
  if (receiver.type === 'identifier' && ORM_RECEIVER_HINTS.has(receiver.text.toLowerCase())) return true
  // call_expression: e.g. session.query(User).update(...) — receiver chain hits a call
  if (receiver.type === 'call') return true
  return false
}

function isPythonExternalDataAccess(node: SyntaxNode): boolean {
  if (node.type === 'attribute') {
    const obj = node.childForFieldName('object')
    const attr = node.childForFieldName('attribute')
    if (!obj || !attr) return false
    if (PYTHON_EXTERNAL_SOURCES.has(obj.text) && PYTHON_EXTERNAL_PROPERTIES.has(attr.text)) return true
    if (obj.type === 'attribute') return isPythonExternalDataAccess(obj)
  }
  if (node.type === 'identifier') {
    const name = node.text.toLowerCase()
    if (name === 'payload' || name === 'body' || name === 'data') return true
  }
  return false
}

export const pythonUnvalidatedExternalDataVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/unvalidated-external-data',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const methodName = getPythonMethodName(node)
    if (!PYTHON_WRITE_METHODS.has(methodName) && !PYTHON_SQL_METHODS.has(methodName)) return null

    // Receiver must be ORM-shaped — otherwise `.update(payload)` is
    // most likely a Pydantic / dict in-memory merge, not a DB write.
    if (!hasOrmShapedReceiver(node)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (isPythonExternalDataAccess(arg)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unvalidated external data used in database write',
          `External data (e.g., \`request.data\`, \`request.json\`) passed directly to \`${methodName}()\` without schema validation. Validate input with a serializer or schema library before writing to the database.`,
          sourceCode,
          'Validate external data with a schema/serializer before using it in database operations.',
        )
      }
    }

    return null
  },
}
