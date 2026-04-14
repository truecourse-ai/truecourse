import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const implicitTypeCoercionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/implicit-type-coercion',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['unary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children[0]
    if (!op) return null

    if (op.text === '+') {
      const operand = node.namedChildren[0]
      if (!operand) return null
      if (operand.type === 'number') return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Implicit numeric coercion',
        '`+value` coerces to a number implicitly. Use `Number(value)` or `parseInt(value)` for clarity.',
        sourceCode,
        'Replace `+value` with `Number(value)` or `parseInt(value, 10)` for explicit conversion.',
      )
    }

    if (op.text === '~') {
      const operand = node.namedChildren[0]
      if (operand?.type === 'call_expression') {
        const fn = operand.childForFieldName('function')
        if (fn?.type === 'member_expression') {
          const fnProp = fn.childForFieldName('property')
          if (fnProp?.text === 'indexOf') {
            return makeViolation(
              this.ruleKey, node, filePath, 'low',
              'Implicit coercion via ~indexOf()',
              '`~arr.indexOf(x)` as a boolean check is confusing. Use `arr.includes(x)` instead.',
              sourceCode,
              'Replace `~arr.indexOf(x)` with `arr.includes(x)`.',
            )
          }
        }
      }
    }

    return null
  },
}
