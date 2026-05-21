import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getRegexSource } from './_helpers.js'

function hasEmptyGroupOutsideCharClass(src: string): boolean {
  let inCharClass = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '\\') {
      i++ // skip the next char (it's an escape)
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
      // Skip lookaround/non-capturing prefixes: (?= (?! (?<= (?<! (?: (?<name>
      let j = i + 1
      if (src[j] === '?') {
        // Treat any `(?` group as non-empty for the purpose of this rule;
        // empty `()` literally requires the immediate `()` pair.
        continue
      }
      if (src[j] === ')') return true
    }
  }
  return false
}

export const regexEmptyGroupVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-empty-group',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const src = getRegexSource(node)
    if (!src) return null

    if (hasEmptyGroupOutsideCharClass(src)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Empty regex group',
        'Regular expression contains an empty group `()` which matches an empty string — likely a mistake.',
        sourceCode,
        'Remove the empty group or add a pattern inside it.',
      )
    }
    return null
  },
}
