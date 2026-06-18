import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const csharpWhitespaceFormattingVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/whitespace-formatting',
  languages: ['csharp'],
  nodeTypes: ['compilation_unit'],
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
        'Use four spaces per level (the .NET default), enforced via .editorconfig.',
      )
    }

    return null
  },
}
