import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unnamedRegexCaptureVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnamed-regex-capture',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const pattern = node.namedChildren.find((c) => c.type === 'regex_pattern')
    const src = pattern?.text ?? ''

    let captureCount = 0
    let inCharClass = false

    for (let i = 0; i < src.length; i++) {
      const ch = src[i]
      if (ch === '\\') { i++; continue }
      if (ch === '[') { inCharClass = true; continue }
      if (ch === ']') { inCharClass = false; continue }
      if (inCharClass) continue
      if (ch !== '(') continue

      const next = src[i + 1]
      if (next === '?') continue // non-capture / lookahead / lookbehind

      // Walk the group body, respecting nested groups/char classes
      let depth = 1
      let j = i + 1
      while (j < src.length && depth > 0) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '[') {
          // skip char class
          j++
          while (j < src.length) {
            if (src[j] === '\\') { j += 2; continue }
            if (src[j] === ']') { j++; break }
            j++
          }
          continue
        }
        if (src[j] === '(') depth++
        else if (src[j] === ')') depth--
        j++
      }
      const groupContent = src.slice(i + 1, j - 1)

      // Heuristic 1: skip top-level alternation groups whose alternatives
      // are short literal-ish tokens (e.g., (a|b), (http|https|ftp), (s?)).
      if (groupContent.includes('|') && !/\([^?]/.test(groupContent)) {
        const alternatives = groupContent.split('|')
        const isSimpleAlternation = alternatives.every(
          (alt) => /^[a-zA-Z0-9_\\?.^$*+\-/:]*$/.test(alt) && alt.length <= 64,
        )
        if (isSimpleAlternation) continue
      }

      // Heuristic 2: skip groups followed by a repetition quantifier — these
      // are grouping-for-quantification, not value capture
      //   (abc)+   (abc)*   (abc)?   (abc){1,3}
      const after = src[j]
      if (after === '+' || after === '*' || after === '?' || after === '{') continue

      // Heuristic 3: skip negated-char-class capture groups whose ONLY content
      // is a single `[^X]+` token — these are delimited-content extractors
      // (e.g., `\{\{([^}]+)\}\}` extracting template placeholder content), a
      // domain-pattern idiom where the capture is structural, not a positional
      // value the caller reads via match[1].
      if (/^\[\^[^\]]+\][*+?]?$/.test(groupContent)) continue

      captureCount++
    }

    // Skip regexes with a single unnamed capture — typically content
    // extractors (e.g., /^r(\d+)$/, /\{(\S+)\}/) where the capture is
    // structural; multi-capture regexes (/(\d{4})-(\d{2})-(\d{2})/) more
    // strongly suggest positional-value extraction worth naming.
    if (captureCount > 1) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnamed capture group',
        'Regex contains unnamed capture groups. Use named groups `(?<name>...)` for better readability.',
        sourceCode,
        'Convert capture groups to named: `(?<name>...)` or non-capturing: `(?:...)`.',
      )
    }
    return null
  },
}
