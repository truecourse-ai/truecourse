/**
 * Python field-exposure extractor — the same "field exposed on a read path"
 * shape as the TS extractor, in Python syntax. Two structural signals, neither
 * specific to any feature, ORM, or framework:
 *
 *   1. query-select — a column-projection call: `.values("id", "status")`
 *      (Django), `.with_entities(Model.id, …)` / `.options(load_only(Model.id,
 *      …))` / `query(Model.id, …)` (SQLAlchemy). The projected field is either
 *      a string-literal column name or the attribute tail of a `Model.field`
 *      reference.
 *
 *   2. api-response — a dict literal serialized back to the caller: the
 *      argument of `jsonify({...})` / `JSONResponse({...})`, or a `return
 *      {...}` value. Each string key on the dict is an exposed field.
 *
 * Each site yields a FieldExposureContract with `target = { field }` (a bare
 * field ident — the code carries no entity binding) and the channel observed.
 * A field on both channels collapses to one record via the dispatcher's dedup.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { FieldExposureContract, SourceLocation } from '../../types/index.js';
import type { ExtractedFieldExposure } from './types.js';

type Channel = FieldExposureContract['exposedVia'][number];

/** Methods/functions whose arguments are a column projection (selected set). */
const PROJECTION_CALLS = new Set([
  'values',        // Django QuerySet.values("a", "b")
  'only',          // Django/Peewee .only(...)
  'with_entities', // SQLAlchemy Query.with_entities(Model.a, …)
  'load_only',     // SQLAlchemy load_only(Model.a, …)
]);

/** Functions that serialize a dict back to the HTTP caller. */
const RESPONSE_CALLS = new Set(['jsonify', 'JSONResponse']);

export function extractPyFieldExposuresFromFile(
  filePath: string,
  _source: string,
  tree: Tree,
): ExtractedFieldExposure[] {
  const out: ExtractedFieldExposure[] = [];

  walk(tree.rootNode, (node) => {
    // 1. query-select: a projection call.
    if (node.type === 'call' && isProjectionCall(node)) {
      const args = node.childForFieldName('arguments');
      if (args) {
        for (const field of projectedFields(args)) {
          out.push(build(field.name, 'query-select', field.node, filePath));
        }
      }
      return true;
    }
    // 2. api-response: jsonify({...}) / JSONResponse({...}).
    if (node.type === 'call') {
      const obj = responseDictArg(node);
      if (obj) {
        for (const field of dictKeys(obj)) {
          out.push(build(field.name, 'api-response', field.node, filePath));
        }
      }
      return true;
    }
    // 2b. api-response: `return {...}` — a dict returned directly.
    if (node.type === 'return_statement') {
      const dict = returnedDict(node);
      if (dict) {
        for (const field of dictKeys(dict)) {
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
// 1. query-select
// ---------------------------------------------------------------------------

/** True when `call`'s callee is one of the projection methods/functions. */
function isProjectionCall(call: SyntaxNode): boolean {
  const fn = call.childForFieldName('function');
  if (!fn) return false;
  if (fn.type === 'identifier') return PROJECTION_CALLS.has(fn.text);
  if (fn.type === 'attribute') {
    const attr = fn.childForFieldName('attribute');
    return !!attr && attr.type === 'identifier' && PROJECTION_CALLS.has(attr.text);
  }
  return false;
}

/**
 * Field names projected by an argument list: string-literal column names
 * (`"id"`) and the attribute tail of `Model.field` references (`Order.id` →
 * `id`). Keyword arguments and anything else are ignored.
 */
function projectedFields(argList: SyntaxNode): { name: string; node: SyntaxNode }[] {
  const out: { name: string; node: SyntaxNode }[] = [];
  for (let i = 0; i < argList.namedChildCount; i++) {
    const c = argList.namedChild(i);
    if (!c) continue;
    if (c.type === 'string') {
      const name = stringText(c);
      if (name) out.push({ name, node: c });
    } else if (c.type === 'attribute') {
      const attr = c.childForFieldName('attribute');
      if (attr && attr.type === 'identifier') out.push({ name: attr.text, node: c });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. api-response
// ---------------------------------------------------------------------------

/** If `call` is `jsonify({...})` / `JSONResponse({...})` whose first arg is a
 *  dict literal, return that dict; otherwise null. */
function responseDictArg(call: SyntaxNode): SyntaxNode | null {
  const fn = call.childForFieldName('function');
  if (!fn) return null;
  let name: string | null = null;
  if (fn.type === 'identifier') name = fn.text;
  else if (fn.type === 'attribute') {
    const attr = fn.childForFieldName('attribute');
    if (attr && attr.type === 'identifier') name = attr.text;
  }
  if (!name || !RESPONSE_CALLS.has(name)) return null;

  const args = call.childForFieldName('arguments');
  if (!args) return null;
  const first = args.namedChild(0);
  if (!first || first.type !== 'dictionary') return null;
  return first;
}

/** The dict literal a `return {...}` returns, or null. */
function returnedDict(ret: SyntaxNode): SyntaxNode | null {
  const value = ret.namedChild(0);
  return value && value.type === 'dictionary' ? value : null;
}

/** String-keyed entries of a dict literal, each with its source node. Spread
 *  (`**x`) entries carry no static key and are ignored. */
function dictKeys(dict: SyntaxNode): { name: string; node: SyntaxNode }[] {
  const out: { name: string; node: SyntaxNode }[] = [];
  for (let i = 0; i < dict.namedChildCount; i++) {
    const c = dict.namedChild(i);
    if (!c || c.type !== 'pair') continue;
    const key = c.childForFieldName('key');
    if (key && key.type === 'string') {
      const name = stringText(key);
      if (name) out.push({ name, node: c });
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

/** Unquoted text of a Python string literal node. */
function stringText(node: SyntaxNode): string {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c && c.type === 'string_content') return c.text;
  }
  const raw = node.text;
  return raw.length >= 2 ? raw.replace(/^['"]|['"]$/g, '') : raw;
}

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  const recurse = visit(node);
  if (recurse === false) return;
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, visit);
  }
}
