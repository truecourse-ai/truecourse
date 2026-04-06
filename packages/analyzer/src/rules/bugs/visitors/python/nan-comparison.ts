import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonNanComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/nan-comparison',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const children = node.children
    // Find == or != operators
    for (let i = 0; i < children.length; i++) {
      const op = children[i]
      if (op.text !== '==' && op.text !== '!=') continue

      // Check left and right operands around this operator
      const left = children[i - 1]
      const right = children[i + 1]

      for (const operand of [left, right]) {
        if (!operand) continue
        // float('nan') or float("nan")
        if (operand.type === 'call') {
          const fn = operand.childForFieldName('function')
          if (fn?.text === 'float') {
            const callArgs = operand.childForFieldName('arguments')
            const firstArg = callArgs?.namedChildren[0]
            if (firstArg?.type === 'string') {
              const val = firstArg.text.toLowerCase().replace(/['"]/g, '')
              if (val === 'nan') {
                return makeViolation(
                  this.ruleKey, node, filePath, 'high',
                  'NaN comparison with ==',
                  '`== float("nan")` is always False — NaN is never equal to itself. Use `math.isnan()` instead.',
                  sourceCode,
                  'Use `import math; math.isnan(x)` or `numpy.isnan(x)` to check for NaN.',
                )
              }
            }
          }
        }
        // Direct identifier named NaN
        if (operand.type === 'identifier' && operand.text === 'NaN') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'NaN comparison with ==',
            '`== NaN` is always False — NaN is never equal to itself. Use `math.isnan()` instead.',
            sourceCode,
            'Use `import math; math.isnan(x)` to check for NaN.',
          )
        }
      }
    }
    return null
  },
}
