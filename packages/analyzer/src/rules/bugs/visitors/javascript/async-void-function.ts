import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const asyncVoidFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/async-void-function',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    // Check if parent is expression_statement (not assignment, not await, not return)
    const parent = node.parent
    if (!parent || parent.type !== 'expression_statement') return null

    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Check if there's a .catch() or .then() chained — if so, it's handled
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop && (prop.text === 'catch' || prop.text === 'then' || prop.text === 'finally')) return null
    }

    // Use type system to check if the call returns a Promise
    const isPromise = typeQuery.isPromiseLike(
      filePath,
      node.startPosition.row,
      node.startPosition.column,
      node.endPosition.row,
      node.endPosition.column,
    )
    if (!isPromise) return null

    const fnText = fn.text
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Async function called without await',
      `\`${fnText}()\` returns a Promise but is called without \`await\` — errors will be silently swallowed.`,
      sourceCode,
      'Add `await` before the call, or attach `.catch(err => ...)` to handle errors.',
    )
  },
}
