import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES } from './_helpers.js'

const PROMISE_FACTORY_METHODS = new Set([
  'resolve', 'reject', 'all', 'allSettled', 'race', 'any',
])

export const noReturnAwaitVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-return-await',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['return_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'await_expression') return null

    const awaited = expr.namedChildren[0]
    if (!awaited) return null

    // Per updated @typescript-eslint/return-await guidance, `return await foo()`
    // on a real call/method chain is preferred — the explicit await produces
    // cleaner stack traces and reliable in-frame error propagation. Only flag
    // the truly redundant shapes:
    //   - return await <bare identifier>
    //   - return await Promise.resolve(...) / Promise.reject(...) / Promise.all(...) / …
    //   - return await new Promise(...)
    if (awaited.type === 'call_expression') {
      const callee = awaited.childForFieldName('function')
      if (!isPromiseFactoryCall(callee)) return null
    } else if (awaited.type === 'new_expression') {
      const ctor = awaited.childForFieldName('constructor')
      if (ctor?.text !== 'Promise') return null
    } else if (awaited.type === 'subscript_expression') {
      return null
    }

    let parent = node.parent
    while (parent) {
      if (JS_FUNCTION_TYPES.includes(parent.type)) {
        const isAsync = parent.children.some((c) => c.type === 'async')
        if (isAsync) {
          let tryParent = node.parent
          while (tryParent && tryParent.id !== parent.id) {
            if (tryParent.type === 'try_statement') return null
            tryParent = tryParent.parent
          }

          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Redundant return await',
            '`return await` is redundant in an async function. The function already returns a promise.',
            sourceCode,
            'Remove the `await` keyword: `return promise` instead of `return await promise`.',
          )
        }
        break
      }
      parent = parent.parent
    }
    return null
  },
}

function isPromiseFactoryCall(callee: SyntaxNode | null): boolean {
  if (!callee || callee.type !== 'member_expression') return false
  const obj = callee.childForFieldName('object')
  const prop = callee.childForFieldName('property')
  if (obj?.text !== 'Promise' || !prop) return false
  return PROMISE_FACTORY_METHODS.has(prop.text)
}
