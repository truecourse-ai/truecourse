import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

/**
 * Detects Promise.reject() called with a non-Error value (literal or primitive).
 * prefer-promise-reject-errors: Rejecting with a non-Error makes error handling harder
 * since catch(e) handlers expect e.message, e.stack, etc.
 */
const PRIMITIVE_LITERAL_TYPES = new Set(['string', 'number', 'true', 'false', 'null', 'undefined'])

export const promiseRejectNonErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/promise-reject-non-error',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    // Match Promise.reject(...)
    if (func.type !== 'member_expression') return null
    const obj = func.childForFieldName('object')
    const prop = func.childForFieldName('property')
    if (obj?.text !== 'Promise' || prop?.text !== 'reject') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Flag if the argument is a primitive literal (not an Error construction)
    if (PRIMITIVE_LITERAL_TYPES.has(firstArg.type)) {
      return makeViolation(
        this.ruleKey, firstArg, filePath, 'medium',
        'Promise rejected with non-Error value',
        `\`Promise.reject(${firstArg.text})\` — rejecting with a primitive value makes error handling harder. Use \`new Error(...)\` so catch handlers can access \`.message\` and \`.stack\`.`,
        sourceCode,
        `Replace with \`Promise.reject(new Error(${firstArg.type === 'string' ? firstArg.text : `"${firstArg.text}"`}))\`.`,
      )
    }

    return null
  },
}
