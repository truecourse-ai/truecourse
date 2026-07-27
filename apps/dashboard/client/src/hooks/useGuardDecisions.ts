/**
 * The committable guard decisions (`scenarios/decisions.json`) as ONE state
 * object: which claims the user ruled out of testing, plus the two writes that
 * change that. The test detail's "don't test this claim" action is the only
 * writer — a claim ruled out here is skipped by the next `guard generate`, which
 * rebuilds its flow without it.
 *
 * The write routes answer with the updated file, so a mutation lands the new
 * state without a follow-up GET. While `enabled` is false (guard reads are off,
 * or an unresolved PR scope) the hook neither reads nor writes: a ruling the user
 * could not have seen must never reach an overlay.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { dismissedClaimKey } from '@truecourse/shared';
import type { GuardClaimIdentity, GuardDecisions, GuardDismissedClaim } from '@truecourse/shared';
import * as api from '@/lib/api';

export interface GuardDecisionsState {
  /** True when this claim is already recorded as dismissed. */
  isDismissed: (claim: GuardClaimIdentity) => boolean;
  /** Record the dismissal — the next generate rebuilds the flow without the claim. */
  dismiss: (claim: GuardClaimIdentity) => Promise<void>;
  /** Reverse it. */
  undismiss: (claim: GuardClaimIdentity) => Promise<void>;
}

type ClaimWriter = (
  repoId: string,
  claim: GuardClaimIdentity,
  pr?: number,
) => Promise<GuardDecisions>;

export function useGuardDecisions(
  repoId: string | undefined,
  enabled: boolean,
  reloadKey = 0,
  pr?: number,
): GuardDecisionsState {
  const [claims, setClaims] = useState<GuardDismissedClaim[]>([]);

  useEffect(() => {
    if (!repoId || !enabled) return;
    let cancelled = false;
    // With `pr` (EE) the PR's overlay is merged over the repo row.
    api
      .getGuardDecisions(repoId, pr)
      .then((d) => !cancelled && setClaims(d.dismissedClaims ?? []))
      .catch(() => !cancelled && setClaims([]));
    return () => {
      cancelled = true;
    };
  }, [repoId, enabled, reloadKey, pr]);

  const keys = useMemo(
    () => new Set(claims.map((c) => dismissedClaimKey(c.doc, c.anchor, c.title))),
    [claims],
  );

  const write = useCallback(
    async (claim: GuardClaimIdentity, writer: ClaimWriter) => {
      if (!repoId || !enabled) return;
      const updated = await writer(repoId, claim, pr);
      setClaims(updated.dismissedClaims ?? []);
    },
    [repoId, enabled, pr],
  );

  return useMemo<GuardDecisionsState>(
    () => ({
      isDismissed: (claim) => keys.has(dismissedClaimKey(claim.doc, claim.anchor, claim.title)),
      dismiss: (claim) => write(claim, api.dismissGuardClaim),
      undismiss: (claim) => write(claim, api.undismissGuardClaim),
    }),
    [keys, write],
  );
}
