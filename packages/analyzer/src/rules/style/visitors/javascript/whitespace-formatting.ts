import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const whitespaceFormattingVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/whitespace-formatting',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
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
        'File uses both tabs and spaces for indentation. Use one consistently.',
        sourceCode,
        'Configure your editor to use spaces (2 or 4) consistently.',
      )
    }

    return null
  },
}
