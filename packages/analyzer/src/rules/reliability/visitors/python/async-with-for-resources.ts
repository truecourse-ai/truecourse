import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const ASYNC_RESOURCE_METHODS = new Set([
  'aopen', 'create_pool', 'create_engine', 'AsyncClient', 'aiohttp_session',
])

export const pythonAsyncWithForResourcesVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/async-with-for-resources',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) methodName = attr.text
    }

    if (!ASYNC_RESOURCE_METHODS.has(methodName)) return null

    // Check if inside async with
    let current: SyntaxNode | null = node.parent
    let enclosingFunc: SyntaxNode | null = null
    while (current) {
      if (current.type === 'with_statement') {
        // Check if it's an async with
        if (current.text.startsWith('async with')) return null
      }
      if (current.type === 'function_definition') {
        enclosingFunc = current
        break
      }
      current = current.parent
    }

    // Skip async-generator dependency injectors:
    //   async def get_client() -> AsyncIterator[X]:
    //       client = httpx.AsyncClient(...)
    //       try:
    //           yield client
    //       finally:
    //           await client.aclose()
    // The function uses \`yield\` and a try/finally with explicit
    // close — \`async with\` cannot wrap a yield-then-cleanup
    // generator pattern.
    if (enclosingFunc) {
      const body = enclosingFunc.childForFieldName('body')
      if (body) {
        const text = body.text
        if (/\byield\b/.test(text) &&
            /\bfinally\s*:/.test(text) &&
            /\b(?:aclose|close|__aexit__)\b/.test(text)) {
          return null
        }
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Async resource without async with',
      `${methodName}() creates an async resource that should be used with 'async with' for proper cleanup.`,
      sourceCode,
      `Use 'async with ${methodName}(...) as resource:' for automatic cleanup.`,
    )
  },
}
