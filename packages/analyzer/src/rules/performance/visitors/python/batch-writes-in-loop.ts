import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsidePythonLoop } from './_helpers.js'

/**
 * ORM session/connection receiver names that indicate a real database write.
 * Generic variable names like `seen_ids`, `result_set`, `tags` are NOT
 * ORM objects — their `.add()` / `.update()` calls are plain Python
 * collection operations, not database writes.
 */
const ORM_RECEIVER_NAMES = new Set([
  'session', 'db', 'db_session', 'database', 'conn', 'connection',
  'cursor', 'tx', 'transaction', 'engine', 'Session',
])

/**
 * Methods that indicate a database write when called on an ORM receiver.
 * Excludes overly generic methods (`add`, `update`, `delete`) that also
 * exist on Python sets/dicts — those are only flagged when the receiver
 * is a known ORM object name.
 */
const ORM_WRITE_METHODS = new Set([
  'save', 'insert', 'create', 'execute', 'add', 'merge', 'update', 'delete',
])

export const batchWritesInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/batch-writes-in-loop',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr || !ORM_WRITE_METHODS.has(attr.text)) return null

    if (!isInsidePythonLoop(node)) return null

    // Exclude commit() as it's often at the end of loops intentionally
    if (attr.text === 'commit') return null

    // Require that the receiver looks like an ORM session/connection object.
    // This prevents flagging `my_set.add(x)`, `my_dict.update(...)`, etc.
    const obj = fn.childForFieldName('object')
    if (!obj) return null

    // The receiver is an identifier — check against known ORM names
    if (obj.type === 'identifier') {
      if (!ORM_RECEIVER_NAMES.has(obj.text)) return null
    } else if (obj.type === 'attribute') {
      // e.g. `self.session.add(...)` — check the terminal attribute name
      const terminalAttr = obj.childForFieldName('attribute')
      if (!terminalAttr || !ORM_RECEIVER_NAMES.has(terminalAttr.text)) return null
    } else {
      // Other shapes (subscript, call return, etc.) — skip to avoid FPs
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Database write inside loop',
      `Calling .${attr.text}() inside a loop performs individual writes. Use bulk operations instead.`,
      sourceCode,
      `Use bulk_create(), executemany(), or batch the operations and call .${attr.text}() once after the loop.`,
    )
  },
}
