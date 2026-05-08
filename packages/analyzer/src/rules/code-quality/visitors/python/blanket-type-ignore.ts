import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonBlanketTypeIgnoreVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/blanket-type-ignore',
  languages: ['python'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // Match: # type: ignore (without a specific error code in brackets).
    // Valid with code: \`# type: ignore[attr-defined]\` (no space) or
    // \`# type: ignore [attr-defined]\` (with space). Both forms have
    // an explicit code list and should be considered scoped, not blanket.
    const hasScopedCode = /# *type: *ignore\s*\[[^\]]+\]/.test(text)
    if (hasScopedCode) return null
    const blanketMatch = /# *type: *ignore\b/.test(text)
    if (blanketMatch) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Blanket type: ignore comment',
        '`# type: ignore` without a specific error code suppresses all type errors on this line — this can hide real type problems.',
        sourceCode,
        'Specify the error code: `# type: ignore[error-code]`. Run mypy to find the specific error code to suppress.',
      )
    }

    return null
  },
}
