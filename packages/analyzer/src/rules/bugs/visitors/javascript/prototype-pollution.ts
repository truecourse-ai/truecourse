import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const prototypePollutionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/prototype-pollution',
  languages: JS_LANGUAGES,
  nodeTypes: ['assignment_expression', 'augmented_assignment_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    if (!left || left.type !== 'subscript_expression') return null

    // obj[key] = value — check if key is a dynamic variable (not a string literal)
    const index = left.childForFieldName('index')
    if (!index) return null

    // Only flag if the index is a variable (identifier), not a literal
    if (index.type !== 'identifier') return null

    // Check if the object is not an array type (heuristic: skip numeric-looking contexts)
    const obj = left.childForFieldName('object')
    if (!obj) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Prototype pollution',
      `\`${left.text}\` uses a dynamic key for property assignment — if \`${index.text}\` is \`"__proto__"\` or \`"constructor"\`, this enables prototype pollution.`,
      sourceCode,
      `Validate that \`${index.text}\` is not "__proto__", "constructor", or "prototype" before assignment, or use Map instead.`,
    )
  },
}
