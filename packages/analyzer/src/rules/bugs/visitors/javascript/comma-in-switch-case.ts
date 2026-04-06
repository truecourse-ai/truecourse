import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const commaInSwitchCaseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/comma-in-switch-case',
  languages: JS_LANGUAGES,
  nodeTypes: ['switch_case'],
  visit(node, filePath, sourceCode) {
    const value = node.childForFieldName('value')
    if (!value) return null

    // Detect comma expression in case value: case a, b: or case (a, b):
    // tree-sitter parses `case (a, b):` as parenthesized_expression > sequence_expression
    let checkNode = value
    if (value.type === 'parenthesized_expression' && value.namedChildren.length === 1) {
      checkNode = value.namedChildren[0]
    }

    if (checkNode.type === 'sequence_expression') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Comma in switch case',
        `\`case ${value.text}:\` uses a comma expression — only the last value (\`${checkNode.namedChildren[checkNode.namedChildren.length - 1]?.text}\`) is actually matched. Use separate case labels.`,
        sourceCode,
        'Use separate `case` labels instead of a comma-separated list.',
      )
    }

    return null
  },
}
