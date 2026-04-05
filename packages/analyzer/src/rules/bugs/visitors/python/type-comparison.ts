import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonTypeComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/type-comparison-instead-of-isinstance',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const children = node.children
    const eqOp = children.find((c) => c.text === '==' || c.text === '!=' || c.text === 'is' || c.text === 'is not')
    if (!eqOp) return null

    for (const child of node.namedChildren) {
      if (child.type === 'call') {
        const fn = child.childForFieldName('function')
        if (fn?.type === 'identifier' && fn.text === 'type') {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Direct type comparison',
            `\`${node.text}\` compares with \`type()\` — use \`isinstance()\` instead to also match subclasses.`,
            sourceCode,
            `Replace \`type(x) ${eqOp.text} Y\` with \`isinstance(x, Y)\`.`,
          )
        }
      }
    }

    return null
  },
}
