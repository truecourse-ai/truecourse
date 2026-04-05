import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Numbers and strings that are considered "magic" (not obvious constants)
const SAFE_NUMBERS = new Set(['0', '1', '-1', '2', 'True', 'False', 'None'])

export const pythonMagicValueComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/magic-value-comparison',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    // Get all operands
    const operands = node.namedChildren

    for (const operand of operands) {
      if (operand.type === 'integer' || operand.type === 'float') {
        if (!SAFE_NUMBERS.has(operand.text)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Magic value comparison',
            `Comparing against magic number \`${operand.text}\` — extract to a named constant for clarity.`,
            sourceCode,
            'Extract the magic value to a named constant at module or class level.',
          )
        }
      }
      // Magic string check (non-empty, non-trivial strings)
      if (operand.type === 'string') {
        const text = operand.text
        const inner = text.slice(1, -1) // strip quotes
        if (inner.length > 1 && !inner.startsWith('\\')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Magic value comparison',
            `Comparing against magic string \`${operand.text}\` — extract to a named constant for clarity.`,
            sourceCode,
            'Extract the magic string to a named constant at module or class level.',
          )
        }
      }
    }
    return null
  },
}
