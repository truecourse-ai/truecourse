import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getRegexSource } from './_helpers.js'

/**
 * Split a regex source into top-level alternatives, ignoring `|` that appears
 * inside groups `(...)` or character classes `[...]`. Backslash-escapes are
 * skipped so escaped brackets/parens/pipes don't fool the scanner.
 */
function splitTopLevelAlternatives(src: string): string[] {
  const parts: string[] = []
  let current = ''
  let parenDepth = 0
  let inCharClass = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '\\') {
      // Copy the escape sequence verbatim (one char of look-ahead).
      current += ch
      if (i + 1 < src.length) {
        current += src[i + 1]
        i++
      }
      continue
    }
    if (inCharClass) {
      current += ch
      if (ch === ']') inCharClass = false
      continue
    }
    if (ch === '[') {
      inCharClass = true
      current += ch
      continue
    }
    if (ch === '(') {
      parenDepth++
      current += ch
      continue
    }
    if (ch === ')') {
      if (parenDepth > 0) parenDepth--
      current += ch
      continue
    }
    if (ch === '|' && parenDepth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
}

export const regexAnchorPrecedenceVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-anchor-precedence',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const src = getRegexSource(node)
    if (!src) return null

    const alternatives = splitTopLevelAlternatives(src)
    // Need at least two top-level alternatives for a precedence concern.
    if (alternatives.length < 2) return null

    const firstStartsAnchored = alternatives[0].startsWith('^')
    const lastEndsAnchored = /\$$/.test(alternatives[alternatives.length - 1])
    // True precedence bugs require BOTH a leading `^` and a trailing `$` —
    // i.e. the regex looks like `^a|b$` (typo for `^(a|b)$`). If only one side
    // is anchored, the alternation reads naturally (`^pfx|other`).
    if (!firstStartsAnchored || !lastEndsAnchored) return null

    // If every alternative is symmetrically anchored on the SAME side (all
    // start with `^`, or all end with `$`), the writer was deliberate about
    // anchoring each branch — not a precedence bug.
    const allStartAnchored = alternatives.every((a) => a.startsWith('^'))
    const allEndAnchored = alternatives.every((a) => /\$$/.test(a))
    if (allStartAnchored || allEndAnchored) return null

    // Slug-trim idiom: exactly two alternatives `^X` and `X$` where X is the
    // same literal text. `^-|-$` trims a leading or trailing dash — each
    // alternative is intentionally anchored to one end.
    if (alternatives.length === 2) {
      const first = alternatives[0]
      const last = alternatives[1]
      if (first.startsWith('^') && !first.endsWith('$') && last.endsWith('$') && !last.startsWith('^')) {
        const firstBody = first.slice(1)
        const lastBody = last.slice(0, -1)
        if (firstBody === lastBody && firstBody.length > 0) {
          return null
        }
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Regex anchor precedence issue',
      '`^` or `$` anchor in regex alternation only anchors one alternative. Wrap in a group: `^(foo|bar)$`.',
      sourceCode,
      'Wrap the alternation in a group: `^(a|b)$` instead of `^a|b$`.',
    )
  },
}
