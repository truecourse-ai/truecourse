import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { PY_TERMINAL_TYPES } from './_helpers.js'

export const pythonUnreachableCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unreachable-code',
  languages: ['python'],
  nodeTypes: ['block'],
  visit(node, filePath, sourceCode) {
    const children = node.namedChildren.filter((c) => c.type !== 'comment')
    for (let i = 0; i < children.length - 1; i++) {
      if (PY_TERMINAL_TYPES.has(children[i].type)) {
        const unreachable = children[i + 1]
        // Skip function/class definitions (they're declarations, not executable code at that point)
        if (unreachable.type === 'function_definition' || unreachable.type === 'class_definition') continue
        return makeViolation(
          this.ruleKey, unreachable, filePath, 'medium',
          'Unreachable code',
          `Code after \`${children[i].type.replace('_statement', '')}\` can never execute.`,
          sourceCode,
          'Remove the unreachable code or move it before the terminating statement.',
        )
      }
    }
    return null
  },
}
