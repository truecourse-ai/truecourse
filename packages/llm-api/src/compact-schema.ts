/**
 * Factor repeated JSON Schema nodes into local definitions without changing
 * optional fields or constraints. When a provider requires strict-schema
 * normalization, call this afterwards so its null-path bookkeeping visits
 * every occurrence before any becomes a reference. Native schemas use the
 * same factoring without normalization.
 */
type JsonObject = Record<string, unknown>;

const SCHEMA_MAPS = new Set(['properties', 'patternProperties', 'dependentSchemas']);
const SCHEMA_ARRAYS = new Set(['anyOf', 'oneOf', 'allOf', 'prefixItems']);
const SCHEMA_VALUES = new Set([
  'items', 'contains', 'additionalProperties', 'unevaluatedProperties',
  'propertyNames', 'not', 'if', 'then', 'else', 'additionalItems', 'unevaluatedItems',
]);
// Existing references may point into a subtree we would move. This helper owns
// inline schemas only; already-referenced schemas retain their original graph.
const REFERENCE_KEYWORDS = new Set([
  '$ref', '$id', '$anchor', '$dynamicRef', '$dynamicAnchor',
  '$recursiveRef', '$recursiveAnchor', '$defs', 'definitions',
]);

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Visit only schema positions: enum/const/example objects are literal data. */
function mapChildren(node: JsonObject, visit: (child: JsonObject) => JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(node).map(([key, value]) => {
    if (SCHEMA_MAPS.has(key) && isObject(value)) {
      return [key, Object.fromEntries(Object.entries(value).map(([name, child]) =>
        [name, isObject(child) ? visit(child) : child]))];
    }
    if ((SCHEMA_ARRAYS.has(key) || key === 'items') && Array.isArray(value)) {
      return [key, value.map((child) => isObject(child) ? visit(child) : child)];
    }
    if (SCHEMA_VALUES.has(key) && isObject(value)) return [key, visit(value)];
    return [key, value];
  }));
}

export function compactSchema(schema: JsonObject): JsonObject {
  const occurrences = new Map<string, number>();
  let referenced = false;
  const count = (node: JsonObject): JsonObject => {
    if (Object.keys(node).some((key) => REFERENCE_KEYWORDS.has(key))) referenced = true;
    const key = JSON.stringify(node);
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
    mapChildren(node, count);
    return node;
  };
  count(schema);
  if (referenced) return schema;

  const definitions: JsonObject = {};
  const names = new Map<string, string>();
  const factor = (node: JsonObject): JsonObject => {
    const key = JSON.stringify(node);
    const existing = names.get(key);
    if (existing !== undefined) return { $ref: `#/$defs/${existing}` };
    const rewritten = mapChildren(node, factor);
    // Tiny nodes cost more as a definition plus references than repeated inline.
    if ((occurrences.get(key) ?? 0) < 2 || JSON.stringify(rewritten).length < 160) return rewritten;
    const name = `s${names.size}`;
    names.set(key, name);
    definitions[name] = rewritten;
    return { $ref: `#/$defs/${name}` };
  };
  // The tool root must remain an object, rather than a root reference.
  const root = mapChildren(schema, factor);
  if (names.size === 0) return schema;
  const compact = { ...root, $defs: definitions };
  return JSON.stringify(compact).length < JSON.stringify(schema).length ? compact : schema;
}
