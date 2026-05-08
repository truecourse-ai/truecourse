/**
 * Operation extractor — walks TS/JS source, finds Express-style route
 * registrations, and produces the same `OperationContract` shape the
 * spec-side lifter produces. The comparator diffs the two without caring
 * which side came from where.
 *
 * Coverage in v1:
 *   - `router.<method>('<path>', ...handlers)` — Express convention.
 *   - For each route's terminal handler arg, walk its body and collect:
 *       * `res.status(N)` calls               → response status entries
 *       * `res.setHeader('name', ...)` calls  → response header presence
 *       * `res.json(...)` arg shape           → response body kind
 *           - bare identifier  → ref-style body
 *           - object literal  → inline shape (we record top-level keys)
 *           - array variable  → flagged "bare array"
 *
 * Things deliberately NOT done in v1 (left for later expansion):
 *   - Cross-handler tracing (when the route delegates to a service func)
 *   - Conditional path tracking (each `if`-branch as its own response)
 *   - Body field-type inference (we only record presence of fields)
 *
 * The extractor is intentionally conservative: when it can't pin a fact
 * to a specific status path, it emits no claim — false negatives over
 * false positives, per the framework's principle.
 */

import type { Node as SyntaxNode, Tree } from 'web-tree-sitter';
import type {
  OperationContract,
  ResponseContract,
  HeaderDecl,
  EffectEdge,
  BodyShape,
} from '../types/index.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

export interface ExtractedOperation {
  /** Stable identity matching the spec-side: `<METHOD> <path>`. */
  identity: string;
  contract: OperationContract;
  /** Where the route was declared, for drift reporting. */
  filePath: string;
  declarationLine: number;
  /**
   * Code-side observations about the handler — used by cross-cutting
   * comparators (PaginationContract, AuthRequirement) that need facts
   * the OperationContract proper doesn't carry.
   */
  observed: HandlerObservations;
  /**
   * The resolved handler body AST node — already follows single-file
   * delegation. Cross-cutting comparators (EffectGroup,
   * AuthorizationRule) walk this directly when they need block-scoped
   * facts the contract / observations don't preserve.
   *
   * In-memory only; not serializable across process boundaries. The
   * `source` is the file's raw text (for slicing node ranges).
   */
  handlerBody?: SyntaxNode;
  handlerSource?: string;
}

export interface HandlerObservations {
  /** Distinct names read off `req.query.<name>`. */
  queryParams: string[];
  /**
   * Numeric-literal clamp targets seen in the handler — e.g.
   * `Math.min(limit, 50)` records `50`. Used by PaginationContract to
   * verify `limit` is bounded.
   */
  numericClamps: number[];
  /** Whether any `Math.min(...)` call appears in the handler. */
  hasClampCall: boolean;
}

/**
 * Walk a parsed file and return one ExtractedOperation per discovered route.
 * Routes that we couldn't identify (computed paths, dynamic methods) are
 * silently skipped.
 */
export function extractOperationsFromFile(filePath: string, source: string, tree: Tree): ExtractedOperation[] {
  // Build a lookup of top-level function definitions in the file so that
  // routes whose handler is just a delegation can resolve into the body
  // they actually delegate to.
  const fnIndex = buildFunctionIndex(tree.rootNode, source);

  const out: ExtractedOperation[] = [];
  const visit = (node: SyntaxNode): void => {
    if (node.type === 'call_expression') {
      const route = tryExtractRouteCall(node, source, filePath, fnIndex);
      if (route) out.push(route);
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(tree.rootNode);
  return out;
}

// ---------------------------------------------------------------------------
// Function index — `function name(...) { … }` and `const name = (...) => …`
// declared at any scope in the file. Used to resolve delegation handlers.
// ---------------------------------------------------------------------------

type FunctionIndex = Map<string, SyntaxNode>;

function buildFunctionIndex(root: SyntaxNode, source: string): FunctionIndex {
  const index: FunctionIndex = new Map();

  const visit = (node: SyntaxNode): void => {
    // function foo(…) { … } and async function foo(…) { … }
    if (node.type === 'function_declaration') {
      const name = node.childForFieldName('name');
      const body = node.childForFieldName('body');
      if (name && body) index.set(sliceText(name, source), body);
    }
    // const foo = (…) => …  /  const foo = function (…) { … }
    if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      for (const decl of node.namedChildren) {
        if (decl.type !== 'variable_declarator') continue;
        const nameNode = decl.childForFieldName('name');
        const value = decl.childForFieldName('value');
        if (!nameNode || !value) continue;
        const fnBody = extractFunctionBody(value);
        if (fnBody) index.set(sliceText(nameNode, source), fnBody);
      }
    }
    for (const child of node.namedChildren) visit(child);
  };

  visit(root);
  return index;
}

function extractFunctionBody(node: SyntaxNode): SyntaxNode | null {
  if (node.type === 'arrow_function' || node.type === 'function_expression' || node.type === 'function') {
    return node.childForFieldName('body') ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Route extraction
// ---------------------------------------------------------------------------

function tryExtractRouteCall(
  call: SyntaxNode,
  source: string,
  filePath: string,
  fnIndex: FunctionIndex,
): ExtractedOperation | null {
  const callee = call.childForFieldName('function');
  const args = call.childForFieldName('arguments');
  if (!callee || !args) return null;
  if (callee.type !== 'member_expression') return null;
  const property = callee.childForFieldName('property');
  if (!property) return null;
  const method = sliceText(property, source).toLowerCase();
  if (!HTTP_METHODS.has(method)) return null;

  // Path is the first arg, must be a string literal.
  const firstArg = args.namedChild(0);
  if (!firstArg) return null;
  const pathLit = readStringLiteral(firstArg, source);
  if (pathLit === null) return null;

  // Handler is the LAST named arg (skips middleware).
  const argCount = args.namedChildCount;
  if (argCount < 2) return null;
  const handlerArg = args.namedChild(argCount - 1);
  if (!handlerArg) return null;

  const handlerBody = resolveHandlerBody(handlerArg, source);
  if (!handlerBody) return null;

  // Resolve the body we actually walk for response extraction. If the
  // route's handler body is a pure delegation `(req, res, next) =>
  // helper(req, res, next, …)`, follow the helper into the same file's
  // function index and walk its body instead. Falls back to the inline
  // body when the delegate isn't a known function in this file.
  const bodyToWalk = resolveDelegationTarget(handlerBody, source, fnIndex) ?? handlerBody;

  const responses = extractResponses(bodyToWalk, source);
  const observed = collectHandlerObservations(bodyToWalk, source);
  return {
    identity: `${method.toUpperCase()} ${pathLit}`,
    contract: {
      protocol: 'http',
      method: method.toUpperCase(),
      path: pathLit,
      responses,
      tags: [],
    },
    filePath,
    declarationLine: call.startPosition.row + 1,
    observed,
    handlerBody: bodyToWalk,
    handlerSource: source,
  };
}

// ---------------------------------------------------------------------------
// Handler observations: query-param reads + numeric clamp expressions
// ---------------------------------------------------------------------------

function collectHandlerObservations(body: SyntaxNode, source: string): HandlerObservations {
  const queryParams = new Set<string>();
  const numericClamps: number[] = [];
  let hasClampCall = false;

  const visit = (node: SyntaxNode): void => {
    // `req.query.<name>` member-access reads.
    if (node.type === 'member_expression') {
      const obj = node.childForFieldName('object');
      const prop = node.childForFieldName('property');
      if (obj && prop && obj.type === 'member_expression') {
        const innerObj = obj.childForFieldName('object');
        const innerProp = obj.childForFieldName('property');
        if (
          innerObj?.type === 'identifier' &&
          sliceText(innerObj, source) === 'req' &&
          innerProp?.type === 'property_identifier' &&
          sliceText(innerProp, source) === 'query'
        ) {
          queryParams.add(sliceText(prop, source));
        }
      }
    }
    // `Math.min(<x>, <numeric>)` clamps.
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn?.type === 'member_expression') {
        const obj = fn.childForFieldName('object');
        const prop = fn.childForFieldName('property');
        if (
          obj?.type === 'identifier' &&
          sliceText(obj, source) === 'Math' &&
          prop?.type === 'property_identifier' &&
          sliceText(prop, source) === 'min'
        ) {
          hasClampCall = true;
          const args = node.childForFieldName('arguments');
          if (args) {
            for (const a of args.namedChildren) {
              if (a.type === 'number') {
                const n = Number(sliceText(a, source));
                if (Number.isFinite(n)) numericClamps.push(n);
              }
            }
          }
        }
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(body);

  return { queryParams: [...queryParams], numericClamps, hasClampCall };
}

/**
 * If the handler body is a pure delegation (a single call_expression as
 * the body, possibly wrapped in a return/expression statement), return
 * the body of the function being delegated to — when that function is
 * defined in this same file's function index. Otherwise return null and
 * the caller falls back to walking the inline body (which has no res.*
 * calls and produces an empty contract — accurate "untraced" signal).
 */
function resolveDelegationTarget(
  body: SyntaxNode,
  source: string,
  fnIndex: FunctionIndex,
): SyntaxNode | null {
  const callExpr = extractDelegationCallExpr(body);
  if (!callExpr) return null;
  const callee = callExpr.childForFieldName('function');
  if (!callee || callee.type !== 'identifier') return null;
  const name = sliceText(callee, source);
  return fnIndex.get(name) ?? null;
}

/**
 * Walk the handler body looking for the canonical "single call expression"
 * shape. Accepts:
 *   - body itself is a call_expression (arrow with expression body)
 *   - { return helper(...) }
 *   - { helper(...) }
 * Returns null if the body has more structure than that.
 */
function extractDelegationCallExpr(body: SyntaxNode): SyntaxNode | null {
  if (body.type === 'call_expression') return body;
  if (body.type === 'statement_block') {
    const stmts = body.namedChildren.filter((c) => c.type !== 'comment');
    if (stmts.length !== 1) return null;
    const stmt = stmts[0];
    if (stmt.type === 'return_statement' || stmt.type === 'expression_statement') {
      const inner = stmt.namedChildren[0];
      if (inner?.type === 'call_expression') return inner;
    }
  }
  return null;
}

/**
 * Resolve the inline handler body to walk. We accept:
 *   - inline arrow / function expression: walk its body directly
 *   - identifier reference: skip in v1 (cross-fn tracing later)
 */
function resolveHandlerBody(handlerArg: SyntaxNode, _source: string): SyntaxNode | null {
  if (handlerArg.type === 'arrow_function' || handlerArg.type === 'function_expression' || handlerArg.type === 'function') {
    return handlerArg.childForFieldName('body') ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Response extraction
// ---------------------------------------------------------------------------
//
// Walk the handler's body collecting calls of shape `res.status(N)` and
// any chained `.json(...)` / `.setHeader(...)` calls. Each distinct
// status seen produces a `ResponseContract` entry.
// ---------------------------------------------------------------------------

interface ResponseAccumulator {
  status: string;
  headers: HeaderDecl[];
  body?: BodyShape;
  effects: EffectEdge[];
}

function extractResponses(body: SyntaxNode, source: string): ResponseContract[] {
  // Two-phase walk in document order:
  //   1. Collect every `res.*` call_expression as a typed event, in source
  //      order, with its line number.
  //   2. Replay events: bind preceding `setHeader` events to the next
  //      status event seen on any subsequent line.
  const events: ResEvent[] = [];

  const visit = (node: SyntaxNode): void => {
    if (node.type === 'call_expression') {
      const e = describeResCall(node, source);
      if (e) events.push(e);
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(body);

  // Document order — tree-sitter already gives us this from named-child
  // traversal, but sort defensively on (line, col) since visit recurses.
  events.sort((a, b) => (a.line - b.line) || (a.col - b.col));

  const byStatus = new Map<string, ResponseAccumulator>();
  let pendingHeaders: HeaderDecl[] = [];

  for (const e of events) {
    if (e.kind === 'set-header') {
      pendingHeaders.push({ name: e.headerName, required: true });
      continue;
    }
    // status event
    let acc = byStatus.get(e.status);
    if (!acc) {
      acc = { status: e.status, headers: [], effects: [] };
      byStatus.set(e.status, acc);
    }
    if (pendingHeaders.length > 0) {
      acc.headers.push(...pendingHeaders);
      pendingHeaders = [];
    }
    if (e.bodyShape) acc.body = e.bodyShape;
  }

  return [...byStatus.values()].map((acc) => ({
    status: acc.status,
    headers: acc.headers.length > 0 ? acc.headers : undefined,
    body: acc.body,
    effects: acc.effects.length > 0 ? acc.effects : undefined,
  }));
}

interface ResEventBase { line: number; col: number }
type ResEvent =
  | (ResEventBase & { kind: 'set-header'; headerName: string })
  | (ResEventBase & { kind: 'status'; status: string; bodyShape?: BodyShape });

/**
 * Express response methods that emit a body. The default status is 200
 * unless the call chain includes `.status(N)` — that's documented Express
 * behavior, not a heuristic. `sendStatus(N)` is the special case that
 * carries its own status as the first argument.
 *
 * We deliberately don't try to track `res.statusCode = N` assignments or
 * `res.statusCode` stickiness across statements — that's path-sensitive
 * and uncommon in modern code. The chain-based rule covers the common
 * cases (`res.json(x)` → 200, `res.status(404).json(x)` → 404) without
 * false negatives on the implicit-200 path that motivates this.
 */
const RES_SEND_METHODS = new Set([
  'json', 'send', 'end', 'jsonp', 'sendFile', 'render',
]);

function describeResCall(call: SyntaxNode, source: string): ResEvent | null {
  const fn = call.childForFieldName('function');
  if (!fn || fn.type !== 'member_expression') return null;
  const obj = fn.childForFieldName('object');
  const prop = fn.childForFieldName('property');
  if (!obj || !prop) return null;
  const propName = sliceText(prop, source);
  const line = call.startPosition.row + 1;
  const col = call.startPosition.column + 1;

  // res.setHeader('Location', '...') / res.header('Location', '...')
  if ((propName === 'setHeader' || propName === 'header') && obj.type === 'identifier' && sliceText(obj, source) === 'res') {
    const args = call.childForFieldName('arguments');
    const nameArg = args?.namedChild(0);
    if (nameArg) {
      const name = readStringLiteral(nameArg, source);
      if (name) return { kind: 'set-header', headerName: name.toLowerCase(), line, col };
    }
    return null;
  }

  // res.sendStatus(N) — explicit numeric status with no body.
  if (propName === 'sendStatus' && obj.type === 'identifier' && sliceText(obj, source) === 'res') {
    const args = call.childForFieldName('arguments');
    const arg = args?.namedChild(0);
    if (arg && arg.type === 'number') {
      return { kind: 'status', status: sliceText(arg, source), line, col };
    }
    return null;
  }

  // res.status(N) / res.status(N).json(...) / res.status(N).send(...) —
  // explicit numeric status anywhere in the chain.
  const statusInfo = findStatusInChain(call, source);
  if (statusInfo) {
    const jsonInfo = findJsonInChain(call, source);
    return {
      kind: 'status',
      status: statusInfo.status,
      bodyShape: jsonInfo ? classifyJsonArg(jsonInfo.arg) : undefined,
      line,
      col,
    };
  }

  // Implicit-200 path: a bare body-emitting send (`res.json(...)`,
  // `res.send(...)`, etc.) with no chained `.status(N)`. Express defaults
  // to 200 in this case, so the extractor records 200 as the response
  // status — without this, modern handlers that just call `res.json(data)`
  // would appear to emit no responses at all.
  if (RES_SEND_METHODS.has(propName) && isResReceiver(obj, source)) {
    const bodyShape = propName === 'json' || propName === 'jsonp'
      ? classifyJsonArg(call.childForFieldName('arguments')?.namedChild(0) ?? undefined)
      : undefined;
    return { kind: 'status', status: '200', bodyShape, line, col };
  }

  return null;
}

/**
 * True when the chain root resolves to the `res` parameter — either the
 * direct identifier `res` or any member expression rooted at it (so
 * `res.json(...)` and `someObj.res.json(...)` are distinguishable).
 */
function isResReceiver(node: SyntaxNode, source: string): boolean {
  let cur: SyntaxNode | null = node;
  while (cur) {
    if (cur.type === 'identifier') return sliceText(cur, source) === 'res';
    if (cur.type === 'member_expression') {
      cur = cur.childForFieldName('object');
      continue;
    }
    if (cur.type === 'call_expression') {
      const fn = cur.childForFieldName('function');
      cur = fn?.type === 'member_expression' ? fn.childForFieldName('object') : null;
      continue;
    }
    return false;
  }
  return false;
}

/**
 * Walk a call expression chain looking for `<receiver>.status(NUM)`.
 * Returns null if no literal-numeric status() was found.
 */
function findStatusInChain(node: SyntaxNode, source: string): { status: string } | null {
  // The chain root is a call_expression. We walk member_expression /
  // call_expression nodes following the `object` field down.
  let cur: SyntaxNode | null = node;
  while (cur) {
    if (cur.type === 'call_expression') {
      const fn = cur.childForFieldName('function');
      if (fn?.type === 'member_expression') {
        const prop = fn.childForFieldName('property');
        const args = cur.childForFieldName('arguments');
        if (prop && args && sliceText(prop, source) === 'status') {
          const arg = args.namedChild(0);
          if (arg && arg.type === 'number') {
            return { status: sliceText(arg, source) };
          }
        }
        cur = fn.childForFieldName('object');
        continue;
      }
    }
    if (cur.type === 'member_expression') {
      cur = cur.childForFieldName('object');
      continue;
    }
    break;
  }
  return null;
}

function findJsonInChain(node: SyntaxNode, source: string): { arg?: SyntaxNode } | null {
  let cur: SyntaxNode | null = node;
  while (cur) {
    if (cur.type === 'call_expression') {
      const fn = cur.childForFieldName('function');
      if (fn?.type === 'member_expression') {
        const prop = fn.childForFieldName('property');
        const args = cur.childForFieldName('arguments');
        if (prop && sliceText(prop, source) === 'json') {
          return { arg: args?.namedChild(0) ?? undefined };
        }
        cur = fn.childForFieldName('object');
        continue;
      }
    }
    if (cur.type === 'member_expression') {
      cur = cur.childForFieldName('object');
      continue;
    }
    break;
  }
  return null;
}

/**
 * Classify the argument to `res.json(...)` into one of the body shapes the
 * comparator can reason about. v1 distinguishes:
 *   - an object literal: extract top-level keys (so `{ items, nextCursor }`
 *     vs `{ message }` are visibly different)
 *   - a bare array (`pageOf.items`, `[…]`): tagged `bare-array`
 *   - an identifier of unknown shape: empty body
 *   - anything else: empty body
 */
function classifyJsonArg(arg: SyntaxNode | undefined): BodyShape | undefined {
  if (!arg) return undefined;
  if (arg.type === 'object') {
    const fields: Record<string, never> = {} as Record<string, never>;
    for (const child of arg.namedChildren) {
      if (child.type === 'pair') {
        const key = child.childForFieldName('key');
        if (!key) continue;
        const name = key.text.replace(/^['"]|['"]$/g, '');
        // store presence only — the comparator currently checks key set
        (fields as Record<string, unknown>)[name] = undefined;
      }
    }
    return { fields: fields as Record<string, never> };
  }
  // `pageOf.items` (member access) or `array(…)` — heuristic: if the arg
  // resolves to something that looks like a bare array (member access
  // ending in `.items`, or an `array` literal), tag as bare-array.
  if (arg.type === 'array') return { fields: undefined, errorCode: 'bare-array' };
  if (arg.type === 'member_expression') {
    const propName = arg.childForFieldName('property')?.text ?? '';
    if (propName === 'items') return { fields: undefined, errorCode: 'bare-array' };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sliceText(node: SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

function readStringLiteral(node: SyntaxNode, source: string): string | null {
  if (node.type === 'string') {
    const fragment = node.namedChildren.find((c) => c.type === 'string_fragment');
    if (!fragment) return '';
    return source.slice(fragment.startIndex, fragment.endIndex);
  }
  return null;
}
