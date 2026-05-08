import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unusedConstructorResultVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-constructor-result',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'new_expression') return null
    const ctor = expr.childForFieldName('constructor')
    if (!ctor) return null
    const name = ctor.text
    const intentionalCtors = ['Worker', 'Promise', 'Observable', 'EventEmitter']
    if (intentionalCtors.some((ic) => name.includes(ic))) return null

    // Skip standard validation patterns where the constructor throws on invalid input
    // and the object is intentionally unused (e.g., new URL(input), new RegExp(pattern))
    if (name === 'URL' || name === 'RegExp') return null
    // Intl.* constructors used for input validation throw on
    // invalid args (e.g., \`new Intl.Locale(language)\`).
    if (/^Intl\./.test(name)) return null

    // Skip when the \`new X(...)\` is inside a try block — the throw
    // is clearly the intended side effect.
    {
      let cursor = node.parent
      while (cursor) {
        if (cursor.type === 'try_statement') return null
        if (cursor.type === 'function_declaration' ||
            cursor.type === 'arrow_function' ||
            cursor.type === 'function_expression' ||
            cursor.type === 'method_definition' ||
            cursor.type === 'program') break
        cursor = cursor.parent
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unused constructor result',
      `\`new ${name}()\` result is discarded — if this is for a side effect only, the intent is unclear. Assign it to a variable or use a factory function.`,
      sourceCode,
      'Assign the result to a variable, or extract the side effect into a named function.',
    )
  },
}
