import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_REGEX_NODE_TYPES, getCSharpRegexUsage } from './_regex-helpers.js'

/**
 * Count data-bearing unnamed capture groups: skips `(?…)` constructs
 * (non-capturing, named, lookaround, inline options), quantified groups
 * (structural, not extractive), and simple short alternations.
 */
function countUnnamedCaptures(src: string): number {
  let unnamedCount = 0
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue }
    if (src[i] !== '(') continue
    if (src[i + 1] === '?') continue

    let depth = 1
    let j = i + 1
    while (j < src.length && depth > 0) {
      if (src[j] === '\\') { j += 2; continue }
      if (src[j] === '(') depth++
      else if (src[j] === ')') depth--
      j++
    }
    const groupContent = src.slice(i + 1, j - 1)

    const after = src[j]
    if (after === '+' || after === '*' || after === '?' || after === '{') continue

    if (groupContent.includes('|')) {
      const alternatives = groupContent.split('|')
      const isSimpleAlternation = alternatives.every((alt) => /^[a-zA-Z0-9_\\?.^$*+\-]+$/.test(alt) && alt.length <= 10)
      if (isSimpleAlternation) continue
    }

    unnamedCount++
  }
  return unnamedCount
}

/**
 * Regex pattern with 3+ unnamed data captures — positional `m.Groups[2]`
 * indexes are easy to mix up; .NET named groups `(?<name>…)` read like a schema.
 */
export const csharpUnnamedRegexCaptureVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnamed-regex-capture',
  languages: ['csharp'],
  nodeTypes: CSHARP_REGEX_NODE_TYPES,
  visit(node, filePath, sourceCode) {
    const usage = getCSharpRegexUsage(node)
    if (!usage) return null

    if (countUnnamedCaptures(usage.pattern) < 3) return null

    return makeViolation(
      this.ruleKey, usage.patternNode, filePath, 'low',
      'Unnamed capture groups',
      'Regex contains 3+ unnamed capture groups — positional `Groups[n]` access is easy to mix up. Use named groups `(?<name>…)`.',
      sourceCode,
      'Convert the capture groups to named groups `(?<name>…)` (or non-capturing `(?:…)` where the value is not used).',
    )
  },
}
