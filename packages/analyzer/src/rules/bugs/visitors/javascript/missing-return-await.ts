import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { TypeQueryService } from '../../../../ts-compiler.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detects: async function with try/catch that returns a Promise without await
// `return somePromise()` inside try/catch doesn't catch rejection from the promise
// Should be `return await somePromise()`
export const missingReturnAwaitVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/missing-return-await',
  languages: JS_LANGUAGES,
  nodeTypes: ['try_statement'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    // Check if we're inside an async function
    let parent = node.parent
    let insideAsync = false
    while (parent) {
      if (parent.type === 'function_declaration' || parent.type === 'function' ||
          parent.type === 'arrow_function' || parent.type === 'method_definition') {
        const asyncKw = parent.children.find((c) => c.text === 'async')
        if (asyncKw) {
          insideAsync = true
        }
        break
      }
      parent = parent.parent
    }

    if (!insideAsync) return null

    const hasCatch = node.namedChildren.some((c) => c.type === 'catch_clause')
    if (!hasCatch) return null

    const tryBody = node.namedChildren.find((c) => c.type === 'statement_block')
    if (!tryBody) return null

    // Look for return statements returning a call expression (likely a Promise) without await
    const bareReturn = findReturnWithoutAwait(tryBody, filePath, typeQuery)
    if (!bareReturn) return null

    return makeViolation(
      this.ruleKey, bareReturn, filePath, 'medium',
      'Missing return await',
      '`return promise` inside `try/catch` — the rejection is not caught because the function returns before the promise settles. Use `return await promise` to catch rejections.',
      sourceCode,
      'Add `await` before the returned expression: `return await somePromise()`.',
    )
  },
}

function findReturnWithoutAwait(
  node: SyntaxNode,
  filePath: string,
  typeQuery?: TypeQueryService,
): SyntaxNode | null {
  for (const child of node.namedChildren) {
    // Don't recurse into nested functions
    if (child.type === 'function_declaration' || child.type === 'arrow_function' ||
        child.type === 'function' || child.type === 'method_definition') continue

    if (child.type === 'return_statement') {
      const returnValue = child.namedChildren[0]
      if (!returnValue) continue

      // Return value is a call expression (not awaited)
      if (returnValue.type === 'call_expression') {
        const callFn = returnValue.childForFieldName('function')
        if (callFn?.type === 'member_expression') {
          const obj = callFn.childForFieldName('object')
          const prop = callFn.childForFieldName('property')
          const objText = obj?.text ?? ''
          const propText = prop?.text ?? ''
          // Skip known synchronous APIs (NextResponse.json, Response.json, res.json, etc.)
          if (/^(NextResponse|Response|res|reply)$/.test(objText)) continue
          // Skip known synchronous methods (array methods, etc.) — these never return Promises
          if (/^(map|filter|reduce|find|findIndex|some|every|flatMap|forEach|sort|flat|join|slice|concat|includes|indexOf|lastIndexOf|toString|keys|values|entries)$/.test(propText)) continue
        }
        // Type-aware check: only flag when the returned expression is
        // actually Promise-like. Catches Hono's `c.json(...)`/`c.text(...)`
        // (synchronous Response), string methods like `.trim()` returning
        // strings, etc. — none of which need awaiting.
        if (typeQuery) {
          const isPromise = typeQuery.isPromiseLike(
            filePath,
            returnValue.startPosition.row,
            returnValue.startPosition.column,
            returnValue.endPosition.row,
            returnValue.endPosition.column,
          )
          if (!isPromise) continue
          // `any`-typed calls satisfy PromiseLike but can't be trusted.
          const isAny = typeQuery.isAnyType(
            filePath,
            returnValue.startPosition.row,
            returnValue.startPosition.column,
            returnValue.endPosition.row,
            returnValue.endPosition.column,
          )
          if (isAny) continue
        }
        return child
      }
    }

    const found = findReturnWithoutAwait(child, filePath, typeQuery)
    if (found) return found
  }
  return null
}
