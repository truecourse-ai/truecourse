/**
 * PaginationContract comparator. Walks operations whose tag matches the
 * pagination contract's selector and checks:
 *
 *   1. `forbids` query-param violations — code reads `req.query.<name>`
 *      where `<name>` is in the spec's forbid list.
 *   2. `limit.max` clamping — spec says `limit: max N`, code must apply
 *      a `Math.min(<*>, N)` clamp on the limit param.
 *
 * Selector matching: v1 supports `selector { tag: <name> }`. The spec's
 * Operation contract carries `tags: string[]`, so we check membership.
 */

import { randomUUID } from 'node:crypto';
import type {
  ContractDrift,
  ArtifactRef,
  OperationContract,
  PaginationContractC,
  SelectorExpr,
} from '../types/index.js';
import type { ResolvedArtifact } from '../resolver/index.js';
import type { ExtractedOperation } from '../extractor/index.js';

export interface PaginationCompareInput {
  paginationRef: ArtifactRef;
  contract: PaginationContractC;
  /** Spec-side Operations indexed by their identity. */
  specOps: Map<string, ResolvedArtifact>;
  /** Code-side operations to check. */
  recognizedOps: ExtractedOperation[];
}

export function comparePagination(input: PaginationCompareInput): ContractDrift[] {
  const out: ContractDrift[] = [];

  for (const op of input.recognizedOps) {
    const specOp = input.specOps.get(op.identity);
    if (!specOp) continue;
    const specContract = specOp.contract as OperationContract | undefined;
    if (!specContract || !matchesSelector(input.contract.selector, specContract.tags ?? [])) continue;

    // (1) forbids — query-param reads.
    for (const f of input.contract.forbids) {
      if (f.kind !== 'query-param') continue;
      const name = String(f.value);
      if (op.observed.queryParams.includes(name)) {
        out.push({
          id: randomUUID(),
          type: 'contract-drift',
          artifactRef: input.paginationRef,
          obligationKey: `${op.identity}/forbid.query-param-${name}`,
          severity: 'critical',
          filePath: op.filePath,
          lineStart: op.declarationLine,
          lineEnd: op.declarationLine,
          message:
            `Pagination contract forbids query parameter \`${name}\` on paginated operations. ` +
            `Implementation reads \`req.query.${name}\`.`,
          specSide: `forbid query-param ${name}`,
          codeSide: `req.query.${name}`,
        });
      }
    }

    // (2) limit clamp — spec says `max N`; code must clamp via Math.min.
    const limitParam = input.contract.query.find((p) => p.name === 'limit');
    if (limitParam?.max !== undefined) {
      const seen = op.observed.numericClamps.includes(limitParam.max);
      if (!seen) {
        out.push({
          id: randomUUID(),
          type: 'contract-drift',
          artifactRef: input.paginationRef,
          obligationKey: `${op.identity}/limit.max-${limitParam.max}-not-clamped`,
          severity: 'critical',
          filePath: op.filePath,
          lineStart: op.declarationLine,
          lineEnd: op.declarationLine,
          message:
            `Pagination contract requires clamping \`limit\` to at most ${limitParam.max}. ` +
            `Implementation does not apply \`Math.min(_, ${limitParam.max})\`.`,
          specSide: `limit: max ${limitParam.max}, on-above-max clamp`,
          codeSide: op.observed.hasClampCall
            ? `Math.min observed but with different bound (${op.observed.numericClamps.join(', ')})`
            : `no Math.min clamp on the limit value`,
        });
      }
    }
  }

  return out;
}

function matchesSelector(sel: SelectorExpr, tags: string[]): boolean {
  switch (sel.kind) {
    case 'tag': return tags.includes(sel.tag);
    case 'all-of': return sel.children.every((c) => matchesSelector(c, tags));
    case 'any-of': return sel.children.some((c) => matchesSelector(c, tags));
    case 'none-of': return !sel.children.some((c) => matchesSelector(c, tags));
    case 'not': return !matchesSelector(sel.child, tags);
    default: return false; // path-glob/method/etc.: handled when we extend
  }
}
