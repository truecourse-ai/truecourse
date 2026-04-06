import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const statefulRegexVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/stateful-regex',
  languages: JS_LANGUAGES,
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const flags = node.childForFieldName('flags')
    if (!flags) return null

    const flagsText = flags.text
    // Only flag g or y (global or sticky) — those have stateful lastIndex
    if (!flagsText.includes('g') && !flagsText.includes('y')) return null

    // Only flag if the regex is used directly in a call (not stored in a variable)
    // i.e., the parent is a call_expression argument, not a variable_declarator
    const parent = node.parent
    if (!parent) return null

    // If stored in a variable, it's fine — only flag inline use in function calls
    if (parent.type === 'variable_declarator' || parent.type === 'assignment_expression') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Stateful regex',
      `Regex \`${node.text}\` has the \`${flagsText.includes('g') ? 'g' : 'y'}\` flag which maintains \`lastIndex\` state between calls. Reusing it across invocations can cause unexpected results.`,
      sourceCode,
      'Store the regex in a variable and reset `lastIndex` between uses, or remove the global/sticky flag if not needed.',
    )
  },
}
