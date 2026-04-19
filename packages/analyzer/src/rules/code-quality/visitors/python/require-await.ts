import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonDecoratorName } from '../../../_shared/python-helpers.js'

type SyntaxNode = import('web-tree-sitter').Node

/** FastAPI / Starlette route decorator terminal names. */
const FASTAPI_ROUTE_DECORATORS = new Set([
  'get', 'post', 'put', 'delete', 'patch', 'head', 'options',
  'websocket', 'api_route',
])

/** Check if the function has a FastAPI/Starlette route decorator. */
function hasFastApiRouteDecorator(funcNode: SyntaxNode): boolean {
  // Decorators live on the parent decorated_definition
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

/** Known async interface methods that MUST be async per framework contract. */
const ASYNC_INTERFACE_METHODS = new Set([
  'authenticate', 'on_connect', 'on_disconnect', 'on_receive',
  'lifespan', 'startup', 'shutdown',
])

function isAsyncInterfaceMethod(funcNode: SyntaxNode): boolean {
  const nameNode = funcNode.childForFieldName('name')
  if (!nameNode || !ASYNC_INTERFACE_METHODS.has(nameNode.text)) return false
  const parent = funcNode.parent
  if (parent?.type !== 'block') return false
  if (parent.parent?.type !== 'class_definition') return false
  return true
}

export const pythonRequireAwaitVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/require-await',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    // Check if function is async (has async keyword before def)
    const isAsync = node.children.some((c) => c.type === 'async')
    if (!isAsync) return null

    // Skip async dunder methods — __aenter__, __aexit__, __aiter__,
    // __anext__ MUST be async for protocol compliance even if their
    // bodies don't await anything.
    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || ''
    if (name.startsWith('__') && name.endsWith('__')) return null

    // Skip FastAPI/Starlette route handlers — they MUST be async even without
    // await so the framework runs them in the async event loop.
    if (hasFastApiRouteDecorator(node)) return null

    // Skip methods that implement known async interface contracts.
    if (isAsyncInterfaceMethod(node)) return null

    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    let hasAwait = false

    function walk(n: SyntaxNode) {
      if (hasAwait) return
      if (n.type === 'await') {
        hasAwait = true
        return
      }
      // Don't descend into nested functions
      if (n.type === 'function_definition' && n.id !== node.id) return
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (!hasAwait) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'anonymous'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Async without await',
        `Async function \`${name}\` does not use \`await\`. Remove the \`async\` keyword or add an \`await\`.`,
        sourceCode,
        'Remove the `async` keyword if the function does not need to be async.',
      )
    }
    return null
  },
}
