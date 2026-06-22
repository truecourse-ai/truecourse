import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A `@`-prefixed verbatim string earns its prefix only when its content holds a
 * backslash, a newline, or an escaped double-quote (`""`) — the things a
 * regular literal would have to escape. When the content has none of those, the
 * verbatim form is pure visual weight and can mask a genuinely intended escape
 * elsewhere. The check reads the raw literal text between the opening `@"` and
 * the closing `"`.
 */
export const csharpUnnecessaryVerbatimStringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-verbatim-string',
  languages: ['csharp'],
  nodeTypes: ['verbatim_string_literal'],
  visit(node, filePath, sourceCode) {
    const raw = node.text
    if (!raw.startsWith('@"') || !raw.endsWith('"')) return null
    const inner = raw.slice(2, -1)

    // Backslash, newline, or an escaped quote all genuinely need verbatim form.
    if (inner.includes('\\') || inner.includes('\n') || inner.includes('\r') || inner.includes('""')) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary verbatim string',
      'This verbatim string contains no backslashes, newlines, or escaped quotes, so the `@` prefix adds nothing.',
      sourceCode,
      'Drop the `@` prefix and use a regular string literal.',
    )
  },
}
