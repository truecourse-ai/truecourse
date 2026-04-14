import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES, VOID_RETURNING_GLOBALS, VOID_RETURNING_METHODS } from './_helpers.js'

export const voidReturnValueUsedVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/void-return-value-used',
  languages: JS_LANGUAGES,
  nodeTypes: ['variable_declarator', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    // Look for: const x = arr.forEach(...) or x = console.log(...)
    const valueField = node.type === 'variable_declarator' ? 'value' : 'right'
    const value = node.childForFieldName(valueField)
    if (!value || value.type !== 'call_expression') return null

    const fn = value.childForFieldName('function')
    if (!fn) return null

    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop && VOID_RETURNING_METHODS.has(prop.text)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Void return value used',
          `\`.${prop.text}()\` does not return a useful value — assigning its result is likely a bug.`,
          sourceCode,
          `Remove the assignment; call \`.${prop.text}()\` as a statement instead.`,
        )
      }

      // Check console.log etc.
      const obj = fn.childForFieldName('object')
      if (obj && prop) {
        const fullName = `${obj.text}.${prop.text}`
        if (VOID_RETURNING_GLOBALS.has(fullName)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Void return value used',
            `\`${fullName}()\` always returns \`undefined\` — assigning its result is likely a bug.`,
            sourceCode,
            `Remove the assignment; call \`${fullName}()\` as a statement.`,
          )
        }
      }
    }

    return null
  },
}
