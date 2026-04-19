import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUselessWithLockVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-with-lock',
  languages: ['python'],
  nodeTypes: ['with_statement'],
  visit(node, filePath, sourceCode) {
    // with threading.Lock(): or with Lock(): — creating new lock inline
    // tree-sitter wraps with items in: with_clause > with_item
    const withItems: import('web-tree-sitter').Node[] = []
    for (const child of node.namedChildren) {
      if (child.type === 'with_item') {
        withItems.push(child)
      } else if (child.type === 'with_clause') {
        for (const sub of child.namedChildren) {
          if (sub.type === 'with_item') withItems.push(sub)
        }
      }
    }

    for (const item of withItems) {
      const value = item.namedChildren[0]
      if (!value) continue

      let isNewLock = false
      if (value.type === 'call') {
        const fn = value.childForFieldName('function')
        if (fn) {
          const fnText = fn.text
          if (fnText === 'Lock' || fnText === 'RLock' || fnText === 'Semaphore' ||
              fnText === 'threading.Lock' || fnText === 'threading.RLock' || fnText === 'threading.Semaphore') {
            isNewLock = true
          }
        }
      }

      if (isNewLock) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Useless with-lock pattern',
          'Creating a new `Lock()` inside a `with` statement — the lock is never shared, so it provides no synchronization.',
          sourceCode,
          'Create the lock once at class/module level and reuse it in the `with` statement.',
        )
      }
    }
    return null
  },
}
