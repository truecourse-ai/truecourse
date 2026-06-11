import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_REGEX_NODE_TYPES, getCSharpRegexUsage } from './_regex-helpers.js'

function hasEmptyGroupOutsideCharClass(src: string): boolean {
  let inCharClass = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (inCharClass) {
      if (ch === ']') inCharClass = false
      continue
    }
    if (ch === '[') {
      inCharClass = true
      continue
    }
    if (ch === '(') {
      // Any `(?` construct (lookaround, non-capturing, named) is not the
      // literal empty `()` pair this rule targets.
      if (src[i + 1] === '?') continue
      if (src[i + 1] === ')') return true
    }
  }
  return false
}

export const csharpRegexEmptyGroupVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-empty-group',
  languages: ['csharp'],
  nodeTypes: CSHARP_REGEX_NODE_TYPES,
  visit(node, filePath, sourceCode) {
    const usage = getCSharpRegexUsage(node)
    if (!usage) return null

    if (hasEmptyGroupOutsideCharClass(usage.pattern)) {
      return makeViolation(
        this.ruleKey, usage.patternNode, filePath, 'low',
        'Empty regex group',
        'Regular expression contains an empty group `()` which matches an empty string — likely a mistake.',
        sourceCode,
        'Remove the empty group or add a pattern inside it.',
      )
    }
    return null
  },
}
