import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonNoneComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/none-comparison-with-equality',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const children = node.children

    // Look for == or != (not is/is not)
    const eqOp = children.find((c) => c.text === '==' || c.text === '!=')
    if (!eqOp) return null

    for (const child of node.namedChildren) {
      if (child.type === 'none') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'None compared with ==',
          `\`${node.text}\` uses \`${eqOp.text}\` to compare with \`None\`. Use \`is\`/\`is not\` instead — \`==\` may give unexpected results if \`__eq__\` is overridden.`,
          sourceCode,
          `Replace \`${eqOp.text} None\` with \`${eqOp.text === '==' ? 'is' : 'is not'} None\`.`,
        )
      }
    }

    return null
  },
}
