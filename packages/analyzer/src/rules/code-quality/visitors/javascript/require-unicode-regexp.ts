import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detect structural regex features that imply ASCII-safe behavior:
 * anchors, escapes, character classes, shorthand classes, quantifiers,
 * groups, alternations. When a regex has any of these, the missing `u`
 * flag is overwhelmingly a non-issue for ASCII-only patterns.
 *
 * The rule still fires when:
 *   - the regex source contains a Unicode escape (`\u…`, `\u{…}`, `\p{…}`),
 *   - the regex source contains a non-ASCII codepoint directly,
 *   - the regex source is a bare ASCII literal with no structural features
 *     (e.g. `/hello/`) — `String#includes` is usually correct here, and the
 *     pattern can still misbehave on multi-unit characters without `u`.
 */
function hasStructuralFeatures(pattern: string): boolean {
  // Walk the pattern, ignoring contents of character classes for top-level
  // anchor/alternation detection, but treating `[...]` itself as structural.
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]
    if (c === '\\') {
      // Any escape sequence implies structure (e.g. `\.`, `\d`, `\s`, `\w`,
      // `\b`, `\/`, `\\`, `\n`, `\r`, `\t`, `\f`, `\v`, `\0`).
      return true
    }
    if (c === '[' || c === ']') return true
    if (c === '^' || c === '$') return true
    if (c === '(' || c === ')') return true
    if (c === '|') return true
    if (c === '*' || c === '+' || c === '?') return true
    if (c === '{') return true
    if (c === '.') return true
    i++
  }
  return false
}

function hasUnicodeEscape(pattern: string): boolean {
  // `̀`, `\u{1F600}`, `\p{Letter}`, `\P{...}`
  if (/\\u[0-9a-fA-F]{4}/.test(pattern)) return true
  if (/\\u\{[0-9a-fA-F]+\}/.test(pattern)) return true
  if (/\\[pP]\{[^}]+\}/.test(pattern)) return true
  return false
}

function hasNonAscii(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    if (pattern.charCodeAt(i) > 127) return true
  }
  return false
}

export const requireUnicodeRegexpVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/require-unicode-regexp',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const flags = node.childForFieldName('flags')
    const flagText = flags?.text ?? ''

    if (flagText.includes('u') || flagText.includes('v')) return null

    const patternNode = node.childForFieldName('pattern')
    const pattern = patternNode?.text ?? ''

    // Real Unicode usage — always flag.
    if (hasUnicodeEscape(pattern) || hasNonAscii(pattern)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'RegExp missing unicode flag',
        'Regular expression should use the `u` or `v` flag for correct Unicode character handling.',
        sourceCode,
        `Add the \`u\` flag: ${node.text}u`,
      )
    }

    // Structural ASCII-only regex — anchors, escapes, classes, quantifiers,
    // groups, alternations imply the pattern is operating on ASCII bytes
    // where the `u` flag has no observable effect.
    if (hasStructuralFeatures(pattern)) return null

    // Bare ASCII literal (`/hello/`) — fall through and flag.
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'RegExp missing unicode flag',
      'Regular expression should use the `u` or `v` flag for correct Unicode character handling.',
      sourceCode,
      `Add the \`u\` flag: ${node.text}u`,
    )
  },
}
