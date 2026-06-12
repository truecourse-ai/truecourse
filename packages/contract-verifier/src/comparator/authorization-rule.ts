/**
 * AuthorizationRule comparator. For each operation in `appliesTo`,
 * look for a per-row authorization check that matches the rule's
 * predicate. If absent → IDOR-class drift.
 *
 * The contract stores the predicate as an opaque string (Phase-4 doesn't
 * yet parse predicate expressions). The comparator performs a *signature*
 * match: the predicate references `request.auth` and a resource
 * member-access (`loaded.<Entity>.<field>`); the comparator looks for a
 * binary equality / inequality in the handler involving (a) a `req.auth*`
 * member-access AND (b) a member-access on a resource-like variable.
 * Conservative — false negatives possible, false positives not.
 *
 * Tree-lifetime: this comparator used to walk `op.handlerBody`
 * (`SyntaxNode`) directly. That kept tree-sitter WASM allocations alive
 * across the whole verify run and crashed large monorepos. The handler
 * is now scanned eagerly in `extractor/handler-facts.ts`, which emits
 * every equality with an auth-side ref as
 * `op.ownershipCheckCandidates: Array<{ resourceField, line }>`. This
 * comparator just checks whether any candidate's `resourceField` matches
 * the contract's parsed field name.
 */

import { randomUUID } from 'node:crypto';
import type {
  ContractDrift,
  ArtifactRef,
  AuthorizationRuleContract,
  SpecOrigin,
} from '../types/index.js';
import type { ExtractedOperation } from '../extractor/index.js';

export interface AuthorizationRuleCompareInput {
  authzRef: ArtifactRef;
  /** Spec-side origin of the authorization-rule artifact (source doc + section). */
  origin: SpecOrigin | null;
  contract: AuthorizationRuleContract;
  recognizedOps: ExtractedOperation[];
}

export function compareAuthorizationRule(
  input: AuthorizationRuleCompareInput,
): ContractDrift[] {
  const out: ContractDrift[] = [];

  const targets = new Set(
    input.contract.appliesTo.operations.map((r) => r.identity),
  );
  if (targets.size === 0) return out;

  // Pull the resource field name out of the predicate string. The DSL
  // form we author looks like:
  //   request.auth.userId == loaded.Order.customerId
  // The comparator extracts `customerId` (the resource field) and
  // requires an ownership-check candidate in the handler that touches
  // `req.auth*` and `<x>.customerId`.
  const fieldName = parseResourceField(input.contract.predicate);
  if (!fieldName) return out;

  for (const op of input.recognizedOps) {
    if (!targets.has(op.identity)) continue;
    // No candidates extracted (handler body wasn't resolved at extraction
    // time) — treat as inconclusive rather than fire a drift, matching
    // the prior behavior where missing handlerBody was a `continue`.
    if (!op.ownershipCheckCandidates) continue;

    if (op.ownershipCheckCandidates.some((c) => c.resourceField === fieldName)) continue;

    out.push({
      id: randomUUID(),
      type: 'contract-drift',
      artifactRef: input.authzRef,
      obligationKey: `${op.identity} / missing-ownership-check`,
      severity: 'critical',
      filePath: op.filePath,
      lineStart: op.declarationLine,
      lineEnd: op.declarationLine,
      message:
        `${op.identity} is governed by AuthorizationRule \`${input.authzRef.identity}\` ` +
        `(predicate: ${JSON.stringify(input.contract.predicate)}), but the handler does ` +
        `not perform any ownership check on the loaded resource's \`${fieldName}\` field.`,
      specSide: `predicate "${input.contract.predicate}"` + (input.contract.except?.role ? ` except role ${input.contract.except.role}` : ''),
      codeSide: `no ownership comparison involving \`req.auth*\` and \`*.${fieldName}\` found in handler`,
      specOrigin: input.origin ?? undefined,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Predicate parsing — find the resource field name (e.g. `customerId`)
// ---------------------------------------------------------------------------

function parseResourceField(predicate: string): string | null {
  // Pattern: `loaded.<Entity>.<field>` — pull the trailing identifier.
  const m = predicate.match(/loaded\.[A-Za-z_][\w]*\.([A-Za-z_][\w]*)/);
  if (m) return m[1];
  return null;
}
