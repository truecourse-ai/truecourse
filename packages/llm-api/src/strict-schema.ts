/**
 * Rewriting a caller's JSON-schema into the subset providers accept for STRICT
 * structured output, so `generateObject` enforces the shape instead of the
 * provider rejecting the request.
 *
 * OpenAI-family strict output (`response_format: json_schema`, `strict: true` —
 * OpenAI, Azure OpenAI, Copilot) validates the SCHEMA before it reads the prompt
 * and fails the WHOLE call on any of these, none of which the pipeline's Zod
 * definitions naturally satisfy:
 *  - `required` must list EVERY key of `properties`. `z.optional()` /
 *    `z.nullish()` / `z.default()` all omit the key, so the request is rejected
 *    ("'required' is required to be supplied and to be an array including every
 *    key in properties. Missing 'install'.").
 *  - `additionalProperties` must be present and `false` on every object node.
 *  - the root must be an object.
 *  - annotation keywords outside the accepted set are rejected, `default`
 *    included ("'default' is not permitted").
 *
 * So a schema is NORMALIZED before submission: every optional property becomes
 * required and widened to accept `null`, `additionalProperties: false` is filled
 * in, and non-validating annotations are dropped. The widened paths are recorded
 * so {@link stripInjectedNulls} can delete the injected nulls from the reply —
 * the caller's Zod accepts a MISSING optional, not an explicit `null`. A property
 * that was already nullable keeps its nulls; only the nullability added here is
 * undone.
 *
 * Three shapes have no strict equivalent at all — a typed/open record
 * (`additionalProperties` other than `false`), an open `{}` sub-schema
 * (`z.unknown()`), and a non-object root. Those THROW
 * {@link SchemaNotEnforceableError}: a call site whose schema is inexpressible
 * must say so explicitly with `enforceSchema: false` (the schema then rides as a
 * prompt hint and the reply is validated by the caller's Zod), never degrade
 * silently at runtime.
 *
 * Both zod-to-json-schema flavors the codebase emits are handled: the default
 * draft-07 target (`type: ["string","null"]` for nullables) and the `openApi3`
 * target used by the analyze provider, whose `nullable: true` is rewritten to a
 * JSON-Schema null union — strict validators read JSON Schema, where the OpenAPI
 * keyword carries no meaning.
 */

type JsonObject = Record<string, unknown>;

/**
 * A data-path segment: a property name, or {@link ARRAY_ELEMENTS} standing for
 * "every element of this array" (a widened property under `items` applies to all
 * of them).
 */
export const ARRAY_ELEMENTS = '[]';

export type SchemaPath = readonly string[];

export interface StrictSchema {
  /** The rewritten schema to submit. A deep copy — the input is never mutated. */
  schema: JsonObject;
  /** Data paths whose nullability was injected here, to strip from the reply. */
  widened: SchemaPath[];
}

/** A schema construct strict structured output cannot express. */
export class SchemaNotEnforceableError extends Error {
  constructor(
    readonly schemaPath: string,
    readonly reason: string,
    stage: string | undefined,
  ) {
    super(
      `[llm-api] schema not enforceable${stage ? ` for stage ${stage}` : ''}: ` +
        `${schemaPath} ${reason}. Pass enforceSchema: false on the request to send the ` +
        `schema as a prompt hint only (JSON mode, validated by the caller's Zod).`,
    );
    this.name = 'SchemaNotEnforceableError';
  }
}

/** Keywords that never affect validation and are rejected or ignored by strict validators. */
const DROPPED_KEYWORDS = new Set(['default', '$schema']);

/** Keywords this module rebuilds rather than copying. */
const REBUILT_KEYWORDS = new Set([
  'properties',
  'required',
  'additionalProperties',
  'items',
  'anyOf',
  'oneOf',
  'nullable',
]);

/** Types whose null union can be expressed by extending `type` in place. */
const PRIMITIVE_TYPES = new Set(['string', 'number', 'integer', 'boolean']);

function isPlainObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepClone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

function label(schemaPath: string): string {
  return schemaPath || '(root)';
}

/** Extend a schema path (`properties.claims` + `items` → `properties.claims.items`). */
function under(base: string, segment: string): string {
  return base ? `${base}.${segment}` : segment;
}

/** Does this schema node already accept `null`? */
function acceptsNull(node: JsonObject): boolean {
  const t = node.type;
  if (t === 'null') return true;
  if (Array.isArray(t) && t.includes('null')) return true;
  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = node[key];
    if (Array.isArray(branches) && branches.some((b) => isPlainObject(b) && acceptsNull(b))) return true;
  }
  return false;
}

/**
 * Widen a node to accept `null`. A primitive without a value set extends its own
 * `type` (keeping siblings like `minLength`, which null simply doesn't engage);
 * anything else — objects, arrays, enums, unions — becomes a null union, the
 * shape strict output documents for nullable non-scalars.
 */
function nullUnion(node: JsonObject): JsonObject {
  const keys = Object.keys(node);
  if (keys.length === 1 && Array.isArray(node.anyOf)) {
    return { anyOf: [...node.anyOf, { type: 'null' }] };
  }
  if (typeof node.type === 'string' && PRIMITIVE_TYPES.has(node.type) && !('enum' in node) && !('const' in node)) {
    return { ...node, type: [node.type, 'null'] };
  }
  return { anyOf: [node, { type: 'null' }] };
}

/** Is this node an object node (so `required` / `additionalProperties` apply)? */
function isObjectNode(node: JsonObject): boolean {
  return node.type === 'object' || isPlainObject(node.properties);
}

interface Ctx {
  stage: string | undefined;
  widened: SchemaPath[];
}

/**
 * Normalize one array's `items`. A tuple (`items: [A, B]`, what `z.tuple()`
 * emits) has no strict equivalent — strict output takes a single element schema —
 * so the positional branches collapse into one element schema (a union when they
 * differ). `minItems`/`maxItems` already pin the length, and the caller's Zod
 * re-checks each position.
 */
function normalizeItems(items: unknown, dataPath: string[], schemaPath: string, ctx: Ctx): unknown {
  const elementPath = [...dataPath, ARRAY_ELEMENTS];
  if (Array.isArray(items)) {
    const branches = items.map((b, i) =>
      normalizeNode(b, elementPath, under(schemaPath, `items[${i}]`), ctx),
    );
    const distinct = [...new Map(branches.map((b) => [JSON.stringify(b), b])).values()];
    return distinct.length === 1 ? distinct[0] : { anyOf: distinct };
  }
  return normalizeNode(items, elementPath, under(schemaPath, 'items'), ctx);
}

function normalizeNode(node: unknown, dataPath: string[], schemaPath: string, ctx: Ctx): JsonObject {
  if (!isPlainObject(node)) {
    throw new SchemaNotEnforceableError(label(schemaPath), 'is not a schema object', ctx.stage);
  }
  if (Object.keys(node).length === 0) {
    throw new SchemaNotEnforceableError(
      label(schemaPath),
      'is an open `{}` sub-schema accepting any JSON (strict output has no equivalent)',
      ctx.stage,
    );
  }

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_KEYWORDS.has(key) || REBUILT_KEYWORDS.has(key)) continue;
    out[key] = deepClone(value);
  }

  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = node[key];
    // A union's branches describe the same value, so they share its data path.
    if (Array.isArray(branches)) {
      out[key] = branches.map((b, i) => normalizeNode(b, dataPath, under(schemaPath, `${key}[${i}]`), ctx));
    }
  }

  if ('items' in node) out.items = normalizeItems(node.items, dataPath, schemaPath, ctx);

  if ('additionalProperties' in node && node.additionalProperties !== false) {
    throw new SchemaNotEnforceableError(
      label(schemaPath),
      isPlainObject(node.additionalProperties)
        ? 'is a typed record (strict output requires additionalProperties: false)'
        : 'allows additional properties (strict output requires additionalProperties: false)',
      ctx.stage,
    );
  }

  if (isPlainObject(node.properties)) {
    const originallyRequired = new Set(
      Array.isArray(node.required) ? node.required.filter((k): k is string => typeof k === 'string') : [],
    );
    const props: JsonObject = {};
    for (const [key, child] of Object.entries(node.properties)) {
      const childPath = [...dataPath, key];
      let normalized = normalizeNode(child, childPath, under(schemaPath, `properties.${key}`), ctx);
      if (!originallyRequired.has(key) && !acceptsNull(normalized)) {
        normalized = nullUnion(normalized);
        ctx.widened.push(childPath);
      }
      props[key] = normalized;
    }
    out.properties = props;
    const keys = Object.keys(props);
    if (keys.length > 0) out.required = keys;
  }

  if (isObjectNode(out)) out.additionalProperties = false;

  // openApi3's `nullable: true` says nothing to a JSON-Schema validator; state
  // the nullability the way strict output reads it. Already-nullable means the
  // caller's Zod accepts null, so this is not a widening we later strip.
  if (node.nullable === true && !acceptsNull(out)) return nullUnion(out);
  return out;
}

/**
 * Rewrite `schema` into the strict-output subset, recording which properties were
 * widened to accept `null`. Throws {@link SchemaNotEnforceableError} when the
 * schema contains a construct strict output cannot express.
 */
export function normalizeForStrictOutput(schema: unknown, stage?: string): StrictSchema {
  if (!isPlainObject(schema) || schema.type !== 'object') {
    throw new SchemaNotEnforceableError(
      '(root)',
      'is not an object-rooted schema (strict output only accepts an object root)',
      stage,
    );
  }
  const ctx: Ctx = { stage, widened: [] };
  return { schema: normalizeNode(schema, [], '', ctx), widened: ctx.widened };
}

function deleteNullAt(value: unknown, path: SchemaPath): void {
  const [head, ...rest] = path;
  if (head === undefined || value === null || typeof value !== 'object') return;
  if (head === ARRAY_ELEMENTS) {
    if (Array.isArray(value)) for (const element of value) deleteNullAt(element, rest);
    return;
  }
  if (Array.isArray(value)) return;
  const obj = value as JsonObject;
  if (rest.length === 0) {
    if (obj[head] === null) delete obj[head];
    return;
  }
  deleteNullAt(obj[head], rest);
}

/**
 * Delete the nulls that only exist because {@link normalizeForStrictOutput}
 * widened an optional property, in place. Nulls anywhere else — including
 * properties the caller's schema declared nullable — are left alone.
 */
export function stripInjectedNulls<T>(value: T, widened: readonly SchemaPath[]): T {
  for (const path of widened) deleteNullAt(value, path);
  return value;
}
