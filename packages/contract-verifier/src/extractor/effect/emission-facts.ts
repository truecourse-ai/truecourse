/**
 * Emission facts — the per-operation code→contract view of event emission that
 * the EffectGroup comparator diffs against. This relocates the handler-AST
 * analysis OUT of the comparator (which is now a pure diff) and INTO the
 * extraction layer, so both sides of verify follow the same
 * "extract a code contract, then diff" shape.
 *
 * Per operation handler we capture: the statically-named events emitted, whether
 * any emit is dynamic (`emit(variable, …)`), every emit that sits in a 4xx/5xx
 * failure block, and per-literal branch emission (so the comparator can tell a
 * branch that skips an emit its siblings perform). Node matching is
 * language-agnostic (JS + Python), identical to the prior inline logic.
 */

import type { Node as SyntaxNode } from 'web-tree-sitter';
import type { ExtractedOperation } from '../operation.js';

export interface FailureEmitSite {
  event: string;
  lineStart: number;
  lineEnd: number;
}

export interface OperationEmission {
  filePath: string;
  declarationLine: number;
  /** Events emitted with a string-literal name, anywhere in the handler. */
  staticEvents: Set<string>;
  /** True if any emit uses a non-literal (dynamic) event name. */
  hasDynamicEmit: boolean;
  /** Emit sites located inside a 4xx/5xx failure block. */
  failureEmitSites: FailureEmitSite[];
  /** For each `x === 'literal'` branch: did the consequent / alternative emit? */
  branchEmits: Map<string, { consequentEmits: boolean; alternativeEmits: boolean }>;
}

/** opIdentity → emission facts. Only handlers we could resolve are present. */
export type EmissionFacts = Map<string, OperationEmission>;

export function extractEmissionFacts(ops: ExtractedOperation[]): EmissionFacts {
  const facts: EmissionFacts = new Map();
  for (const op of ops) {
    if (!op.handlerBody || !op.handlerSource) continue;
    const body = op.handlerBody;
    const source = op.handlerSource;
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
    facts.set(op.identity, {
      filePath: op.filePath,
      declarationLine: op.declarationLine,
      staticEvents: new Set(callMap.keys()),
      hasDynamicEmit: handlerHasDynamicEmit(body, source),
      failureEmitSites,
      branchEmits: collectBranchEmits(body, source),
    });
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Language-agnostic node predicates
// ---------------------------------------------------------------------------

function isCall(n: SyntaxNode): boolean {
  return n.type === 'call_expression' || n.type === 'call';
}
function isMember(n: SyntaxNode | null): boolean {
  return n?.type === 'member_expression' || n?.type === 'attribute';
}
function memberProp(n: SyntaxNode, source: string): string {
  const p = n.childForFieldName('property') ?? n.childForFieldName('attribute');
  return p ? source.slice(p.startIndex, p.endIndex) : '';
}
function isBlock(n: SyntaxNode): boolean {
  return n.type === 'statement_block' || n.type === 'block';
}
function isFnBoundary(n: SyntaxNode): boolean {
  return n.type === 'function_declaration' || n.type === 'arrow_function'
    || n.type === 'function_expression' || n.type === 'function_definition';
}
function isControlFlow(n: SyntaxNode): boolean {
  return /^(if_statement|switch_statement|try_statement|for_statement|for_in_statement|while_statement|do_statement)$/.test(n.type);
}
function strVal(n: SyntaxNode, source: string): string | null {
  if (n.type !== 'string') return null;
  const frag = n.namedChildren.find((c) => c.type === 'string_fragment' || c.type === 'string_content');
  return frag ? source.slice(frag.startIndex, frag.endIndex) : null;
}
function isEmitFn(fn: SyntaxNode, source: string): boolean {
  if (isMember(fn)) return memberProp(fn, source) === 'emit';
  if (fn.type === 'identifier') return /^emit/i.test(source.slice(fn.startIndex, fn.endIndex));
  return false;
}

// ---------------------------------------------------------------------------
// Emit-call collection
// ---------------------------------------------------------------------------

function collectEmitCalls(body: SyntaxNode, source: string): Map<string, SyntaxNode[]> {
  const out = new Map<string, SyntaxNode[]>();
  const visit = (node: SyntaxNode): void => {
    if (isCall(node)) {
      const fn = node.childForFieldName('function');
      const args = node.childForFieldName('arguments');
      if (fn && args && isEmitFn(fn, source)) {
        const first = args.namedChild(0);
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
        const first = args.namedChild(0);
        if (first && first.type !== 'string') { dynamic = true; return; }
      }
    }
    for (const child of node.namedChildren) { visit(child); if (dynamic) return; }
  };
  visit(body);
  return dynamic;
}

// ---------------------------------------------------------------------------
// Failure-block detection
// ---------------------------------------------------------------------------

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

function callEmitsFailureStatus(call: SyntaxNode, source: string): boolean {
  const fn = call.childForFieldName('function');
  if (!fn) return false;
  const args = call.childForFieldName('arguments');
  if (!args) return false;

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

// ---------------------------------------------------------------------------
// Branch emission map (`x === 'literal'` → did each side emit?)
// ---------------------------------------------------------------------------

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
