import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const literalAssertionOverConstVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/literal-assertion-over-const',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['as_expression'],
  visit(node, filePath, sourceCode) {
    const typeNode = node.namedChildren[node.namedChildCount - 1]
    if (!typeNode) return null

    if (typeNode.type === 'literal_type') {
      const lit = typeNode.namedChildren[0]
      if (lit?.type === 'string' || lit?.type === 'number') {
        const expr = node.namedChildren[0]
        const exprText = expr?.text ?? 'value'
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Prefer as const over literal assertion',
          `\`${exprText} as ${typeNode.text}\` — use \`${exprText} as const\` to preserve the literal type.`,
          sourceCode,
          `Replace \`as ${typeNode.text}\` with \`as const\`.`,
        )
      }
    }
    return null
  },
}
