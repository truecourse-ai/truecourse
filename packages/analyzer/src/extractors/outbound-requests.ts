/**
 * OUTBOUND REQUEST CONSTRUCTION — how the app builds the requests it sends to its
 * upstreams, and which response fields it reads back (item 69).
 *
 * The gap this closes is measured, not theoretical: a scenario that stubs an
 * upstream with `setup.http` scripts the VENDOR'S default payload, while the app
 * asks that vendor for a different representation (`timeformat=unixtime`) and then
 * validates every field as a finite number. The app rejects its own stub and the
 * scenario fails 502 — for a reason that has nothing to do with the claim under
 * test. The model was never shown how the app CONSTRUCTS the request or which
 * fields it VALIDATES; this pass is what shows it.
 *
 * PRECISION OVER RECALL, and the anchor is the URL construction, not the transport.
 * `new URL(path, base)` is where a repo writes down its path and its query, and it
 * is in the same function as the response reads — while the `fetch` itself is
 * routinely one indirection away in a shared client module. Everything harvested is
 * a literal or a locally-resolvable fact:
 *   - the path literal and the `searchParams.set('k', v)` keys, values verbatim
 *     when literal and `<dynamic>` when computed (the KEY is the assertable fact
 *     either way — an author can `expect.query` on it);
 *   - fetch options in the same function (method, literal headers);
 *   - the property names read off the parsed response in the same function, with a
 *     type hint ONLY when the source itself checks the value right there
 *     (`asFiniteNumber(current['time'])`, `typeof tz === 'string'`).
 * Anything needing a type-checker or a cross-file inference is left out, and the
 * base of a request whose origin arrives as a parameter stays an unresolved
 * expression — the honest answer, joined to a service by the caller when it can be.
 *
 * JS/TS ONLY, the same recorded follow-up items 63/68 carry for their own walks.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import {
  DYNAMIC_VALUE,
  type OutboundHeader,
  type OutboundQueryParam,
  type OutboundRequest,
  type OutboundResponseField,
  type SupportedLanguage,
} from '@truecourse/shared'

/** Nodes that bound a "same function" claim. */
const FUNCTION_NODES = new Set([
  'function_declaration',
  'function_expression',
  'function',
  'arrow_function',
  'generator_function',
  'generator_function_declaration',
  'method_definition',
])

/**
 * Wrapper WORDS that say what a value must be, matched against the callee's own
 * name split into words (`asFiniteNumber` → as|finite|number). A name is the only
 * thing available here — the alternative is a type-checker, which this pass
 * deliberately is not.
 */
const NUMBER_WORDS = new Set(['number', 'num', 'int', 'integer', 'float', 'finite', 'parsefloat', 'parseint'])
const STRING_WORDS = new Set(['string', 'str', 'text'])

/** `asFiniteNumber` → `['as','finite','number']`; `read_string` → `['read','string']`. */
function wordsOf(name: string): string[] {
  const last = name.split('.').pop() ?? name
  return last
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
}

/** The type a locally-applied wrapper asserts, from its name alone. */
function wrapperHint(callee: string): 'number' | 'string' | 'array' | undefined {
  const words = wordsOf(callee)
  if (words.some((w) => NUMBER_WORDS.has(w))) return 'number'
  if (callee.trim() === 'Array.isArray') return 'array'
  if (words.some((w) => STRING_WORDS.has(w))) return 'string'
  return undefined
}

/**
 * Properties that belong to JavaScript, not to the payload. Reading `.length` off a
 * parsed array says nothing a stub author can act on, and a method call is not a
 * field at all.
 */
const INTRINSIC_PROPERTIES = new Set(['length', 'constructor', 'prototype', '__proto__'])

/** Query-param setters on a `URL`'s `searchParams`. */
const PARAM_SETTERS = new Set(['set', 'append'])

/** How many params/fields one request may carry into the analysis. Beyond this the
 *  facts stop being a summary and start being a dump; the prompt caps again. */
const MAX_PARAMS = 40
const MAX_FIELDS = 60

/**
 * The outbound requests one parsed file constructs. Pure: no I/O, no tree-sitter
 * node escapes the return.
 */
export function extractOutboundRequests(
  tree: Tree,
  filePath: string,
  language: SupportedLanguage,
): OutboundRequest[] {
  if (language !== 'typescript' && language !== 'tsx' && language !== 'javascript') return []

  const out: OutboundRequest[] = []
  for (const anchor of findUrlAnchors(tree.rootNode)) {
    // A `new URL` is not always a REQUEST: `new URL('../../drizzle', import.meta.url)`
    // resolves a file next to the module. An outbound request writes an absolute
    // path or an absolute origin; anything else is addressing something local.
    if (!anchor.urlRef.host && !anchor.pathLiteral?.startsWith('/')) continue
    const scope = enclosingFunction(anchor.node)
    if (!scope) continue
    const siblings = findUrlAnchors(scope).length
    const varName = assignedVariableName(anchor.node)
    const fetchOptions = readFetchOptions(scope)

    out.push({
      urlRef: anchor.urlRef,
      method: fetchOptions.method ?? 'GET',
      ...(anchor.pathLiteral !== undefined ? { pathLiteral: anchor.pathLiteral } : {}),
      queryParams: varName ? collectQueryParams(scope, varName) : [],
      ...(fetchOptions.headers.length > 0 ? { headers: fetchOptions.headers } : {}),
      // Response reads are attributed only when the function builds ONE request:
      // with two, nothing in the source says which payload belongs to which.
      responseFieldsRead: siblings === 1 ? collectResponseFields(scope) : [],
      location: {
        filePath,
        startLine: anchor.node.startPosition.row + 1,
        endLine: anchor.node.endPosition.row + 1,
        startColumn: anchor.node.startPosition.column,
        endColumn: anchor.node.endPosition.column,
      },
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// The anchor: `new URL(path, base)`
// ---------------------------------------------------------------------------

interface UrlAnchor {
  node: SyntaxNode
  pathLiteral?: string
  urlRef: OutboundRequest['urlRef']
}

/** Every `new URL(…)` in a subtree, in source order. */
function findUrlAnchors(root: SyntaxNode): UrlAnchor[] {
  const anchors: UrlAnchor[] = []
  walk(root, (node) => {
    if (node.type !== 'new_expression') return
    const ctor = node.childForFieldName('constructor')
    if (!ctor || ctor.text !== 'URL') return
    const args = node.childForFieldName('arguments')
    if (!args) return
    const first = args.namedChild(0)
    const second = args.namedChild(1)
    const pathLiteral = first ? stringLiteral(first) : null
    // `new URL(absoluteLiteral)` is a request too — its own origin is the base.
    const absolute = pathLiteral && /^https?:\/\//i.test(pathLiteral) ? pathLiteral : null
    anchors.push({
      node,
      ...(pathLiteral !== null && !absolute ? { pathLiteral } : {}),
      ...(absolute ? { pathLiteral: pathOf(absolute) } : {}),
      urlRef: baseRef(absolute, second),
    })
  })
  return anchors
}

/** How the ORIGIN of this request is written: a literal host, an env read, or the
 *  base expression verbatim (unresolved, and honestly so). */
function baseRef(absolute: string | null, base: SyntaxNode | null): OutboundRequest['urlRef'] {
  if (absolute) {
    const host = hostOf(absolute)
    return host ? { host } : {}
  }
  if (!base) return {}
  const literal = stringLiteral(base)
  if (literal && /^https?:\/\//i.test(literal)) {
    const host = hostOf(literal)
    if (host) return { host, baseExpr: literal }
  }
  const envVar = envReadName(base.text)
  return { baseExpr: base.text.trim(), ...(envVar ? { envVar } : {}) }
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase() || undefined
  } catch {
    return undefined
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

const ENV_READ = /(?:process\s*\.\s*env|(?<![\w.$])env)\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*['"]([^'"]+)['"]\s*\])/

function envReadName(text: string): string | undefined {
  const m = ENV_READ.exec(text)
  return m ? (m[1] ?? m[2]) : undefined
}

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

/**
 * `url.searchParams.set('k', v)` / `.append(…)` on the URL this anchor was assigned
 * to. Bound by the RECEIVER's name, so a function that builds two URLs never mixes
 * their query strings.
 */
function collectQueryParams(scope: SyntaxNode, urlVar: string): OutboundQueryParam[] {
  const params: OutboundQueryParam[] = []
  walk(scope, (node) => {
    if (params.length >= MAX_PARAMS) return
    if (node.type !== 'call_expression') return
    const callee = node.childForFieldName('function')
    if (!callee || callee.type !== 'member_expression') return
    const method = callee.childForFieldName('property')?.text
    if (!method || !PARAM_SETTERS.has(method)) return
    const receiver = callee.childForFieldName('object')
    if (!receiver || receiver.text.replace(/\s+/g, '') !== `${urlVar}.searchParams`) return
    const args = node.childForFieldName('arguments')
    const key = args?.namedChild(0)
    const value = args?.namedChild(1)
    const keyLiteral = key ? stringLiteral(key) : null
    if (keyLiteral === null) return // a computed KEY is not an assertable fact
    const valueLiteral = value ? stringLiteral(value) : null
    params.push({ key: keyLiteral, value: valueLiteral ?? DYNAMIC_VALUE })
  })
  return params
}

// ---------------------------------------------------------------------------
// Fetch options
// ---------------------------------------------------------------------------

/** The literal method + headers of a `fetch(…, { … })` in the same function. */
function readFetchOptions(scope: SyntaxNode): { method?: string; headers: OutboundHeader[] } {
  let method: string | undefined
  const headers: OutboundHeader[] = []
  walk(scope, (node) => {
    if (node.type !== 'call_expression') return
    const callee = node.childForFieldName('function')?.text ?? ''
    if (!/(^|\.)fetch$/.test(callee.trim())) return
    const options = node.childForFieldName('arguments')?.namedChild(1)
    if (!options || options.type !== 'object') return
    const methodValue = objectProperty(options, 'method')
    const literal = methodValue ? stringLiteral(methodValue) : null
    if (literal) method = literal.toUpperCase()
    const headerObject = objectProperty(options, 'headers')
    if (headerObject && headerObject.type === 'object') {
      for (const pair of headerObject.namedChildren) {
        if (!pair || pair.type !== 'pair') continue
        const name = pair.childForFieldName('key')
        const value = pair.childForFieldName('value')
        if (!name || !value) continue
        const valueLiteral = stringLiteral(value)
        if (valueLiteral === null) continue
        headers.push({ name: unquote(name.text), value: valueLiteral })
      }
    }
  })
  return { ...(method ? { method } : {}), headers }
}

function objectProperty(object: SyntaxNode, name: string): SyntaxNode | null {
  for (const child of object.namedChildren) {
    if (!child || child.type !== 'pair') continue
    if (unquote(child.childForFieldName('key')?.text ?? '') === name) return child.childForFieldName('value')
  }
  return null
}

// ---------------------------------------------------------------------------
// Response field reads
// ---------------------------------------------------------------------------

/**
 * The property names the function reads off the PARSED response, as dotted paths.
 *
 * The root is the value an `await` produced in this function — `await res.json()`
 * when the file does its own transport, else the first awaited call's result (the
 * shared-client idiom, `const payload = await fetchJson(url, timeout)`). From there
 * an ALIAS CHAIN is followed in source order: `const current = payload['current']`
 * makes `current` mean `current`, so `asFiniteNumber(current['time'])` is
 * `current.time` — bounded to what one function writes down and nothing more.
 */
function collectResponseFields(scope: SyntaxNode): OutboundResponseField[] {
  const root = responseRootName(scope)
  if (!root) return []

  /** identifier → the response path it names. */
  const aliases = new Map<string, string>([[root, '']])
  /** path → hint, filled by whatever check the source applies to it. */
  const hints = new Map<string, OutboundResponseField['hint']>()
  const order: string[] = []
  const seen = new Set<string>()

  const record = (path: string, hint?: OutboundResponseField['hint']): void => {
    if (!path) return
    if (!seen.has(path)) {
      if (order.length >= MAX_FIELDS) return
      seen.add(path)
      order.push(path)
    }
    if (hint && !hints.get(path)) hints.set(path, hint)
  }

  walk(scope, (node) => {
    // `payload['current']`, `payload.current`, `results[0]`
    if (node.type === 'subscript_expression' || node.type === 'member_expression') {
      const path = resolvePath(node, aliases)
      if (path === null) return
      record(path, hintFromContext(node))
      const alias = declaredName(node)
      if (alias) aliases.set(alias, path)
      return
    }
    // `const { results } = payload`
    if (node.type === 'variable_declarator') {
      const name = node.childForFieldName('name')
      const value = node.childForFieldName('value')
      if (!name || !value || name.type !== 'object_pattern') return
      const base = aliases.get(value.text.trim())
      if (base === undefined) return
      for (const key of destructuredKeys(name)) {
        const path = base ? `${base}.${key}` : key
        record(path)
        aliases.set(key, path)
      }
      return
    }
    // `typeof timezone !== 'string'`, `Array.isArray(results)`, `isRecord(current)`
    if (node.type === 'unary_expression' || node.type === 'call_expression' || node.type === 'binary_expression') {
      const guard = guardHint(node, aliases)
      if (guard) record(guard.path, guard.hint)
    }
  })

  return order.map((path) => {
    const hint = hints.get(path)
    return hint ? { path, hint } : { path }
  })
}

/** The identifier an `await` bound in this function — the parsed response body. */
function responseRootName(scope: SyntaxNode): string | null {
  let firstAwait: string | null = null
  let jsonAwait: string | null = null
  walk(scope, (node) => {
    if (node.type !== 'variable_declarator') return
    const name = node.childForFieldName('name')
    const value = node.childForFieldName('value')
    if (!name || name.type !== 'identifier' || !value || value.type !== 'await_expression') return
    const inner = value.namedChild(0)
    if (!inner || inner.type !== 'call_expression') return
    const callee = inner.childForFieldName('function')?.text ?? ''
    if (/\.json\s*\(?$|\.json$/.test(callee.trim())) {
      jsonAwait ??= name.text
      return
    }
    // `await fetch(…)` binds a Response, never a payload.
    if (/(^|\.)fetch$/.test(callee.trim())) return
    firstAwait ??= name.text
  })
  return jsonAwait ?? firstAwait
}

/** The response path a member/subscript expression names, or null if it is not one. */
function resolvePath(node: SyntaxNode, aliases: ReadonlyMap<string, string>): string | null {
  const object = node.childForFieldName('object')
  if (!object) return null
  const base = aliases.get(object.text.trim())
  if (base === undefined) return null
  if (node.type === 'member_expression') {
    const property = node.childForFieldName('property')?.text
    if (!property || INTRINSIC_PROPERTIES.has(property)) return null
    // `results.map(…)` is a method call on the payload, not a field of it.
    if (node.parent?.type === 'call_expression' && node.parent.childForFieldName('function')?.id === node.id) {
      return null
    }
    return base ? `${base}.${property}` : property
  }
  const index = node.childForFieldName('index')
  if (!index) return null
  const literal = stringLiteral(index)
  if (literal !== null) return base ? `${base}.${literal}` : literal
  if (/^\d+$/.test(index.text)) return `${base}[${index.text}]`
  return null
}

/** The variable this expression initializes, when it initializes one directly. */
function declaredName(node: SyntaxNode): string | null {
  const parent = node.parent
  if (!parent || parent.type !== 'variable_declarator') return null
  if (parent.childForFieldName('value')?.id !== node.id) return null
  const name = parent.childForFieldName('name')
  return name && name.type === 'identifier' ? name.text : null
}

/** A numeric/string wrapper applied AT the read: `asFiniteNumber(current['time'])`. */
function hintFromContext(node: SyntaxNode): OutboundResponseField['hint'] {
  const parent = node.parent
  if (!parent || parent.type !== 'arguments') return undefined
  const call = parent.parent
  if (!call || call.type !== 'call_expression') return undefined
  const callee = call.childForFieldName('function')?.text.trim() ?? ''
  return wrapperHint(callee)
}

/** A check the source applies to an already-bound alias. */
function guardHint(
  node: SyntaxNode,
  aliases: ReadonlyMap<string, string>,
): { path: string; hint: OutboundResponseField['hint'] } | null {
  const text = node.text.replace(/\s+/g, ' ').trim()
  const typeofMatch = /^typeof ([A-Za-z_$][\w$]*) [!=]==? '(\w+)'$/.exec(text)
  if (typeofMatch) {
    const path = aliases.get(typeofMatch[1]!)
    const kind = typeofMatch[2]
    if (path && (kind === 'string' || kind === 'number' || kind === 'object')) return { path, hint: kind }
    return null
  }
  const callMatch = /^(?:Array\.isArray|isArray)\(([A-Za-z_$][\w$]*)\)$/.exec(text)
  if (callMatch) {
    const path = aliases.get(callMatch[1]!)
    return path ? { path, hint: 'array' } : null
  }
  const recordMatch = /^(?:isRecord|isObject|isPlainObject)\(([A-Za-z_$][\w$]*)\)$/.exec(text)
  if (recordMatch) {
    const path = aliases.get(recordMatch[1]!)
    return path ? { path, hint: 'object' } : null
  }
  const wrapped = /^([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)$/.exec(text)
  if (wrapped) {
    const hint = wrapperHint(wrapped[1]!)
    const path = aliases.get(wrapped[2]!)
    if (hint && path) return { path, hint }
  }
  return null
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The variable a `new URL(…)` was assigned to, when it was. */
function assignedVariableName(node: SyntaxNode): string | null {
  return declaredName(node)
}

/** The nearest enclosing function of a node, or null at module level. */
function enclosingFunction(node: SyntaxNode): SyntaxNode | null {
  for (let current = node.parent; current; current = current.parent) {
    if (FUNCTION_NODES.has(current.type)) return current
  }
  return null
}

/** The keys of an object destructuring pattern, shorthand and renamed alike. */
function destructuredKeys(pattern: SyntaxNode): string[] {
  const keys: string[] = []
  for (const child of pattern.namedChildren) {
    if (!child) continue
    if (child.type === 'shorthand_property_identifier_pattern' || child.type === 'shorthand_property_identifier') {
      keys.push(child.text)
    } else if (child.type === 'pair_pattern') {
      const key = child.childForFieldName('key')
      if (key) keys.push(unquote(key.text))
    } else if (child.type === 'object_assignment_pattern') {
      const left = child.namedChild(0)
      if (left && left.type === 'shorthand_property_identifier_pattern') keys.push(left.text)
    }
  }
  return keys
}

/** The string a node carries, or null when it is not a plain literal. A template
 *  with an interpolation is NOT a literal — its value is dynamic. */
export function stringLiteral(node: SyntaxNode): string | null {
  if (node.type === 'string') return unquote(node.text)
  if (node.type === 'string_fragment') return node.text
  if (node.type === 'template_string') {
    return node.namedChildren.some((c) => c?.type === 'template_substitution') ? null : unquote(node.text)
  }
  return null
}

function unquote(text: string): string {
  return text.replace(/^['"`]/, '').replace(/['"`]$/, '')
}

/** Depth-first walk over named + unnamed children, parent before child. */
export function walk(node: SyntaxNode, visit: (node: SyntaxNode) => void): void {
  visit(node)
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child) walk(child, visit)
  }
}
