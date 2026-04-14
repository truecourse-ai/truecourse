import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CONSTANT_LITERALS, JS_LANGUAGES } from './_helpers.js'

export const constantConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/constant-condition',
  languages: JS_LANGUAGES,
  nodeTypes: ['if_statement', 'while_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    const inner = condition.type === 'parenthesized_expression'
      ? condition.namedChildren[0]
      : condition

    if (!inner) return null

    // For while(true), this is idiomatic — skip it
    if (node.type === 'while_statement' && inner.text === 'true') return null

    if (CONSTANT_LITERALS.has(inner.text) || inner.type === 'number') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Constant condition',
        `Condition is always \`${inner.text}\` — this ${node.type === 'if_statement' ? 'branch' : 'loop'} is ${inner.text === 'false' || inner.text === 'null' || inner.text === 'undefined' || inner.text === '0' ? 'dead code' : 'always taken'}.`,
        sourceCode,
        'Remove the condition or fix the logic.',
      )
    }
    return null
  },
}
