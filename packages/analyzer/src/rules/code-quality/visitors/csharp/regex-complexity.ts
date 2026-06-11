import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_REGEX_NODE_TYPES, getCSharpRegexUsage } from './_regex-helpers.js'

const MAX_REGEX_LENGTH = 50
const MAX_GROUPS = 5

function maxParenDepth(pattern: string): number {
  let depth = 0
  let max = 0
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '\\') { i++; continue }
    if (c === '[') {
      i++
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i++
        i++
      }
      continue
    }
    if (c === '(') {
      depth++
      if (depth > max) max = depth
    } else if (c === ')') {
      depth--
    }
  }
  return max
}

export const csharpRegexComplexityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-complexity',
  languages: ['csharp'],
  nodeTypes: CSHARP_REGEX_NODE_TYPES,
  visit(node, filePath, sourceCode) {
    const usage = getCSharpRegexUsage(node)
    if (!usage) return null
    const pattern = usage.pattern

    // Skip well-known regex shapes (UUID, email, ISO date, semver).
    const wellKnownPatterns = [
      /\[0-9a-f\]\{8\}-?\[0-9a-f\]\{4\}/i,
      /\[a-zA-Z0-9.*\].*@.*\[a-zA-Z0-9\]/,
      /\\d\{4\}[-/]\\d\{2\}[-/]\\d\{2\}/,
      /\\d+\\.\\d+\\.\\d+/,
    ]
    if (wellKnownPatterns.some((wp) => wp.test(pattern))) return null

    const hasLookahead = pattern.includes('(?=') || pattern.includes('(?!') || pattern.includes('(?<=') || pattern.includes('(?<!')
    const hasBackref = /(?<!\\)\\[1-9]/.test(pattern)
    const groupCount = (pattern.match(/\(/g) || []).length
    const maxDepth = maxParenDepth(pattern)

    // A pattern that lives in a named field/const or a [GeneratedRegex]
    // partial method is already extracted and named — exactly what this rule
    // asks for. Moderately-structured named patterns are fine; deep grouping
    // or backreferences still fire.
    if (
      (usage.isNamedFieldInitializer || usage.isGeneratedRegexAttribute)
      && groupCount < MAX_GROUPS
      && !hasBackref
    ) return null

    // Flat alternations of literal chunks are readable regardless of length.
    if (!hasLookahead && !hasBackref && maxDepth <= 1 && groupCount < MAX_GROUPS) return null

    if (pattern.length < MAX_REGEX_LENGTH && groupCount < MAX_GROUPS) return null

    const isComplex = pattern.length >= MAX_REGEX_LENGTH || groupCount >= MAX_GROUPS || hasLookahead
    if (!isComplex) return null

    return makeViolation(
      this.ruleKey, usage.patternNode, filePath, 'medium',
      'Complex regular expression',
      `Regular expression is complex (length: ${pattern.length}, groups: ${groupCount}) — extract it to a named static readonly Regex or [GeneratedRegex] with a comment explaining it.`,
      sourceCode,
      'Extract the regex to a named pattern: `private static readonly Regex MyPattern = new(...)` or a `[GeneratedRegex]` partial method, with a comment explaining its purpose.',
    )
  },
}
