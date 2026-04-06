import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES, TERMINAL_TYPES } from './_helpers.js'

export const unreachableCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unreachable-code',
  languages: JS_LANGUAGES,
  nodeTypes: ['statement_block'],
  visit(node, filePath, sourceCode) {
    const children = node.namedChildren.filter((c) => c.type !== 'comment')
    for (let i = 0; i < children.length - 1; i++) {
      if (TERMINAL_TYPES.has(children[i].type)) {
        const unreachable = children[i + 1]
        // Skip if the unreachable node is a function/class declaration (hoisted)
        if (unreachable.type === 'function_declaration' || unreachable.type === 'class_declaration') continue
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
