import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects assignment to self or cls inside methods.
 * e.g., `self = other` or `cls = other_cls`
 */
export const pythonSelfOrClsAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/self-or-cls-assignment',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    if (!left) return null

    // Check for direct identifier assignment to self or cls
    if (left.type !== 'identifier') return null
    const varName = left.text

    if (varName !== 'self' && varName !== 'cls') return null

    // Make sure we're inside a method (function inside a class)
    let parent = node.parent
    while (parent) {
      if (parent.type === 'function_definition') {
        // Check if this function is inside a class
        let outerParent = parent.parent
        while (outerParent) {
          if (outerParent.type === 'class_definition') {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              `Assignment to ${varName}`,
              `\`${varName}\` is reassigned inside a method — this breaks the method behavior as \`${varName}\` will no longer refer to the instance/class.`,
              sourceCode,
              `Remove the assignment to \`${varName}\` or rename the variable to something else.`,
            )
          }
          if (outerParent.type === 'function_definition') break
          outerParent = outerParent.parent
        }
        break
      }
      parent = parent.parent
    }

    return null
  },
}
