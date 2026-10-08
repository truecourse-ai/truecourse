/**
 * The rows of the Claims view: every claim the workspace's newest scan read,
 * each joined to what the repositories say about it.
 *
 * A claim is the workspace's (the scan reads it out of a document), but what
 * stands behind it is a repository's: its flows, its tests, its dismissals. A
 * document read by several repositories gives each of them the same claim, so
 * the readings are joined by claim id and the status folds worst first: a
 * failure in one repository is never hidden behind a proof in another. A claim
 * no repository holds, because none reads its document or none has generated
 * flows since the scan read it, is Not linked: nothing was asked to prove it.
 *
 * Pure by construction: the caller reads the claims file and each repository
 * once and hands them in.
 */

import {
  worstCoverageStatus,
  type ClaimsFile,
  type ContextClaimRow,
  type ContextClaimsViewResponse,
  type GuardClaimsView,
  type GuardCoverageStatus,
  type GuardDismissedClaim,
} from '@truecourse/shared';

/** One repository's claims, as its own Claims read answers them. */
export interface ContextClaimReading {
  /** The repository's slug, which the client routes on. */
  repo: string;
  view: GuardClaimsView;
  /** The claim dismissals the repository's decisions ledger records. */
  dismissals: readonly GuardDismissedClaim[];
}

/** A claim some repository holds: its status is always a coverage status. */
type HeldClaim = ContextClaimRow & { status: GuardCoverageStatus };

/** The reason a Not linked claim gives. */
export const NOT_LINKED_CLAIM_REASON = 'No repository has generated flows from this claim yet.';

/** The scan's claims in its order, each folded across the repositories that hold it. */
export function composeContextClaims(
  file: ClaimsFile | null,
  readings: readonly ContextClaimReading[],
): ContextClaimsViewResponse {
  if (!file) return { extracted: false, claims: [], untestable: [] };
  const held = foldReadings(readings);
  const claims: ContextClaimRow[] = [];
  for (const claim of file.claims) {
    if (claim.testable !== true) continue;
    const row = held.get(claim.id);
    claims.push(
      row
        ? { ...row, statement: claim.statement }
        : {
            id: claim.id,
            doc: claim.doc,
            statement: claim.statement,
            sentences: claim.sentences,
            status: 'not-linked',
            reason: NOT_LINKED_CLAIM_REASON,
            dismissed: false,
            repositories: [],
            flows: [],
            scenarios: [],
          },
    );
  }
  return {
    extracted: true,
    claims,
    untestable: file.claims.flatMap((c) =>
      c.testable === true ? [] : [{ id: c.id, doc: c.doc, statement: c.statement, reason: c.testable.reason }],
    ),
  };
}

/** Every claim a repository holds, joined by id across the repositories. */
function foldReadings(readings: readonly ContextClaimReading[]): Map<string, HeldClaim> {
  const rows = new Map<string, HeldClaim>();
  for (const { repo, view, dismissals } of readings) {
    const dismissalById = new Map(dismissals.map((d) => [d.claimId, d]));
    for (const claim of view.claims) {
      const flows = claim.flows.map((flow) => ({ ...flow, repo }));
      const dismissal = dismissalById.get(claim.id);
      const prior = rows.get(claim.id);
      if (!prior) {
        rows.set(claim.id, { ...claim, repositories: [repo], flows, ...(dismissal ? { dismissal } : {}) });
        continue;
      }
      // The worse reading decides the status and owns the words behind it.
      const worse = worstCoverageStatus([prior.status, claim.status]) !== prior.status;
      rows.set(claim.id, {
        ...prior,
        ...(worse
          ? { status: claim.status, reason: claim.reason, needsSetup: claim.needsSetup, dismissed: claim.dismissed }
          : {}),
        repositories: [...prior.repositories, repo],
        flows: [...prior.flows, ...flows],
        scenarios: [...prior.scenarios, ...claim.scenarios],
        ...(prior.dismissal || !dismissal ? {} : { dismissal }),
      });
    }
  }
  return rows;
}
