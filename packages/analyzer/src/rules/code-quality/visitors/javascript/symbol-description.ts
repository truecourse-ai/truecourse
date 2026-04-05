import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const symbolDescriptionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/symbol-description',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'Symbol') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Symbol() with no arguments or empty string
    const argList = args.namedChildren
    if (argList.length === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Symbol without description',
        '`Symbol()` created without a description string — makes debugging harder.',
        sourceCode,
        'Add a description: `Symbol("mySymbol")`.',
      )
    }

    return null
  },
}
