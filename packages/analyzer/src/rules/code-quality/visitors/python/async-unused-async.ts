import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'
import { getPythonDecoratorName } from '../../../_shared/python-helpers.js'

/** FastAPI / Starlette route decorator terminal names. */
const FASTAPI_ROUTE_DECORATORS = new Set([
  'get', 'post', 'put', 'delete', 'patch', 'head', 'options',
  'websocket', 'api_route',
])

/** Check if the function has a FastAPI/Starlette route decorator. */
function hasFastApiRouteDecorator(funcNode: SyntaxNode): boolean {
  const parent = funcNode.parent
  if (!parent || parent.type !== 'decorated_definition') return false
  for (const child of parent.children) {
    if (child.type === 'decorator') {
      const name = getPythonDecoratorName(child)
      if (name && FASTAPI_ROUTE_DECORATORS.has(name)) return true
    }
  }
  return false
}

function hasAwaitOrAsyncFor(node: SyntaxNode): boolean {
  if (node.type === 'await') return true
  if (node.type === 'for_statement' && node.children.some((c) => c.type === 'async')) return true
  if (node.type === 'with_statement' && node.children.some((c) => c.type === 'async')) return true
  // Don't descend into nested functions
  if (node.type === 'function_definition') return false
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && hasAwaitOrAsyncFor(child)) return true
  }
  return false
}

export const pythonAsyncUnusedAsyncVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/async-unused-async',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const isAsync = node.children.some((c) => c.type === 'async')
    if (!isAsync) return null

    // Skip async dunder methods — __aenter__, __aexit__, __aiter__,
    // __anext__ MUST be async for protocol compliance even if their
    // bodies don't use await/async-for/async-with.
    const nameNode = node.childForFieldName('name')
    if (nameNode?.text.startsWith('__') && nameNode.text.endsWith('__')) return null

    // Skip FastAPI/Starlette route handlers — they MUST be async even without
    // await so the framework runs them in the async event loop.
    if (hasFastApiRouteDecorator(node)) return null

    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    if (hasAwaitOrAsyncFor(bodyNode)) return null

    const name = nameNode?.text || 'function'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Async function without await',
      `Async function \`${name}\` never uses \`await\`, \`async for\`, or \`async with\` — the \`async\` keyword is unnecessary.`,
      sourceCode,
      'Remove the `async` keyword if the function does not need to be awaitable.',
    )
  },
}
