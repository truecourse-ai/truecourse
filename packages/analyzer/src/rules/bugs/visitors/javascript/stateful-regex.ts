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

    const parent = node.parent
    if (!parent) return null

    // Inline regex in method calls like .replace(/x/g, ...) and .match(/x/g) are safe —
    // a fresh regex instance is created each time. Only stored/reused regex is problematic.
    if (parent.type === 'arguments') return null

    // Regex stored in a module-scope variable and reused across function calls IS problematic.
    // Only flag when the regex is assigned to a variable at module scope (not inside a function).
    if (parent.type !== 'variable_declarator' && parent.type !== 'assignment_expression') return null

    // Check if the variable is at module scope (parent chain reaches 'program' without hitting a function)
    let ancestor = parent.parent
    while (ancestor) {
      if (ancestor.type === 'function_declaration' || ancestor.type === 'arrow_function'
        || ancestor.type === 'function' || ancestor.type === 'method_definition') {
        return null // Inside a function — regex is recreated each call, safe
      }
      if (ancestor.type === 'program') break
      ancestor = ancestor.parent
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Stateful regex',
      `Regex \`${node.text}\` has the \`${flagsText.includes('g') ? 'g' : 'y'}\` flag which maintains \`lastIndex\` state between calls. Reusing it across invocations can cause unexpected results.`,
      sourceCode,
      'Store the regex in a variable and reset `lastIndex` between uses, or remove the global/sticky flag if not needed.',
    )
  },
}
