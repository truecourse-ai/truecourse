import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects math.isclose(x, 0) without abs_tol parameter.
 * When comparing against zero, relative tolerance is meaningless.
 */
export const pythonMathIscloseZeroNoAbstolVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/math-isclose-zero-no-abstol',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    const funcText = func.text
    if (funcText !== 'math.isclose' && funcText !== 'isclose') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const positionalArgs = args.namedChildren.filter((a) => a.type !== 'keyword_argument')

    if (positionalArgs.length < 2) return null

    // Check if either argument is 0
    const arg1 = positionalArgs[0]
    const arg2 = positionalArgs[1]

    const isZero = (n: import('tree-sitter').SyntaxNode): boolean =>
      n.text === '0' || n.text === '0.0' || n.text === '0.'

    if (!isZero(arg1) && !isZero(arg2)) return null

    // Check if abs_tol is provided
    const hasAbsTol = args.namedChildren.some((arg) => {
      if (arg.type === 'keyword_argument') {
        const key = arg.childForFieldName('name')
        return key?.text === 'abs_tol'
      }
      return false
    })

    if (!hasAbsTol) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'math.isclose to zero without abs_tol',
        `\`${funcText}(${arg1.text}, ${arg2.text})\` compares against zero without \`abs_tol\` — the default relative tolerance (\`rel_tol=1e-09\`) is useless near zero and this will almost never return True for non-zero values.`,
        sourceCode,
        `Add \`abs_tol\` parameter: \`math.isclose(x, 0, abs_tol=1e-9)\`.`,
      )
    }

    return null
  },
}
