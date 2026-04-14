import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsJsx } from '../../../_shared/javascript-helpers.js'

export const floatingPromiseVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/floating-promise',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['expression_statement'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    // Look for expression statements containing a call expression that likely returns a promise
    const expr = node.namedChildren[0]
    if (!expr) return null

    // If the expression is already an await, it's fine
    if (expr.type === 'await_expression') return null

    // If it's a call expression, check if it looks like a promise
    if (expr.type !== 'call_expression') return null

    const fn = expr.childForFieldName('function')
    if (!fn) return null

    // Already has .catch() or .then() → fine
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop?.text === 'catch' || prop?.text === 'then' || prop?.text === 'finally') return null
    }

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) funcName = prop.text
    }

    // Use real type info to check if the call returns a Promise.
    // Replaces the previous ASYNC_PREFIXES name heuristic which:
    //   - missed async calls without a known prefix (commit, dispatch, query, publish, ...)
    //   - falsely flagged sync functions like createBullBoard, loadConfigSync, removeListener
    //
    // Skip when no type info is available (plain JS without JSDoc, files outside the
    // TS program, etc.) — conservative default to avoid FPs.
    if (!typeQuery) return null
    const isPromise = typeQuery.isPromiseLike(
      filePath,
      expr.startPosition.row,
      expr.startPosition.column,
      expr.endPosition.row,
      expr.endPosition.column,
    )
    if (!isPromise) return null

    // Also skip if the call's static type is `any` — an `any` value satisfies
    // PromiseLike but we can't trust the result.
    const isAny = typeQuery.isAnyType(
      filePath,
      expr.startPosition.row,
      expr.startPosition.column,
      expr.endPosition.row,
      expr.endPosition.column,
    )
    if (isAny) return null

    // Skip when the async call is inside a useEffect/useLayoutEffect callback.
    // Pattern: call_expression → arguments → arrow_function/function_expression → ... → our node
    let ancestor = node.parent
    while (ancestor) {
      if (ancestor.type === 'arrow_function' || ancestor.type === 'function_expression') {
        const parentOfFn = ancestor.parent
        if (parentOfFn?.type === 'arguments') {
          const callExpr = parentOfFn.parent
          if (callExpr?.type === 'call_expression') {
            const callee = callExpr.childForFieldName('function')
            if (callee) {
              const calleeName = callee.type === 'identifier' ? callee.text
                : callee.type === 'member_expression' ? callee.childForFieldName('property')?.text
                : ''
              if (calleeName === 'useEffect' || calleeName === 'useLayoutEffect') {
                return null
              }
            }
          }
        }
      }
      ancestor = ancestor.parent
    }

    // Skip when inside a React component — any function whose body contains JSX.
    // React event handlers (onClick, onSubmit, etc.) fire-and-forget async calls
    // and handle errors via UI state, not via await/catch at the call site.
    let componentAncestor = node.parent
    while (componentAncestor) {
      if (
        componentAncestor.type === 'function_declaration' ||
        componentAncestor.type === 'arrow_function' ||
        componentAncestor.type === 'function_expression'
      ) {
        const body = componentAncestor.childForFieldName('body')
        // Real AST JSX check — see _shared/javascript-helpers.ts
        if (body && containsJsx(body)) {
          return null
        }
      }
      componentAncestor = componentAncestor.parent
    }

    return makeViolation(
      this.ruleKey, expr, filePath, 'high',
      'Floating promise',
      `${funcName}() likely returns a Promise that is not awaited or .catch()-ed.`,
      sourceCode,
      'Either await the promise or add .catch() to handle rejections.',
    )
  },
}
