import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// The `u`/`v` flag only changes behavior when the pattern actually deals with
// non-ASCII text: literal non-ASCII characters, unicode escapes (`\u…`,
// `\p{…}`), or surrogate-relevant constructs. For a pure-ASCII pattern like
// `/[a-z]+/` or `/^\d{4}$/`, adding `u` is a no-op — requiring it is noise.
function unicodeFlagWouldMatter(pattern: string): boolean {
  // Any non-ASCII codepoint in the source pattern.
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(pattern)) return true
  // Unicode-specific escapes whose semantics differ under the u/v flag.
  //   \u{...} codepoint escapes, \p{...}/\P{...} property escapes.
  if (/\\u\{/.test(pattern)) return true
  if (/\\[pP]\{/.test(pattern)) return true
  return false
}

export const requireUnicodeRegexpVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/require-unicode-regexp',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    // Check if the regex has the u or v flag
    const flags = node.childForFieldName('flags')
    const flagText = flags?.text ?? ''

    if (flagText.includes('u') || flagText.includes('v')) return null

    // Only flag when the unicode flag would actually change matching behavior.
    // Pure-ASCII patterns are unaffected by `u`, so requiring it is a false
    // positive.
    const pattern = node.namedChildren.find((c) => c.type === 'regex_pattern')?.text ?? ''
    if (!unicodeFlagWouldMatter(pattern)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'RegExp missing unicode flag',
      'Regular expression should use the `u` or `v` flag for correct Unicode character handling.',
      sourceCode,
      `Add the \`u\` flag: ${node.text}u`,
    )
  },
}
