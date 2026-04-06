import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const tripleSlashReferenceVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/triple-slash-reference',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text.trim()
    if (/^\/\/\/\s*<reference\s+(path|types|lib)=/.test(text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Triple-slash reference directive',
        'Triple-slash `/// <reference ...>` directives are legacy. Use `import` statements instead.',
        sourceCode,
        'Replace the triple-slash reference with an `import` statement.',
      )
    }
    return null
  },
}
