/**
 * JS/TS field-exposure extractor.
 *
 * Recognizes the GENERAL "this field is exposed on a read path" shape — a
 * field included in a data-access PROJECTION or returned in an API RESPONSE
 * shape. Two structural signals, neither specific to any feature, framework,
 * or ORM:
 *
 *   1. query-select — an ORM projection object: a `select: { <field>: true }`
 *      property (Prisma-style selected column set). Each inner key whose value
 *      is `true` is a projected field; a `false` value is a DESELECT and is
 *      ignored (the field is excluded, not exposed).
 *
 *   2. api-response — a response-serializer call whose first argument is an
 *      object literal: `res.json({ <field>: … })`, `reply.send({ <field> })`,
 *      `res.send({ … })`. Each literal key on the serialized object is an
 *      exposed field.
 *
 * From each it derives a FieldExposureContract:
 *   - target     = the exposed field (`{ field }` — a bare field ident; the
 *                  code site carries no entity binding, so `entity` is left
 *                  undefined and the comparator matches by field name)
 *   - exposedVia = ['query-select'] or ['api-response'] (the channel observed)
 *
 * A field seen on BOTH channels collapses to one record carrying both, done by
 * the dispatcher's dedup. This extractor never threads props through named
 * files or inspects component render output — that signal is fragile and out
 * of scope; only a projection/response SITE counts.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { FieldExposureContract, SourceLocation } from '../../types/index.js';
import type { ExtractedFieldExposure } from './types.js';

type Channel = FieldExposureContract['exposedVia'][number];

/** Method names that serialize an object back to the HTTP caller. */
const RESPONSE_METHODS = new Set(['json', 'send']);

export function extractFieldExposuresFromFile(
  filePath: string,
  _source: string,
  tree: Tree,
): ExtractedFieldExposure[] {
  const out: ExtractedFieldExposure[] = [];

  walk(tree.rootNode, (node) => {
    // 1. query-select: a `select: { … }` projection pair.
    if (node.type === 'pair') {
      const key = node.childForFieldName('key');
      const value = node.childForFieldName('value');
      if (key && value && keyName(key) === 'select' && value.type === 'object') {
        for (const field of selectedFields(value)) {
          out.push(build(field.name, 'query-select', field.node, filePath));
        }
      }
      return true;
    }
    // 2. api-response: `res.json({ … })` / `reply.send({ … })`.
    if (node.type === 'call_expression') {
      const obj = responseObjectArg(node);
      if (obj) {
        for (const field of literalKeys(obj)) {
          out.push(build(field.name, 'api-response', field.node, filePath));
        }
      }
      return true;
    }
    return true;
  });

  return out;
}

// ---------------------------------------------------------------------------
// 1. query-select — selected fields of a projection object
// ---------------------------------------------------------------------------

/**
 * Fields a `select: { … }` object projects: each `pair` whose value is the
 * literal `true`. A `false` value DESELECTS the field (it is being excluded,
 * not exposed) — skipped. Nested-relation selects (`include`/object values)
 * are not flattened; only scalar `true` projections count.
 */
function selectedFields(objectNode: SyntaxNode): { name: string; node: SyntaxNode }[] {
  const out: { name: string; node: SyntaxNode }[] = [];
  for (let i = 0; i < objectNode.namedChildCount; i++) {
    const c = objectNode.namedChild(i);
    if (!c || c.type !== 'pair') continue;
    const key = c.childForFieldName('key');
    const value = c.childForFieldName('value');
    if (!key || !value) continue;
    if (value.type !== 'true') continue;
    const name = keyName(key);
    if (name) out.push({ name, node: c });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. api-response — object argument of a response-serializer call
// ---------------------------------------------------------------------------

/**
 * If `call` is a `<recv>.json(...)` / `<recv>.send(...)` whose first argument
 * is an object literal, return that object; otherwise null. The receiver is
 * not pinned to a name (`res`, `reply`, `ctx.response`, …) — any object passed
 * to a `json`/`send` serializer is a response shape.
 */
function responseObjectArg(call: SyntaxNode): SyntaxNode | null {
  const callee = call.childForFieldName('function');
  if (!callee || callee.type !== 'member_expression') return null;
  const prop = callee.childForFieldName('property');
  if (!prop || prop.type !== 'property_identifier') return null;
  if (!RESPONSE_METHODS.has(prop.text)) return null;

  const args = call.childForFieldName('arguments');
  if (!args) return null;
  const first = args.namedChild(0);
  if (!first || first.type !== 'object') return null;
  return first;
}

/** Literal property names (`key: value`, `"key": value`, shorthand) of an
 *  object, each with the node it came from. Spread elements are ignored —
 *  they carry no statically-known key. */
function literalKeys(objectNode: SyntaxNode): { name: string; node: SyntaxNode }[] {
  const out: { name: string; node: SyntaxNode }[] = [];
  for (let i = 0; i < objectNode.namedChildCount; i++) {
    const c = objectNode.namedChild(i);
    if (!c) continue;
    if (c.type === 'pair') {
      const key = c.childForFieldName('key');
      const name = key ? keyName(key) : null;
      if (name) out.push({ name, node: c });
    } else if (c.type === 'shorthand_property_identifier') {
      // `{ status }` — the key is the identifier itself.
      out.push({ name: c.text, node: c });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function build(
  field: string,
  channel: Channel,
  node: SyntaxNode,
  filePath: string,
): ExtractedFieldExposure {
  return {
    identity: `${field}.exposure`,
    contract: { target: { field }, exposedVia: [channel] },
    source: location(node, filePath),
  };
}

function location(node: SyntaxNode, filePath: string): SourceLocation {
  return {
    filePath,
    lineStart: node.startPosition.row + 1,
    lineEnd: node.endPosition.row + 1,
  };
}

/** Static name of an object key: `property_identifier` text, or the unquoted
 *  text of a string key. Computed keys (`[expr]`) yield no static name. */
function keyName(key: SyntaxNode): string | null {
  if (key.type === 'property_identifier') return key.text;
  if (key.type === 'string') return stringText(key);
  return null;
}

function stringText(node: SyntaxNode): string {
  const frag = node.namedChild(0);
  if (frag && frag.type === 'string_fragment') return frag.text;
  const raw = node.text;
  return raw.length >= 2 ? raw.slice(1, -1) : raw;
}

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  const recurse = visit(node);
  if (recurse === false) return;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, visit);
  }
}
