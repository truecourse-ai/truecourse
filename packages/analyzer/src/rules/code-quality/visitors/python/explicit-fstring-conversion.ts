import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonExplicitFstringConversionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/explicit-fstring-conversion',
  languages: ['python'],
  nodeTypes: ['interpolation'],
  visit(node, filePath, sourceCode) {
    // f-string interpolation: {str(x)} should be {x!s}
    // The expression inside the interpolation is a call to str(), repr(), or ascii()
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'call') return null

    const fn = expr.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null

    const conversionMap: Record<string, string> = {
      str: '!s',
      repr: '!r',
      ascii: '!a',
    }

    const conversion = conversionMap[fn.text]
    if (!conversion) return null

    const args = expr.childForFieldName('arguments')
    if (!args || args.namedChildCount !== 1) return null

    const innerArg = args.namedChildren[0]?.text ?? 'x'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Use f-string ${conversion} conversion flag`,
      `\`{${fn.text}(${innerArg})}\` in f-string should use explicit conversion flag \`{${innerArg}${conversion}}\`.`,
      sourceCode,
      `Replace \`{${fn.text}(${innerArg})}\` with \`{${innerArg}${conversion}}\`.`,
    )
  },
}
