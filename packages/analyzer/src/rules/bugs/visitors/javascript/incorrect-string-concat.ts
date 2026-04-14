import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const incorrectStringConcatVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/incorrect-string-concat',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => c.text === '+')

    if (!left || !right || !operator) return null

    // Flag: string_literal + number_literal or number_literal + string_literal
    // where both are literals — this is always a type-coercion surprise
    const leftIsString = left.type === 'string' || left.type === 'template_string'
    const rightIsString = right.type === 'string' || right.type === 'template_string'
    const leftIsNumber = left.type === 'number'
    const rightIsNumber = right.type === 'number'

    if ((leftIsString && rightIsNumber) || (leftIsNumber && rightIsString)) {
      // Only flag if embedded in a larger context (not standalone assignment to a const)
      // — flag all cases: string concatenation with numbers is always potentially confusing
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Incorrect string concatenation',
        `\`${node.text}\` adds a string and a number — the number is coerced to a string. Use template literals or explicit \`String()\` / \`Number()\` conversion for clarity.`,
        sourceCode,
        'Use a template literal: `` `${left.text}${right.text}` `` or explicitly convert: `String(value) + other`.',
      )
    }

    return null
  },
}
