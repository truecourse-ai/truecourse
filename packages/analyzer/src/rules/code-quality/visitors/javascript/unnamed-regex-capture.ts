import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unnamedRegexCaptureVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnamed-regex-capture',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const pattern = node.namedChildren.find((c) => c.type === 'regex_pattern')
    const src = pattern?.text ?? ''

    // Count "meaningful" unnamed capture groups. A single capture group is
    // unambiguous — `m[1]` is self-evidently the one capture, so naming adds
    // ceremony without value. Named groups disambiguate when there are
    // *several* captures, so only flag when 2+ unnamed groups are present.
    let unnamedCount = 0
    for (let i = 0; i < src.length; i++) {
      if (src[i] === '\\') { i++; continue }
      if (src[i] === '(') {
        const next = src[i + 1]
        if (next !== '?') {
          // Extract the content of this capture group
          let depth = 1
          let j = i + 1
          while (j < src.length && depth > 0) {
            if (src[j] === '\\') { j += 2; continue }
            if (src[j] === '(') depth++
            else if (src[j] === ')') depth--
            j++
          }
          const groupContent = src.slice(i + 1, j - 1)

          // Skip groups immediately followed by a quantifier (`)+`, `)*`,
          // `)?`, `){...}`). These are structural — used to apply the
          // quantifier to a sub-pattern, not to extract data (you only ever
          // get the last iteration's match), so naming adds nothing.
          const after = src[j]
          if (after === '+' || after === '*' || after === '?' || after === '{') {
            continue
          }

          // Skip groups that are purely alternation of short literals/tokens
          // e.g., (a|b), (\?|$), (http|https), (s?) — these are
          // matching/grouping constructs, not data captures worth naming.
          if (groupContent.includes('|')) {
            const alternatives = groupContent.split('|')
            const isSimpleAlternation = alternatives.every((alt) => /^[a-zA-Z0-9_\\?.^$*+\-]+$/.test(alt) && alt.length <= 10)
            if (isSimpleAlternation) continue
          }

          unnamedCount++
        }
      }
    }

    // A lone capture group reads fine as `match[1]`; named groups only earn
    // their keep when multiple captures would otherwise be positional and
    // easy to mix up.
    if (unnamedCount >= 2) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnamed capture groups',
        'Regex contains multiple unnamed capture groups. Use named groups `(?<name>...)` for better readability.',
        sourceCode,
        'Convert capture groups to named: `(?<name>...)` or non-capturing: `(?:...)`.',
      )
    }
    return null
  },
}
