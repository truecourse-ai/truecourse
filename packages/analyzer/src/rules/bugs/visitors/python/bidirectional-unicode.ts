import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { BIDI_CHARS } from './_helpers.js'

export const pythonBidirectionalUnicodeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/bidirectional-unicode',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    if (BIDI_CHARS.test(sourceCode)) {
      // Find the first occurrence to report a location
      const match = BIDI_CHARS.exec(sourceCode)
      if (!match) return null
      // Find the line containing the character
      const before = sourceCode.slice(0, match.index)
      const lineNum = before.split('\n').length
      const charCode = sourceCode.charCodeAt(match.index).toString(16).toUpperCase()
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'Bidirectional unicode control character',
        `Source file contains a bidirectional unicode control character (U+${charCode}) near line ${lineNum} — these characters can alter how code appears to reviewers without changing execution.`,
        sourceCode,
        'Remove all bidirectional unicode control characters from the source file.',
      )
    }
    return null
  },
}
