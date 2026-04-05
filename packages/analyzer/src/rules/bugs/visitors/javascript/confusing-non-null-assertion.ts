import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const confusingNonNullAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/confusing-non-null-assertion',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const operator = node.children.find((c) => c.text === '==' || c.text === '!=')

    if (!left || !operator) return null

    // Check if left is a non_null_expression (TypeScript !)
    if (left.type === 'non_null_expression') {
      const inner = left.namedChildren[0]
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Confusing non-null assertion',
        `\`${inner?.text}! ${operator.text} ${node.childForFieldName('right')?.text}\` looks like \`${inner?.text} !${operator.text} ${node.childForFieldName('right')?.text}\` — add a space or use \`===\`/\`!==\`.`,
        sourceCode,
        `Use \`${operator.text === '==' ? '===' : '!=='}\` for strict equality, or add parentheses: \`(${inner?.text}!) ${operator.text} value\`.`,
      )
    }
    return null
  },
}
