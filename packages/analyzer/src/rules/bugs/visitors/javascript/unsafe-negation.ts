import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const unsafeNegationVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unsafe-negation',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const operator = node.children.find((c) => c.text === 'instanceof' || c.text === 'in')

    if (!left || !operator) return null

    if (left.type === 'unary_expression') {
      const bang = left.children.find((c) => c.text === '!')
      if (bang) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unsafe negation',
          `\`${node.text}\` negates the left operand, not the result. Use \`!(${left.childForFieldName('argument')?.text} ${operator.text} ${node.childForFieldName('right')?.text})\` instead.`,
          sourceCode,
          `Wrap the entire expression in parentheses: !(a ${operator.text} B).`,
        )
      }
    }
    return null
  },
}
