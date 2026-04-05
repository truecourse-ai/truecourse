import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const deleteVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/delete-variable',
  languages: JS_LANGUAGES,
  nodeTypes: ['unary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.text === 'delete')
    if (!op) return null

    const argument = node.childForFieldName('argument')
    if (!argument) return null

    // Only flag `delete identifier` (plain variable), not `delete obj.prop` or `delete obj[key]`
    if (argument.type === 'identifier') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Delete on variable',
        `\`delete ${argument.text}\` has no effect on a variable — \`delete\` only works on object properties.`,
        sourceCode,
        'Remove this `delete` statement or assign the variable to `undefined` instead.',
      )
    }
    return null
  },
}
