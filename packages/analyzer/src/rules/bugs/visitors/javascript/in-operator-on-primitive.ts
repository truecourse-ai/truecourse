import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES, PRIMITIVE_TYPES } from './_helpers.js'

export const inOperatorOnPrimitiveVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/in-operator-on-primitive',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const operator = node.children.find((c) => c.text === 'in')
    if (!operator) return null

    const right = node.childForFieldName('right')
    if (!right) return null

    if (PRIMITIVE_TYPES.has(right.type)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'in operator on primitive',
        `\`"prop" in ${right.text}\` will throw a TypeError — the \`in\` operator only works on objects.`,
        sourceCode,
        'Use an object or replace with `typeof` check.',
      )
    }

    return null
  },
}
