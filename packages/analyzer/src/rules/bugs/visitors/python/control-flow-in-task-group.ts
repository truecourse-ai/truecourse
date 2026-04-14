import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const TASK_GROUP_CONTEXTS = new Set([
  'anyio.create_task_group', 'trio.open_nursery', 'asyncio.TaskGroup',
  'create_task_group', 'open_nursery', 'TaskGroup',
])

const CONTROL_FLOW_TYPES = new Set(['return_statement', 'break_statement', 'continue_statement'])

function isInsideTaskGroup(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'with_statement') {
      // Check if any with clause uses a task group
      let found = false
      function checkForTaskGroup(n: SyntaxNode) {
        if (n.type === 'call') {
          const fn = n.childForFieldName('function')
          if (fn) {
            const text = fn.text
            if (TASK_GROUP_CONTEXTS.has(text)) found = true
          }
        }
        for (let i = 0; i < n.childCount; i++) {
          const child = n.child(i)
          if (child && !found) checkForTaskGroup(child)
        }
      }
      checkForTaskGroup(current)
      if (found) return true
    }
    // Stop at function boundary
    if (current.type === 'function_definition') break
    current = current.parent
  }
  return false
}

export const pythonControlFlowInTaskGroupVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/control-flow-in-task-group',
  languages: ['python'],
  nodeTypes: ['return_statement', 'break_statement', 'continue_statement'],
  visit(node, filePath, sourceCode) {
    if (!isInsideTaskGroup(node)) return null

    const flowType = node.type.replace('_statement', '')

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Control flow in TaskGroup block',
      `\`${flowType}\` inside a TaskGroup/Nursery block may cancel child tasks unexpectedly. The task group may not complete cleanly.`,
      sourceCode,
      'Restructure the code to avoid early exits from TaskGroup blocks.',
    )
  },
}
