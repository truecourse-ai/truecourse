import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const INTENDED: Record<string, string> = { '+': '+=', '-': '-=', '!': '!=' }

/**
 * `x =+ y` / `x =- y` / `x =! y` — parses as `x = (+y)` etc., but the
 * spacing (operator pair glued together, space before the operand) is the
 * signature of a `+=` / `-=` / `!=` typo. `x = -y` and `x=-y` are never
 * flagged.
 */
export const csharpNonExistentOperatorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/non-existent-operator',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const operator = node.childForFieldName('operator')
    if (!operator || operator.text !== '=') return null

    const right = node.childForFieldName('right')
    if (right?.type !== 'prefix_unary_expression') return null

    const unaryToken = right.children[0]
    const operand = right.namedChildren[0]
    if (!unaryToken || !operand) return null
    const intended = INTENDED[unaryToken.text]
    if (!intended) return null

    // `=` glued to the unary operator, whitespace before the operand.
    if (operator.endIndex !== right.startIndex) return null
    if (unaryToken.endIndex >= operand.startIndex) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Non-existent operator',
      `\`=${unaryToken.text}\` is not an operator — this parses as \`= ${unaryToken.text}${operand.text}\`, but the spacing suggests \`${intended}\` was intended.`,
      sourceCode,
      `Replace \`=${unaryToken.text}\` with \`${intended}\`, or write \`= ${unaryToken.text}${operand.text}\` if the unary operator is intentional.`,
    )
  },
}
