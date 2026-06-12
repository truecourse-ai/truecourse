import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_REGEX_NODE_TYPES, getCSharpRegexUsage } from './_regex-helpers.js'

/**
 * Split `src` into its top-level alternatives. Returns null when there is no
 * top-level `|`. Tracks character classes and groups so `|` inside them is
 * not mistaken for alternation; honors backslash escapes.
 */
function splitTopLevelAlternatives(src: string): string[] | null {
  const alts: string[] = []
  let current = ''
  let depth = 0
  let inCharClass = false
  let escape = false
  for (const ch of src) {
    if (escape) {
      current += ch
      escape = false
      continue
    }
    if (ch === '\\') {
      current += ch
      escape = true
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
      depth++
      current += ch
      continue
    }
    if (ch === ')') {
      depth--
      current += ch
      continue
    }
    if (ch === '|' && depth === 0) {
      alts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  alts.push(current)
  return alts.length > 1 ? alts : null
}

export const csharpRegexAnchorPrecedenceVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-anchor-precedence',
  languages: ['csharp'],
  nodeTypes: CSHARP_REGEX_NODE_TYPES,
  visit(node, filePath, sourceCode) {
    const usage = getCSharpRegexUsage(node)
    if (!usage) return null

    const alternatives = splitTopLevelAlternatives(usage.pattern)
    if (!alternatives) return null

    // The bug only exists when *some* alternatives are anchored and others
    // aren't: `^a|b` matches `^a` OR just `b`. If every alternative is
    // start- or end-anchored consistently the operator-precedence concern
    // does not apply.
    const startAnchored = alternatives.map((a) => /^\^/.test(a))
    const endAnchored = alternatives.map((a) => /(?<!\\)\$$/.test(a))

    const inconsistentStart = startAnchored.some(Boolean) && !startAnchored.every(Boolean)
    const inconsistentEnd = endAnchored.some(Boolean) && !endAnchored.every(Boolean)

    if (inconsistentStart || inconsistentEnd) {
      return makeViolation(
        this.ruleKey, usage.patternNode, filePath, 'low',
        'Regex anchor precedence issue',
        '`^` or `$` anchor in regex alternation only anchors one alternative. Wrap in a group: `^(foo|bar)$`.',
        sourceCode,
        'Wrap the alternation in a group: `^(a|b)$` instead of `^a|b$`.',
      )
    }
    return null
  },
}
