/**
 * INBOUND REQUEST CONTRACTS — what a route's handler actually reads off the
 * request, and which of those fields it REFUSES to work without (item 69).
 *
 * The measured failure: a scenario signs up with `{email, password}` because the
 * spec section it was authored from talks about credentials, while the app's body
 * validation also requires `name` — so a SETUP step 400s and the whole scenario
 * dies before the claim under test is ever exercised. The route's own source says
 * `name` is required; authoring was simply never shown it.
 *
 * Three sources, in descending confidence, all statically visible at the handler:
 *   1. a validation-library shape — `z.object({…})` parsed from `req.body`, whose
 *      keys carry their own requiredness (`.optional()` and friends);
 *   2. a guard the handler writes itself — `if (!req.body.city) → 400` makes that
 *      field REQUIRED, verbatim from the code;
 *   3. plain reads and destructuring — `req.body.name`, `const {city} = req.body`,
 *      `req.query.units` — which prove the field is READ and say nothing about
 *      requiredness, so it is recorded as `'unknown'` rather than guessed.
 *
 * And ONE indirection, because it is where real apps keep this: a handler that
 * hands `req.body` to a named function records that SYMBOL
 * (`bodyValidatorRefs: ['parseSignupBody']`). Every top-level function whose first
 * parameter is read as a record is harvested here too, so the repo-level join can
 * resolve the symbol against the file that declares it — the only layer that sees
 * both files. Requiredness for such a function comes from its own DECLARED RETURN
 * SHAPE when the file has one (`: SignupBody` → `interface SignupBody { name:
 * string }` → required, `name?:` → optional): the app's own written statement of
 * what a valid body contains, not an inference.
 *
 * JS/TS ONLY, the same recorded follow-up items 63/68 carry for their own walks.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import type { RequestContract, RequestField, RequestValidator, SupportedLanguage } from '@truecourse/shared'
import { stringLiteral, walk } from './outbound-requests.js'

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'all'])

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

/** Zod key modifiers that make a key optional. */
const OPTIONAL_ZOD = /\.(optional|nullish|default)\s*\(/

/** What one file yields: per-route contracts (keyed by the route call's location)
 *  and the validator functions declared here. */
export interface RequestContractExtraction {
  /** `startLine:startColumn` of the route registration call → its contract. */
  byRouteLocation: Map<string, RequestContract>
  validators: RequestValidator[]
}

const EMPTY: RequestContractExtraction = { byRouteLocation: new Map(), validators: [] }

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
    byRouteLocation.set(`${node.startPosition.row + 1}:${node.startPosition.column}`, contract)
  })

  return {
    byRouteLocation,
    validators: collectValidators(root, filePath, functionsByName, declaredShapes),
  }
}

// ---------------------------------------------------------------------------
// Route contracts
// ---------------------------------------------------------------------------

function routeContract(
  args: SyntaxNode,
  functionsByName: ReadonlyMap<string, SyntaxNode>,
  zodShapes: ReadonlyMap<string, RequestField[]>,
): RequestContract | null {
  const body = new FieldSet()
  const query = new FieldSet()
  const bodyValidatorRefs = new Set<string>()
  const queryValidatorRefs = new Set<string>()

  for (let i = 1; i < args.namedChildCount; i++) {
    const arg = args.namedChild(i)
    if (!arg) continue
    const handler = FUNCTION_NODES.has(arg.type)
      ? arg
      : arg.type === 'identifier'
        ? (functionsByName.get(arg.text) ?? null)
        : null
    if (!handler) continue
    const requestVar = firstParamName(handler)
    if (!requestVar) continue
    harvestHandler(handler, requestVar, { body, query, bodyValidatorRefs, queryValidatorRefs }, zodShapes)
  }

  const contract: RequestContract = {
    ...(body.size > 0 ? { bodyFields: body.list() } : {}),
    ...(query.size > 0 ? { queryFields: query.list() } : {}),
    ...(bodyValidatorRefs.size > 0 ? { bodyValidatorRefs: [...bodyValidatorRefs].sort() } : {}),
    ...(queryValidatorRefs.size > 0 ? { queryValidatorRefs: [...queryValidatorRefs].sort() } : {}),
  }
  return Object.keys(contract).length > 0 ? contract : null
}

interface HandlerSink {
  body: FieldSet
  query: FieldSet
  bodyValidatorRefs: Set<string>
  queryValidatorRefs: Set<string>
}

/** `req.body` / `req.query` and everything the handler does with them. */
function harvestHandler(
  handler: SyntaxNode,
  requestVar: string,
  sink: HandlerSink,
  zodShapes: ReadonlyMap<string, RequestField[]>,
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
          if (shape) for (const f of shape) fields.add(f.name, f.required)
        }
      }
    }
  })

  // Reads through an alias (`const body = req.body; body.city`).
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

// ---------------------------------------------------------------------------
// Validator functions
// ---------------------------------------------------------------------------

/**
 * Every top-level function whose first parameter is read as a RECORD. Only the ones
 * a route names are ever joined, so an unreferenced entry is dead weight and never
 * a wrong answer.
 */
function collectValidators(
  root: SyntaxNode,
  filePath: string,
  functionsByName: ReadonlyMap<string, SyntaxNode>,
  declaredShapes: ReadonlyMap<string, RequestField[]>,
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
      location: {
        filePath,
        startLine: fn.startPosition.row + 1,
        endLine: fn.endPosition.row + 1,
        startColumn: fn.startPosition.column,
        endColumn: fn.endPosition.column,
      },
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
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

/** variable name → the keys of the `z.object({…})` it holds, with requiredness. */
function collectZodShapes(root: SyntaxNode): Map<string, RequestField[]> {
  const out = new Map<string, RequestField[]>()
  walk(root, (node) => {
    if (node.type !== 'variable_declarator') return
    const name = node.childForFieldName('name')
    const value = node.childForFieldName('value')
    if (name?.type !== 'identifier' || !value) return
    const object = zodObjectArgument(value)
    if (!object) return
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
    if (fields.length > 0) out.set(name.text, fields)
  })
  return out
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
  const params = fn.childForFieldName('parameters')
  if (params) {
    const first = params.namedChild(0)
    if (!first) return null
    if (first.type === 'identifier') return first.text
    const pattern = first.childForFieldName('pattern')
    return pattern && pattern.type === 'identifier' ? pattern.text : null
  }
  // `(x) => …` with a bare parameter.
  const parameter = fn.childForFieldName('parameter')
  return parameter && parameter.type === 'identifier' ? parameter.text : null
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
