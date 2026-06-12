/**
 * AuthRequirement comparator. For each spec AuthRequirement artifact
 * with selector matching one or more operations, check that each
 * matched route's containing file is auth-protected (auth presence
 * detector reports it). Operations whose file is NOT protected drift.
 *
 * Supported selector forms: `path-glob`, `tag`, `operations [...]`,
 * plus the compound combinators (`all-of`, `any-of`, `none-of`, `not`).
 */

import { randomUUID } from 'node:crypto';
import { minimatch } from './minimatch.js';
import type {
  ContractDrift,
  ArtifactRef,
  AuthRequirementContract,
  SelectorExpr,
  OperationContract,
  SpecOrigin,
} from '../types/index.js';
import type { ResolvedArtifact } from '../resolver/index.js';
import type { ExtractedOperation } from '../extractor/index.js';

export interface AuthRequirementCompareInput {
  authRef: ArtifactRef;
  /** Spec-side origin of the auth-requirement artifact (source doc + section). */
  origin: SpecOrigin | null;
  contract: AuthRequirementContract;
  specOps: Map<string, ResolvedArtifact>;
  recognizedOps: ExtractedOperation[];
  /** Files whose router IS auth-protected (from detectAuthPresence). */
  protectedFiles: Set<string>;
}

export function compareAuthRequirement(input: AuthRequirementCompareInput): ContractDrift[] {
  const out: ContractDrift[] = [];

  for (const op of input.recognizedOps) {
    const specOp = input.specOps.get(op.identity);
    if (!specOp) continue;
    if (!matchesOperation(input.contract.selector, op, specOp)) continue;

    if (input.protectedFiles.has(op.filePath)) continue; // satisfied

    // `except` selectors — paths explicitly excluded from this requirement.
    if (input.contract.except?.some((ex) => matchesOperation(ex, op, specOp))) continue;

    out.push({
      id: randomUUID(),
      type: 'contract-drift',
      artifactRef: input.authRef,
      obligationKey: `${op.identity}/unprotected`,
      severity: 'critical',
      filePath: op.filePath,
      lineStart: op.declarationLine,
      lineEnd: op.declarationLine,
      message:
        `${op.identity} matches the auth requirement but its handler chain ` +
        `does not pass through any known auth middleware.`,
      specSide:
        `selector ${describeSelector(input.contract.selector)}, ` +
        `scheme ${input.contract.scheme}` +
        (input.contract.requiredRole ? ` (role ${input.contract.requiredRole})` : ''),
      codeSide: `route declared in ${op.filePath} without auth middleware on the mount chain`,
      specOrigin: input.origin ?? undefined,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Selector matching against an operation
// ---------------------------------------------------------------------------

function matchesOperation(
  sel: SelectorExpr,
  op: ExtractedOperation,
  specOp: ResolvedArtifact,
): boolean {
  switch (sel.kind) {
    case 'path-glob':
      return minimatch(op.contract.path, sel.pattern);
    case 'path-exact':
      return op.contract.path === sel.path;
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
        (r) =>
          r.type === 'Operation' &&
          r.identity === op.identity,
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
