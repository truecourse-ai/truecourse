import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnnecessaryLambdaVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-lambda',
  languages: ['python'],
  nodeTypes: ['lambda'],
  visit(node, filePath, sourceCode) {
    // Check if body is a single call
    const body = node.childForFieldName('body')
    if (!body || body.type !== 'call') return null

    // Get lambda parameters
    const params = node.childForFieldName('parameters')
    const paramNames = params
      ? params.namedChildren.map((p) => p.type === 'identifier' ? p.text : p.childForFieldName('name')?.text).filter(Boolean)
      : []

    // Get the function being called and its arguments
    const fn = body.childForFieldName('function')
    const args = body.childForFieldName('arguments')
    if (!fn || !args) return null

    // Check if the call args exactly match lambda params in order
    const callArgs = args.namedChildren.filter((a) => a.type !== 'keyword_argument')
    if (callArgs.length !== paramNames.length) return null
    if (paramNames.length === 0) {
      // lambda: func() → just use func
      const fnText = fn.text
      if (!fnText.includes('(')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Unnecessary lambda',
          `\`lambda: ${body.text}\` just calls \`${fnText}\` — pass \`${fnText}\` directly.`,
          sourceCode,
          `Replace the lambda with the function reference \`${fnText}\` directly.`,
        )
      }
    }
    const allMatch = callArgs.every((arg, i) => arg.text === paramNames[i])
    if (!allMatch) return null

    const fnText = fn.text
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary lambda',
      `\`lambda ${paramNames.join(', ')}: ${body.text}\` just forwards arguments to \`${fnText}\` — pass \`${fnText}\` directly.`,
      sourceCode,
      `Replace the lambda with a direct reference to \`${fnText}\`.`,
    )
  },
}
