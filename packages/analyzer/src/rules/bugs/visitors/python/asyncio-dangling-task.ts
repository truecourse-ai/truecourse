import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAsyncioDanglingTaskVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/asyncio-dangling-task',
  languages: ['python'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'call') return null

    const fn = expr.childForFieldName('function')
    if (!fn) return null

    // Match asyncio.create_task(...)
    let isCreateTask = false
    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if (obj?.text === 'asyncio' && attr?.text === 'create_task') isCreateTask = true
    }
    // Also match bare create_task(...) if imported
    if (fn.type === 'identifier' && fn.text === 'create_task') isCreateTask = true

    if (!isCreateTask) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Asyncio dangling task',
      '`asyncio.create_task()` result is not saved. The task may be garbage-collected before it completes, silently cancelling it.',
      sourceCode,
      'Save the task reference: `task = asyncio.create_task(...)` and keep it alive for the task\'s duration.',
    )
  },
}
