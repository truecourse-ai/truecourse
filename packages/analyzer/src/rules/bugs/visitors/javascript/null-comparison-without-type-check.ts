import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const nullComparisonWithoutTypeCheckVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/null-comparison-without-type-check',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => c.text === '==' || c.text === '!=')

    if (!left || !right || !operator) return null

    function isNull(n: SyntaxNode): boolean {
      return n.type === 'null'
    }

    if (isNull(right) || isNull(left)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Null comparison without type check',
        `\`${node.text}\` — \`== null\` matches both \`null\` and \`undefined\`. Use \`=== null\` for a precise check.`,
        sourceCode,
        `Replace \`${operator.text} null\` with \`${operator.text === '==' ? '===' : '!=='} null\` for a strict null check.`,
      )
    }
    return null
  },
}
