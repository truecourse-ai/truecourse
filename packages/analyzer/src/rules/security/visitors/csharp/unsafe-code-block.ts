import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * The `unsafe` keyword — an `unsafe` modifier on a member or an `unsafe { }`
 * block. Unsafe code uses pointers and bypasses the runtime's memory-safety
 * guarantees, so it warrants explicit scrutiny.
 */
export const csharpUnsafeCodeBlockVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-code-block',
  languages: ['csharp'],
  nodeTypes: ['modifier', 'unsafe_statement'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'modifier' && node.text !== 'unsafe') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unsafe code block',
      'The unsafe keyword enables pointer operations that bypass the runtime\'s memory-safety guarantees and can corrupt memory.',
      sourceCode,
      'Avoid unsafe code; if it is genuinely required, keep it minimal, audited, and isolated.',
    )
  },
}
