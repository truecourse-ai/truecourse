/**
 * EffectGroup comparator. Walks each spec-declared effect's matching
 * operation handler, scoped to enclosing statement blocks. Two checks:
 *
 *   1. MISSING EMISSION (spec says `order.cancelled` emits on
 *      `POST /api/orders/{id}/cancel`, code never emits it).
 *   2. FORBIDDEN EMISSION on failure (spec forbids emission on 4xx/5xx;
 *      code emits an event from a block that ALSO returns a 4xx/5xx).
 *
 * Node matching is language-agnostic: JS `call_expression` + `res.status(4xx)`
 * and Python `call` + `JSONResponse(status_code=4xx)` / `HTTPException(4xx)`
 * are both recognized.
 */

import { randomUUID } from 'node:crypto';
import type { Node as SyntaxNode } from 'web-tree-sitter';
import type {
  ContractDrift,
  ArtifactRef,
  EffectGroupContract,
} from '../types/index.js';
import type { ResolvedArtifact } from '../resolver/index.js';
import type { ExtractedOperation } from '../extractor/index.js';

export interface EffectGroupCompareInput {
  effectGroupRef: ArtifactRef;
  contract: EffectGroupContract;
  specOps: Map<string, ResolvedArtifact>;
  recognizedOps: ExtractedOperation[];
}

export function compareEffectGroup(input: EffectGroupCompareInput): ContractDrift[] {
  const out: ContractDrift[] = [];

  const codeOps = new Map<string, ExtractedOperation>();
  for (const op of input.recognizedOps) codeOps.set(op.identity, op);

  for (const effect of input.contract.effects) {
    const opIdentity = effect.emitWhen.operationRef.identity;
    const codeOp = codeOps.get(opIdentity);
    if (!codeOp || !codeOp.handlerBody || !codeOp.handlerSource) continue;

    const callMap = collectEmitCalls(codeOp.handlerBody, codeOp.handlerSource);
    const events = [...callMap.keys()];
    const emitsThisEffect = events.includes(effect.identity);
    const hasDynamicEmit = handlerHasDynamicEmit(codeOp.handlerBody, codeOp.handlerSource);

    const branchKey =
      (typeof effect.payloadConstraint?.status === 'string'
        ? effect.payloadConstraint.status
        : null) ?? effect.identity.split('.').pop() ?? '';

    const branchSkipped = handlerHasBranchSkippingEmit(
      codeOp.handlerBody, codeOp.handlerSource, branchKey,
    );

    if (!emitsThisEffect && (!hasDynamicEmit || branchSkipped)) {
      out.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: input.effectGroupRef,
        obligationKey: `Effect:${effect.identity} / missing-emission`,
        severity: 'critical',
        filePath: codeOp.filePath,
        lineStart: codeOp.declarationLine,
        lineEnd: codeOp.declarationLine,
        message:
          `Effect \`${effect.identity}\` is declared to emit on ${opIdentity} ` +
          `(status ${effect.emitWhen.onStatus}) but the handler never emits ` +
          `\`${effect.identity}\` along any code path.`,
        specSide: `effect ${effect.identity} emit-when ${opIdentity} on-status ${effect.emitWhen.onStatus}`,
        codeSide: branchSkipped
          ? `branch for '${branchKey}' exists but contains no emit while sibling branches do`
          : events.length > 0
            ? `handler emits: ${events.join(', ')}`
            : `handler does not emit any tracked event`,
      });
    }
  }

  if (input.contract.forbids.some((f) => f.kind === 'emission')) {
    for (const op of input.recognizedOps) {
      if (!op.handlerBody || !op.handlerSource) continue;
      const events = collectEmitCalls(op.handlerBody, op.handlerSource);
      for (const [eventName, calls] of events) {
        for (const call of calls) {
          if (!emitIsInFailureBlock(call, op.handlerSource)) continue;
          out.push({
            id: randomUUID(),
            type: 'contract-drift',
            artifactRef: input.effectGroupRef,
            obligationKey: `Effect:${eventName} / forbidden-emission-on-failure`,
            severity: 'critical',
            filePath: op.filePath,
            lineStart: call.startPosition.row + 1,
            lineEnd: call.endPosition.row + 1,
            message:
              `Effect \`${eventName}\` is emitted from a code path that also ` +
              `returns a 4xx/5xx response on ${op.identity}. The spec forbids ` +
              `emission on failure responses.`,
            specSide: `forbid emission when-response-status [4xx, 5xx]`,
            codeSide: `emit \`${eventName}\` co-located with a 4xx/5xx response`,
          });
        }
      }
    }
  }

  return out;
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

/**
 * A call that sets a 4xx/5xx status:
 *   JS:     res.status(4xx) / res.status(5xx)
 *   Python: JSONResponse(status_code=4xx) / HTTPException(4xx | status_code=4xx)
 */
function callEmitsFailureStatus(call: SyntaxNode, source: string): boolean {
  const fn = call.childForFieldName('function');
  if (!fn) return false;
  const args = call.childForFieldName('arguments');
  if (!args) return false;

  // JS: <x>.status(NUM)
  if (isMember(fn) && memberProp(fn, source) === 'status') {
    const arg = args.namedChild(0);
    return !!arg && arg.type === 'number' && /^[45]\d{2}$/.test(source.slice(arg.startIndex, arg.endIndex));
  }

  // Python: JSONResponse(...) / HTTPException(...) with a 4xx/5xx status.
  const fnName = fn.type === 'identifier' ? source.slice(fn.startIndex, fn.endIndex)
    : isMember(fn) ? memberProp(fn, source) : '';
  if (fnName === 'JSONResponse' || fnName === 'HTTPException' || fnName === 'Response') {
    // keyword status_code=NUM
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
    // positional first arg (HTTPException(404, ...))
    const first = args.namedChild(0);
    if (first?.type === 'integer' && /^[45]\d{2}$/.test(source.slice(first.startIndex, first.endIndex))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Branch-skipping emit detection (used when emits are dynamic)
// ---------------------------------------------------------------------------

function handlerHasBranchSkippingEmit(body: SyntaxNode, source: string, branchKey: string): boolean {
  let found = false;
  const visit = (node: SyntaxNode): void => {
    if (found) return;
    if (node.type === 'if_statement') {
      const cond = node.childForFieldName('condition');
      const consequent = node.childForFieldName('consequence');
      const alternative = node.childForFieldName('alternative');
      if (cond && consequent && conditionMatchesLiteral(cond, source, branchKey)) {
        const consequentEmits = blockHasAnyEmit(consequent, source);
        const alternativeEmits = alternative ? blockHasAnyEmit(alternative, source) : false;
        if (!consequentEmits && alternativeEmits) { found = true; return; }
      }
    }
    for (const child of node.namedChildren) { visit(child); if (found) return; }
  };
  visit(body);
  return found;
}

function conditionMatchesLiteral(node: SyntaxNode, source: string, expected: string): boolean {
  const u = unwrapParens(node);
  // JS binary_expression === / == OR Python comparison_operator ==
  if (u.type === 'binary_expression') {
    const opNode = u.childForFieldName('operator');
    const op = opNode ? source.slice(opNode.startIndex, opNode.endIndex) : '';
    if (op !== '===' && op !== '==') return false;
    return literalIs(u.childForFieldName('left'), source, expected) || literalIs(u.childForFieldName('right'), source, expected);
  }
  if (u.type === 'comparison_operator') {
    const a = u.namedChild(0);
    const b = u.namedChild(1);
    if (!a || !b || source.slice(a.endIndex, b.startIndex).trim() !== '==') return false;
    return literalIs(a, source, expected) || literalIs(b, source, expected);
  }
  return false;
}

function literalIs(node: SyntaxNode | null, source: string, expected: string): boolean {
  return !!node && node.type === 'string' && strVal(node, source) === expected;
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
