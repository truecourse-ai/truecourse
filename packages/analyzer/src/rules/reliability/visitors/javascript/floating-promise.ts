import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const floatingPromiseVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/floating-promise',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
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

    // Skip .delete() calls — Map.delete(), Set.delete(), WeakMap.delete() etc. return boolean, not Promise
    if (funcName === 'delete' && fn.type === 'member_expression') return null

    // Heuristic: only flag commonly known async patterns
    const ASYNC_PREFIXES = ['fetch', 'save', 'send', 'update', 'create', 'remove', 'upload', 'download', 'load']
    const isLikelyAsync = ASYNC_PREFIXES.some((p) => funcName.toLowerCase().startsWith(p))

    if (!isLikelyAsync) return null

    // For bare function calls (not method calls on an object), only flag if the
    // enclosing function is async. Synchronous factory functions like createBullBoard()
    // imported from packages match async prefixes but don't return promises.
    if (fn.type === 'identifier') {
      let enclosing = node.parent
      while (enclosing) {
        if (enclosing.type === 'arrow_function' || enclosing.type === 'function_expression' ||
            enclosing.type === 'function_declaration' || enclosing.type === 'method_definition') {
          const isAsync = enclosing.children.some(c => c.type === 'async')
          if (!isAsync) return null
          break
        }
        enclosing = enclosing.parent
      }
    }

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
        if (body) {
          const bodyText = body.text
          // Check for JSX returns — indicates a React component or JSX-containing function
          if (/<[A-Za-z]/.test(bodyText)) {
            return null
          }
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
