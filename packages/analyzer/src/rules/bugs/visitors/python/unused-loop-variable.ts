import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects loop variables that are never used in the loop body.
 * Pattern: for x in items: (body doesn't use x) — should be `for _ in items:`
 */
export const pythonUnusedLoopVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unused-loop-variable',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const body = node.childForFieldName('body')

    if (!left || !body) return null

    // Only handle simple identifier loop variables (not tuple unpacking)
    if (left.type !== 'identifier') return null

    const varName = left.text

    // Skip if already using _ convention
    if (varName === '_' || varName.startsWith('_')) return null

    // Check if the variable is used in the body
    function isUsedInBody(n: import('tree-sitter').SyntaxNode): boolean {
      if (n.type === 'identifier' && n.text === varName) {
        // Make sure it's not the loop variable definition itself
        if (n !== left) return true
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && isUsedInBody(child)) return true
      }
      return false
    }

    if (!isUsedInBody(body)) {
      return makeViolation(
        this.ruleKey, left, filePath, 'low',
        'Unused loop control variable',
        `Loop variable \`${varName}\` is never used in the loop body — use \`_\` to indicate intentional discard.`,
        sourceCode,
        `Replace \`${varName}\` with \`_\` to make it clear the loop variable is intentionally unused.`,
      )
    }

    return null
  },
}
