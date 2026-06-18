import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const BIDI_CHARS = /[\u200F\u200E\u202A-\u202E\u2066-\u2069\u061C]/

/**
 * Bidirectional Unicode control characters in the source — can reorder how
 * code APPEARS to reviewers without changing what the compiler executes
 * (CVE-2021-42574 "Trojan Source").
 */
export const csharpBidirectionalUnicodeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/bidirectional-unicode',
  languages: ['csharp'],
  nodeTypes: ['compilation_unit'],
  visit(node, filePath, sourceCode) {
    const match = BIDI_CHARS.exec(sourceCode)
    if (!match) return null

    const lineNum = sourceCode.slice(0, match.index).split('\n').length
    const charCode = sourceCode.charCodeAt(match.index).toString(16).toUpperCase().padStart(4, '0')

    return makeViolation(
      this.ruleKey, node, filePath, 'critical',
      'Bidirectional unicode control character',
      `Source file contains a bidirectional unicode control character (U+${charCode}) near line ${lineNum} — these characters can alter how code appears to reviewers without changing execution.`,
      sourceCode,
      'Remove all bidirectional unicode control characters from the source file.',
    )
  },
}
