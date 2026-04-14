import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonWhitespaceFormattingVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/whitespace-formatting',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    const lines = sourceCode.split('\n')
    let hasTabs = false
    let hasSpaces = false

    for (const line of lines) {
      const leadingWhitespace = line.match(/^(\s+)/)?.[1]
      if (leadingWhitespace) {
        if (leadingWhitespace.includes('\t')) hasTabs = true
        if (leadingWhitespace.includes(' ')) hasSpaces = true
      }
    }

    if (hasTabs && hasSpaces) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Mixed tabs and spaces',
        'File uses both tabs and spaces for indentation. Python requires consistent indentation.',
        sourceCode,
        'Use spaces (4 per level) consistently, as recommended by PEP 8.',
      )
    }

    return null
  },
}
