import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody, getFunctionName } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const requireAwaitVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/require-await',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const isAsync = node.children.some((c) => c.type === 'async')
    if (!isAsync) return null

    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    // Skip when the function has an explicit `Promise<T>` / `Awaited<T>`
    // return type — the async is fulfilling a typed contract. Removing
    // it would change the return type from Promise<T> to T.
    const returnType = node.childForFieldName('return_type')
    if (returnType && /\b(?:Promise|Awaited|PromiseLike|Thenable)\b/.test(returnType.text)) return null

    // Skip when the function is in JSX prop position — `onClick={async
    // () => …}` async lets the handler `await` later additions and
    // reads as "this returns a Promise, the framework will manage it".
    let p: typeof node.parent = node.parent
    while (p) {
      if (p.type === 'jsx_attribute') return null
      if (p.type === 'jsx_expression' && p.parent?.type === 'jsx_attribute') return null
      // Variable declarator with explicit Promise<T> annotation — same
      // contract reasoning as return type above.
      if (p.type === 'variable_declarator') {
        const ann = p.children.find((c) => c.type === 'type_annotation')
        if (ann && /\b(?:Promise|Awaited|PromiseLike|Thenable)\b/.test(ann.text)) return null
        break
      }
      // Don't escape past the immediate enclosing context.
      if (
        p.type === 'function_declaration' ||
        p.type === 'function_expression' ||
        p.type === 'arrow_function' ||
        p.type === 'method_definition' ||
        p.type === 'class_body' ||
        p.type === 'program'
      ) break
      p = p.parent
    }

    // Skip async arrow functions whose body is a single
    // expression (no statement_block) — `async (x) => fn(x)`,
    // `async () => something`. The body's value is the return
    // value, and writing `async` ensures the result is wrapped
    // in `Promise<T>` even when the inner expression already is
    // one. Removing `async` could change the public type
    // signature of the function from `Promise<T>` to `T`. This
    // pattern is common for inline middleware factories,
    // sync→async adapters, and tap/passthrough helpers.
    if (node.type === 'arrow_function') {
      const body = node.childForFieldName('body')
      if (body && body.type !== 'statement_block') return null
    }

    // Skip async functions passed as values of known
    // async-callback option keys (`mutationFn`, `queryFn`,
    // `handler`, `loader`, `action`, `resolver`, `subscribe`,
    // `transition`). The framework's option-bag type expects an
    // async function regardless of whether the body uses await.
    const ASYNC_OPTION_KEYS = new Set([
      'mutationFn', 'queryFn', 'handler', 'resolver',
      'fetch', 'fetcher',
      'subscribe', 'unsubscribe', 'connect', 'disconnect',
      'onLoad', 'onUnload', 'onMount',
    ])
    {
      const pair = node.parent?.type === 'pair' ? node.parent : null
      if (pair) {
        const key = pair.childForFieldName('key')
        const keyName = key?.type === 'property_identifier' ? key.text :
          (key?.type === 'string' ? key.text.replace(/^['"]|['"]$/g, '') : '')
        if (keyName && ASYNC_OPTION_KEYS.has(keyName)) return null
      }
    }

    // Skip async arrow passed as the last positional argument
    // to a router method call: `app.get('/path', async (c) =>
    // …)`, `http.get('/api', async () => HttpResponse.json(...))`,
    // `router.post(p, async (req) => …)`. The router contract
    // expects an async handler.
    {
      const args = node.parent?.type === 'arguments' ? node.parent : null
      const call = args?.parent?.type === 'call_expression' ? args.parent : null
      if (call) {
        const fn = call.childForFieldName('function')
        let methodName = ''
        if (fn?.type === 'member_expression') {
          methodName = fn.childForFieldName('property')?.text ?? ''
        } else if (fn?.type === 'identifier') {
          methodName = fn.text
        }
        // Common HTTP / route-handler verbs.
        const HTTP_VERB_RE = /^(?:get|post|put|patch|delete|head|options|all|use|route|on|handle|fetch|all)$/i
        if (methodName && HTTP_VERB_RE.test(methodName)) return null
        // MSW / undici handler factories.
        if (methodName === 'http' || methodName === 'rest' || methodName === 'graphql') return null
      }
    }

    // Skip exported async functions named after framework
    // conventions (`loader`, `action`, `meta`, `links`,
    // `headers`, `clientLoader`, `clientAction`, `default`).
    // Their async signature is required by the framework even
    // when the implementation has no await.
    if (node.type === 'function_declaration') {
      const name = node.childForFieldName('name')?.text ?? ''
      const FRAMEWORK_ASYNC_FN = new Set([
        'loader', 'action', 'meta', 'links', 'headers',
        'clientLoader', 'clientAction', 'shouldRevalidate',
        'middleware',
        'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
        'generateMetadata', 'generateStaticParams', 'generateViewport',
      ])
      if (FRAMEWORK_ASYNC_FN.has(name)) return null
    }

    // Skip async methods of a class that has an `implements` clause —
    // those are interface/contract implementations.
    if (node.type === 'method_definition') {
      let cls: typeof node.parent = node.parent
      while (cls) {
        if (cls.type === 'class_declaration' || cls.type === 'class') {
          const heritage = cls.namedChildren.find((c) => c.type === 'class_heritage')
          if (heritage && /\bimplements\b/.test(heritage.text)) return null
          // Also skip when class extends a parent — the async signature may
          // be required by the parent's contract.
          if (heritage && /\bextends\b/.test(heritage.text)) return null
          break
        }
        cls = cls.parent
      }
    }

    let hasAwait = false

    function walk(n: SyntaxNode) {
      if (hasAwait) return
      if (n.type === 'await_expression') {
        hasAwait = true
        return
      }
      if (JS_FUNCTION_TYPES.includes(n.type) && n.id !== node.id) return
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (!hasAwait) {
      const name = getFunctionName(node)
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
