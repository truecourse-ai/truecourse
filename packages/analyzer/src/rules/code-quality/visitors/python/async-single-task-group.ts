import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects TaskGroup / anyio.create_task_group / trio.open_nursery used
 * with only a single task start call — use asyncio.create_task instead.
 */
export const pythonAsyncSingleTaskGroupVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/async-single-task-group',
  languages: ['python'],
  nodeTypes: ['with_statement'],
  visit(node, filePath, sourceCode) {
    // Look for `async with anyio.create_task_group() as tg:` or similar
    const withItems = node.namedChildren.filter((c) => c.type === 'with_item' || c.type === 'as_pattern')
    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if any with-item context is a task group
    const ctxText = node.text
    const isTaskGroup =
      ctxText.includes('create_task_group') ||
      ctxText.includes('open_nursery') ||
      ctxText.includes('TaskGroup')
    if (!isTaskGroup) return null

    // Count start_soon / start / start_soon calls in the body
    let startCallCount = 0
    function countStartCalls(n: typeof node) {
      if (n.type === 'call') {
        const fn = n.childForFieldName('function')
        if (fn?.type === 'attribute') {
          const attr = fn.childForFieldName('attribute')
          if (attr?.text === 'start_soon' || attr?.text === 'start' || attr?.text === 'start_soon') {
            startCallCount++
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) countStartCalls(child)
      }
    }
    countStartCalls(body)

    if (startCallCount !== 1) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Single task in TaskGroup',
      'TaskGroup/Nursery with only a single task start is unnecessary overhead. Use `asyncio.create_task()` directly instead.',
      sourceCode,
      'Replace the TaskGroup with a direct `asyncio.create_task()` call.',
    )
  },
}
