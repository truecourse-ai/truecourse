import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDecimalFromFloatVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/decimal-from-float',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    const isDecimal =
      (fn.type === 'identifier' && fn.text === 'Decimal') ||
      (fn.type === 'attribute' && fn.childForFieldName('attribute')?.text === 'Decimal')
    if (!isDecimal) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren.find((c) => c.type !== 'comment')
    if (!firstArg) return null

    if (firstArg.type === 'float' || firstArg.type === 'integer') {
      // Integer is OK — it's exact. Flag floats only.
      if (firstArg.type === 'float') {
        return makeViolation(
          this.ruleKey, firstArg, filePath, 'high',
          'Decimal constructed from float literal',
          `\`Decimal(${firstArg.text})\` creates an imprecise Decimal because \`${firstArg.text}\` cannot be represented exactly in binary floating point. Use a string literal instead.`,
          sourceCode,
          `Replace with \`Decimal("${firstArg.text}")\` to get the exact decimal value.`,
        )
      }
    }
    return null
  },
}
