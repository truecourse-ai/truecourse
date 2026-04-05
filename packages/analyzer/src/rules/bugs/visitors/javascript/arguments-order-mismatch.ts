import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES, KNOWN_ARG_ORDERS } from './_helpers.js'

export const argumentsOrderMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/arguments-order-mismatch',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop) return null

    const methodName = prop.text
    const spec = KNOWN_ARG_ORDERS.find((s) => s.fn === methodName)
    if (!spec) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const argNodes = args.namedChildren
    if (argNodes.length < 1) return null

    // Check if argument names suggest a mismatch: e.g. str.startsWith(str, prefix) instead of str.startsWith(prefix)
    // We look at identifier names and compare to expected positions
    const obj = fn.childForFieldName('object')
    const receiverName = obj?.type === 'identifier' ? obj.text.toLowerCase() : ''

    // For startsWith/endsWith/includes: the first arg should be the needle, not the receiver
    // Flag if arg[0] looks like the receiver (same name or contains receiver name)
    const firstArgText = argNodes[0].text.toLowerCase()

    if (['startsWith', 'endsWith', 'includes', 'indexOf'].includes(methodName)) {
      // Heuristic: if the first arg's identifier name matches the receiver variable name, they might be swapped
      if (receiverName && firstArgText === receiverName) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Arguments in wrong order',
          `\`${node.text}\` — the first argument to \`.${methodName}()\` looks like it might be the object itself. Check argument order.`,
          sourceCode,
          `Verify the argument order: \`haystack.${methodName}(needle)\`.`,
        )
      }
    }

    return null
  },
}
