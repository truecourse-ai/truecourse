import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects `global x` declarations where x is only read in the function
 * and never assigned — the `global` keyword is unnecessary for reads.
 */
export const pythonGlobalVariableNotAssignedVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/global-variable-not-assigned',
  languages: ['python'],
  nodeTypes: ['global_statement'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (!parent || parent.type !== 'block') return null

    const funcNode = parent.parent
    if (!funcNode || (funcNode.type !== 'function_definition' && funcNode.type !== 'async_function_definition')) return null

    // Get global variable names
    const names = node.namedChildren.map((c) => c.text)

    const funcBody = funcNode.childForFieldName('body')
    if (!funcBody) return null

    for (const name of names) {
      // Check if any assignment to this name exists in the function body (excluding global_statement itself)
      let hasAssignment = false

      function check(n: typeof node) {
        if (n.id === node.id) return
        if (
          n.type === 'assignment' ||
          n.type === 'augmented_assignment' ||
          n.type === 'named_expression'
        ) {
          const target = n.childForFieldName('left') ?? n.childForFieldName('name')
          if (target?.text === name) {
            hasAssignment = true
            return
          }
        }
        // for x in ...: — also assigns
        if (n.type === 'for_statement') {
          const left = n.childForFieldName('left')
          if (left?.text === name) {
            hasAssignment = true
            return
          }
        }
        for (let i = 0; i < n.childCount; i++) {
          const child = n.child(i)
          if (child && !hasAssignment) check(child)
        }
      }

      check(funcBody)

      if (!hasAssignment) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Global declaration for read-only variable',
          `\`global ${name}\` is unnecessary — \`${name}\` is only read, not assigned in this function. Remove the \`global\` declaration.`,
          sourceCode,
          `Remove \`global ${name}\` — it is not needed for reading a global variable.`,
        )
      }
    }

    return null
  },
}
