import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getRegexSource } from './_helpers.js'

export const regexEmptyRepetitionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-empty-repetition',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const src = getRegexSource(node)
    if (!src) return null

    // Only flag groups that genuinely CAN match empty + outer
    // quantifier: \`(X*)*\`, \`(X?)*\`, \`(X|)*\`, \`()*\`. Skip groups
    // where the inner pattern requires at least one character
    // (e.g., \`([-_][a-z0-9]+)*\` — the inner always matches 2+).
    const FLAG_PATTERNS = [
      /\(([^)]*)\*\)[*+]/,    // (X*)* / (X*)+
      /\(([^)]*)\?\)[*+]/,    // (X?)*
      /\([^)|]*\|\)[*+]/,     // (X|)*
      /\(\)[*+]/,             // ()*
      /\(\?:\)\s*[*+]/,       // (?:)*
      /\(\?:[^)]*\*\)[*+]/,   // (?:X*)*
      /\(\?:[^)]*\?\)[*+]/,   // (?:X?)*
      /\(\?:[^)|]*\|\)[*+]/,  // (?:X|)*
    ]
    if (FLAG_PATTERNS.some((p) => p.test(src))) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Empty string repetition in regex',
        'Repeated group can match an empty string, which may cause catastrophic backtracking.',
        sourceCode,
        'Restructure the regex to avoid nested quantifiers on patterns that can match empty strings.',
      )
    }
    return null
  },
}
