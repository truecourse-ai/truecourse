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

    // Skip when the unhandled async call is inside a useEffect/useLayoutEffect callback.
    // Pattern: useEffect(() => { asyncFn(); }) — this is the standard React pattern.
    const grandparent = parent.parent // statement_block (callback body)
    if (grandparent && grandparent.type === 'statement_block') {
      const callbackFn = grandparent.parent // arrow_function or function_expression
      if (callbackFn && (callbackFn.type === 'arrow_function' || callbackFn.type === 'function_expression')) {
        const callbackArgs = callbackFn.parent // arguments node
        if (callbackArgs && callbackArgs.type === 'arguments') {
          const effectCall = callbackArgs.parent // call_expression
          if (effectCall && effectCall.type === 'call_expression') {
            const effectFn = effectCall.childForFieldName('function')
            if (effectFn && (effectFn.text === 'useEffect' || effectFn.text === 'useLayoutEffect')) {
              return null
            }
          }
        }
      }
    }

    // Skip when the async call is inside an arrow function used as a JSX event handler.
    // Pattern: onClick={() => { asyncFn(); }} or onChange={async () => { asyncFn(); }}
    // Ancestor chain: expression_statement → statement_block → arrow_function → jsx_expression → jsx_attribute
    if (grandparent && grandparent.type === 'statement_block') {
      const arrowFn = grandparent.parent
      if (arrowFn && arrowFn.type === 'arrow_function') {
        const jsxExpr = arrowFn.parent
        if (jsxExpr && jsxExpr.type === 'jsx_expression') {
          const jsxAttr = jsxExpr.parent
          if (jsxAttr && jsxAttr.type === 'jsx_attribute') {
            return null
          }
        }
      }
    }

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
