import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const tripleSlashReferenceVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/triple-slash-reference',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text.trim()
    // Only the `path=` form is legacy and replaceable by a regular `import`.
    // `types=` (ambient declarations) and `lib=` (TS lib selection) are the
    // canonical TypeScript directives for things `import` cannot express.
    if (/^\/\/\/\s*<reference\s+path=/.test(text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Triple-slash reference directive',
        'Triple-slash `/// <reference path=...>` directives are legacy. Use `import` statements instead.',
        sourceCode,
        'Replace the triple-slash reference with an `import` statement.',
      )
    }
    return null
  },
}
