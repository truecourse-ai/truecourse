import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { MUTATING_METHODS } from './_helpers.js'

export const pythonModifiedLoopIteratorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/modified-loop-iterator',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const iterExpr = node.childForFieldName('right')
    if (!iterExpr || iterExpr.type !== 'identifier') return null
    const collName = iterExpr.text

    const body = node.childForFieldName('body')
    if (!body) return null

    function findMutation(n: import('web-tree-sitter').Node): import('web-tree-sitter').Node | null {
      // call_expression: coll.add(...), coll.remove(...)
      if (n.type === 'call') {
        const fn = n.childForFieldName('function')
        if (fn?.type === 'attribute') {
          const obj = fn.childForFieldName('object')
          const attr = fn.childForFieldName('attribute')
          if (obj?.text === collName && attr && MUTATING_METHODS.has(attr.text)) {
            return n
          }
        }
      }
      // del coll[...] or del coll
      if (n.type === 'delete_statement') {
        const targets = n.namedChildren
        for (const t of targets) {
          if (t.type === 'subscript' || t.type === 'identifier') {
            const base = t.type === 'subscript' ? t.childForFieldName('value') : t
            if (base?.text === collName) return n
          }
        }
      }
      // Don't recurse into nested functions
      if (n.type === 'function_definition') return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findMutation(child)
          if (found) return found
        }
      }
      return null
    }

    const mutation = findMutation(body)
    if (mutation) {
      return makeViolation(
        this.ruleKey, mutation, filePath, 'high',
        'Modifying collection while iterating',
        `\`${collName}\` is being mutated inside the loop that iterates over it — this raises RuntimeError for sets/dicts or produces unexpected results for lists.`,
        sourceCode,
        `Iterate over a copy: \`for x in list(${collName}):\` or collect changes and apply after the loop.`,
      )
    }

    return null
  },
}
