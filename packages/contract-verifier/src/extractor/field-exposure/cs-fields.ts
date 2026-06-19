/**
 * C# field-exposure extractor — the language-general twin of `ts-fields.ts` /
 * `py-fields.ts`. Recognizes the same "field exposed on a read path" shape, in
 * C# syntax. Two structural channels, neither specific to any feature or ORM:
 *
 *   1. query-select — an EF Core projection: `db.Orders.Select(o => new { o.Id,
 *      o.Status, Total = o.TotalCents })`. Each member of the projected
 *      anonymous object is an exposed field.
 *
 *   2. api-response — a response body object passed to an ASP.NET result helper:
 *      `return Ok(new { o.Id, o.Status })` / `Json(new OrderDto { Id = o.Id })`.
 *      Each member of the serialized object is an exposed field.
 *
 * From each it derives a FieldExposureContract:
 *   - target     = the exposed field (`{ field }`; the code site carries no entity
 *                  binding, so the comparator matches by field name)
 *   - exposedVia = ['query-select'] or ['api-response']
 *
 * Only a projection / response SITE counts — a bare `new { … }` built for
 * internal use is not an exposure.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { FieldExposureContract, SourceLocation } from '../../types/index.js';
import type { ExtractedFieldExposure } from './types.js';
import { walkCs, sliceNode } from '../shared/cs-nodes.js';

type Channel = FieldExposureContract['exposedVia'][number];

/** ASP.NET result helpers whose body argument is a serialized response shape. */
const RESPONSE_METHODS = new Set([
  'Ok', 'Json', 'Created', 'CreatedAtAction', 'CreatedAtRoute', 'Accepted', 'AcceptedAtAction',
]);

export function extractCsFieldExposuresFromFile(
  filePath: string,
  source: string,
  tree: Tree,
): ExtractedFieldExposure[] {
  const out: ExtractedFieldExposure[] = [];
  walkCs(tree.rootNode, (node) => {
    if (node.type !== 'invocation_expression') return;
    const method = methodName(node, source);
    if (!method) return;

    if (method === 'Select') {
      const obj = selectProjection(node);
      if (obj) for (const f of objectMembers(obj, source)) out.push(build(f, 'query-select', obj, filePath));
    } else if (RESPONSE_METHODS.has(method)) {
      const obj = firstObjectArg(node);
      if (obj) for (const f of objectMembers(obj, source)) out.push(build(f, 'api-response', obj, filePath));
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Call shape
// ---------------------------------------------------------------------------

/** Method name of an invocation: a bare `Ok(...)` → `Ok`; `x.Select(...)` →
 *  the member name `Select`. */
function methodName(call: SyntaxNode, source: string): string | null {
  const fn = call.childForFieldName('function');
  if (!fn) return null;
  if (fn.type === 'identifier') return sliceNode(fn, source);
  if (fn.type === 'member_access_expression') {
    const name = fn.childForFieldName('name');
    return name ? sliceNode(name, source) : null;
  }
  return null;
}

/** The anonymous/object body of a `Select(o => new { … })` lambda projection. */
function selectProjection(call: SyntaxNode): SyntaxNode | null {
  const args = call.childForFieldName('arguments');
  if (!args) return null;
  for (let i = 0; i < args.namedChildCount; i++) {
    const arg = args.namedChild(i);
    const lambda = arg?.type === 'argument' ? arg.namedChild(0) : arg;
    if (lambda?.type !== 'lambda_expression') continue;
    const body = lambda.childForFieldName('body');
    if (body && isObjectShape(body)) return body;
  }
  return null;
}

/** The first object-shape argument of a response call (`Ok(new { … })`). */
function firstObjectArg(call: SyntaxNode): SyntaxNode | null {
  const args = call.childForFieldName('arguments');
  if (!args) return null;
  for (let i = 0; i < args.namedChildCount; i++) {
    const arg = args.namedChild(i);
    const val = arg?.type === 'argument' ? arg.namedChild(0) : arg;
    if (val && isObjectShape(val)) return val;
  }
  return null;
}

function isObjectShape(node: SyntaxNode): boolean {
  return node.type === 'anonymous_object_creation_expression' || node.type === 'object_creation_expression';
}

// ---------------------------------------------------------------------------
// Member names of an object shape
// ---------------------------------------------------------------------------

/**
 * Field names exposed by an object shape:
 *   - `anonymous_object_creation_expression`: shorthand `o.Field` → `Field`;
 *     explicit `Alias = expr` → `Alias` (the `=` token marks the name/value split).
 *   - `object_creation_expression` (named DTO): each `Id = expr` initializer
 *     assignment → the left identifier.
 */
function objectMembers(obj: SyntaxNode, source: string): string[] {
  if (obj.type === 'object_creation_expression') {
    const init = obj.childForFieldName('initializer');
    if (!init) return [];
    const out: string[] = [];
    for (let i = 0; i < init.namedChildCount; i++) {
      const c = init.namedChild(i);
      if (c?.type !== 'assignment_expression') continue;
      const left = c.childForFieldName('left');
      if (left?.type === 'identifier') out.push(sliceNode(left, source));
    }
    return out;
  }
  // anonymous object: walk ALL children (incl `=` / `,` tokens) so an explicit
  // `Alias = value` is distinguished from a shorthand `o.Field`.
  const out: string[] = [];
  for (let i = 0; i < obj.childCount; i++) {
    const c = obj.child(i);
    if (!c) continue;
    const prevIsEq = sliceNode(obj.child(i - 1) ?? c, source) === '=' && i > 0;
    if (c.type === 'identifier') {
      if (prevIsEq) continue; // a bare-identifier VALUE of an explicit member
      out.push(sliceNode(c, source)); // explicit name, or `new { localVar }` shorthand
    } else if (c.type === 'member_access_expression') {
      if (prevIsEq) continue; // the VALUE of an explicit member (`Alias = o.Field`)
      const name = c.childForFieldName('name');
      if (name) out.push(sliceNode(name, source)); // shorthand `o.Field` → `Field`
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

function build(field: string, channel: Channel, node: SyntaxNode, filePath: string): ExtractedFieldExposure {
  return {
    identity: `${field}.exposure`,
    contract: { target: { field }, exposedVia: [channel] },
    source: location(node, filePath),
  };
}

function location(node: SyntaxNode, filePath: string): SourceLocation {
  return { filePath, lineStart: node.startPosition.row + 1, lineEnd: node.endPosition.row + 1 };
}
