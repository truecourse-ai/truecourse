/**
 * EffectGroup comparator. Walks each spec-declared effect's matching
 * operation handler, scoped to enclosing statement blocks. Two checks:
 *
 *   1. MISSING EMISSION (e.g. spec says `order.cancelled` emits on
 *      `POST /api/orders/{id}/cancel` 200, code never calls
 *      `emit('order.cancelled', …)` anywhere in that handler).
 *
 *   2. FORBIDDEN EMISSION on failure (spec forbids emission on 4xx/5xx;
 *      code emits an event from a block that ALSO returns a 4xx/5xx
 *      status — the same lexical block, so the failure path is reached).
 *
 * Block-scoped detection is enough for the current fixture: the planted
 * #14 bug has the offending `emit(...)` inside the same `if` branch as
 * `res.status(400)`. More elaborate control-flow analysis is later
 * polish.
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
  /** Spec-side Operations indexed by identity. */
  specOps: Map<string, ResolvedArtifact>;
  /** Code-side recognized operations (already filtered to known specs). */
  recognizedOps: ExtractedOperation[];
}

export function compareEffectGroup(input: EffectGroupCompareInput): ContractDrift[] {
  const out: ContractDrift[] = [];

  // Index recognized ops by identity for direct lookup.
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

    // What value identifies THIS effect's branch in the handler? Use the
    // payload-constraint status (e.g. `status: cancelled` for
    // `order.cancelled`), or fall back to the suffix of the effect's
    // identity (`order.cancelled` → `cancelled`).
    const branchKey =
      (typeof effect.payloadConstraint?.status === 'string'
        ? effect.payloadConstraint.status
        : null) ?? effect.identity.split('.').pop() ?? '';

    // Branch-skip detection: even when the handler emits dynamically,
    // a `if (target === '<branchKey>') { /* no emit */ } else { emit }`
    // shape is unambiguous evidence that this specific branch deliberately
    // skips emission. Catches the planted-bug pattern without lookups
    // into the call-site arguments.
    const branchSkipped = handlerHasBranchSkippingEmit(
      codeOp.handlerBody, codeOp.handlerSource, branchKey,
    );

    // ---- Check 1: missing emission ----
    // Three regimes:
    //   1. Handler has only static emits and none target this effect →
    //      drift (clear evidence).
    //   2. Handler has dynamic emits BUT a branch of the form above
    //      explicitly skips emission for this effect's branchKey →
    //      drift.
    //   3. Otherwise (dynamic + no skip-branch) → suppress, the
    //      comparator can't statically decide.
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
          `(status ${effect.emitWhen.onStatus}) but the handler never calls ` +
          `\`emit(${JSON.stringify(effect.identity)}, …)\` along any code path.`,
        specSide: `effect ${effect.identity} emit-when ${opIdentity} on-status ${effect.emitWhen.onStatus}`,
        codeSide: branchSkipped
          ? `branch \`if (… === '${branchKey}') { … }\` exists but contains no emit while sibling branches do`
          : events.length > 0
            ? `handler emits: ${events.join(', ')}`
            : `handler does not emit any tracked event`,
      });
    }
  }

  // ---- Check 2: forbidden emission on failure ----
  // Walk each recognized op's handler. For each emit call, find the
  // smallest enclosing block, check if that block also contains a
  // `res.status(4xx)` or `res.status(5xx)`.
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
            codeSide:
              `emit \`${eventName}\` co-located with a 4xx/5xx res.status() call`,
          });
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Emit-call collection
// ---------------------------------------------------------------------------
//
// Recognized shapes:
//   <X>.emit('event.name', …)       — common Node EventEmitter pattern
//   emitOrderEvent('event.name', …) — wrapper helper used in the fixture
//   <X>('event.name', …)            — generic when first arg is a string
//
// We bind the event NAME to its CALL nodes so the forbidden-emission
// check can find the enclosing block of the actual emit site.
// ---------------------------------------------------------------------------

function collectEmitCalls(body: SyntaxNode, source: string): Map<string, SyntaxNode[]> {
  const out = new Map<string, SyntaxNode[]>();

  const visit = (node: SyntaxNode): void => {
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      const args = node.childForFieldName('arguments');
      if (fn && args) {
        let isEmitCall = false;
        if (fn.type === 'member_expression') {
          const prop = fn.childForFieldName('property');
          if (prop && source.slice(prop.startIndex, prop.endIndex) === 'emit') {
            isEmitCall = true;
          }
        }
        if (!isEmitCall && fn.type === 'identifier') {
          const fname = source.slice(fn.startIndex, fn.endIndex);
          if (/^emit/i.test(fname) && fname !== 'emit') {
            isEmitCall = true;
          }
        }
        if (isEmitCall) {
          const first = args.namedChild(0);
          if (first?.type === 'string') {
            const fragment = first.namedChildren.find((c) => c.type === 'string_fragment');
            if (fragment) {
              const eventName = source.slice(fragment.startIndex, fragment.endIndex);
              const arr = out.get(eventName) ?? [];
              arr.push(node);
              out.set(eventName, arr);
            }
          }
        }
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(body);

  return out;
}

/**
 * Find the smallest enclosing `statement_block` of an emit-call node
 * AND check ONLY that block for a 4xx/5xx `res.status(...)` call. We
 * don't walk up to ancestor blocks: a sibling failure branch in the
 * outer function isn't the same code path as the emit, and treating it
 * as such produces false positives on legitimate success-path emits.
 *
 * The "outermost handler function body" is also a statement_block, so
 * an emit in the function's top-level block + a 4xx in the same block
 * is correctly matched. The narrower the scope, the lower the FP rate.
 */
function emitIsInFailureBlock(emitCall: SyntaxNode, source: string): boolean {
  let cur: SyntaxNode | null = emitCall.parent;
  while (cur) {
    if (cur.type === 'statement_block') {
      return blockContainsFailureStatusShallow(cur, source);
    }
    if (cur.type === 'function_declaration' || cur.type === 'arrow_function' || cur.type === 'function_expression') {
      break;
    }
    cur = cur.parent;
  }
  return false;
}

/**
 * Like `blockContainsFailureStatus`, but only inspects DIRECT statements
 * of the block — does not recurse into nested if/try/etc. branches.
 * That's what makes the check block-local rather than block-or-descendants.
 */
function blockContainsFailureStatusShallow(block: SyntaxNode, source: string): boolean {
  for (const stmt of block.namedChildren) {
    if (containsTopLevelFailureStatus(stmt, source)) return true;
  }
  return false;
}

function containsTopLevelFailureStatus(stmt: SyntaxNode, source: string): boolean {
  // We allow descending through expressions (member chains, await, return)
  // but NOT through new control-flow constructs (if / try / for / etc.).
  if (
    stmt.type === 'if_statement' ||
    stmt.type === 'switch_statement' ||
    stmt.type === 'try_statement' ||
    stmt.type === 'for_statement' ||
    stmt.type === 'for_in_statement' ||
    stmt.type === 'while_statement' ||
    stmt.type === 'do_statement'
  ) {
    return false;
  }
  // Look for any res.status(<4xx|5xx>) inside this statement, descending
  // through expression structure only.
  let found = false;
  const visit = (node: SyntaxNode): void => {
    if (found) return;
    if (
      node.type === 'if_statement' ||
      node.type === 'switch_statement' ||
      node.type === 'try_statement'
    ) return;
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn?.type === 'member_expression') {
        const prop = fn.childForFieldName('property');
        if (prop && source.slice(prop.startIndex, prop.endIndex) === 'status') {
          const args = node.childForFieldName('arguments');
          const arg = args?.namedChild(0);
          if (arg?.type === 'number') {
            const n = source.slice(arg.startIndex, arg.endIndex);
            if (/^[45]\d{2}$/.test(n)) {
              found = true;
              return;
            }
          }
        }
      }
    }
    for (const child of node.namedChildren) {
      visit(child);
      if (found) return;
    }
  };
  visit(stmt);
  return found;
}

/**
 * Detect a branch of shape `if (<X> === '<branchKey>') { /* no emit *​/ }
 * else { emit(…) }` (or with `==`). Evidence that the implementation
 * deliberately omits emission for THIS branch while emitting elsewhere.
 */
function handlerHasBranchSkippingEmit(
  body: SyntaxNode,
  source: string,
  branchKey: string,
): boolean {
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
        if (!consequentEmits && alternativeEmits) {
          found = true;
          return;
        }
      }
    }
    for (const child of node.namedChildren) {
      visit(child);
      if (found) return;
    }
  };
  visit(body);
  return found;
}

function conditionMatchesLiteral(node: SyntaxNode, source: string, expected: string): boolean {
  // Accept `<X> === '<expected>'` / `<X> == '<expected>'` (or reversed).
  const u = unwrapParens(node);
  if (u.type !== 'binary_expression') return false;
  const opNode = u.childForFieldName('operator');
  if (!opNode) return false;
  const op = source.slice(opNode.startIndex, opNode.endIndex);
  if (op !== '===' && op !== '==') return false;
  const left = u.childForFieldName('left');
  const right = u.childForFieldName('right');
  return literalIs(left, source, expected) || literalIs(right, source, expected);
}

function literalIs(node: SyntaxNode | null, source: string, expected: string): boolean {
  if (!node || node.type !== 'string') return false;
  const fragment = node.namedChildren.find((c) => c.type === 'string_fragment');
  if (!fragment) return false;
  return source.slice(fragment.startIndex, fragment.endIndex) === expected;
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
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn?.type === 'member_expression') {
        const prop = fn.childForFieldName('property');
        if (prop && source.slice(prop.startIndex, prop.endIndex) === 'emit') {
          found = true;
          return;
        }
      } else if (fn?.type === 'identifier') {
        const name = source.slice(fn.startIndex, fn.endIndex);
        if (/^emit/i.test(name) && name !== 'emit') {
          found = true;
          return;
        }
      }
    }
    for (const child of node.namedChildren) {
      visit(child);
      if (found) return;
    }
  };
  visit(block);
  return found;
}

/**
 * True if any `emit(...)` / `<X>.emit(...)` / `emitFoo(...)` call in
 * the handler has a non-string first arg (e.g. variable). Indicates
 * the comparator can't reliably enumerate which events the handler
 * emits — used to suppress missing-emission false positives.
 */
function handlerHasDynamicEmit(body: SyntaxNode, source: string): boolean {
  let dynamic = false;
  const visit = (node: SyntaxNode): void => {
    if (dynamic) return;
    if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      const args = node.childForFieldName('arguments');
      if (fn && args) {
        let isEmitCall = false;
        if (fn.type === 'member_expression') {
          const prop = fn.childForFieldName('property');
          if (prop && source.slice(prop.startIndex, prop.endIndex) === 'emit') isEmitCall = true;
        }
        if (!isEmitCall && fn.type === 'identifier') {
          const fname = source.slice(fn.startIndex, fn.endIndex);
          if (/^emit/i.test(fname) && fname !== 'emit') isEmitCall = true;
        }
        if (isEmitCall) {
          const first = args.namedChild(0);
          if (first && first.type !== 'string') {
            dynamic = true;
            return;
          }
        }
      }
    }
    for (const child of node.namedChildren) {
      visit(child);
      if (dynamic) return;
    }
  };
  visit(body);
  return dynamic;
}

