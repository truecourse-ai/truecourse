import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonIsLiteralComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/is-literal-comparison',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const children = node.children

    // Look for `is` or `is not` operator
    let isOperator = false
    for (const child of children) {
      if (child.type === 'is' || (child.type === 'is' && child.text === 'is')) isOperator = true
      if (child.text === 'is' || child.text === 'is not') isOperator = true
    }
    if (!isOperator) return null

    const LITERAL_TYPES = new Set(['string', 'integer', 'float', 'concatenated_string', 'bytes'])

    for (const child of node.namedChildren) {
      if (LITERAL_TYPES.has(child.type)) {
        const opText = children.find((c) => c.text === 'is' || c.text === 'is not')?.text ?? 'is'
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Identity comparison with literal',
          `Using \`${opText}\` with a literal value (\`${child.text}\`) is unreliable — Python may or may not intern the value. Use \`==\` for value equality.`,
          sourceCode,
          `Replace \`${opText}\` with \`==\` or \`!=\` for value comparison.`,
        )
      }
    }

    return null
  },
}
