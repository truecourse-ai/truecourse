import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const extraNonNullAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/extra-non-null-assertion',
  languages: JS_LANGUAGES,
  nodeTypes: ['non_null_expression'],
  visit(node, filePath, sourceCode) {
    // Check if the inner expression is also a non_null_expression
    const inner = node.namedChildren[0]
    if (inner?.type === 'non_null_expression') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Extra non-null assertion',
        `\`${node.text}\` has a redundant double \`!!\` non-null assertion — one \`!\` is sufficient.`,
        sourceCode,
        `Remove one of the \`!\` operators: \`${inner.text}\`.`,
      )
    }
    return null
  },
}
