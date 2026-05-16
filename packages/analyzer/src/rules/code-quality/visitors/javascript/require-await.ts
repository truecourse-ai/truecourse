import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody, getFunctionName } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

// Async-callback option keys whose value is expected to be an async fn by
// the option-bag contract (TanStack Query / RTK / tRPC / GraphQL / Hono).
const ASYNC_OPTION_KEYS = new Set([
  'mutationFn', 'queryFn', 'handler', 'resolver',
  'fetch', 'fetcher',
  'subscribe', 'unsubscribe', 'connect', 'disconnect',
  'onLoad', 'onUnload', 'onMount',
  'createContext', 'middleware',
  // Common React/JSX event-style callback prop names that take a
  // Promise<void> from frameworks like Radix/Headless UI/react-hook-form.
  'onSelect', 'onSubmit', 'onSuccess', 'onError', 'onSettled',
  'onChange', 'onClick', 'onValueChange', 'onOpenChange',
  'onConfirm', 'onCancel', 'onUpdate', 'onDelete', 'onRemove',
  'onDownload', 'onCopy', 'onCopyClick', 'onMethodSelect',
  'onSignatureComplete', 'onFormSubmit',
])

// Methods on a router/app object that take an async handler as the last arg
// (Hono, Express, Fastify, Koa, Vue, MSW http/rest/graphql).
const HTTP_VERB_RE = /^(?:get|post|put|patch|delete|head|options|all|use|route|on|handle|fetch)$/i

// Framework conventions: a function declaration with one of these names
// is required by the framework to be async even with no body await
// (Remix / Next.js / React Router data APIs).
const FRAMEWORK_ASYNC_FN = new Set([
  'loader', 'action', 'meta', 'links', 'headers',
  'clientLoader', 'clientAction', 'shouldRevalidate',
  'middleware', 'default',
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
  'generateMetadata', 'generateStaticParams', 'generateViewport',
])

// Regex describing types whose presence on a function signature is the
// contract the `async` keyword fulfills.
const PROMISE_TYPE_RE = /\b(?:Promise|Awaited|PromiseLike|Thenable)\b/

function isInsideJsxProp(node: SyntaxNode): boolean {
  let p: SyntaxNode | null = node.parent
  while (p) {
    if (p.type === 'jsx_attribute') return true
    if (p.type === 'jsx_expression' && p.parent?.type === 'jsx_attribute') return true
    if (
      p.type === 'function_declaration' ||
      p.type === 'function_expression' ||
      p.type === 'arrow_function' ||
      p.type === 'method_definition' ||
      p.type === 'class_body' ||
      p.type === 'program'
    ) return false
    p = p.parent
  }
  return false
}

function variableDeclaratorHasPromiseType(node: SyntaxNode): boolean {
  // Walk up to the immediate variable_declarator (if any) and check for a
  // type annotation matching Promise<…> / Awaited<…> / PromiseLike<…>.
  let p: SyntaxNode | null = node.parent
  while (p) {
    if (p.type === 'variable_declarator') {
      const ann = p.children.find((c) => c.type === 'type_annotation')
      if (ann && PROMISE_TYPE_RE.test(ann.text)) return true
      return false
    }
    if (
      p.type === 'function_declaration' ||
      p.type === 'function_expression' ||
      p.type === 'arrow_function' ||
      p.type === 'method_definition' ||
      p.type === 'class_body' ||
      p.type === 'program'
    ) return false
    p = p.parent
  }
  return false
}

function isInRouterCallback(node: SyntaxNode): boolean {
  const args = node.parent?.type === 'arguments' ? node.parent : null
  const call = args?.parent?.type === 'call_expression' ? args.parent : null
  if (!call) return false
  const fn = call.childForFieldName('function')
  let methodName = ''
  if (fn?.type === 'member_expression') {
    methodName = fn.childForFieldName('property')?.text ?? ''
  } else if (fn?.type === 'identifier') {
    methodName = fn.text
  }
  if (methodName && HTTP_VERB_RE.test(methodName)) return true
  // MSW / undici handler factories.
  if (methodName === 'http' || methodName === 'rest' || methodName === 'graphql') return true
  // ts-pattern `.with(value, async () => fn())` and `.otherwise(async () => fn())`.
  if (methodName === 'with' || methodName === 'otherwise') return true
  // tRPC `.query(...)` / `.mutation(...)` / `.subscription(...)`.
  if (methodName === 'query' || methodName === 'mutation' || methodName === 'subscription') return true
  return false
}

function isOptionBagAsyncValue(node: SyntaxNode): boolean {
  const pair = node.parent?.type === 'pair' ? node.parent : null
  if (!pair) return false
  const key = pair.childForFieldName('key')
  const keyName = key?.type === 'property_identifier' ? key.text :
    (key?.type === 'string' ? key.text.replace(/^['"]|['"]$/g, '') : '')
  return !!keyName && ASYNC_OPTION_KEYS.has(keyName)
}

function isMapFilterReduceCallback(node: SyntaxNode): boolean {
  // `arr.map(async (x) => …)`, `arr.filter(async (x) => …)`, etc.
  const args = node.parent?.type === 'arguments' ? node.parent : null
  const call = args?.parent?.type === 'call_expression' ? args.parent : null
  if (!call) return false
  const fn = call.childForFieldName('function')
  if (fn?.type !== 'member_expression') return false
  const method = fn.childForFieldName('property')?.text ?? ''
  return method === 'map' || method === 'flatMap' || method === 'filter' || method === 'reduce' ||
    method === 'then' || method === 'catch' || method === 'finally' ||
    method === 'forEach' || method === 'find' || method === 'some' || method === 'every' ||
    // Common Promise utilities used as a containing call:
    method === 'all' || method === 'allSettled' || method === 'race'
}

function bodyIsSingleReturnOfDelegate(body: SyntaxNode): boolean {
  // statement_block with exactly one named child that is a return_statement
  // whose argument is a call/.then chain/await/new Promise — i.e. the body
  // delegates to another Promise-producing expression directly.
  if (body.type !== 'statement_block') return false
  const stmts = body.namedChildren.filter((c) => c.type !== 'comment')
  if (stmts.length !== 1) return false
  const stmt = stmts[0]
  if (stmt.type !== 'return_statement') return false
  const arg = stmt.namedChildren[0]
  if (!arg) return false
  // `return X()` / `return X.y()` / `return X(…).then(…)` / `return new Promise(…)`
  if (arg.type === 'call_expression') return true
  if (arg.type === 'new_expression') {
    const ctor = arg.childForFieldName('constructor')
    if (ctor?.text === 'Promise') return true
  }
  // `return cond ? promiseExpr : promiseExpr` — common in promise-chain shapes.
  if (arg.type === 'ternary_expression') {
    const left = arg.childForFieldName('consequence')
    const right = arg.childForFieldName('alternative')
    if (
      (left?.type === 'call_expression' || left?.type === 'await_expression') &&
      (right?.type === 'call_expression' || right?.type === 'await_expression')
    ) return true
  }
  return false
}

function isMethodOfClassWithHeritage(node: SyntaxNode): boolean {
  if (node.type !== 'method_definition') return false
  let p: SyntaxNode | null = node.parent
  while (p) {
    if (p.type === 'class_declaration' || p.type === 'class' || p.type === 'class_body') {
      const cls = p.type === 'class_body' ? p.parent : p
      if (!cls) return false
      const heritage = cls.namedChildren.find((c) => c.type === 'class_heritage')
      if (heritage && (/\bimplements\b/.test(heritage.text) || /\bextends\b/.test(heritage.text))) {
        return true
      }
      return false
    }
    p = p.parent
  }
  return false
}

export const requireAwaitVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/require-await',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const isAsync = node.children.some((c) => c.type === 'async')
    if (!isAsync) return null

    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    // 1. Explicit `Promise<T>` / `Awaited<T>` / `PromiseLike<T>` return type
    //    on the function — the `async` is fulfilling the typed contract.
    const returnType = node.childForFieldName('return_type')
    if (returnType && PROMISE_TYPE_RE.test(returnType.text)) return null

    // 2. Variable declarator with explicit `Promise<T>` annotation —
    //    `const onClick: () => Promise<void> = async () => …`.
    if (variableDeclaratorHasPromiseType(node)) return null

    // 3. JSX prop position — `onClick={async () => …}` — the framework
    //    type expects a Promise return and the user may add `await` later.
    if (isInsideJsxProp(node)) return null

    // 4. Concise-body async arrow (no statement_block) — `async (x) => fn(x)`,
    //    `async () => Promise.resolve(…)`. The body's value is the return
    //    value, and removing `async` changes the public type from
    //    `Promise<T>` to `T`. Common in middleware factories, sync→async
    //    adapters, ts-pattern callbacks, .map(async (x) => …), and
    //    arrayBuffer/text File-like interface implementations.
    if (node.type === 'arrow_function') {
      const body = node.childForFieldName('body')
      if (body && body.type !== 'statement_block') return null
    }

    // 5. Router method callback — `app.get(path, async (c) => …)`,
    //    `router.post(path, async (req) => …)`, `http.get(path, async () => …)`,
    //    `match.with(pattern, async () => …)`,
    //    `procedure.query(async () => …)` etc.
    if (isInRouterCallback(node)) return null

    // 6. Option-bag async-callback key (`mutationFn`, `queryFn`,
    //    `handler`, `resolver`, `onClick`, `onSelect`, …).
    if (isOptionBagAsyncValue(node)) return null

    // 7. Array-method callback (`arr.map(async (x) => …)` block-body too —
    //    not just concise — also `.then(async (x) => { … })` chains).
    if (isMapFilterReduceCallback(node)) return null

    // 8. Framework-named exported async function (`loader`, `action`,
    //    `clientLoader`, `clientAction`, Remix/Next.js HTTP verb exports,
    //    `default` for Next.js page components).
    if (node.type === 'function_declaration') {
      const name = node.childForFieldName('name')?.text ?? ''
      if (FRAMEWORK_ASYNC_FN.has(name)) return null
    }

    // 9. Async method of a class with `implements` / `extends` heritage —
    //    the async signature may be required by the parent contract.
    if (isMethodOfClassWithHeritage(node)) return null

    // 10. Block body whose only statement is a `return` of a function
    //     call / `new Promise(…)` / ternary of promise expressions — the
    //     function is a pure delegating wrapper. Removing `async` would
    //     change the function's externally-visible return type from
    //     `Promise<T>` to whatever the inner call returns (usually
    //     `Promise<T>` directly, but the wrapper is intentional to
    //     normalize the signature).
    //
    //     Restriction: limited to non-class-method functions, so class
    //     methods like `async getAll() { return repo.findAll(); }` still
    //     fire (negative-fixture contract).
    if (node.type !== 'method_definition' && bodyIsSingleReturnOfDelegate(bodyNode)) return null

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
