import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import type { RequestContract, RequestField, RouteRegistration } from '@truecourse/shared'
import { returnedObjectKeys } from '../request-contracts.js'

// ---------------------------------------------------------------------------
// Routes declared as decorators — NestJS
//
// The sibling extractor in `route-registrations.ts` reads routes that are CALLED
// (`router.get('/x', h)`). NestJS never calls a router: a controller class is
// annotated, Nest reflects the metadata at boot, and the address is the sum of
// two decorators.
//
//     @Controller({ path: "/v2/bookings", version: "2024-08-13" })
//     export class BookingsController {
//       @Post("/:bookingUid/cancel") async cancelBooking(…) {}
//     }
//
// The whole address is visible in the file — `/v2/bookings` + `/:bookingUid/cancel`
// — so this idiom needs NO mount composition. That is not a general property of
// Nest (an app CAN `setGlobalPrefix('/api')`), but the prefix, where it exists,
// is a bootstrap-level call the per-file extractor never sees, and guessing one
// would be worse than the honest sum of the two decorators. Measured on cal.com's
// api/v2 — 175 method decorators across 38 controllers — every served path is
// exactly that sum, because the version segment is baked into each `@Controller`
// path literal and versioning is negotiated by header.
//
// The gate is the `@Controller` decorator on the enclosing class, and nothing
// else. `@Get`/`@Post` on their own are far too generic to trust — they are also
// how several ORMs and DI containers annotate accessors — but a method decorator
// INSIDE a `@Controller` class is unambiguous. That gate is why this reader can
// afford to be otherwise permissive.
//
// Anything not statically known is dropped rather than half-guessed, at whichever
// level the unknown appears: a `@Controller({ path: BASE })` loses its whole
// class, a `@Get(ROUTE)` loses only itself. A half-known address is not callable
// and, worse, collides with the real one under the operation key downstream.
// ---------------------------------------------------------------------------

/**
 * Nest's HTTP-method decorators, mapped to the verbs the route schema carries.
 * `@Head` and `@Options` are real Nest decorators with no verb in
 * `RouteRegistration`, and neither names an operation a contract is written
 * against — they are left out on purpose rather than folded into `ALL`.
 */
const METHOD_DECORATORS: Record<string, RouteRegistration['httpMethod']> = {
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Patch: 'PATCH',
  Delete: 'DELETE',
  All: 'ALL',
}

/**
 * Route registrations declared by NestJS controller decorators. Paths come out
 * already composed (controller base + method path), so the caller must not apply
 * a mount prefix to them.
 */
export function extractNestControllerRoutes(tree: Tree, filePath: string): RouteRegistration[] {
  const routes: RouteRegistration[] = []
  const cursor = tree.walk()

  function traverse(): void {
    const node = cursor.currentNode
    if (node.type === 'class_declaration') {
      const base = controllerBasePath(node)
      if (base !== null) routes.push(...classRoutes(node, base, filePath))
    }

    if (cursor.gotoFirstChild()) {
      do { traverse() } while (cursor.gotoNextSibling())
      cursor.gotoParent()
    }
  }

  traverse()
  return routes
}

/**
 * The class's `@Controller(…)` base path, or `null` when the class is not a
 * controller — which is also the answer when it IS one but its path is not a
 * literal, since a controller with an unknown base has no derivable route.
 */
function controllerBasePath(classNode: SyntaxNode): string | null {
  for (const decorator of classDecorators(classNode)) {
    const call = decoratorCall(decorator)
    if (!call || decoratorName(call) !== 'Controller') continue

    const args = call.childForFieldName('arguments')
    const first = args?.namedChild(0)
    // `@Controller()` — the app root.
    if (!first) return ''
    // `@Controller('users')`
    if (isStringNode(first)) {
      const literal = stringLiteral(first)
      return literal === null ? null : normalizeSegment(literal)
    }
    // `@Controller({ path: '/v2/bookings', version: … })`
    if (first.type === 'object') {
      const path = objectStringProperty(first, 'path')
      return path === null ? null : normalizeSegment(path)
    }
    return null
  }
  return null
}

/**
 * A class's own decorators. They hang off the `class_declaration` when it stands
 * alone and off the wrapping `export_statement` when it is exported, so both
 * parents are read.
 */
function classDecorators(classNode: SyntaxNode): SyntaxNode[] {
  const own = childrenOfType(classNode, 'decorator')
  const parent = classNode.parent
  if (parent?.type === 'export_statement') return [...childrenOfType(parent, 'decorator'), ...own]
  return own
}

/**
 * One registration per (method decorator × path) in the class body. The two
 * grammars disagree on where a method's decorators hang: tree-sitter-typescript
 * makes them siblings PRECEDING the `method_definition`, tree-sitter-javascript
 * makes them children OF it. Both are read — accumulate the preceding siblings,
 * flush them together with the method's own children when the method is reached.
 */
function classRoutes(classNode: SyntaxNode, base: string, filePath: string): RouteRegistration[] {
  const body = classNode.childForFieldName('body')
  if (!body) return []

  const routes: RouteRegistration[] = []
  let pending: SyntaxNode[] = []

  for (let i = 0; i < body.namedChildCount; i++) {
    const child = body.namedChild(i)
    if (!child) continue
    if (child.type === 'decorator') {
      pending.push(child)
      continue
    }
    if (child.type === 'method_definition') {
      const handlerName = child.childForFieldName('name')?.text ?? ''
      const decorators = [...pending, ...childrenOfType(child, 'decorator')]
      const httpCode = httpCodeOf(decorators)
      const request = methodRequestFacts(child)
      const bodyKeys = returnedObjectKeys(child)
      for (const decorator of decorators) {
        const call = decoratorCall(decorator)
        if (!call) continue
        const httpMethod = METHOD_DECORATORS[decoratorName(call) ?? '']
        if (!httpMethod) continue
        const contract = methodContract(request, bodyKeys, httpCode, httpMethod)
        for (const suffix of decoratorPaths(call)) {
          routes.push({
            httpMethod,
            path: joinPath(base, suffix),
            handlerName,
            ...(contract ? { requestContract: contract } : {}),
            location: {
              filePath,
              startLine: decorator.startPosition.row + 1,
              endLine: decorator.endPosition.row + 1,
              startColumn: decorator.startPosition.column,
              endColumn: decorator.endPosition.column,
            },
          })
        }
      }
    }
    pending = []
  }
  return routes
}

// ---------------------------------------------------------------------------
// The method's CONTRACT — decorator-borne, so it is read here rather than in
// `request-contracts.ts`: the request side is the sum of the `@Body()`/`@Query()`
// parameter decorators (a bare one names its DTO class, harvested repo-wide as a
// validator and resolved by the join; a keyed one names one field), and the
// response side is `@HttpCode(…)` — or the framework's OWN documented default,
// 201 for POST and 200 otherwise — plus the top-level keys of returned object
// literals, which Nest serializes as the response body verbatim. `@Param()` is
// deliberately not a field: the path template already names its params.
// ---------------------------------------------------------------------------

interface MethodRequestFacts {
  bodyFields: RequestField[]
  queryFields: RequestField[]
  bodyValidatorRefs: string[]
  queryValidatorRefs: string[]
}

/**
 * Nest's own `HttpStatus` enum members, so `@HttpCode(HttpStatus.OK)` — the way
 * real controllers write it — resolves without type-checking. A member not in
 * this table (or any other non-literal argument) makes the status UNKNOWN, and
 * an unknown override claims nothing rather than falling back to the default the
 * author explicitly replaced.
 */
const HTTP_STATUS_NAMES: Record<string, number> = {
  CONTINUE: 100, OK: 200, CREATED: 201, ACCEPTED: 202, NO_CONTENT: 204, PARTIAL_CONTENT: 206,
  MOVED_PERMANENTLY: 301, FOUND: 302, SEE_OTHER: 303, NOT_MODIFIED: 304,
  TEMPORARY_REDIRECT: 307, PERMANENT_REDIRECT: 308,
  BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409, GONE: 410, PRECONDITION_FAILED: 412, PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_ENTITY: 422, TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500, NOT_IMPLEMENTED: 501, BAD_GATEWAY: 502, SERVICE_UNAVAILABLE: 503,
}

/**
 * The `@HttpCode(…)` status among a method's decorators: `'none'` when the
 * decorator is absent (the framework default applies), a number when it is
 * statically readable, `'unknown'` when present but not readable — in which case
 * no status is claimed at all, since the default was explicitly overridden.
 */
function httpCodeOf(decorators: readonly SyntaxNode[]): number | 'none' | 'unknown' {
  for (const decorator of decorators) {
    const call = decoratorCall(decorator)
    if (!call || decoratorName(call) !== 'HttpCode') continue
    const arg = call.childForFieldName('arguments')?.namedChild(0)
    if (!arg) return 'unknown'
    if (arg.type === 'number') {
      const value = Number(arg.text)
      return Number.isInteger(value) ? value : 'unknown'
    }
    if (arg.type === 'member_expression') {
      const name = arg.childForFieldName('property')?.text ?? ''
      return HTTP_STATUS_NAMES[name] ?? 'unknown'
    }
    return 'unknown'
  }
  return 'none'
}

/** The request facts of one controller method's decorated parameters. */
function methodRequestFacts(method: SyntaxNode): MethodRequestFacts {
  const facts: MethodRequestFacts = { bodyFields: [], queryFields: [], bodyValidatorRefs: [], queryValidatorRefs: [] }
  const params = method.childForFieldName('parameters')
  if (!params) return facts

  for (const param of params.namedChildren) {
    if (!param || (param.type !== 'required_parameter' && param.type !== 'optional_parameter')) continue
    for (const decorator of childrenOfType(param, 'decorator')) {
      const call = decoratorCall(decorator)
      if (!call) continue
      const name = decoratorName(call)
      if (name !== 'Body' && name !== 'Query') continue
      const fields = name === 'Body' ? facts.bodyFields : facts.queryFields
      const refs = name === 'Body' ? facts.bodyValidatorRefs : facts.queryValidatorRefs

      const keyArg = call.childForFieldName('arguments')?.namedChild(0)
      const key = keyArg ? stringLiteral(keyArg) : null
      if (key !== null) {
        // `@Query('day') day?: string` — the `?` is the app's own optionality statement.
        fields.push({ name: key, required: param.type === 'optional_parameter' ? false : 'unknown' })
        continue
      }
      if (keyArg) continue // a non-literal key names nothing statically
      // `@Body() body: CreateBookingInput` — the DTO class is the shape; record
      // the SYMBOL for the repo-level join (the class usually lives elsewhere).
      const typeName = paramTypeName(param)
      if (typeName) refs.push(typeName)
    }
  }
  return facts
}

/** The bare named type of a parameter annotation, or null for anything composed. */
function paramTypeName(param: SyntaxNode): string | null {
  const annotation = param.childForFieldName('type')
  const inner = annotation?.namedChild(0)
  return inner?.type === 'type_identifier' ? inner.text : null
}

/**
 * One route's contract from the method-level facts. The status is per-VERB
 * because the framework default is (POST → 201, otherwise → 200); an `@HttpCode`
 * whose argument could not be read claims no status at all.
 */
function methodContract(
  request: MethodRequestFacts,
  bodyKeys: readonly string[],
  httpCode: number | 'none' | 'unknown',
  httpMethod: RouteRegistration['httpMethod'],
): RequestContract | null {
  const status = httpCode === 'none' ? (httpMethod === 'POST' ? 201 : 200) : httpCode
  const produces = {
    ...(typeof status === 'number' ? { statuses: [status] } : {}),
    ...(bodyKeys.length > 0 ? { bodyKeys: [...bodyKeys] } : {}),
  }
  const contract: RequestContract = {
    ...(request.bodyFields.length > 0 ? { bodyFields: request.bodyFields.map((f) => ({ ...f })) } : {}),
    ...(request.queryFields.length > 0 ? { queryFields: request.queryFields.map((f) => ({ ...f })) } : {}),
    ...(request.bodyValidatorRefs.length > 0 ? { bodyValidatorRefs: [...request.bodyValidatorRefs].sort() } : {}),
    ...(request.queryValidatorRefs.length > 0 ? { queryValidatorRefs: [...request.queryValidatorRefs].sort() } : {}),
    ...(Object.keys(produces).length > 0 ? { produces } : {}),
  }
  return Object.keys(contract).length > 0 ? contract : null
}

/**
 * The path(s) a method decorator registers. `@Get()` registers the controller
 * base itself; `@Get(['/a', '/b'])` registers both; a non-literal argument
 * registers nothing.
 */
function decoratorPaths(call: SyntaxNode): string[] {
  const args = call.childForFieldName('arguments')
  const first = args?.namedChild(0)
  if (!first) return ['']

  if (first.type === 'array') {
    const paths: string[] = []
    for (let i = 0; i < first.namedChildCount; i++) {
      const element = first.namedChild(i)
      const literal = element ? stringLiteral(element) : null
      if (literal !== null) paths.push(normalizeSegment(literal))
    }
    return paths
  }

  const literal = stringLiteral(first)
  return literal === null ? [] : [normalizeSegment(literal)]
}

function childrenOfType(node: SyntaxNode, type: string): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child?.type === type) out.push(child)
  }
  return out
}

/** The `call_expression` inside `@Name(args)`; `null` for a bare `@Name`. */
function decoratorCall(decorator: SyntaxNode): SyntaxNode | null {
  for (let i = 0; i < decorator.namedChildCount; i++) {
    const child = decorator.namedChild(i)
    if (child?.type === 'call_expression') return child
  }
  return null
}

/** `Controller` from `@Controller(…)` and from `@nest.Controller(…)` alike. */
function decoratorName(call: SyntaxNode): string | null {
  const callee = call.childForFieldName('function')
  if (!callee) return null
  if (callee.type === 'identifier') return callee.text
  if (callee.type === 'member_expression') return callee.childForFieldName('property')?.text ?? null
  return null
}

/** The literal value of a `{ key: '…' }` property, or `null` when it is not one. */
function objectStringProperty(object: SyntaxNode, key: string): string | null {
  for (let i = 0; i < object.namedChildCount; i++) {
    const pair = object.namedChild(i)
    if (pair?.type !== 'pair') continue
    const name = pair.childForFieldName('key')
    if (!name) continue
    const nameText = isStringNode(name) ? stringLiteral(name) : name.text
    if (nameText !== key) continue
    const value = pair.childForFieldName('value')
    return value ? stringLiteral(value) : null
  }
  return null
}

function isStringNode(node: SyntaxNode): boolean {
  return node.type === 'string' || node.type === 'template_string'
}

/**
 * The statically-known text of a string node — plain quotes, or a backtick string
 * with no interpolation in it. Anything else (an identifier, a concatenation, a
 * `${…}`) is not statically known and yields `null`.
 */
function stringLiteral(node: SyntaxNode): string | null {
  if (node.type === 'string') return node.text.replace(/^["'`]|["'`]$/g, '')
  if (node.type === 'template_string') {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (node.namedChild(i)?.type !== 'string_fragment') return null
    }
    return node.text.replace(/^`|`$/g, '')
  }
  return null
}

/** `users` → `/users`, `/` → ``, `/v2/bookings/` → `/v2/bookings`. */
function normalizeSegment(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '/') return ''
  const leading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return leading.endsWith('/') ? leading.slice(0, -1) : leading
}

function joinPath(base: string, suffix: string): string {
  return `${base}${suffix}` || '/'
}
