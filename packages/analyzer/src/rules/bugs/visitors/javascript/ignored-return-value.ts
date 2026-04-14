import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES, PURE_ARRAY_METHODS } from './_helpers.js'

export const ignoredReturnValueVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/ignored-return-value',
  languages: JS_LANGUAGES,
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'call_expression') return null

    const fn = expr.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || !PURE_ARRAY_METHODS.has(prop.text)) return null

    // Skip if used as an await expression target or similar
    return makeViolation(
      this.ruleKey, expr, filePath, 'high',
      'Ignored return value',
      `The return value of \`.${prop.text}()\` is ignored — this method does not mutate the array in place; the result must be used.`,
      sourceCode,
      `Assign the result: \`const result = arr.${prop.text}(...)\`.`,
    )
  },
}
