import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const arrayDeleteVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/array-delete',
  languages: JS_LANGUAGES,
  nodeTypes: ['unary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.text === 'delete')
    if (!op) return null

    const argument = node.childForFieldName('argument')
    if (!argument || argument.type !== 'subscript_expression') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'delete on array element',
      `\`${node.text}\` leaves a hole (undefined slot) in the array instead of removing the element. Use \`splice()\` to properly remove elements.`,
      sourceCode,
      'Use `arr.splice(index, 1)` to remove an element without leaving a hole.',
    )
  },
}
