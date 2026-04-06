import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const forInArrayVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/for-in-array',
  languages: JS_LANGUAGES,
  nodeTypes: ['for_in_statement'],
  visit(node, filePath, sourceCode) {
    // Check if the `in` keyword is present (for...in, not for...of)
    const hasIn = node.children.some((c) => c.text === 'in')
    const hasOf = node.children.some((c) => c.text === 'of')

    if (!hasIn || hasOf) return null

    // Only flag if the right side is clearly an array literal or .length usage
    const right = node.childForFieldName('right') || node.namedChildren.find((_c, i) => i === node.namedChildren.length - 1)

    // We can't always know if the right side is an array
    // Flag if the right is obviously an array literal
    if (right?.type === 'array') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'for-in loop on array',
        '`for...in` on an array iterates over index keys as strings, not values. Use `for...of` instead.',
        sourceCode,
        'Replace `for (k in arr)` with `for (const item of arr)` to iterate over values.',
      )
    }

    return null
  },
}
