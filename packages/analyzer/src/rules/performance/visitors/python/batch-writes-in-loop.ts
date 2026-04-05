import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsidePythonLoop } from './_helpers.js'

const PYTHON_DB_WRITE_METHODS = new Set([
  'save', 'insert', 'create', 'update', 'delete', 'execute', 'add', 'commit',
])

export const batchWritesInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/batch-writes-in-loop',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr || !PYTHON_DB_WRITE_METHODS.has(attr.text)) return null

    if (!isInsidePythonLoop(node)) return null

    // Exclude commit() as it's often at the end of loops intentionally
    if (attr.text === 'commit') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Database write inside loop',
      `Calling .${attr.text}() inside a loop performs individual writes. Use bulk operations instead.`,
      sourceCode,
      `Use bulk_create(), executemany(), or batch the operations and call .${attr.text}() once after the loop.`,
    )
  },
}
