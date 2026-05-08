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

/**
 * True if the function is a method of a class that declares a
 * non-trivial superclass. The body may not happen to await
 * anything in this implementation, but the contract (defined by
 * the base) is async — `async def` is required for the override
 * to satisfy `runtime_checkable` protocols, ABC `@abstractmethod`
 * shapes, framework `Manager[T]` interfaces, etc.
 *
 * Same rationale as the no-self-use subclass skip.
 */
function isMethodOfSubclass(funcNode: SyntaxNode): boolean {
  // Handles both raw `async def` methods (parent: block) AND
  // decorated methods (`@staticmethod async def …`) where the
  // parent is `decorated_definition` and the block is the
  // grandparent.
  let cursor = funcNode.parent
  if (cursor?.type === 'decorated_definition') cursor = cursor.parent
  if (cursor?.type !== 'block') return false
  const cls = cursor.parent
  if (cls?.type !== 'class_definition') return false
  const supers = cls.childForFieldName('superclasses')
  if (!supers) return false
  for (const c of supers.namedChildren) {
    const text = c.text.trim()
    if (!text) continue
    if (text === 'object') continue
    return true
  }
  return false
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

    // Skip async methods on classes with a non-trivial base — the
    // base may declare the method as async and the override has to
    // match. Same rationale as no-self-use's subclass skip.
    if (isMethodOfSubclass(node)) return null

    // Skip @classmethod async def factories — `async def
    // get_instance(cls)`, `from_dict`, `create`, etc. Factory
    // conventions on async-protocol classes.
    {
      const decorated = node.parent?.type === 'decorated_definition' ? node.parent : null
      if (decorated) {
        for (const c of decorated.children) {
          if (c.type !== 'decorator') continue
          const dec = c.namedChildren[0]
          let decName = ''
          if (dec?.type === 'identifier') decName = dec.text
          else if (dec?.type === 'attribute') decName = dec.childForFieldName('attribute')?.text ?? ''
          else if (dec?.type === 'call') {
            const fn = dec.childForFieldName('function')
            if (fn?.type === 'identifier') decName = fn.text
          }
          if (decName === 'classmethod') return null
        }
      }
    }

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
