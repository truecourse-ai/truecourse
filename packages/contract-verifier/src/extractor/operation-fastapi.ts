/**
 * FastAPI operation extractor — produces the same `ExtractedOperation`
 * shape the Express extractor does, so the comparators (Operation,
 * ErrorEnvelope, Pagination, AuthRequirement, Idempotency,
 * AuthorizationRule, EffectGroup) diff it without caring about language.
 *
 * Recognizes:
 *   router = APIRouter(prefix="/api", dependencies=[Depends(require_bearer)])
 *   @router.get("/orders/{id}", status_code=200)
 *   async def get_order(id: str, limit: int = 20): ...
 *
 * Route URL = router prefix + decorator path. Responses are read from the
 * decorator `status_code` (success), `raise HTTPException(status_code=N)`,
 * `return JSONResponse(status_code=N, content={...})`, and the success
 * `return` value's shape. `observed` carries query-param names + numeric
 * `min(_, N)` clamps for the Pagination comparator.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type {
  OperationContract,
  ResponseContract,
  BodyShape,
} from '../types/index.js';
import type { ExtractedOperation, HandlerObservations } from './operation.js';
import { extractHandlerFacts, emptyHandlerFacts } from './handler-facts.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

interface RouterInfo {
  prefix: string;
  hasAuthDep: boolean;
}

export function extractFastApiOperationsFromFile(
  filePath: string,
  source: string,
  tree: Tree,
): ExtractedOperation[] {
  const routers = collectRouters(tree.rootNode, source);
  const stringVars = collectStringVars(tree.rootNode, source);
  const out: ExtractedOperation[] = [];

  walk(tree.rootNode, (node) => {
    if (node.type !== 'decorated_definition') return;
    const def = node.childForFieldName('definition');
    if (def?.type !== 'function_definition') return;
    for (let i = 0; i < node.namedChildCount; i++) {
      const dec = node.namedChild(i);
      if (dec?.type !== 'decorator') continue;
      const route = parseRouteDecorator(dec, source, stringVars);
      if (!route) continue;
      const router = routers.get(route.routerVar) ?? { prefix: '', hasAuthDep: false };
      const fullPath = joinPath(router.prefix, route.path);
      const body = def.childForFieldName('body');
      const paramsNode = def.childForFieldName('parameters');
      const responses = extractResponses(body, source, route.successStatus);
      const observed = collectObservations(paramsNode, body, source, fullPath);
      const facts = body ? extractHandlerFacts(body, source) : emptyHandlerFacts();
      out.push({
        identity: `${route.method.toUpperCase()} ${fullPath}`,
        contract: {
          protocol: 'http',
          method: route.method.toUpperCase(),
          path: fullPath,
          responses,
          tags: [],
        } satisfies OperationContract,
        filePath,
        declarationLine: node.startPosition.row + 1,
        routerName: route.routerVar,
        observed,
        emission: facts.emission,
        ownershipCheckCandidates: facts.ownershipCheckCandidates,
      });
      break; // one route decorator per function
    }
  });

  return out;
}

// ---------------------------------------------------------------------------
// Router collection — APIRouter(prefix=…, dependencies=[Depends(authfn)])
// ---------------------------------------------------------------------------

const AUTH_DEP_NAMES = /require_bearer|require_auth|authenticate|get_current_user|bearer|require_role|require_admin/i;

function collectRouters(root: SyntaxNode, source: string): Map<string, RouterInfo> {
  const routers = new Map<string, RouterInfo>();
  walk(root, (node) => {
    if (node.type !== 'assignment') return;
    const left = node.childForFieldName('left');
    const right = node.childForFieldName('right');
    if (left?.type !== 'identifier' || right?.type !== 'call') return;
    const fn = right.childForFieldName('function');
    const fnName = fn ? source.slice(fn.startIndex, fn.endIndex) : '';
    if (fnName !== 'FastAPI' && !fnName.endsWith('Router')) return;
    const args = right.childForFieldName('arguments');
    let prefix = '';
    let hasAuthDep = false;
    if (args) {
      for (let i = 0; i < args.namedChildCount; i++) {
        const a = args.namedChild(i);
        if (a?.type !== 'keyword_argument') continue;
        const name = a.childForFieldName('name');
        const value = a.childForFieldName('value');
        if (!name || !value) continue;
        const key = source.slice(name.startIndex, name.endIndex);
        if (key === 'prefix' && value.type === 'string') prefix = pyStr(value, source);
        if (key === 'dependencies' && AUTH_DEP_NAMES.test(source.slice(value.startIndex, value.endIndex))) {
          hasAuthDep = true;
        }
      }
    }
    routers.set(source.slice(left.startIndex, left.endIndex), { prefix, hasAuthDep });
  });
  return routers;
}

/** Public: which routers in a file carry auth dependencies (for auth-presence). */
export function fastApiFileHasAuthRouter(source: string, tree: Tree): boolean {
  for (const info of collectRouters(tree.rootNode, source).values()) {
    if (info.hasAuthDep) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// String variable collection — module-level assignments + function parameter
// defaults. Used to resolve identifier path arguments in route decorators
// (e.g. `@app.get(health_check_path)` where `health_check_path: str = "/health"`
// is a parameter of the enclosing function).
// ---------------------------------------------------------------------------

function collectStringVars(root: SyntaxNode, source: string): Map<string, string> {
  const vars = new Map<string, string>();
  walk(root, (node) => {
    // module-level assignment: path_var = "/some/path"
    if (node.type === 'assignment') {
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (left?.type === 'identifier' && right?.type === 'string') {
        vars.set(source.slice(left.startIndex, left.endIndex), pyStr(right, source));
      }
    }
    // function parameter with a string default: func(x: str = "/path")
    if (node.type === 'function_definition') {
      const params = node.childForFieldName('parameters');
      if (params) {
        for (let i = 0; i < params.namedChildCount; i++) {
          const p = params.namedChild(i);
          if (!p) continue;
          if (p.type === 'typed_default_parameter' || p.type === 'default_parameter') {
            const name = p.childForFieldName('name');
            const value = p.childForFieldName('value');
            if (name?.type === 'identifier' && value?.type === 'string') {
              vars.set(source.slice(name.startIndex, name.endIndex), pyStr(value, source));
            }
          }
        }
      }
    }
  });
  return vars;
}

// ---------------------------------------------------------------------------
// Route decorator parsing
// ---------------------------------------------------------------------------

interface RouteDecorator {
  method: string;
  path: string;
  routerVar: string;
  successStatus: string;
}

function parseRouteDecorator(dec: SyntaxNode, source: string, stringVars: Map<string, string>): RouteDecorator | null {
  const call = dec.namedChild(0);
  if (call?.type !== 'call') return null;
  const fn = call.childForFieldName('function');
  if (fn?.type !== 'attribute') return null;
  const method = (fn.childForFieldName('attribute')?.text ?? '').toLowerCase();
  if (!HTTP_METHODS.has(method)) return null;
  const obj = fn.childForFieldName('object');
  if (obj?.type !== 'identifier') return null;
  const routerVar = source.slice(obj.startIndex, obj.endIndex);

  const args = call.childForFieldName('arguments');
  if (!args) return null;
  let path: string | null = null;
  let successStatus = '200';
  for (let i = 0; i < args.namedChildCount; i++) {
    const a = args.namedChild(i);
    if (!a) continue;
    if (path === null && a.type === 'string') path = pyStr(a, source);
    else if (a.type === 'keyword_argument') {
      const name = a.childForFieldName('name');
      const value = a.childForFieldName('value');
      if (name && value && source.slice(name.startIndex, name.endIndex) === 'status_code' && isIntLike(value)) {
        successStatus = source.slice(value.startIndex, value.endIndex).replace(/_/g, '');
      }
    }
  }
  // If the path argument was an identifier (not a string literal), try to
  // resolve it from collected string variables (parameter defaults or
  // module-level assignments). Handles `@app.get(health_path)` where
  // `health_path: str = "/health"` is a function parameter default.
  if (path === null) {
    const firstArg = args.namedChild(0);
    if (firstArg?.type === 'identifier') {
      const resolved = stringVars.get(source.slice(firstArg.startIndex, firstArg.endIndex));
      if (resolved !== undefined) path = resolved;
    }
  }
  if (path === null) return null;
  return { method, path, routerVar, successStatus };
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

function extractResponses(body: SyntaxNode | null, source: string, successStatus: string): ResponseContract[] {
  const byStatus = new Map<string, BodyShape | undefined>();
  let successBody: BodyShape | undefined;
  let successSeen = false;

  if (body) {
    walk(body, (node) => {
      // raise HTTPException(status_code=N) / HTTPException(N, ...)
      if (node.type === 'raise_statement') {
        const call = findCall(node, 'HTTPException');
        if (call) {
          const st = callStatusArg(call, source);
          if (st) byStatus.set(st, byStatus.get(st));
        }
      }
      // return JSONResponse(status_code=N, content=X) | return <value>
      if (node.type === 'return_statement') {
        const val = node.namedChild(0);
        if (!val) return;
        if (val.type === 'call' && callName(val, source) === 'JSONResponse') {
          const st = callStatusArg(val, source) ?? successStatus;
          const content = callKwarg(val, 'content', source);
          byStatus.set(st, content ? classifyBody(content, source) : byStatus.get(st));
          if (st === successStatus) { successSeen = true; successBody = content ? classifyBody(content, source) : successBody; }
        } else {
          successSeen = true;
          const shape = classifyBody(val, source);
          if (shape) successBody = shape;
        }
      }
    });
  }

  if (successSeen || byStatus.size === 0) byStatus.set(successStatus, successBody);

  return [...byStatus.entries()].map(([status, shape]) => ({ status, body: shape }));
}

function callStatusArg(call: SyntaxNode, source: string): string | null {
  const kw = callKwarg(call, 'status_code', source);
  if (kw && isIntLike(kw)) return source.slice(kw.startIndex, kw.endIndex).replace(/_/g, '');
  // positional first arg integer (HTTPException(404, ...))
  const args = call.childForFieldName('arguments');
  const first = args?.namedChild(0);
  if (first && isIntLike(first)) return source.slice(first.startIndex, first.endIndex).replace(/_/g, '');
  return null;
}

function classifyBody(node: SyntaxNode, source: string): BodyShape | undefined {
  if (node.type === 'dictionary') {
    const fields: Record<string, never> = {} as Record<string, never>;
    for (let i = 0; i < node.namedChildCount; i++) {
      const pair = node.namedChild(i);
      if (pair?.type !== 'pair') continue;
      const key = pair.childForFieldName('key');
      if (key?.type === 'string') (fields as Record<string, unknown>)[pyStr(key, source)] = undefined;
    }
    return { fields: fields as Record<string, never> };
  }
  if (node.type === 'list' || node.type === 'list_comprehension') {
    return { fields: undefined, errorCode: 'bare-array' };
  }
  // `attribute` ending in `.items` (page.items) → bare array, mirroring JS.
  if (node.type === 'attribute' && node.childForFieldName('attribute')?.text === 'items') {
    return { fields: undefined, errorCode: 'bare-array' };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Observations — query params + numeric clamps
// ---------------------------------------------------------------------------

function collectObservations(
  paramsNode: SyntaxNode | null,
  body: SyntaxNode | null,
  source: string,
  fullPath: string,
): HandlerObservations {
  const pathParams = new Set([...fullPath.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]));
  const queryParams: string[] = [];
  if (paramsNode) {
    for (let i = 0; i < paramsNode.namedChildCount; i++) {
      const p = paramsNode.namedChild(i);
      if (!p) continue;
      const name = paramName(p, source);
      if (!name) continue;
      if (pathParams.has(name)) continue;
      if (['self', 'request', 'db', 'session'].includes(name)) continue;
      // Query params in FastAPI carry a default (or Query(...)). Path
      // params don't and were excluded above. Body models are typed
      // Pydantic classes — skip params with no default whose type is a
      // CapitalizedName (a model).
      if (p.type === 'default_parameter' || p.type === 'typed_default_parameter') {
        queryParams.push(name);
      } else if (p.type === 'typed_parameter' && !looksLikeModel(p, source)) {
        queryParams.push(name);
      }
    }
  }

  const numericClamps: number[] = [];
  let hasClampCall = false;
  if (body) {
    walk(body, (node) => {
      if (node.type === 'call' && callName(node, source) === 'min') {
        hasClampCall = true;
        const args = node.childForFieldName('arguments');
        if (args) {
          for (let i = 0; i < args.namedChildCount; i++) {
            const a = args.namedChild(i);
            if (a && isIntLike(a)) numericClamps.push(Number(source.slice(a.startIndex, a.endIndex).replace(/_/g, '')));
          }
        }
      }
    });
  }
  return { queryParams, numericClamps, hasClampCall };
}

function paramName(p: SyntaxNode, source: string): string | null {
  if (p.type === 'identifier') return source.slice(p.startIndex, p.endIndex);
  if (p.type === 'typed_parameter') {
    const id = p.namedChild(0);
    return id?.type === 'identifier' ? source.slice(id.startIndex, id.endIndex) : null;
  }
  if (p.type === 'default_parameter' || p.type === 'typed_default_parameter') {
    const id = p.childForFieldName('name') ?? p.namedChild(0);
    return id?.type === 'identifier' ? source.slice(id.startIndex, id.endIndex) : null;
  }
  return null;
}

/** A `typed_parameter` whose type is a Capitalized name (Pydantic model). */
function looksLikeModel(p: SyntaxNode, source: string): boolean {
  const type = p.childForFieldName('type');
  if (!type) return false;
  const text = source.slice(type.startIndex, type.endIndex);
  return /^[A-Z]/.test(text);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function joinPath(prefix: string, path: string): string {
  const a = prefix.replace(/\/$/, '');
  const b = path.startsWith('/') ? path : `/${path}`;
  return (a + b) || '/';
}

function callName(call: SyntaxNode, source: string): string {
  const fn = call.childForFieldName('function');
  if (!fn) return '';
  if (fn.type === 'identifier') return source.slice(fn.startIndex, fn.endIndex);
  if (fn.type === 'attribute') return fn.childForFieldName('attribute')?.text ?? '';
  return '';
}

function findCall(node: SyntaxNode, name: string): SyntaxNode | null {
  let found: SyntaxNode | null = null;
  const visit = (n: SyntaxNode): void => {
    if (found) return;
    if (n.type === 'call') {
      const fn = n.childForFieldName('function');
      if (fn?.type === 'identifier' && fn.text === name) { found = n; return; }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) visit(c); if (found) return; }
  };
  visit(node);
  return found;
}

function callKwarg(call: SyntaxNode, name: string, source: string): SyntaxNode | null {
  const args = call.childForFieldName('arguments');
  if (!args) return null;
  for (let i = 0; i < args.namedChildCount; i++) {
    const a = args.namedChild(i);
    if (a?.type !== 'keyword_argument') continue;
    const n = a.childForFieldName('name');
    if (n && source.slice(n.startIndex, n.endIndex) === name) return a.childForFieldName('value');
  }
  return null;
}

function isIntLike(node: SyntaxNode): boolean {
  return node.type === 'integer';
}

function pyStr(node: SyntaxNode, source: string): string {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c?.type === 'string_content') return source.slice(c.startIndex, c.endIndex);
  }
  return source.slice(node.startIndex, node.endIndex).replace(/^[a-zA-Z]*('''|"""|'|")|('''|"""|'|")$/g, '');
}

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => void): void {
  visit(node);
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (c) walk(c, visit);
  }
}
