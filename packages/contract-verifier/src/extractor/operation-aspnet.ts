/**
 * ASP.NET Core operation extractor — produces the same `ExtractedOperation`
 * shape the Express/FastAPI extractors do, so the language-agnostic comparators
 * (Operation, ErrorEnvelope, Pagination, AuthRequirement, Idempotency) diff it.
 *
 * Recognizes two styles:
 *   - Controllers: `[ApiController] [Route("api")] class OrdersController` with
 *     `[HttpGet("orders/{id}")]`-attributed action methods.
 *   - Minimal APIs: `app.MapGroup("/api")` + `api.MapGet("/customers", (…) => …)`.
 *
 * `tags` is always `[]` — tags live on the spec-side contract. `emission` /
 * `ownershipCheckCandidates` are intentionally omitted (the Effect/Authorization
 * families own the C# handler-fact extraction separately).
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type { OperationContract, ResponseContract, BodyShape } from '../types/index.js';
import type { ExtractedOperation, HandlerObservations } from './operation.js';
import { extractHandlerFacts, emptyHandlerFacts, type HandlerFacts } from './handler-facts.js';
import type { CsColumnMap } from './shared/cs-column-map.js';

const HTTP_ATTR_METHODS: Record<string, string> = {
  HttpGet: 'GET', HttpPost: 'POST', HttpPut: 'PUT', HttpDelete: 'DELETE', HttpPatch: 'PATCH',
};
const MINIMAL_MAP_METHODS: Record<string, string> = {
  MapGet: 'GET', MapPost: 'POST', MapPut: 'PUT', MapDelete: 'DELETE', MapPatch: 'PATCH',
};

/** Controller result-factory helpers (bare-identifier callee) → status. */
const CONTROLLER_STATUS: Record<string, string> = {
  Ok: '200', Created: '201', CreatedAtAction: '201', CreatedAtRoute: '201', Accepted: '202', NoContent: '204',
  BadRequest: '400', Unauthorized: '401', Forbid: '403', NotFound: '404', Conflict: '409', UnprocessableEntity: '422',
};
/** Minimal-API `Results.<X>` factory → status. */
const MINIMAL_STATUS: Record<string, string> = {
  Ok: '200', Created: '201', CreatedAtRoute: '201', Accepted: '202', NoContent: '204',
  BadRequest: '400', Unauthorized: '401', Forbid: '403', NotFound: '404', Conflict: '409',
  UnprocessableEntity: '422', Problem: '500', ValidationProblem: '400',
};
/** Factories whose first arg is the response body. */
const BODY_AT0 = new Set(['Ok', 'BadRequest', 'NotFound', 'Conflict', 'UnprocessableEntity']);

export function extractAspNetOperationsFromFile(
  filePath: string,
  source: string,
  tree: Tree,
  columnMap?: CsColumnMap,
): ExtractedOperation[] {
  return [
    ...extractControllerOperations(filePath, source, tree, columnMap),
    ...extractMinimalApiOperations(filePath, source, tree, columnMap),
  ];
}

/** A file is auth-protected when it declares `[Authorize]` or `.RequireAuthorization()`. */
export function aspNetFileHasAuthRouter(source: string, tree: Tree): boolean {
  let protectedFile = false;
  walk(tree.rootNode, (node) => {
    if (node.type === 'attribute') {
      if (attrName(node, source) === 'Authorize') protectedFile = true;
    } else if (node.type === 'invocation_expression') {
      const fn = node.childForFieldName('function');
      if (fn?.type === 'member_access_expression' && identText(fn.childForFieldName('name'), source) === 'RequireAuthorization') {
        protectedFile = true;
      }
    }
  });
  return protectedFile;
}

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

function extractControllerOperations(filePath: string, source: string, tree: Tree, columnMap?: CsColumnMap): ExtractedOperation[] {
  const out: ExtractedOperation[] = [];
  walk(tree.rootNode, (node) => {
    if (node.type !== 'class_declaration') return;
    const className = identText(node.childForFieldName('name'), source);
    const classPrefix = readRouteAttribute(node, source);
    const controllerName = className.replace(/Controller$/, '');
    const body = node.childForFieldName('body');
    if (!body) return;
    for (let i = 0; i < body.namedChildCount; i++) {
      const m = body.namedChild(i);
      if (m?.type !== 'method_declaration') continue;
      const http = findHttpAttr(m, source);
      if (!http) continue;
      const actionName = identText(m.childForFieldName('name'), source);
      const fullPath = joinSegments(classPrefix, expandTokens(http.route, controllerName, actionName));
      const mbody = m.childForFieldName('body');
      const params = m.childForFieldName('parameters');
      const facts = mbody ? extractHandlerFacts(mbody, source, columnMap) : emptyHandlerFacts();
      out.push(mkOp(http.method, fullPath, extractResponses(mbody, source), filePath,
        m.startPosition.row + 1, collectObservations(params, mbody, source, fullPath, true), facts));
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Minimal APIs
// ---------------------------------------------------------------------------

function extractMinimalApiOperations(filePath: string, source: string, tree: Tree, columnMap?: CsColumnMap): ExtractedOperation[] {
  const groupPrefixes = collectGroupPrefixes(tree.rootNode, source);
  const out: ExtractedOperation[] = [];
  walk(tree.rootNode, (node) => {
    if (node.type !== 'invocation_expression') return;
    const fn = node.childForFieldName('function');
    if (fn?.type !== 'member_access_expression') return;
    const method = MINIMAL_MAP_METHODS[identText(fn.childForFieldName('name'), source)];
    if (!method) return;
    const recv = fn.childForFieldName('expression');
    const prefix = recv?.type === 'identifier' ? (groupPrefixes.get(slice(recv, source)) ?? '') : '';
    const args = node.childForFieldName('arguments');
    const route = readInvocationStringArg(args, 0, source);
    if (route === null) return;
    const lambda = lastLambda(args);
    const lbody = lambda?.childForFieldName('body') ?? null;
    const lparams = lambda?.childForFieldName('parameters') ?? null;
    const fullPath = joinSegments(prefix, route);
    const facts = lbody ? extractHandlerFacts(lbody, source, columnMap) : emptyHandlerFacts();
    out.push(mkOp(method, fullPath, extractResponses(lbody, source), filePath,
      node.startPosition.row + 1, collectObservations(lparams, lbody, source, fullPath, false), facts));
  });
  return out;
}

function collectGroupPrefixes(root: SyntaxNode, source: string): Map<string, string> {
  const out = new Map<string, string>();
  walk(root, (node) => {
    if (node.type !== 'variable_declarator') return;
    const name = node.childForFieldName('name');
    if (name?.type !== 'identifier') return;
    let val: SyntaxNode | null = null;
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c && c.id !== name.id) { val = c; break; }
    }
    if (val?.type !== 'invocation_expression') return;
    const fn = val.childForFieldName('function');
    if (fn?.type !== 'member_access_expression' || identText(fn.childForFieldName('name'), source) !== 'MapGroup') return;
    const prefixArg = readInvocationStringArg(val.childForFieldName('arguments'), 0, source);
    if (prefixArg === null) return;
    const recv = fn.childForFieldName('expression');
    const parent = recv?.type === 'identifier' ? (out.get(slice(recv, source)) ?? '') : '';
    out.set(slice(name, source), joinSegments(parent, prefixArg));
  });
  return out;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

function extractResponses(body: SyntaxNode | null, source: string): ResponseContract[] {
  const byStatus = new Map<string, BodyShape | undefined>();
  if (body) {
    walk(body, (node) => {
      if (node.type !== 'invocation_expression') return;
      const ev = describeResultCall(node, source);
      if (ev) byStatus.set(ev.status, ev.bodyShape ?? byStatus.get(ev.status));
    });
  }
  if (byStatus.size === 0) byStatus.set('200', undefined);
  return [...byStatus.entries()].map(([status, b]) => ({ status, body: b }));
}

function describeResultCall(call: SyntaxNode, source: string): { status: string; bodyShape?: BodyShape } | null {
  const fn = call.childForFieldName('function');
  if (!fn) return null;
  const args = call.childForFieldName('arguments');
  if (fn.type === 'identifier') {
    const name = slice(fn, source);
    if (name === 'StatusCode') {
      const a0 = nthArgExpr(args, 0);
      if (a0?.type !== 'integer_literal') return null;
      return { status: slice(a0, source), bodyShape: classifyArg(nthArgExpr(args, 1), source) };
    }
    const status = CONTROLLER_STATUS[name];
    if (!status) return null;
    return { status, bodyShape: BODY_AT0.has(name) ? classifyArg(nthArgExpr(args, 0), source) : undefined };
  }
  if (fn.type === 'member_access_expression') {
    const recv = fn.childForFieldName('expression');
    if (!recv || (slice(recv, source) !== 'Results' && slice(recv, source) !== 'TypedResults')) return null;
    const name = identText(fn.childForFieldName('name'), source);
    if (name === 'StatusCode') {
      const a0 = nthArgExpr(args, 0);
      return a0?.type === 'integer_literal' ? { status: slice(a0, source) } : null;
    }
    const status = MINIMAL_STATUS[name];
    if (!status) return null;
    const bodyShape = BODY_AT0.has(name)
      ? classifyArg(nthArgExpr(args, 0), source)
      : name === 'Created' || name === 'CreatedAtRoute'
        ? classifyArg(lastArgExpr(args), source)
        : undefined;
    return { status, bodyShape };
  }
  return null;
}

function classifyArg(arg: SyntaxNode | null, source: string): BodyShape | undefined {
  if (!arg) return undefined;
  if (arg.type === 'anonymous_object_creation_expression') {
    const fields: Record<string, never> = {} as Record<string, never>;
    for (let i = 0; i < arg.childCount; i++) {
      const c = arg.child(i);
      const next = arg.child(i + 1);
      if (c?.type === 'identifier' && next?.type === '=') {
        (fields as Record<string, unknown>)[slice(c, source)] = undefined;
      }
    }
    return { fields };
  }
  if (arg.type === 'array_creation_expression' || arg.type === 'implicit_array_creation_expression' || arg.type === 'collection_expression') {
    return { fields: undefined, errorCode: 'bare-array' };
  }
  if (arg.type === 'invocation_expression') {
    const fn = arg.childForFieldName('function');
    if (fn?.type === 'member_access_expression' && /^(ToList|ToArray|AsEnumerable)$/.test(identText(fn.childForFieldName('name'), source))) {
      return { fields: undefined, errorCode: 'bare-array' };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Observations — query params + numeric clamps
// ---------------------------------------------------------------------------

function collectObservations(
  params: SyntaxNode | null,
  body: SyntaxNode | null,
  source: string,
  fullPath: string,
  isController: boolean,
): HandlerObservations {
  const pathParams = new Set([...fullPath.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]));
  const queryParams: string[] = [];
  if (params) {
    for (let i = 0; i < params.namedChildCount; i++) {
      const p = params.namedChild(i);
      if (p?.type !== 'parameter') continue;
      const name = identText(p.childForFieldName('name'), source);
      if (!name || pathParams.has(name)) continue;
      const attrs = paramAttrs(p, source);
      if (attrs.has('FromBody') || attrs.has('FromServices') || attrs.has('FromRoute')) continue;
      const type = p.childForFieldName('type');
      if (isController) {
        if (attrs.has('FromQuery') || (isPrimitiveType(type) && hasDefault(p))) queryParams.push(name);
      } else if (isPrimitiveType(type)) {
        queryParams.push(name);
      }
    }
  }

  const numericClamps: number[] = [];
  let hasClampCall = false;
  if (body) {
    walk(body, (node) => {
      if (node.type !== 'invocation_expression') return;
      const fn = node.childForFieldName('function');
      if (fn?.type !== 'member_access_expression') return;
      const recv = fn.childForFieldName('expression');
      const name = identText(fn.childForFieldName('name'), source);
      if (recv?.type === 'identifier' && slice(recv, source) === 'Math' && (name === 'Min' || name === 'Clamp')) {
        hasClampCall = true;
        const args = node.childForFieldName('arguments');
        if (args) {
          for (let i = 0; i < args.namedChildCount; i++) {
            const a = args.namedChild(i);
            const e = a?.type === 'argument' ? a.namedChild(0) : a;
            if (e?.type === 'integer_literal') numericClamps.push(Number(slice(e, source).replace(/_/g, '')));
          }
        }
      }
    });
  }
  return { queryParams, numericClamps, hasClampCall };
}

function isPrimitiveType(type: SyntaxNode | null): boolean {
  if (!type) return false;
  if (type.type === 'predefined_type') return true;
  if (type.type === 'nullable_type') return type.namedChild(0)?.type === 'predefined_type';
  return false;
}

function hasDefault(p: SyntaxNode): boolean {
  for (let i = 0; i < p.childCount; i++) if (p.child(i)?.type === '=') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Attribute / path helpers
// ---------------------------------------------------------------------------

function readRouteAttribute(declNode: SyntaxNode, source: string): string {
  for (let i = 0; i < declNode.namedChildCount; i++) {
    const al = declNode.namedChild(i);
    if (al?.type !== 'attribute_list') continue;
    for (let j = 0; j < al.namedChildCount; j++) {
      const attr = al.namedChild(j);
      if (attr?.type === 'attribute' && attrName(attr, source) === 'Route') return readAttrStringArg(attr, source) ?? '';
    }
  }
  return '';
}

function findHttpAttr(m: SyntaxNode, source: string): { method: string; route: string } | null {
  for (let i = 0; i < m.namedChildCount; i++) {
    const al = m.namedChild(i);
    if (al?.type !== 'attribute_list') continue;
    for (let j = 0; j < al.namedChildCount; j++) {
      const attr = al.namedChild(j);
      if (attr?.type !== 'attribute') continue;
      const method = HTTP_ATTR_METHODS[attrName(attr, source)];
      if (method) return { method, route: readAttrStringArg(attr, source) ?? '' };
    }
  }
  return null;
}

function paramAttrs(p: SyntaxNode, source: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < p.namedChildCount; i++) {
    const al = p.namedChild(i);
    if (al?.type !== 'attribute_list') continue;
    for (let j = 0; j < al.namedChildCount; j++) {
      const attr = al.namedChild(j);
      if (attr?.type === 'attribute') set.add(attrName(attr, source));
    }
  }
  return set;
}

function attrName(attr: SyntaxNode, source: string): string {
  return identText(attr.childForFieldName('name'), source).replace(/Attribute$/, '');
}

function readAttrStringArg(attr: SyntaxNode, source: string): string | null {
  let found: string | null = null;
  walk(attr, (n) => { if (found === null && n.type === 'string_literal') found = readCsString(n, source); });
  return found;
}

function expandTokens(route: string, controllerName: string, actionName: string): string {
  return route.replace(/\[controller\]/gi, controllerName).replace(/\[action\]/gi, actionName);
}

function joinSegments(prefix: string, route: string): string {
  const a = (prefix || '').replace(/^\/|\/$/g, '');
  const b = (route || '').replace(/^\/|\/$/g, '');
  return '/' + [a, b].filter(Boolean).join('/');
}

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

function nthArgExpr(args: SyntaxNode | null, n: number): SyntaxNode | null {
  if (!args) return null;
  let count = 0;
  for (let i = 0; i < args.namedChildCount; i++) {
    const a = args.namedChild(i);
    if (!a || a.type === 'comment') continue;
    const e = a.type === 'argument' ? a.namedChild(0) : a;
    if (count === n) return e;
    count++;
  }
  return null;
}

function lastArgExpr(args: SyntaxNode | null): SyntaxNode | null {
  if (!args) return null;
  let last: SyntaxNode | null = null;
  for (let i = 0; i < args.namedChildCount; i++) {
    const a = args.namedChild(i);
    if (!a || a.type === 'comment') continue;
    last = a.type === 'argument' ? a.namedChild(0) : a;
  }
  return last;
}

function lastLambda(args: SyntaxNode | null): SyntaxNode | null {
  if (!args) return null;
  let lambda: SyntaxNode | null = null;
  for (let i = 0; i < args.namedChildCount; i++) {
    const a = args.namedChild(i);
    const e = a?.type === 'argument' ? a.namedChild(0) : a;
    if (e?.type === 'lambda_expression') lambda = e;
  }
  return lambda;
}

function readInvocationStringArg(args: SyntaxNode | null, n: number, source: string): string | null {
  const e = nthArgExpr(args, n);
  return e?.type === 'string_literal' ? readCsString(e, source) : null;
}

// ---------------------------------------------------------------------------
// Assembly + low-level helpers
// ---------------------------------------------------------------------------

function mkOp(
  method: string,
  fullPath: string,
  responses: ResponseContract[],
  filePath: string,
  declarationLine: number,
  observed: HandlerObservations,
  facts: HandlerFacts,
): ExtractedOperation {
  return {
    identity: `${method} ${fullPath}`,
    contract: { protocol: 'http', method, path: fullPath, responses, tags: [] } satisfies OperationContract,
    filePath,
    declarationLine,
    observed,
    emission: facts.emission,
    ownershipCheckCandidates: facts.ownershipCheckCandidates,
  };
}

function identText(node: SyntaxNode | null, source: string): string {
  if (!node) return '';
  if (node.type === 'generic_name') {
    const id = node.namedChild(0);
    return id ? source.slice(id.startIndex, id.endIndex) : '';
  }
  return source.slice(node.startIndex, node.endIndex);
}

function readCsString(node: SyntaxNode, source: string): string {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c?.type === 'string_literal_content') return source.slice(c.startIndex, c.endIndex);
  }
  return source.slice(node.startIndex, node.endIndex).replace(/^@?\$?"|"$/g, '');
}

function slice(node: SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => void): void {
  visit(node);
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, visit);
  }
}
