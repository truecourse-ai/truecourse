import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonLoopVariableOverridesIteratorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/loop-variable-overrides-iterator',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const loopVar = node.childForFieldName('left')
    const iterExpr = node.childForFieldName('right')

    if (!loopVar || !iterExpr) return null

    // Only handle simple identifier loop variables
    if (loopVar.type !== 'identifier') return null
    const varName = loopVar.text

    // Fire when the iterable expression contains a *free* use of the loop
    // variable's name — i.e. one that would resolve to the outer-scope
    // binding the loop variable is about to shadow. `for fields in
    // range(len(fields))` is the canonical bug. The trailing `x` in `obj.x`
    // is an attribute name (not a variable reference), so `for x in obj.x`
    // is fine.
    function hasFreeUse(n: import('web-tree-sitter').Node, name: string): boolean {
      if (n.type === 'identifier' && n.text === name) {
        const parent = n.parent
        // Skip when this identifier is the *attribute* part of `obj.attr`.
        if (parent?.type === 'attribute' && parent.childForFieldName('attribute')?.id === n.id) {
          return false
        }
        // Skip when this identifier is a keyword-argument name (`f(x=1)`).
        if (parent?.type === 'keyword_argument' && parent.childForFieldName('name')?.id === n.id) {
          return false
        }
        return true
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasFreeUse(child, name)) return true
      }
      return false
    }

    if (hasFreeUse(iterExpr, varName)) {
      return makeViolation(
        this.ruleKey, loopVar, filePath, 'high',
        'Loop variable overrides iterator',
        `Loop variable \`${varName}\` has the same name as the iterable \`${iterExpr.text}\` — after the first iteration \`${varName}\` no longer references the original iterable.`,
        sourceCode,
        `Rename the loop variable to something different from \`${iterExpr.text}\`.`,
      )
    }

    return null
  },
}
