import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects a variable assigned immediately then reassigned without any use in between.
 *   x = 1
 *   x = 2   ← second declaration overwrites first
 */
export const pythonRedeclaredAssignedNameVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redeclared-assigned-name',
  languages: ['python'],
  nodeTypes: ['block', 'module'],
  visit(node, filePath, sourceCode) {
    const children = node.namedChildren
    const lastAssignment = new Map<string, number>() // name → index of last assignment

    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (child.type === 'expression_statement') {
        const expr = child.namedChildren[0]
        if (!expr) continue
        if (expr.type === 'assignment') {
          const target = expr.childForFieldName('left')
          if (!target || target.type !== 'identifier') continue
          const name = target.text
          if (lastAssignment.has(name)) {
            // Check that between previous assignment and this one there's no reference to name
            const prevIdx = lastAssignment.get(name)!
            let usedBetween = false
            for (let j = prevIdx + 1; j < i; j++) {
              const between = children[j]
              if (between.text.includes(name)) {
                usedBetween = true
                break
              }
            }
            if (!usedBetween) {
              return makeViolation(
                this.ruleKey, child, filePath, 'medium',
                'Variable redeclared without use',
                `\`${name}\` is assigned again without being used since the previous assignment — the previous value is lost.`,
                sourceCode,
                `Remove the first assignment to \`${name}\` or use its value before reassigning.`,
              )
            }
          }
          lastAssignment.set(name, i)
        } else {
          // Any other expression — references may occur; clear assignments for names that appear
          for (const [name] of lastAssignment) {
            if (child.text.includes(name)) {
              lastAssignment.delete(name)
            }
          }
        }
      } else {
        // Non-assignment statement — references names
        for (const [name] of lastAssignment) {
          if (child.text.includes(name)) {
            lastAssignment.delete(name)
          }
        }
      }
    }

    return null
  },
}
