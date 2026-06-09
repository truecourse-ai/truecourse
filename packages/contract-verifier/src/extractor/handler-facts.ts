/**
 * Eager handler-body fact extraction.
 *
 * Runs once per resolved handler body, at extraction time, while the
 * tree-sitter `Tree` is still alive. Produces plain data (strings, numbers,
 * Sets, Maps) that downstream comparators consume — `compareEffectGroup`
 * and `compareAuthorizationRule`. This lets the verifier dispose every
 * parsed `Tree` per-file (the WASM heap pressure that caused payloadcms
 * to crash at ~6000 parses), because nothing downstream walks AST nodes.
 *
 * The semantics here are a verbatim port of:
 *   - the AST walks in `effect/emission-facts.ts` (now consumed via
 *     `op.emission` rather than a comparator-time call)
 *   - the auth-side / resource-field detector in
 *     `comparator/authorization-rule.ts` (now consumed via
 *     `op.ownershipCheckCandidates`)
 *
 * Both modules used to walk `ExtractedOperation.handlerBody` (a
 * `SyntaxNode`) at comparison time. That field is gone — these facts are
 * the per-handler IR that replaces it.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import { resolveColumn, type CsColumnMap } from './shared/cs-column-map.js';

// ---------------------------------------------------------------------------
// Public IR (replaces handlerBody/handlerSource on ExtractedOperation)
// ---------------------------------------------------------------------------

export interface FailureEmitSite {
  event: string;
  lineStart: number;
  lineEnd: number;
}

export interface OperationEmission {
  /** Events emitted with a string-literal name, anywhere in the handler. */
  staticEvents: Set<string>;
  /** True if any emit uses a non-literal (dynamic) event name. */
  hasDynamicEmit: boolean;
  /** Emit sites located inside a 4xx/5xx failure block. */
  failureEmitSites: FailureEmitSite[];
  /** For each `x === 'literal'` branch: did the consequent / alternative emit? */
  branchEmits: Map<string, { consequentEmits: boolean; alternativeEmits: boolean }>;
}

export interface OwnershipCheckCandidate {
  /** The terminal `.<name>` accessed on the non-auth side of an equality.
   *  Compared against the contract's `resourceField` at comparison time. */
  resourceField: string;
  /** 1-indexed line of the equality expression — for drift location reporting. */
  line: number;
}

export interface HandlerFacts {
  emission: OperationEmission;
  ownershipCheckCandidates: OwnershipCheckCandidate[];
}

/**
 * Eagerly extract all handler-body facts the verifier needs after the
 * tree is gone. Called once per resolved handler in the operation /
 * file-based-routes / fastapi extractors.
 */
export function extractHandlerFacts(body: SyntaxNode, source: string, columnMap?: CsColumnMap): HandlerFacts {
  return {
    emission: extractEmission(body, source),
    ownershipCheckCandidates: extractOwnershipCandidates(body, source, columnMap),
  };
}

/** A no-op fact set for the rare case where the handler body wasn't resolved. */
export function emptyHandlerFacts(): HandlerFacts {
  return {
    emission: {
      staticEvents: new Set(),
      hasDynamicEmit: false,
      failureEmitSites: [],
      branchEmits: new Map(),
    },
    ownershipCheckCandidates: [],
  };
}

// ===========================================================================
// Emission facts — verbatim port from effect/emission-facts.ts
// ===========================================================================

function extractEmission(body: SyntaxNode, source: string): OperationEmission {
  const callMap = collectEmitCalls(body, source);
  const failureEmitSites: FailureEmitSite[] = [];
  for (const [event, calls] of callMap) {
    for (const call of calls) {
      if (emitIsInFailureBlock(call, source)) {
        failureEmitSites.push({
          event,
          lineStart: call.startPosition.row + 1,
          lineEnd: call.endPosition.row + 1,
        });
      }
    }
  }
  return {
    staticEvents: new Set(callMap.keys()),
    hasDynamicEmit: handlerHasDynamicEmit(body, source),
    failureEmitSites,
    branchEmits: collectBranchEmits(body, source),
  };
}

// ---- Language-agnostic node predicates (JS + Python) ----

function isCall(n: SyntaxNode): boolean {
  return n.type === 'call_expression' || n.type === 'call' || n.type === 'invocation_expression';
}
function isMember(n: SyntaxNode | null): boolean {
  return n?.type === 'member_expression' || n?.type === 'attribute' || n?.type === 'member_access_expression';
}
function memberProp(n: SyntaxNode, source: string): string {
  const p = n.childForFieldName('property') ?? n.childForFieldName('attribute') ?? n.childForFieldName('name');
  return p ? source.slice(p.startIndex, p.endIndex) : '';
}
function isBlock(n: SyntaxNode): boolean {
  return n.type === 'statement_block' || n.type === 'block';
}
function isFnBoundary(n: SyntaxNode): boolean {
  return n.type === 'function_declaration' || n.type === 'arrow_function'
    || n.type === 'function_expression' || n.type === 'function_definition'
    || n.type === 'method_declaration' || n.type === 'local_function_statement' || n.type === 'lambda_expression';
}
function isControlFlow(n: SyntaxNode): boolean {
  return /^(if_statement|switch_statement|switch_expression|try_statement|for_statement|for_in_statement|foreach_statement|while_statement|do_statement)$/.test(n.type);
}
function strVal(n: SyntaxNode, source: string): string | null {
  if (n.type !== 'string' && n.type !== 'string_literal') return null;
  const frag = n.namedChildren.find((c) => c.type === 'string_fragment' || c.type === 'string_content' || c.type === 'string_literal_content');
  return frag ? source.slice(frag.startIndex, frag.endIndex) : null;
}
/** Unwrap C#'s `argument` wrapper inside an `argument_list`. */
function argValue(n: SyntaxNode | null): SyntaxNode | null {
  if (!n) return null;
  return n.type === 'argument' ? n.namedChild(0) : n;
}
function isEmitFn(fn: SyntaxNode, source: string): boolean {
  if (isMember(fn)) return memberProp(fn, source).toLowerCase() === 'emit';
  if (fn.type === 'identifier') return /^emit/i.test(source.slice(fn.startIndex, fn.endIndex));
  return false;
}

function collectEmitCalls(body: SyntaxNode, source: string): Map<string, SyntaxNode[]> {
  const out = new Map<string, SyntaxNode[]>();
  const visit = (node: SyntaxNode): void => {
    if (isCall(node)) {
      const fn = node.childForFieldName('function');
      const args = node.childForFieldName('arguments');
      if (fn && args && isEmitFn(fn, source)) {
        const first = argValue(args.namedChild(0));
        const eventName = first ? strVal(first, source) : null;
        if (eventName !== null) {
          const arr = out.get(eventName) ?? [];
          arr.push(node);
          out.set(eventName, arr);
        }
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(body);
  return out;
}

function handlerHasDynamicEmit(body: SyntaxNode, source: string): boolean {
  let dynamic = false;
  const visit = (node: SyntaxNode): void => {
    if (dynamic) return;
    if (isCall(node)) {
      const fn = node.childForFieldName('function');
      const args = node.childForFieldName('arguments');
      if (fn && args && isEmitFn(fn, source)) {
        const first = argValue(args.namedChild(0));
        if (first && first.type !== 'string' && first.type !== 'string_literal') { dynamic = true; return; }
      }
    }
    for (const child of node.namedChildren) { visit(child); if (dynamic) return; }
  };
  visit(body);
  return dynamic;
}

function emitIsInFailureBlock(emitCall: SyntaxNode, source: string): boolean {
  let cur: SyntaxNode | null = emitCall.parent;
  while (cur) {
    if (isBlock(cur)) return blockContainsFailureStatusShallow(cur, source);
    if (isFnBoundary(cur)) break;
    cur = cur.parent;
  }
  return false;
}

function blockContainsFailureStatusShallow(block: SyntaxNode, source: string): boolean {
  for (const stmt of block.namedChildren) {
    if (containsTopLevelFailureStatus(stmt, source)) return true;
  }
  return false;
}

function containsTopLevelFailureStatus(stmt: SyntaxNode, source: string): boolean {
  if (isControlFlow(stmt)) return false;
  let found = false;
  const visit = (node: SyntaxNode): void => {
    if (found) return;
    if (isControlFlow(node)) return;
    if (isCall(node) && callEmitsFailureStatus(node, source)) { found = true; return; }
    for (const child of node.namedChildren) { visit(child); if (found) return; }
  };
  visit(stmt);
  return found;
}

const CS_FAILURE_FACTORIES = new Set([
  'BadRequest', 'NotFound', 'Unauthorized', 'Forbid', 'Conflict', 'UnprocessableEntity', 'Problem', 'ValidationProblem',
]);

function callEmitsFailureStatus(call: SyntaxNode, source: string): boolean {
  const fn = call.childForFieldName('function');
  if (!fn) return false;
  const args = call.childForFieldName('arguments');
  if (!args) return false;

  // C#: `return BadRequest(...)` / `NotFound(...)` / `StatusCode(4xx|5xx, …)` and
  // their `Results.<X>` minimal-API equivalents.
  const csName = fn.type === 'identifier' ? source.slice(fn.startIndex, fn.endIndex)
    : fn.type === 'member_access_expression' ? memberProp(fn, source) : '';
  if (csName) {
    if (CS_FAILURE_FACTORIES.has(csName)) return true;
    if (csName === 'StatusCode') {
      const a = argValue(args.namedChild(0));
      if (a?.type === 'integer_literal' && /^[45]\d{2}$/.test(source.slice(a.startIndex, a.endIndex))) return true;
    }
  }

  if (isMember(fn) && memberProp(fn, source) === 'status') {
    const arg = args.namedChild(0);
    return !!arg && arg.type === 'number' && /^[45]\d{2}$/.test(source.slice(arg.startIndex, arg.endIndex));
  }

  const fnName = fn.type === 'identifier' ? source.slice(fn.startIndex, fn.endIndex)
    : isMember(fn) ? memberProp(fn, source) : '';
  if (fnName === 'JSONResponse' || fnName === 'HTTPException' || fnName === 'Response') {
    for (let i = 0; i < args.namedChildCount; i++) {
      const a = args.namedChild(i);
      if (a?.type === 'keyword_argument') {
        const name = a.childForFieldName('name');
        const value = a.childForFieldName('value');
        if (name && value && source.slice(name.startIndex, name.endIndex) === 'status_code'
          && value.type === 'integer' && /^[45]\d{2}$/.test(source.slice(value.startIndex, value.endIndex))) {
          return true;
        }
      }
    }
    const first = args.namedChild(0);
    if (first?.type === 'integer' && /^[45]\d{2}$/.test(source.slice(first.startIndex, first.endIndex))) return true;
  }
  return false;
}

function collectBranchEmits(
  body: SyntaxNode,
  source: string,
): Map<string, { consequentEmits: boolean; alternativeEmits: boolean }> {
  const out = new Map<string, { consequentEmits: boolean; alternativeEmits: boolean }>();
  const visit = (node: SyntaxNode): void => {
    if (node.type === 'if_statement') {
      const cond = node.childForFieldName('condition');
      const consequent = node.childForFieldName('consequence');
      const alternative = node.childForFieldName('alternative');
      const literal = cond ? conditionLiteral(cond, source) : null;
      if (literal !== null && consequent && !out.has(literal)) {
        out.set(literal, {
          consequentEmits: blockHasAnyEmit(consequent, source),
          alternativeEmits: alternative ? blockHasAnyEmit(alternative, source) : false,
        });
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(body);
  return out;
}

function conditionLiteral(node: SyntaxNode, source: string): string | null {
  const u = unwrapParens(node);
  if (u.type === 'binary_expression') {
    const opNode = u.childForFieldName('operator');
    const op = opNode ? source.slice(opNode.startIndex, opNode.endIndex) : '';
    if (op !== '===' && op !== '==') return null;
    return litText(u.childForFieldName('left'), source) ?? litText(u.childForFieldName('right'), source);
  }
  if (u.type === 'comparison_operator') {
    const a = u.namedChild(0);
    const b = u.namedChild(1);
    if (!a || !b || source.slice(a.endIndex, b.startIndex).trim() !== '==') return null;
    return litText(a, source) ?? litText(b, source);
  }
  return null;
}

function litText(node: SyntaxNode | null, source: string): string | null {
  return node && node.type === 'string' ? strVal(node, source) : null;
}

function unwrapParens(node: SyntaxNode): SyntaxNode {
  let cur = node;
  while (cur.type === 'parenthesized_expression') {
    const child = cur.namedChildren[0];
    if (!child) break;
    cur = child;
  }
  return cur;
}

function blockHasAnyEmit(block: SyntaxNode, source: string): boolean {
  let found = false;
  const visit = (node: SyntaxNode): void => {
    if (found) return;
    if (isCall(node)) {
      const fn = node.childForFieldName('function');
      if (fn && isEmitFn(fn, source)) { found = true; return; }
    }
    for (const child of node.namedChildren) { visit(child); if (found) return; }
  };
  visit(block);
  return found;
}

// ===========================================================================
// Ownership-check candidates — port from comparator/authorization-rule.ts
// ===========================================================================
//
// We walk every equality / inequality comparison. If one side touches
// `req.auth`/`request.auth`/`request.user.*`/`current_user.*` AND the
// other side is a member/attribute access whose terminal property name
// is some identifier X, we emit a candidate `{ resourceField: X, line }`.
//
// At comparison time the comparator just checks
// `op.ownershipCheckCandidates.some(c => c.resourceField === contractField)`.

function extractOwnershipCandidates(body: SyntaxNode, source: string, columnMap?: CsColumnMap): OwnershipCheckCandidate[] {
  const out: OwnershipCheckCandidate[] = [];
  const tryEq = (left: SyntaxNode, right: SyntaxNode, line: number): void => {
    const leftAuth = matchesAuthSide(left, source);
    const rightAuth = matchesAuthSide(right, source);
    if (!leftAuth && !rightAuth) return;
    // The non-auth side is the resource side. If only ONE side is auth, the
    // other is unambiguously the resource side. If BOTH sides are auth (rare)
    // emit candidates for both — the comparator filters by name anyway.
    if (rightAuth) {
      const field = terminalProperty(left, source, columnMap);
      if (field) out.push({ resourceField: field, line });
    }
    if (leftAuth) {
      const field = terminalProperty(right, source, columnMap);
      if (field) out.push({ resourceField: field, line });
    }
  };
  const visit = (node: SyntaxNode): void => {
    // JS equality: binary_expression with ===/==/!==/!=
    if (node.type === 'binary_expression') {
      const opNode = node.childForFieldName('operator');
      const op = opNode ? source.slice(opNode.startIndex, opNode.endIndex) : '';
      if (op === '===' || op === '==' || op === '!==' || op === '!=') {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (left && right) tryEq(left, right, node.startPosition.row + 1);
      }
    }
    // Python equality: comparison_operator with ==/!=
    if (node.type === 'comparison_operator') {
      const a = node.namedChild(0);
      const b = node.namedChild(1);
      if (a && b) {
        const op = source.slice(a.endIndex, b.startIndex).trim();
        if (op === '==' || op === '!=') tryEq(a, b, node.startPosition.row + 1);
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(body);
  return out;
}

/** Terminal `.<name>` of a member_expression / attribute / member_access chain.
 *  For C#, resolves the property to its mapped `[Column]` so it matches the
 *  contract's snake_case `resourceField` (e.g. `CustomerId` → `customer_id`). */
function terminalProperty(node: SyntaxNode, source: string, columnMap?: CsColumnMap): string | null {
  if (node.type === 'member_access_expression') {
    const prop = node.childForFieldName('name');
    if (!prop) return null;
    const raw = source.slice(prop.startIndex, prop.endIndex);
    return columnMap ? resolveColumn(columnMap, raw) : raw;
  }
  if (node.type !== 'member_expression' && node.type !== 'attribute') return null;
  const prop = node.childForFieldName('property') ?? node.childForFieldName('attribute');
  if (!prop) return null;
  return source.slice(prop.startIndex, prop.endIndex);
}

/** True if the expression touches `req.auth.*` / `request.user.*` /
 *  `current_user.*` (JS member chains + Python attribute chains). */
function matchesAuthSide(node: SyntaxNode, source: string): boolean {
  // C#: the auth side is `CurrentUserId()`, `User.IsInRole/FindFirst/Identity/Claims`,
  // `HttpContext.User`, or `ClaimTypes.*`.
  if (/\bCurrentUserId\b|\bUser\.(IsInRole|FindFirst|Identity|Claims)\b|\bHttpContext\.User\b|\bClaimTypes\./.test(source.slice(node.startIndex, node.endIndex))) {
    return true;
  }
  // Python attribute chain: `request.user.id`, `request.auth.user_id`, `current_user.id`.
  if (node.type === 'attribute') {
    return /\b(req|request)\.(auth|user)\b|\bcurrent_user\b/.test(source.slice(node.startIndex, node.endIndex));
  }
  // Walk up the member chain looking for `req` / `request` then `.auth`.
  let cur: SyntaxNode | null = node;
  while (cur) {
    if (cur.type === 'identifier') {
      const text = source.slice(cur.startIndex, cur.endIndex);
      if (text === 'req' || text === 'request') return false; // bare identifier — not enough
      return false;
    }
    if (cur.type === 'member_expression') {
      const text = source.slice(cur.startIndex, cur.endIndex);
      if (/\b(req|request)\.auth\b|\b(req|request)\?\.auth\b/.test(text)) return true;
      cur = cur.childForFieldName('object');
      continue;
    }
    if (cur.type === 'optional_chain_expression' || cur.type === 'subscript_expression') {
      cur = cur.childForFieldName('object');
      continue;
    }
    return false;
  }
  return false;
}
