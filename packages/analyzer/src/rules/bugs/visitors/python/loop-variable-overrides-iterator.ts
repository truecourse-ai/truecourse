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

    // Check if the iterator expression contains the same identifier
    function containsIdentifier(n: import('tree-sitter').SyntaxNode, name: string): boolean {
      if (n.type === 'identifier' && n.text === name) return true
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && containsIdentifier(child, name)) return true
      }
      return false
    }

    if (containsIdentifier(iterExpr, varName)) {
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
