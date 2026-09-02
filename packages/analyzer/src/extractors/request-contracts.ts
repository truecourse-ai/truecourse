/**
 * INBOUND REQUEST/RESPONSE CONTRACTS — what a route's handler actually reads off
 * the request, which of those fields it REFUSES to work without, and what it
 * statically PRODUCES back (response statuses + literal response-body keys).
 *
 * The measured failure: a scenario signs up with `{email, password}` because the
 * spec section it was authored from talks about credentials, while the app's body
 * validation also requires `name` — so a SETUP step 400s and the whole scenario
 * dies before the claim under test is ever exercised. The route's own source says
 * `name` is required; authoring was simply never shown it.
 *
 * Three sources, in descending confidence, all statically visible at the handler:
 *   1. a validation-library shape — `z.object({…})` parsed from `req.body` (or
 *      bound by a Hono validator middleware), whose keys carry their own
 *      requiredness (`.optional()` and friends);
 *   2. a guard the handler writes itself — `if (!req.body.city) → 400` makes that
 *      field REQUIRED, verbatim from the code;
 *   3. plain reads and destructuring — `req.body.name`, `const {city} = req.body`,
 *      `const {email} = c.req.valid('json')`, `req.query.units` — which prove the
 *      field is READ and say nothing about requiredness, so it is recorded as
 *      `'unknown'` rather than guessed.
 *
 * FOUR request-read idioms are walked, one per mainstream handler shape:
 *   - Express-style `(req, res)` — `req.body` / `req.query` reads and aliases;
 *   - Hono-style `(c)` — `c.req.json()`, `c.req.valid('json'|'query'|'form')`,
 *     `c.req.query('x')`, `c.req.parseBody()`, plus validator MIDDLEWARE in the
 *     registration args (`zValidator('json', Schema)` / `sValidator(…)`);
 *   - Next.js app-router handlers — `export async function POST(req)` with
 *     `await req.json()` and `req.nextUrl.searchParams.get('x')`;
 *   - Next.js pages/api — `export default function handler(req, res)`, which is
 *     the Express shape behind a default export.
 * The two Next shapes have no route REGISTRATION in the tree today, so their
 * contracts are keyed by the exported declaration's location and join nothing
 * until a registration derivation mints routes at those locations — deliberate:
 * covering the read idiom here means contracts appear the day that lands.
 * (NestJS decorator routes are the one idiom NOT read here: their facts are
 * decorator-borne, so `routes/nest-decorators.ts` attaches the contract while it
 * builds the registration.)
 *
 * The RESPONSE side records only what the source names: `res.status(404)`,
 * `c.json(x, 400)`, `throw new HTTPException(429)`, `Response.json(x, {status})`,
 * and the framework's OWN documented default (200) when the handler demonstrably
 * sends a body without naming a status and nothing in the handler sets one.
 * Body keys are the TOP-LEVEL literal keys of an object literal handed to the
 * send call — a body built elsewhere contributes nothing, honestly.
 *
 * And ONE indirection, because it is where real apps keep this: a handler that
 * hands `req.body` to a named function records that SYMBOL
 * (`bodyValidatorRefs: ['parseSignupBody']`). Every top-level function whose first
 * parameter is read as a record is harvested here too — and so are top-level
 * `z.object({…})` schema variables and class-validator DTO classes, because a
 * Hono middleware schema (`sValidator('json', ZSignInSchema)`) and a Nest
 * `@Body() dto: CreateBookingInput` both name a shape that usually lives in
 * ANOTHER file. The repo-level join resolves the symbol against the file that
 * declares it — the only layer that sees both files.
 *
 * JS/TS ONLY, the same recorded follow-up the external-HTTP and datastore-URL
 * walks carry: Python and C# parse into the same shape and contribute nothing
 * until then.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import type {
  RequestContract,
  RequestField,
  RequestValidator,
  ResponseContract,
  SupportedLanguage,
} from '@truecourse/shared'
import { stringLiteral, walk } from './outbound-requests.js'

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'all'])

/** The verb names a Next.js app-router route module exports its handlers as. */
const HANDLER_EXPORT_NAMES = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

/** Function shapes a handler / validator can be written as. */
const FUNCTION_NODES = new Set([
  'function_declaration',
  'function_expression',
  'function',
  'arrow_function',
  'generator_function',
  'generator_function_declaration',
])

/**
 * A call whose FIRST argument is the record and whose second is a string literal
 * names a field of it (`readString(body, 'email', details)`) — but only when the
 * callee READS like an accessor. Without this gate any two-argument helper taking
 * the record would invent fields out of its own options.
 */
const FIELD_ACCESSOR = /^(read|get|require|pick|take|field|prop|parse|expect|ensure|check|validate|coerce)/i

/**
 * A call that returns the RECORD ITSELF — `asRecord(body)`, `toObject(payload)`. The
 * gate matters: without it every accessor call (`readString(record, 'email')`) would
 * be read as another handle on the record, and the STRING it returns would start
 * contributing its own methods (`name.trim()`) as request fields.
 */
const RECORD_NORMALIZER = /^(?:as|to|ensure|require|coerce|normalize|parse|assert)?_?(?:record|object|obj|body|json|dict|map|payload)$/i

/**
 * A Hono-family validator MIDDLEWARE in the registration args: `zValidator('json',
 * Schema)` (@hono/zod-validator), `sValidator(…)` (@hono/standard-validator),
 * hono's own `validator(…)`. Matched on the callee's tail so a renamed import
 * still reads as one.
 */
const VALIDATOR_MIDDLEWARE = /validator$/i

/** Zod key modifiers that make a key optional. */
const OPTIONAL_ZOD = /\.(optional|nullish|default)\s*\(/

/**
 * Decorator names that mark a class property as a VALIDATED request field —
 * class-validator's vocabulary plus Nest/swagger's `@ApiProperty` pair, which is
 * the app's own written statement of the field's requiredness.
 */
const VALIDATION_DECORATORS = new Set([
  'Min', 'Max', 'MinLength', 'MaxLength', 'Length', 'Matches', 'Equals', 'NotEquals',
  'Contains', 'NotContains', 'ArrayNotEmpty', 'ArrayMinSize', 'ArrayMaxSize',
  'ArrayContains', 'ArrayUnique', 'ValidateNested', 'ValidateIf', 'Validate',
  'Allow', 'ApiProperty', 'ApiPropertyOptional',
])

const isValidationDecorator = (name: string): boolean =>
  VALIDATION_DECORATORS.has(name) || /^Is[A-Z]/.test(name)

/** What one file yields: per-route contracts (keyed by the registration's location)
 *  and the validator shapes declared here. */
export interface RequestContractExtraction {
  /**
   * `startLine:startColumn:endLine:endColumn` of the route registration call →
   * its contract. All FOUR coordinates, deliberately: chained registrations
   * (`new Hono().post('/a', h).post('/b', h)`) share a start position — every
   * link of a chain starts where the chain's head does — so a start-only key
   * would hand one handler's contract to every route in the chain. For the two
   * exported-handler idioms with no registration in the tree (Next app-router,
   * pages/api) the contract is keyed at BOTH the `export_statement` and the
   * declaration inside it, so a future registration derivation can join on
   * whichever location it records.
   */
  byRouteLocation: Map<string, RequestContract>
  validators: RequestValidator[]
}

const EMPTY: RequestContractExtraction = { byRouteLocation: new Map(), validators: [] }

/** The four-coordinate location key — must mirror how the route extractors record
 *  `location` (1-based lines, 0-based columns, from the same syntax node). */
function locationKey(node: SyntaxNode): string {
  return `${node.startPosition.row + 1}:${node.startPosition.column}:${node.endPosition.row + 1}:${node.endPosition.column}`
}

export function extractRequestContracts(
  tree: Tree,
  filePath: string,
  language: SupportedLanguage,
): RequestContractExtraction {
  if (language !== 'typescript' && language !== 'tsx' && language !== 'javascript') return EMPTY

  const root = tree.rootNode
  const functionsByName = collectNamedFunctions(root)
  const zodShapes = collectZodShapes(root)
  const declaredShapes = collectDeclaredShapes(root)

  const byRouteLocation = new Map<string, RequestContract>()
  walk(root, (node) => {
    if (node.type !== 'call_expression') return
    const callee = node.childForFieldName('function')
    if (!callee || callee.type !== 'member_expression') return
    const method = callee.childForFieldName('property')?.text
    if (!method || !HTTP_METHODS.has(method)) return
    const args = node.childForFieldName('arguments')
    if (!args || args.namedChildCount < 2) return
    const first = args.namedChild(0)
    if (!first || stringLiteral(first) === null) return

    const contract = routeContract(args, functionsByName, zodShapes)
    if (!contract) return
    byRouteLocation.set(locationKey(node), contract)
  })

  collectExportedHandlerContracts(root, functionsByName, zodShapes, byRouteLocation)

  return {
    byRouteLocation,
    validators: collectValidators(root, filePath, functionsByName, declaredShapes, zodShapes),
  }
}

// ---------------------------------------------------------------------------
// Route contracts
// ---------------------------------------------------------------------------

/** Everything one route's walk accumulates before it becomes a RequestContract. */
interface ContractSink {
  body: FieldSet
  query: FieldSet
  bodyValidatorRefs: Set<string>
  queryValidatorRefs: Set<string>
  statuses: Set<number>
  /** Insertion-ordered top-level response-body keys. */
  bodyKeys: Set<string>
}

function newSink(): ContractSink {
  return {
    body: new FieldSet(),
    query: new FieldSet(),
    bodyValidatorRefs: new Set(),
    queryValidatorRefs: new Set(),
    statuses: new Set(),
    bodyKeys: new Set(),
  }
}

/** The sink folded into the schema shape — `null` when nothing was established. */
function buildContract(sink: ContractSink): RequestContract | null {
  const produces: ResponseContract = {
    ...(sink.statuses.size > 0 ? { statuses: [...sink.statuses].sort((a, b) => a - b) } : {}),
    ...(sink.bodyKeys.size > 0 ? { bodyKeys: [...sink.bodyKeys] } : {}),
  }
  const contract: RequestContract = {
    ...(sink.body.size > 0 ? { bodyFields: sink.body.list() } : {}),
    ...(sink.query.size > 0 ? { queryFields: sink.query.list() } : {}),
    ...(sink.bodyValidatorRefs.size > 0 ? { bodyValidatorRefs: [...sink.bodyValidatorRefs].sort() } : {}),
    ...(sink.queryValidatorRefs.size > 0 ? { queryValidatorRefs: [...sink.queryValidatorRefs].sort() } : {}),
    ...(Object.keys(produces).length > 0 ? { produces } : {}),
  }
  return Object.keys(contract).length > 0 ? contract : null
}

function routeContract(
  args: SyntaxNode,
  functionsByName: ReadonlyMap<string, SyntaxNode>,
  zodShapes: ReadonlyMap<string, ZodShape>,
): RequestContract | null {
  const sink = newSink()

  for (let i = 1; i < args.namedChildCount; i++) {
    const arg = args.namedChild(i)
    if (!arg) continue
    const handler = FUNCTION_NODES.has(arg.type)
      ? arg
      : arg.type === 'identifier'
        ? (functionsByName.get(arg.text) ?? null)
        : null
    if (handler) {
      harvestAnyHandler(handler, sink, zodShapes)
      continue
    }
    // A validator MIDDLEWARE between the path and the handler binds the schema
    // the handler will read via `c.req.valid(…)` — the strongest signal here.
    if (arg.type === 'call_expression') harvestValidatorMiddleware(arg, sink, zodShapes)
  }

  return buildContract(sink)
}

/**
 * Dispatch on the handler's SHAPE: two-or-more parameters is the `(req, res)`
 * family (Express, pages/api), a single parameter is the context family (Hono).
 * A one-parameter handler still gets the Express request walk — `(req) => …`
 * reading `req.body` is legal Express — because the two walks key on disjoint
 * member shapes and cannot cross-talk.
 */
function harvestAnyHandler(
  handler: SyntaxNode,
  sink: ContractSink,
  zodShapes: ReadonlyMap<string, ZodShape>,
): void {
  const params = paramNames(handler)
  const requestVar = params[0]
  if (!requestVar) return
  harvestExpressRequests(handler, requestVar, sink, zodShapes)
  if (params.length >= 2) {
    if (params[1]) harvestExpressResponses(handler, params[1], sink)
  } else {
    harvestContextHandler(handler, requestVar, sink)
  }
}

/**
 * `zValidator('json', Schema)` / `sValidator('query', Schema)` — the Hono-family
 * middleware that binds a schema to a request part. A schema declared in THIS
 * file resolves to its keys right here; one imported from elsewhere is recorded
 * as a validator REF for the repo-level join, exactly like a named body-validator
 * function. `param`/`header`/`cookie` targets are skipped: the path template
 * already names its params, and headers are not contract fields here.
 */
function harvestValidatorMiddleware(
  call: SyntaxNode,
  sink: ContractSink,
  zodShapes: ReadonlyMap<string, ZodShape>,
): void {
  const callee = call.childForFieldName('function')
  if (!callee || callee.type !== 'identifier' || !VALIDATOR_MIDDLEWARE.test(callee.text)) return
  const args = call.childForFieldName('arguments')
  const target = args?.namedChild(0) ? stringLiteral(args.namedChild(0)!) : null
  const part = target === 'json' || target === 'form' ? 'body' : target === 'query' ? 'query' : null
  if (!part) return
  const fields = part === 'body' ? sink.body : sink.query
  const refs = part === 'body' ? sink.bodyValidatorRefs : sink.queryValidatorRefs

  const schema = args?.namedChild(1)
  if (!schema) return
  if (schema.type === 'identifier') {
    const shape = zodShapes.get(schema.text)
    if (shape) for (const f of shape.fields) fields.add(f.name, f.required)
    else refs.add(schema.text)
    return
  }
  // `zValidator('json', z.object({…}))` written inline.
  const object = zodObjectArgument(schema)
  if (object) for (const f of zodObjectFields(object)) fields.add(f.name, f.required)
}

/** `req.body` / `req.query` and everything the handler does with them. */
function harvestExpressRequests(
  handler: SyntaxNode,
  requestVar: string,
  sink: ContractSink,
  zodShapes: ReadonlyMap<string, ZodShape>,
): void {
  /** identifier → which request part it aliases. */
  const aliases = new Map<string, 'body' | 'query'>()

  walk(handler, (node) => {
    if (node.type !== 'member_expression') return
    const object = node.childForFieldName('object')?.text.trim()
    const property = node.childForFieldName('property')?.text
    if (object !== requestVar || (property !== 'body' && property !== 'query')) return
    const part = property
    const fields = part === 'body' ? sink.body : sink.query
    const refs = part === 'body' ? sink.bodyValidatorRefs : sink.queryValidatorRefs
    const parent = node.parent
    if (!parent) return

    // `req.body.name`, `req.body['name']`
    const direct = readFieldName(parent, node)
    if (direct !== null) {
      fields.add(direct, guardsRequired(parent) ? true : 'unknown')
      return
    }
    // `const body = req.body`, `const { city } = req.body`
    if (parent.type === 'variable_declarator' && parent.childForFieldName('value')?.id === node.id) {
      const name = parent.childForFieldName('name')
      if (!name) return
      if (name.type === 'identifier') aliases.set(name.text, part)
      else if (name.type === 'object_pattern') for (const key of destructuredKeys(name)) fields.add(key, 'unknown')
      return
    }
    // `parseSignupBody(req.body)`, `SignupSchema.parse(req.body)`
    if (parent.type === 'arguments' && parent.parent?.type === 'call_expression') {
      const call = parent.parent
      const calleeNode = call.childForFieldName('function')
      if (!calleeNode) return
      if (calleeNode.type === 'identifier') {
        refs.add(calleeNode.text)
        return
      }
      if (calleeNode.type === 'member_expression') {
        const method = calleeNode.childForFieldName('property')?.text
        const receiver = calleeNode.childForFieldName('object')?.text.trim() ?? ''
        if (method === 'parse' || method === 'safeParse') {
          const shape = zodShapes.get(receiver)
          if (shape) for (const f of shape.fields) fields.add(f.name, f.required)
        }
      }
    }
  })

  harvestAliasReads(handler, aliases, sink)
}

/** Reads through an alias (`const body = req.body; body.city`). */
function harvestAliasReads(
  handler: SyntaxNode,
  aliases: ReadonlyMap<string, 'body' | 'query'>,
  sink: ContractSink,
): void {
  if (aliases.size === 0) return
  walk(handler, (node) => {
    if (node.type !== 'member_expression' && node.type !== 'subscript_expression') return
    const object = node.childForFieldName('object')?.text.trim() ?? ''
    const part = aliases.get(object)
    if (!part) return
    const name = fieldNameOf(node)
    if (name === null) return
    const fields = part === 'body' ? sink.body : sink.query
    fields.add(name, guardsRequired(node) ? true : 'unknown')
  })
}

/**
 * The `(req, res)` response side: `res.status(404)`, `res.sendStatus(204)`,
 * `res.json({…})` keys. Express's implicit 200 is claimed only when the handler
 * demonstrably sends a body AND never calls `res.status`/`sendStatus` anywhere —
 * a bare `res.json(x)` after some branch's `res.status(500)` answers whatever was
 * set, and claiming 200 for it would be an invention.
 */
function harvestExpressResponses(handler: SyntaxNode, resVar: string, sink: ContractSink): void {
  let sawStatusSetter = false
  let sawBareSend = false

  walk(handler, (node) => {
    if (node.type !== 'call_expression') return
    const callee = node.childForFieldName('function')
    if (!callee || callee.type !== 'member_expression') return
    const method = callee.childForFieldName('property')?.text
    const receiver = callee.childForFieldName('object')
    if (!method || !receiver) return
    const args = node.childForFieldName('arguments')

    if (receiver.text.trim() === resVar) {
      if (method === 'status' || method === 'sendStatus') {
        sawStatusSetter = true
        const status = numberLiteral(args?.namedChild(0) ?? null)
        if (status !== null) sink.statuses.add(status)
        return
      }
      if (method === 'json' || method === 'send') {
        sawBareSend = true
        addObjectKeys(args?.namedChild(0) ?? null, sink.bodyKeys)
      }
      return
    }
    // `res.status(404).json({…})` — the keys ride the chained send; the status
    // was already recorded when the inner `res.status(…)` call was visited.
    if ((method === 'json' || method === 'send') && receiver.type === 'call_expression') {
      const inner = receiver.childForFieldName('function')
      if (
        inner?.type === 'member_expression' &&
        inner.childForFieldName('object')?.text.trim() === resVar &&
        inner.childForFieldName('property')?.text === 'status'
      ) {
        addObjectKeys(args?.namedChild(0) ?? null, sink.bodyKeys)
      }
    }
  })

  if (sawBareSend && !sawStatusSetter) sink.statuses.add(200)
}

/**
 * The single-parameter CONTEXT family — Hono's `(c)`. Request reads live under
 * `c.req` (`json()`, `valid('json')`, `query('x')`, `parseBody()`), responses on
 * the context itself (`c.json(x, 400)`, `c.text('OK', 201)`, `c.status(n)`) and
 * as thrown `HTTPException`s. Hono's per-send default 200 is claimed only when
 * the handler never calls `c.status` — the one cross-statement setter.
 */
function harvestContextHandler(handler: SyntaxNode, ctx: string, sink: ContractSink): void {
  const aliases = new Map<string, 'body' | 'query'>()
  const reqOf = `${ctx}.req`
  let sawStatusSetter = false
  let sawBareSend = false

  walk(handler, (node) => {
    if (node.type === 'call_expression') {
      const callee = node.childForFieldName('function')
      if (!callee || callee.type !== 'member_expression') return
      const property = callee.childForFieldName('property')?.text
      const object = callee.childForFieldName('object')?.text.trim()
      const args = node.childForFieldName('arguments')
      if (!property || !object) return

      if (object === reqOf) {
        // `c.req.query('page')` — a direct single-key read. `c.req.param(…)` is
        // deliberately not a field: the path template already names its params.
        if (property === 'query' || property === 'queries') {
          const key = args?.namedChild(0) ? stringLiteral(args.namedChild(0)!) : null
          if (key !== null) sink.query.add(key, 'unknown')
        }
        return
      }
      if (object === ctx) {
        if (property === 'status') {
          sawStatusSetter = true
          const status = numberLiteral(args?.namedChild(0) ?? null)
          if (status !== null) sink.statuses.add(status)
          return
        }
        if (property === 'json' || property === 'text' || property === 'html' || property === 'body') {
          if (property === 'json') addObjectKeys(args?.namedChild(0) ?? null, sink.bodyKeys)
          const status = numberLiteral(args?.namedChild(1) ?? null)
          if (status !== null) sink.statuses.add(status)
          else sawBareSend = true
        }
      }
      return
    }

    // `throw new HTTPException(429, …)` — the framework's own status-bearing throw.
    if (node.type === 'new_expression') {
      const ctor = node.childForFieldName('constructor')
      if (ctor?.type === 'identifier' && ctor.text === 'HTTPException') {
        const status = numberLiteral(node.childForFieldName('arguments')?.namedChild(0) ?? null)
        if (status !== null) sink.statuses.add(status)
      }
      return
    }

    // `const body = await c.req.json()`, `const { email } = c.req.valid('json')`
    if (node.type === 'variable_declarator') {
      const name = node.childForFieldName('name')
      const value = unwrapAwait(node.childForFieldName('value'))
      if (!name || !value) return
      const part = contextRecordSource(value, reqOf)
      if (!part) return
      if (name.type === 'identifier') aliases.set(name.text, part)
      else if (name.type === 'object_pattern') {
        const fields = part === 'body' ? sink.body : sink.query
        for (const key of destructuredKeys(name)) fields.add(key, 'unknown')
      }
    }
  })

  if (sawBareSend && !sawStatusSetter) sink.statuses.add(200)
  harvestAliasReads(handler, aliases, sink)
}

/** Which request part a `c.req.…` call yields a RECORD of, or null. */
function contextRecordSource(value: SyntaxNode, reqOf: string): 'body' | 'query' | null {
  if (value.type !== 'call_expression') return null
  const callee = value.childForFieldName('function')
  if (!callee || callee.type !== 'member_expression') return null
  if (callee.childForFieldName('object')?.text.trim() !== reqOf) return null
  const property = callee.childForFieldName('property')?.text
  const args = value.childForFieldName('arguments')
  if (property === 'json' || property === 'parseBody') return 'body'
  if (property === 'query' && (args?.namedChildCount ?? 0) === 0) return 'query'
  if (property === 'valid') {
    const target = args?.namedChild(0) ? stringLiteral(args.namedChild(0)!) : null
    if (target === 'json' || target === 'form') return 'body'
    if (target === 'query') return 'query'
  }
  return null
}

// ---------------------------------------------------------------------------
// Exported handlers with no registration in the tree (Next.js)
// ---------------------------------------------------------------------------

/**
 * Contracts for the two Next.js handler shapes, keyed by DECLARATION location
 * (see {@link RequestContractExtraction.byRouteLocation}): a verb-named export
 * (`export async function POST(req)`) walks the fetch-Request idiom, a default
 * export with a `(req, res)` signature walks the Express idiom. Neither joins a
 * route today — the tree derives no registrations for them — so these entries
 * are inert until that derivation exists, and cost nothing meanwhile.
 */
function collectExportedHandlerContracts(
  root: SyntaxNode,
  functionsByName: ReadonlyMap<string, SyntaxNode>,
  zodShapes: ReadonlyMap<string, ZodShape>,
  byRouteLocation: Map<string, RequestContract>,
): void {
  for (const statement of root.namedChildren) {
    if (!statement || statement.type !== 'export_statement') continue
    const isDefault = statement.children.some((c) => c?.type === 'default')

    if (isDefault) {
      // pages/api: `export default function handler(req, res)` / `export default handler`.
      let handler: SyntaxNode | null = null
      for (const child of statement.namedChildren) {
        if (!child) continue
        if (FUNCTION_NODES.has(child.type)) handler = child
        else if (child.type === 'identifier') handler = functionsByName.get(child.text) ?? null
      }
      if (!handler) continue
      const params = paramNames(handler)
      if (params.length < 2 || !params[0]) continue
      const sink = newSink()
      harvestExpressRequests(handler, params[0], sink, zodShapes)
      if (params[1]) harvestExpressResponses(handler, params[1], sink)
      const contract = buildContract(sink)
      if (contract) {
        byRouteLocation.set(locationKey(statement), contract)
        byRouteLocation.set(locationKey(handler), contract)
      }
      continue
    }

    // app-router: `export async function POST(req)` / `export const POST = async (req) => …`.
    for (const child of statement.namedChildren) {
      if (!child) continue
      if (child.type === 'function_declaration' || child.type === 'generator_function_declaration') {
        const name = child.childForFieldName('name')?.text
        if (name && HANDLER_EXPORT_NAMES.has(name)) emitFetchHandler(child, statement, child, byRouteLocation)
        continue
      }
      if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
        for (const declarator of child.namedChildren) {
          if (declarator?.type !== 'variable_declarator') continue
          const name = declarator.childForFieldName('name')
          const value = declarator.childForFieldName('value')
          if (name?.type !== 'identifier' || !HANDLER_EXPORT_NAMES.has(name.text)) continue
          if (value && FUNCTION_NODES.has(value.type)) emitFetchHandler(value, statement, declarator, byRouteLocation)
        }
      }
    }
  }
}

function emitFetchHandler(
  handler: SyntaxNode,
  statement: SyntaxNode,
  declaration: SyntaxNode,
  byRouteLocation: Map<string, RequestContract>,
): void {
  const requestVar = paramNames(handler)[0]
  if (!requestVar) return
  const sink = newSink()
  harvestFetchHandler(handler, requestVar, sink)
  const contract = buildContract(sink)
  if (!contract) return
  byRouteLocation.set(locationKey(statement), contract)
  byRouteLocation.set(locationKey(declaration), contract)
}

/**
 * The fetch-Request idiom of a Next.js app-router handler: body via
 * `await req.json()`, query via `req.nextUrl.searchParams.get('x')` (directly or
 * through a `searchParams` / `new URL(req.url)` alias), responses via
 * `Response.json(x, {status})` / `NextResponse.json(…)` / `new Response(_, {status})`.
 * A `.json(x)` that names no status IS a 200 — fetch Responses carry their status
 * per construction, so the default here is per-call, not per-handler.
 */
function harvestFetchHandler(handler: SyntaxNode, requestVar: string, sink: ContractSink): void {
  const aliases = new Map<string, 'body' | 'query'>()
  /** Identifiers holding a URLSearchParams (`sp.get('x')` → query). */
  const searchParamsAliases = new Set<string>()
  /** Identifiers holding a `new URL(req.url)` (`url.searchParams.get('x')`). */
  const urlAliases = new Set<string>()

  const isRequestUrl = (text: string): boolean =>
    text === `${requestVar}.url` || text === `${requestVar}.nextUrl`

  walk(handler, (node) => {
    if (node.type === 'variable_declarator') {
      const name = node.childForFieldName('name')
      const value = unwrapAwait(node.childForFieldName('value'))
      if (!name || !value) return

      // `const body = await req.json()` / `const { a } = await req.json()`
      if (value.type === 'call_expression') {
        const callee = value.childForFieldName('function')
        if (
          callee?.type === 'member_expression' &&
          callee.childForFieldName('object')?.text.trim() === requestVar &&
          callee.childForFieldName('property')?.text === 'json'
        ) {
          if (name.type === 'identifier') aliases.set(name.text, 'body')
          else if (name.type === 'object_pattern') for (const key of destructuredKeys(name)) sink.body.add(key, 'unknown')
        }
        return
      }
      // `const url = new URL(req.url)` / `const { searchParams } = new URL(req.url)`
      if (value.type === 'new_expression') {
        const ctor = value.childForFieldName('constructor')
        const firstArg = value.childForFieldName('arguments')?.namedChild(0)
        if (ctor?.type === 'identifier' && ctor.text === 'URL' && firstArg && isRequestUrl(firstArg.text.trim())) {
          if (name.type === 'identifier') urlAliases.add(name.text)
          else if (name.type === 'object_pattern') {
            for (const key of destructuredKeys(name)) if (key === 'searchParams') searchParamsAliases.add(key)
          }
        }
        return
      }
      // `const sp = req.nextUrl.searchParams`
      if (
        value.type === 'member_expression' &&
        value.childForFieldName('property')?.text === 'searchParams' &&
        isRequestUrl(value.childForFieldName('object')?.text.trim() ?? '')
      ) {
        if (name.type === 'identifier') searchParamsAliases.add(name.text)
      }
      return
    }

    if (node.type !== 'call_expression') return
    const callee = node.childForFieldName('function')
    if (!callee || callee.type !== 'member_expression') return
    const property = callee.childForFieldName('property')?.text
    const object = callee.childForFieldName('object')
    const args = node.childForFieldName('arguments')
    if (!property || !object) return

    // Query reads off a URLSearchParams, however it was reached.
    if (property === 'get' || property === 'getAll' || property === 'has') {
      const objectText = object.text.trim()
      const viaAlias = object.type === 'identifier' && searchParamsAliases.has(objectText)
      const viaUrlAlias =
        object.type === 'member_expression' &&
        object.childForFieldName('property')?.text === 'searchParams' &&
        ((object.childForFieldName('object')?.type === 'identifier' &&
          urlAliases.has(object.childForFieldName('object')!.text)) ||
          isRequestUrl(object.childForFieldName('object')?.text.trim() ?? ''))
      if (viaAlias || viaUrlAlias) {
        const key = args?.namedChild(0) ? stringLiteral(args.namedChild(0)!) : null
        if (key !== null) sink.query.add(key, 'unknown')
      }
      return
    }

    // `Response.json(x)` / `NextResponse.json(x, {status: 400})`
    if (
      property === 'json' &&
      object.type === 'identifier' &&
      (object.text === 'Response' || object.text === 'NextResponse')
    ) {
      addObjectKeys(args?.namedChild(0) ?? null, sink.bodyKeys)
      const status = statusInitOf(args?.namedChild(1) ?? null)
      sink.statuses.add(status ?? 200)
    }
  })

  // `new Response(body, {status: 404})` — status only; the body is a string here.
  walk(handler, (node) => {
    if (node.type !== 'new_expression') return
    const ctor = node.childForFieldName('constructor')
    if (ctor?.type !== 'identifier' || (ctor.text !== 'Response' && ctor.text !== 'NextResponse')) return
    const status = statusInitOf(node.childForFieldName('arguments')?.namedChild(1) ?? null)
    sink.statuses.add(status ?? 200)
  })

  harvestAliasReads(handler, aliases, sink)
}

/** The `status: N` of a ResponseInit object literal, or null. */
function statusInitOf(init: SyntaxNode | null): number | null {
  if (!init || init.type !== 'object') return null
  for (const pair of init.namedChildren) {
    if (pair?.type !== 'pair') continue
    if (pair.childForFieldName('key')?.text.replace(/^['"`]|['"`]$/g, '') !== 'status') continue
    return numberLiteral(pair.childForFieldName('value'))
  }
  return null
}

// ---------------------------------------------------------------------------
// Validator shapes (functions, zod schema variables, DTO classes)
// ---------------------------------------------------------------------------

/**
 * Every shape a route can NAME as its contract, harvested per file so the
 * repo-level join can resolve the symbol against the file that declares it:
 * top-level functions whose first parameter is read as a RECORD, top-level
 * `z.object({…})` schema variables (what a Hono validator middleware binds), and
 * class-validator DTO classes (what a Nest `@Body()` parameter is typed as).
 * Only the ones a route names are ever joined, so an unreferenced entry is dead
 * weight and never a wrong answer.
 */
function collectValidators(
  root: SyntaxNode,
  filePath: string,
  functionsByName: ReadonlyMap<string, SyntaxNode>,
  declaredShapes: ReadonlyMap<string, RequestField[]>,
  zodShapes: ReadonlyMap<string, ZodShape>,
): RequestValidator[] {
  const out: RequestValidator[] = []
  for (const [name, fn] of functionsByName) {
    const param = firstParamName(fn)
    if (!param) continue
    const fields = validatorFields(fn, param)
    if (fields.size === 0) continue
    const declared = returnShape(fn, declaredShapes)
    out.push({
      name,
      fields: fields.list().map((f) => {
        const required = declared?.get(f.name)
        return required === undefined ? f : { name: f.name, required }
      }),
      location: locationOf(fn, filePath),
    })
  }
  for (const [name, shape] of zodShapes) {
    if (shape.fields.length === 0) continue
    out.push({ name, fields: shape.fields.map((f) => ({ ...f })), location: locationOf(shape.node, filePath) })
  }
  out.push(...collectDtoClassValidators(root, filePath))
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function locationOf(node: SyntaxNode, filePath: string): RequestValidator['location'] {
  return {
    filePath,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    startColumn: node.startPosition.column,
    endColumn: node.endPosition.column,
  }
}

/**
 * class-validator DTO classes — the shape behind a Nest `@Body() dto: X`. A
 * property counts when it carries a validation decorator (`@IsEmail()`,
 * `@Min(1)`, `@ApiProperty(…)`); requiredness is the class's own statement:
 * `@IsOptional()` / `@ApiPropertyOptional()` / a `?` token say optional, a
 * validated property without them is required — that is exactly what
 * class-validator enforces at runtime. A class with no validated property is not
 * a DTO and contributes nothing.
 */
function collectDtoClassValidators(root: SyntaxNode, filePath: string): RequestValidator[] {
  const out: RequestValidator[] = []
  walk(root, (node) => {
    if (node.type !== 'class_declaration') return
    const name = node.childForFieldName('name')?.text
    const body = node.childForFieldName('body')
    if (!name || !body) return
    const fields: RequestField[] = []
    for (const member of body.namedChildren) {
      if (member?.type !== 'public_field_definition') continue
      const decoratorNames = memberDecoratorNames(member)
      if (!decoratorNames.some(isValidationDecorator)) continue
      const fieldName = member.childForFieldName('name')?.text
      if (!fieldName) continue
      const optional =
        decoratorNames.includes('IsOptional') ||
        decoratorNames.includes('ApiPropertyOptional') ||
        member.children.some((c) => c?.type === '?')
      fields.push({ name: fieldName.replace(/^['"`]|['"`]$/g, ''), required: !optional })
    }
    if (fields.length > 0) out.push({ name, fields, location: locationOf(node, filePath) })
  })
  return out
}

/** The decorator names on a class member (`@IsOptional()` → `IsOptional`). */
function memberDecoratorNames(member: SyntaxNode): string[] {
  const names: string[] = []
  for (const child of member.namedChildren) {
    if (child?.type !== 'decorator') continue
    for (const inner of child.namedChildren) {
      if (inner?.type === 'call_expression') {
        const callee = inner.childForFieldName('function')
        if (callee?.type === 'identifier') names.push(callee.text)
        else if (callee?.type === 'member_expression') {
          const property = callee.childForFieldName('property')?.text
          if (property) names.push(property)
        }
      } else if (inner?.type === 'identifier') {
        names.push(inner.text)
      }
    }
  }
  return names
}

/** The fields a validator reads off its record parameter, through the local
 *  normalizing wrappers a hand-written validator always has. */
function validatorFields(fn: SyntaxNode, param: string): FieldSet {
  const fields = new FieldSet()
  const aliases = new Set<string>([param])

  // `const record = asRecord(body)`, `const record = body as Record<string, unknown>`
  walk(fn, (node) => {
    if (node.type !== 'variable_declarator') return
    const name = node.childForFieldName('name')
    const value = node.childForFieldName('value')
    if (!name || name.type !== 'identifier' || !value) return
    if (aliasesRecord(value, aliases)) aliases.add(name.text)
  })

  walk(fn, (node) => {
    if (node.type === 'member_expression' || node.type === 'subscript_expression') {
      const object = node.childForFieldName('object')?.text.trim() ?? ''
      if (!aliases.has(object)) return
      const name = fieldNameOf(node)
      if (name !== null) fields.add(name, guardsRequired(node) ? true : 'unknown')
      return
    }
    // `const { city } = record`
    if (node.type === 'variable_declarator') {
      const name = node.childForFieldName('name')
      const value = node.childForFieldName('value')
      if (name?.type === 'object_pattern' && value && aliases.has(value.text.trim())) {
        for (const key of destructuredKeys(name)) fields.add(key, 'unknown')
      }
      return
    }
    // `readString(record, 'email', details)`
    if (node.type === 'call_expression') {
      const callee = node.childForFieldName('function')
      if (!callee || callee.type !== 'identifier' || !FIELD_ACCESSOR.test(callee.text)) return
      const args = node.childForFieldName('arguments')
      const receiver = args?.namedChild(0)
      const key = args?.namedChild(1)
      if (!receiver || !key || !aliases.has(receiver.text.trim())) return
      const literal = stringLiteral(key)
      if (literal !== null) fields.add(literal, 'unknown')
    }
  })
  return fields
}

/** Is this initializer the record itself, or a locally-obvious normalization of it? */
function aliasesRecord(value: SyntaxNode, aliases: ReadonlySet<string>): boolean {
  if (value.type === 'identifier') return aliases.has(value.text)
  if (value.type === 'as_expression' || value.type === 'satisfies_expression') {
    const inner = value.namedChild(0)
    return !!inner && aliasesRecord(inner, aliases)
  }
  if (value.type === 'call_expression') {
    const callee = value.childForFieldName('function')
    if (!callee || callee.type !== 'identifier' || !RECORD_NORMALIZER.test(callee.text)) return false
    const first = value.childForFieldName('arguments')?.namedChild(0)
    return !!first && first.type === 'identifier' && aliases.has(first.text)
  }
  return false
}

/**
 * The requiredness map of a function's DECLARED return shape, when the same file
 * declares it. `: SignupBody` → `interface SignupBody { email: string; name?: string }`
 * → `{email: true, name: false}`. This is the app's own written statement of what a
 * valid record contains — the only requiredness signal a hand-written validator
 * reliably leaves behind.
 */
function returnShape(
  fn: SyntaxNode,
  declaredShapes: ReadonlyMap<string, RequestField[]>,
): Map<string, boolean | 'unknown'> | null {
  const annotation = fn.childForFieldName('return_type')
  if (!annotation) return null
  const text = annotation.text.replace(/^:\s*/, '').replace(/\s+/g, ' ').trim()
  const named = /^([A-Za-z_$][\w$]*)$/.exec(text)
  const shape = named ? declaredShapes.get(named[1]!) : inlineShape(annotation)
  if (!shape) return null
  const map = new Map<string, boolean | 'unknown'>()
  for (const field of shape) map.set(field.name, field.required)
  return map
}

/** `: { email: string; name?: string }` written inline at the signature. */
function inlineShape(annotation: SyntaxNode): RequestField[] | null {
  for (const child of annotation.namedChildren) {
    if (child?.type === 'object_type') return objectTypeFields(child)
  }
  return null
}

// ---------------------------------------------------------------------------
// File-level indexes
// ---------------------------------------------------------------------------

/** name → its function node, for `function f(){}`, `const f = () => {}`, `const f = function(){}`. */
function collectNamedFunctions(root: SyntaxNode): Map<string, SyntaxNode> {
  const out = new Map<string, SyntaxNode>()
  walk(root, (node) => {
    if (node.type === 'function_declaration' || node.type === 'generator_function_declaration') {
      const name = node.childForFieldName('name')?.text
      if (name && !out.has(name)) out.set(name, node)
      return
    }
    if (node.type === 'variable_declarator') {
      const name = node.childForFieldName('name')
      const value = node.childForFieldName('value')
      if (name?.type === 'identifier' && value && FUNCTION_NODES.has(value.type) && !out.has(name.text)) {
        out.set(name.text, value)
      }
    }
  })
  return out
}

/** A `z.object({…})` schema variable: its keys and the declarator that binds it. */
interface ZodShape {
  fields: RequestField[]
  node: SyntaxNode
}

/** variable name → the keys of the `z.object({…})` it holds, with requiredness. */
function collectZodShapes(root: SyntaxNode): Map<string, ZodShape> {
  const out = new Map<string, ZodShape>()
  walk(root, (node) => {
    if (node.type !== 'variable_declarator') return
    const name = node.childForFieldName('name')
    const value = node.childForFieldName('value')
    if (name?.type !== 'identifier' || !value) return
    const object = zodObjectArgument(value)
    if (!object) return
    const fields = zodObjectFields(object)
    if (fields.length > 0) out.set(name.text, { fields, node })
  })
  return out
}

/** The keys of one `z.object({…})` literal, `.optional()` and friends read. */
function zodObjectFields(object: SyntaxNode): RequestField[] {
  const fields: RequestField[] = []
  for (const pair of object.namedChildren) {
    if (!pair || pair.type !== 'pair') continue
    const key = pair.childForFieldName('key')
    const keyValue = pair.childForFieldName('value')
    if (!key || !keyValue) continue
    fields.push({
      name: key.text.replace(/^['"`]|['"`]$/g, ''),
      required: !OPTIONAL_ZOD.test(keyValue.text),
    })
  }
  return fields
}

/** The object literal of a `z.object({…})` expression, through trailing modifiers. */
function zodObjectArgument(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node
  while (current && current.type === 'call_expression') {
    const callee = current.childForFieldName('function')
    if (callee?.type === 'member_expression' && callee.childForFieldName('property')?.text === 'object') {
      const receiver = callee.childForFieldName('object')?.text.trim()
      if (receiver === 'z' || receiver === 'zod') {
        const arg = current.childForFieldName('arguments')?.namedChild(0)
        return arg && arg.type === 'object' ? arg : null
      }
    }
    // `z.object({…}).strict()` — walk down the chain.
    current = callee?.type === 'member_expression' ? callee.childForFieldName('object') : null
  }
  return null
}

/** interface / type-alias name → its properties and whether each is required. */
function collectDeclaredShapes(root: SyntaxNode): Map<string, RequestField[]> {
  const out = new Map<string, RequestField[]>()
  walk(root, (node) => {
    if (node.type === 'interface_declaration') {
      const name = node.childForFieldName('name')?.text
      const body = node.childForFieldName('body')
      if (name && body) out.set(name, objectTypeFields(body))
      return
    }
    if (node.type === 'type_alias_declaration') {
      const name = node.childForFieldName('name')?.text
      const value = node.childForFieldName('value')
      if (name && value?.type === 'object_type') out.set(name, objectTypeFields(value))
    }
  })
  return out
}

/** The property signatures of an object type, `?` read as optional. */
function objectTypeFields(body: SyntaxNode): RequestField[] {
  const fields: RequestField[] = []
  for (const member of body.namedChildren) {
    if (!member || member.type !== 'property_signature') continue
    const name = member.childForFieldName('name')?.text
    if (!name) continue
    fields.push({
      name: name.replace(/^['"`]|['"`]$/g, ''),
      required: !/\?\s*:/.test(member.text.replace(/\s+/g, ' ')),
    })
  }
  return fields
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

/** The first parameter's identifier, for both `(req)` and `(req: Request)`. */
function firstParamName(fn: SyntaxNode): string | null {
  return paramNames(fn)[0] ?? null
}

/**
 * Every positional parameter's identifier, in order; a destructured parameter
 * holds `null` at its position. Length is the DECLARED parameter count, which is
 * what the handler-shape dispatch keys on.
 */
function paramNames(fn: SyntaxNode): (string | null)[] {
  const params = fn.childForFieldName('parameters')
  if (params) {
    const out: (string | null)[] = []
    for (const param of params.namedChildren) {
      if (!param) continue
      if (param.type === 'identifier') {
        out.push(param.text)
        continue
      }
      const pattern = param.childForFieldName('pattern')
      out.push(pattern && pattern.type === 'identifier' ? pattern.text : null)
    }
    return out
  }
  // `x => …` with a bare parameter.
  const parameter = fn.childForFieldName('parameter')
  return parameter && parameter.type === 'identifier' ? [parameter.text] : []
}

/** `await X` → `X`; anything else unchanged. */
function unwrapAwait(node: SyntaxNode | null): SyntaxNode | null {
  if (node?.type === 'await_expression') return node.namedChild(0)
  return node
}

/** A plain integer literal's value, or null for anything computed. */
function numberLiteral(node: SyntaxNode | null): number | null {
  if (!node || node.type !== 'number') return null
  const value = Number(node.text)
  return Number.isInteger(value) ? value : null
}

/** The top-level literal keys of an object literal, appended in source order. */
function addObjectKeys(node: SyntaxNode | null, into: Set<string>): void {
  for (const key of objectLiteralKeys(node)) into.add(key)
}

/**
 * The statically visible TOP-LEVEL keys of an object literal — `pair` keys and
 * shorthand properties; spreads and computed keys contribute nothing. Exported
 * for the Nest decorator reader, which applies it to `return {…}` literals.
 */
export function objectLiteralKeys(node: SyntaxNode | null): string[] {
  if (!node || node.type !== 'object') return []
  const keys: string[] = []
  for (const child of node.namedChildren) {
    if (!child) continue
    if (child.type === 'pair') {
      const key = child.childForFieldName('key')
      if (!key) continue
      if (key.type === 'computed_property_name') continue
      keys.push(key.text.replace(/^['"`]|['"`]$/g, ''))
    } else if (child.type === 'shorthand_property_identifier') {
      keys.push(child.text)
    }
  }
  return keys
}

/**
 * The top-level keys of every object literal a function RETURNS, skipping
 * returns that belong to functions nested inside it. Exported for the Nest
 * decorator reader — a controller method's returned literal is its response
 * body, serialized as-is by the framework.
 */
export function returnedObjectKeys(fn: SyntaxNode): string[] {
  const keys = new Set<string>()
  const visit = (node: SyntaxNode): void => {
    if (node.id !== fn.id && FUNCTION_NODES.has(node.type)) return
    if (node.type === 'return_statement') {
      const value = unwrapAwait(node.namedChild(0))
      if (value) for (const key of objectLiteralKeys(value)) keys.add(key)
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) visit(child)
    }
  }
  visit(fn)
  return [...keys]
}

/** `req.body.name` / `req.body['name']` read THROUGH `parent`, or null. */
function readFieldName(parent: SyntaxNode, node: SyntaxNode): string | null {
  if (parent.type !== 'member_expression' && parent.type !== 'subscript_expression') return null
  if (parent.childForFieldName('object')?.id !== node.id) return null
  return fieldNameOf(parent)
}

function fieldNameOf(node: SyntaxNode): string | null {
  if (node.type === 'member_expression') return node.childForFieldName('property')?.text ?? null
  const index = node.childForFieldName('index')
  return index ? stringLiteral(index) : null
}

/**
 * Does the source REFUSE the request without this field? Only the two forms that
 * say so unambiguously right at the read: `!body.x` and `body.x === undefined` /
 * `== null`. A truthiness check inside a larger expression still counts — its
 * absence is what the branch is about.
 */
function guardsRequired(read: SyntaxNode): boolean {
  const parent = read.parent
  if (!parent) return false
  if (parent.type === 'unary_expression' && parent.child(0)?.text === '!') return true
  if (parent.type === 'binary_expression') {
    const operator = parent.child(1)?.text ?? ''
    const other = parent.childForFieldName('left')?.id === read.id
      ? parent.childForFieldName('right')
      : parent.childForFieldName('left')
    const otherText = other?.text.trim() ?? ''
    if ((operator === '===' || operator === '==') && (otherText === 'undefined' || otherText === 'null')) return true
  }
  return false
}

function destructuredKeys(pattern: SyntaxNode): string[] {
  const keys: string[] = []
  for (const child of pattern.namedChildren) {
    if (!child) continue
    if (child.type === 'shorthand_property_identifier_pattern' || child.type === 'shorthand_property_identifier') {
      keys.push(child.text)
    } else if (child.type === 'pair_pattern') {
      const key = child.childForFieldName('key')
      if (key) keys.push(key.text.replace(/^['"`]|['"`]$/g, ''))
    } else if (child.type === 'object_assignment_pattern') {
      const left = child.namedChild(0)
      if (left) keys.push(left.text)
    }
  }
  return keys
}

/** Fields deduped by name, first-seen order, a KNOWN requiredness winning over `'unknown'`. */
class FieldSet {
  private readonly fields = new Map<string, RequestField>()

  add(name: string, required: boolean | 'unknown'): void {
    const existing = this.fields.get(name)
    if (!existing) {
      this.fields.set(name, { name, required })
      return
    }
    if (existing.required === 'unknown' && required !== 'unknown') existing.required = required
    else if (existing.required === false && required === true) existing.required = true
  }

  get size(): number {
    return this.fields.size
  }

  list(): RequestField[] {
    return [...this.fields.values()].map((f) => ({ ...f }))
  }
}
