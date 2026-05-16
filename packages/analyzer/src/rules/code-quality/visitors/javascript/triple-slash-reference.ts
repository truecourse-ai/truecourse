import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const tripleSlashReferenceVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/triple-slash-reference',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text.trim()
    // Only flag `<reference path=...>` — that form references another file as a
    // module dependency and is the legacy equivalent of an `import` statement.
    //
    // Do NOT flag `<reference types="..." />` or `<reference lib="..." />`:
    //   - `types=` pulls in ambient declarations from a typings package (e.g.
    //     `vite/client`, `node`, locally generated ORM types). These augment the
    //     global namespace and cannot be expressed with `import` — modules
    //     cannot contribute to the ambient global scope.
    //   - `lib=` references built-in TypeScript library declarations and is also
    //     not replaceable with `import`.
    if (/^\/\/\/\s*<reference\s+path=/.test(text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Triple-slash reference directive',
        'Triple-slash `/// <reference path=... />` directives are legacy. Use `import` statements instead.',
        sourceCode,
        'Replace the triple-slash reference with an `import` statement.',
      )
    }
    return null
  },
}
