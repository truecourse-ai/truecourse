import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const uselessConcatVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-concat',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.type === '+')
    if (!op) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')

    if (left?.type === 'string' && right?.type === 'string') {
      // Skip when ALL operands in the entire concatenation chain are string literals.
      // Multi-line string literal concatenation is a formatting choice, not a logic error.
      let root = node
      while (root.parent?.type === 'binary_expression') {
        const parentOp = root.parent.children.find((c) => c.type === '+')
        if (parentOp) {
          root = root.parent
        } else {
          break
        }
      }
      // Walk the entire chain and check if every leaf is a string literal
      function allStringLiterals(n: typeof node): boolean {
        if (n.type === 'string') return true
        if (n.type === 'binary_expression') {
          const l = n.childForFieldName('left')
          const r = n.childForFieldName('right')
          const hasPlus = n.children.some((c) => c.type === '+')
          if (hasPlus && l && r) return allStringLiterals(l) && allStringLiterals(r)
        }
        return false
      }
      if (allStringLiterals(root)) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Useless string concatenation',
        `Concatenating two string literals ${left.text} + ${right.text} — merge them into one string.`,
        sourceCode,
        'Combine the string literals into a single string.',
      )
    }
    return null
  },
}
