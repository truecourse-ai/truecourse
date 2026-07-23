/**
 * A focused, hand-rolled JSON-Schema conformance check over an OpenAPI operation's
 * declared RESPONSE schema — the runtime side of `expect.schema: true`. It is not a
 * full JSON-Schema validator (no ajv dependency, no `format`, no `$ref`): the
 * operation slice it runs against is already `$ref`-resolved by
 * {@link deriveOpenApiSections}, and the guard only needs the SPECIFIC drift signals
 * an author cares about — a documented field the response dropped or retyped.
 *
 * Strictness policy (deliberately conservative — a false failure is worse than a
 * missed one here):
 * - `required` missing → violation (THE pagination/field-drop signal). A declared-
 *   but-not-required property is checked only when present.
 * - Extra undocumented fields are ALLOWED unless `additionalProperties: false`.
 * - `type` is enforced (`integer` requires an integral number); OpenAPI 3.0
 *   `nullable: true` and 3.1 `type: [..., 'null']` both permit `null`.
 * - `enum` membership; `items` per element (path `[i]`); `allOf` all branches;
 *   `anyOf`/`oneOf` at least one (`oneOf` is treated as `anyOf` in v1).
 * - The FIRST violation found (depth-first, declaration order) is returned with its
 *   JSON path, the expected constraint, and the actual value — so the guard failure
 *   points at exactly the field that drifted.
 */

/** One conformance violation: where, what was expected, and what was found. */
export interface SchemaViolation {
  /** JSON path to the offending value (`data.pagination.nextCursor`, `items[1].id`, `(root)`). */
  path: string
  /** The declared constraint the value failed. */
  expected: string
  /** A short description of the actual value. */
  actual: string
}

/**
 * Check `value` against a declared JSON `schema`, returning the first violation or
 * `null` when it conforms. A non-object schema (or `{}`) is permissive — no
 * constraints, always conforms.
 */
export function validateAgainstSchema(value: unknown, schema: unknown): SchemaViolation | null {
  return validateNode(value, schema, '')
}

/**
 * The JSON response schema an operation declares for `status`, or `undefined` when
 * it declares none. Status resolution: exact code → `NXX` range → `default`; then
 * `content['application/json'].schema`, falling back to the first JSON-family media
 * type (a `.../json` or `...+json` key). The operation slice is already
 * `$ref`-resolved by {@link deriveOpenApiSections}, so the returned schema needs no
 * further dereferencing. Mirrors {@link requestBodyJsonSchema} for the response side.
 */
export function responseJsonSchema(operation: unknown, status: number): unknown | undefined {
  if (!isObject(operation)) return undefined
  const responses = operation.responses
  if (!isObject(responses)) return undefined
  const response = responses[String(status)] ?? responses[`${Math.floor(status / 100)}XX`] ?? responses.default
  if (!isObject(response)) return undefined
  const content = response.content
  if (!isObject(content)) return undefined
  let media = content['application/json']
  if (media === undefined) {
    const jsonKey = Object.keys(content).find((k) => /\/json$|\+json$/i.test(k))
    if (jsonKey) media = content[jsonKey]
  }
  if (!isObject(media)) return undefined
  const schema = media.schema
  return schema === undefined ? undefined : schema
}

// --- internals -------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function childPath(base: string, key: string): string {
  return base ? `${base}.${key}` : key
}

function indexPath(base: string, i: number): string {
  return `${base}[${i}]`
}

function labelPath(path: string): string {
  return path === '' ? '(root)' : path
}

function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  const t = typeof value
  if (t === 'string') return `string (${JSON.stringify(truncate(value as string))})`
  if (t === 'number' || t === 'boolean') return `${t} (${JSON.stringify(value)})`
  if (t === 'object') return 'object'
  return t
}

/** The declared type(s) as a lowercase string list, or `null` when unconstrained. */
function declaredTypes(schema: Record<string, unknown>): string[] | null {
  const t = schema.type
  if (typeof t === 'string') return [t]
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string')
  return null
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isObject(value)
    case 'array':
      return Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    default:
      return true // an unknown type keyword is not enforced
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]))
  }
  return false
}

function validateNode(value: unknown, schema: unknown, path: string): SchemaViolation | null {
  if (!isObject(schema)) return null // `true`/absent/non-object schema = permissive

  // enum membership
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((e) => deepEqual(e, value))) {
      return { path: labelPath(path), expected: `one of enum ${JSON.stringify(schema.enum)}`, actual: describe(value) }
    }
  }

  // allOf — every branch must hold
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      const v = validateNode(value, sub, path)
      if (v) return v
    }
  }

  // anyOf / oneOf — at least one branch must hold (oneOf is permissive-as-anyOf in v1)
  const union = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : null
  if (union) {
    const anyPass = union.some((sub) => validateNode(value, sub, path) === null)
    if (!anyPass) {
      const kind = Array.isArray(schema.anyOf) ? 'anyOf' : 'oneOf'
      return { path: labelPath(path), expected: `to match one of the ${kind} branches`, actual: describe(value) }
    }
  }

  const types = declaredTypes(schema)
  const nullable = schema.nullable === true || (types?.includes('null') ?? false)

  if (value === null) {
    if (nullable || types === null) return null
    return { path: labelPath(path), expected: `type ${types.join('|')}`, actual: 'null' }
  }

  // No explicit type: still apply structural constraints when the value's shape fits
  // the keyword (an allOf branch that lists `required` without repeating `type`).
  if (types === null) {
    if (isObject(value) && (schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined)) {
      return validateObject(value, schema, path)
    }
    if (Array.isArray(value) && schema.items !== undefined) {
      return validateArray(value, schema, path)
    }
    return null
  }

  const nonNull = types.filter((t) => t !== 'null')
  const matched = nonNull.find((t) => matchesType(value, t))
  if (matched === undefined) {
    return { path: labelPath(path), expected: `type ${nonNull.join('|')}`, actual: describe(value) }
  }
  if (matched === 'object') return validateObject(value as Record<string, unknown>, schema, path)
  if (matched === 'array') return validateArray(value as unknown[], schema, path)
  return null
}

function validateObject(obj: Record<string, unknown>, schema: Record<string, unknown>, path: string): SchemaViolation | null {
  const props = isObject(schema.properties) ? schema.properties : {}
  const required = Array.isArray(schema.required) ? schema.required.filter((x): x is string => typeof x === 'string') : []

  // required missing — THE drift signal, checked before per-property type checks.
  for (const key of required) {
    if (!(key in obj)) {
      return { path: childPath(path, key), expected: `property "${key}" to be present (required)`, actual: 'missing' }
    }
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(obj)) {
      if (!(key in props)) {
        return {
          path: childPath(path, key),
          expected: 'no undocumented properties (additionalProperties: false)',
          actual: `unexpected property "${key}"`,
        }
      }
    }
  }

  for (const key of Object.keys(props)) {
    if (key in obj) {
      const v = validateNode(obj[key], (props as Record<string, unknown>)[key], childPath(path, key))
      if (v) return v
    }
  }
  return null
}

function validateArray(arr: unknown[], schema: Record<string, unknown>, path: string): SchemaViolation | null {
  const items = schema.items
  if (items === undefined) return null
  for (let i = 0; i < arr.length; i++) {
    const v = validateNode(arr[i], items, indexPath(path, i))
    if (v) return v
  }
  return null
}
