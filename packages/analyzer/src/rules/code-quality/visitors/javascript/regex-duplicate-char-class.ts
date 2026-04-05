import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getRegexSource } from './_helpers.js'

export const regexDuplicateCharClassVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-duplicate-char-class',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const src = getRegexSource(node)
    if (!src) return null

    const classRegex = /\[([^\]]*)\]/g
    let match: RegExpExecArray | null
    while ((match = classRegex.exec(src)) !== null) {
      const classContent = match[1]
      const chars: string[] = []
      for (let i = 0; i < classContent.length; i++) {
        if (classContent[i] === '\\' && i + 1 < classContent.length) {
          chars.push(classContent.slice(i, i + 2))
          i++
        } else if (classContent[i] !== '-') {
          chars.push(classContent[i])
        }
      }
      const seen = new Set<string>()
      for (const ch of chars) {
        if (seen.has(ch)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Duplicate character in regex class',
            `Character class contains duplicate character \`${ch}\`.`,
            sourceCode,
            'Remove the duplicate character from the character class.',
          )
        }
        seen.add(ch)
      }
    }
    return null
  },
}
