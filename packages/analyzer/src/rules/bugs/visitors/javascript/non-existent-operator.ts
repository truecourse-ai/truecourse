import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const nonExistentOperatorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/non-existent-operator',
  languages: JS_LANGUAGES,
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const right = node.childForFieldName('right')
    if (!right) return null

    // Detect x = +y (where user meant x += y) and x = !y (where user meant x != y)
    // This manifests as: assignment_expression where operator is = and right is unary_expression with + or -
    const op = node.children.find((c) => c.text === '=')
    if (!op) return null

    // Make sure it's plain = (not +=, -=, etc.)
    const opIdx = node.children.findIndex((c) => c.id === op.id)
    if (opIdx === 0) return null

    const before = node.children[opIdx - 1]
    // If the token before = is +, -, !, we have the non-existent operator pattern
    // But this is already handled by the parser — we need to detect via the raw source text
    const nodeText = node.text
    // Match x =+ y, x =- y, x =! y patterns (space optional)
    if (/=\+[^=]/.test(nodeText) || /=![^=]/.test(nodeText)) {
      const pattern = /=\+[^=]/.test(nodeText) ? '=+' : '=!'
      const intended = pattern === '=+' ? '+=' : '!='
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Non-existent operator',
        `\`${pattern}\` is not a valid operator — did you mean \`${intended}\`?`,
        sourceCode,
        `Replace \`${pattern}\` with \`${intended}\`.`,
      )
    }

    return null
  },
}
