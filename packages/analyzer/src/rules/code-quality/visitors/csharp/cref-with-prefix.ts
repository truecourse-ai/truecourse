import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * An XML documentation `cref` may carry a member-kind prefix (`cref="T:Foo"`,
 * `cref="M:Foo.Bar"`). When the prefix is present the compiler treats the
 * reference as a verbatim string and stops verifying it, so a rename silently
 * leaves the doc pointing at a name that no longer exists. Dropping the prefix
 * (`cref="Foo"`) lets the compiler bind and validate the reference.
 */

// Single-letter member-kind prefix followed by a colon inside a cref value.
const CREF_PREFIX = /\bcref\s*=\s*"([NTMPEF!]):/

export const csharpCrefWithPrefixVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/cref-with-prefix',
  languages: ['csharp'],
  nodeTypes: ['comment'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // Only XML doc comments (`///` or `/** */`) carry crefs.
    if (!text.startsWith('///') && !text.startsWith('/**')) return null
    const m = CREF_PREFIX.exec(text)
    if (!m) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Doc cref uses a prefix',
      `The XML doc \`cref\` carries a \`${m[1]}:\` prefix, which stops the compiler from verifying the reference and prevents tooling from updating it on rename.`,
      sourceCode,
      'Remove the prefix so the cref reads as a plain code reference the compiler can bind.',
    )
  },
}
