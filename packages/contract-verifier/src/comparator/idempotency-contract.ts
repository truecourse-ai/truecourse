/**
 * IdempotencyContract comparator. For each spec IdempotencyContract,
 * find every operation matched by its selector and verify the
 * corresponding code-side route reads the configured idempotency header
 * (directly in the handler, or via an upstream middleware).
 *
 * Selectors v1: `tag`, `path-glob`, `path-regex`, `method`, `operations`,
 * plus the compound combinators (`all-of`, `any-of`, `none-of`, `not`).
 */

import { randomUUID } from 'node:crypto';
import { minimatch } from './minimatch.js';
import type {
  ContractDrift,
  ArtifactRef,
  IdempotencyContractC,
  SelectorExpr,
  OperationContract,
} from '../types/index.js';
import type { ResolvedArtifact } from '../resolver/index.js';
import type { ExtractedOperation } from '../extractor/index.js';
import { routeKey } from '../extractor/idempotency-presence.js';

export interface IdempotencyCompareInput {
  idempotencyRef: ArtifactRef;
  contract: IdempotencyContractC;
  specOps: Map<string, ResolvedArtifact>;
  recognizedOps: ExtractedOperation[];
  /** Routes that ARE idempotency-protected (from detectIdempotencyPresence). */
  protectedRoutes: Set<string>;
}

export function compareIdempotency(input: IdempotencyCompareInput): ContractDrift[] {
  const out: ContractDrift[] = [];

  // Avoid double-flagging the same physical route — `applyMountPrefixes`
  // emits one ExtractedOperation per (route × mount-prefix variant). The
  // comparator only needs to flag the underlying declaration once.
  const seenRoutes = new Set<string>();
  for (const op of input.recognizedOps) {
    const specOp = input.specOps.get(op.identity);
    if (!specOp) continue;
    if (!matchesOperation(input.contract.selector, op, specOp)) continue;
    const rk = routeKey(op.filePath, op.declarationLine);
    if (input.protectedRoutes.has(rk)) continue;
    if (seenRoutes.has(rk)) continue;
    seenRoutes.add(rk);

    out.push({
      id: randomUUID(),
      type: 'contract-drift',
      artifactRef: input.idempotencyRef,
      obligationKey: `${op.identity}/missing-idempotency-key-handling`,
      severity: 'high',
      filePath: op.filePath,
      lineStart: op.declarationLine,
      lineEnd: op.declarationLine,
      message:
        `${op.identity} matches the idempotency contract but its handler chain ` +
        `does not read the \`${input.contract.requestHeader}\` header — repeat ` +
        `requests with the same key cannot short-circuit.`,
      specSide:
        `selector ${describeSelector(input.contract.selector)}, ` +
        `request-header ${input.contract.requestHeader}, ` +
        `semantics ${input.contract.semantics}`,
      codeSide: `route declared in ${op.filePath} with no idempotency-key handling on the handler chain`,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Selector matching (mirrors AuthRequirement)
// ---------------------------------------------------------------------------

function matchesOperation(
  sel: SelectorExpr,
  op: ExtractedOperation,
  specOp: ResolvedArtifact,
): boolean {
  switch (sel.kind) {
    case 'path-glob':
      return minimatch(op.contract.path, sel.pattern);
    case 'path-regex':
      try {
        return new RegExp(sel.pattern).test(op.contract.path);
      } catch {
        return false;
      }
    case 'method':
      return op.contract.method.toLowerCase() === sel.method.toLowerCase();
    case 'tag': {
      const tags = (specOp.contract as OperationContract | undefined)?.tags ?? [];
      return tags.includes(sel.tag);
    }
    case 'operations':
      return sel.ops.some(
        (r) => r.type === 'Operation' && r.identity === op.identity,
      );
    case 'all-of': return sel.children.every((c) => matchesOperation(c, op, specOp));
    case 'any-of': return sel.children.some((c) => matchesOperation(c, op, specOp));
    case 'none-of': return !sel.children.some((c) => matchesOperation(c, op, specOp));
    case 'not': return !matchesOperation(sel.child, op, specOp);
    default: return false;
  }
}

function describeSelector(sel: SelectorExpr): string {
  switch (sel.kind) {
    case 'path-glob': return `path-glob "${sel.pattern}"`;
    case 'path-regex': return `path-regex "${sel.pattern}"`;
    case 'method': return `method ${sel.method}`;
    case 'tag': return `tag ${sel.tag}`;
    case 'operations': return `operations [${sel.ops.length}]`;
    case 'all-of': return `all-of(${sel.children.length})`;
    case 'any-of': return `any-of(${sel.children.length})`;
    case 'none-of': return `none-of(${sel.children.length})`;
    case 'not': return `not(${describeSelector(sel.child)})`;
    default: return 'selector';
  }
}
