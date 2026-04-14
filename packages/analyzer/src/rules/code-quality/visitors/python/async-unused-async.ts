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

/**
 * Known method names that MUST be async per their framework interface contract,
 * even when the implementation doesn't use await.
 * E.g., Starlette AuthenticationBackend.authenticate, ASGI lifespan handlers.
 */
const ASYNC_INTERFACE_METHODS = new Set([
  'authenticate', 'on_connect', 'on_disconnect', 'on_receive',
  'lifespan', 'startup', 'shutdown',
])

/** True if the function is a method inside a class that overrides an async interface. */
function isAsyncInterfaceMethod(funcNode: SyntaxNode): boolean {
  const nameNode = funcNode.childForFieldName('name')
  if (!nameNode || !ASYNC_INTERFACE_METHODS.has(nameNode.text)) return false
  // Must be inside a class body
  const parent = funcNode.parent
  if (parent?.type !== 'block') return false
  if (parent.parent?.type !== 'class_definition') return false
  return true
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

    // Skip methods that implement known async interface contracts — they MUST
    // be async even without await to satisfy the base class protocol.
    if (isAsyncInterfaceMethod(node)) return null

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
