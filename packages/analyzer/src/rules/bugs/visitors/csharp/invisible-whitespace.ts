import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Invisible/irregular whitespace characters that can cause subtle bugs.
const INVISIBLE_WS_RE = /[\u000B\u000C\u00A0\u0085\u1680\u180E\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/

/**
 * Invisible Unicode whitespace inside identifiers or string literals —
 * looks identical to a regular space but compares differently at runtime.
 */
export const csharpInvisibleWhitespaceVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invisible-whitespace',
  languages: ['csharp'],
  nodeTypes: ['identifier', 'string_literal', 'verbatim_string_literal', 'raw_string_literal', 'interpolated_string_expression'],
  visit(node, filePath, sourceCode) {
    if (!INVISIBLE_WS_RE.test(node.text)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Invisible whitespace character',
      'This code contains an invisible or irregular whitespace character (e.g. a non-breaking space) that may cause unexpected comparisons or parsing issues.',
      sourceCode,
      'Replace the invisible whitespace character with a regular space, or use an explicit escape sequence.',
    )
  },
}
