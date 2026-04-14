import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const lossOfPrecisionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/loss-of-precision',
  languages: JS_LANGUAGES,
  nodeTypes: ['number'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // Skip non-integer literals (floats with decimal points, scientific notation, hex, octal, binary)
    if (text.includes('.') || text.includes('e') || text.includes('E')) return null
    if (text.startsWith('0x') || text.startsWith('0X') || text.startsWith('0o') || text.startsWith('0O') || text.startsWith('0b') || text.startsWith('0B')) return null
    // Skip BigInt literals
    if (text.endsWith('n')) return null

    const num = Number(text)
    if (!Number.isFinite(num)) return null

    if (!Number.isSafeInteger(num)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Loss of precision',
        `\`${text}\` exceeds Number.MAX_SAFE_INTEGER and will lose precision at runtime.`,
        sourceCode,
        `Use BigInt (\`${text}n\`) or restructure to avoid large integer literals.`,
      )
    }
    return null
  },
}
