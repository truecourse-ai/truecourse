import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detects: async function with try/catch that returns a Promise without await
// `return somePromise()` inside try/catch doesn't catch rejection from the promise
// Should be `return await somePromise()`
export const missingReturnAwaitVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/missing-return-await',
  languages: JS_LANGUAGES,
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
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
    const bareReturn = findReturnWithoutAwait(tryBody)
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

function findReturnWithoutAwait(node: import('web-tree-sitter').Node): import('web-tree-sitter').Node | null {
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
          // Skip known synchronous response APIs:
          //   NextResponse.json / Response.json / res.json / reply.X (Fastify)
          //   Hono context: `c.json` / `c.text` / `c.redirect` / `c.html`
          //   `ctx.X` (alternative naming).
          // All return a `Response` synchronously, not a Promise.
          if (/^(NextResponse|Response|res|reply|c|ctx)$/.test(objText)) continue
          // Skip schema/parser methods: `Schema.parse(...)` /
          // `Schema.safeParse(...)` (Zod, Yup, ArkType, …) — synchronous.
          if (/^(parse|safeParse|stringify|toJSON|toString)$/.test(propText)) continue
          // Skip known synchronous methods (array methods, etc.) — these never return Promises
          if (/^(map|filter|reduce|find|findIndex|some|every|flatMap|forEach|sort|flat|join|slice|concat|includes|indexOf|lastIndexOf|keys|values|entries)$/.test(propText)) continue
        }
        // Free-function calls like `streamText(c, …)` / `streamSSE(c, …)` —
        // Hono's stream helpers return `Response` synchronously even
        // though their callback is async.
        if (callFn?.type === 'identifier') {
          if (/^(streamText|streamSSE|stream|html|jsx|raw|text|redirect|notFound|body|json)$/.test(callFn.text)) continue
        }
        return child
      }
    }

    const found = findReturnWithoutAwait(child)
    if (found) return found
  }
  return null
}
