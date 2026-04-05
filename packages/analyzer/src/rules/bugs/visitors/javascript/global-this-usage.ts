import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const globalThisUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/global-this-usage',
  languages: JS_LANGUAGES,
  nodeTypes: ['this'],
  visit(node, filePath, sourceCode) {
    // Walk up to see if we're inside a function/class method/arrow function
    let current = node.parent
    while (current) {
      const t = current.type
      if (
        t === 'function_declaration' ||
        t === 'function' ||
        t === 'method_definition' ||
        t === 'class_declaration' ||
        t === 'class'
      ) {
        return null // `this` is valid inside a function or class
      }
      // Arrow functions inherit `this` from enclosing scope — keep walking
      if (t === 'arrow_function') {
        current = current.parent
        continue
      }
      current = current.parent
    }

    // If we got here, `this` is at the top level (program scope)
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Global this usage',
      '`this` at the top level of a module is `undefined` in strict mode or the global object otherwise — use `globalThis` for a portable reference.',
      sourceCode,
      'Replace `this` with `globalThis` or move the code into a function/class.',
    )
  },
}
