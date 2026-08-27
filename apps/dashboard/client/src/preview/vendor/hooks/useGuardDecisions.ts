/**
 * The committable guard decisions (`scenarios/decisions.json`) as ONE state
 * object: what the user ruled out of testing, plus the writes that change it.
 *
 * TWO TIERS, and they are not interchangeable:
 *  - `dismissedFlows`, the MANUAL unit. A flow is a stable, spec-derived
 *    identity, so a dismissal keeps matching after a regenerate. The flow
 *    detail's "don't test this flow" ruling writes it, and the next generate
 *    drops the flow with its tests.
 *  - `dismissedClaims`, the finer, claim-level tier the test detail writes. A
 *    record marked `auto` was the TOOL's own call (triage), not the user's, and
 *    surfaces render that provenance rather than passing it off as a human
 *    judgment, hence {@link GuardDecisionsState.dismissalFor}, which hands back
 *    the record instead of a boolean.
 *
 * A TEST is never a dismissal unit: its id is generated, so a dismissal would
 * silently stop matching the moment the flow is re-authored.
 *
 * The write routes answer with the updated file, so a mutation lands the new
 * state without a follow-up GET. While `enabled` is false (guard reads are off,
 * or an unresolved PR scope) the hook neither reads nor writes: a ruling the user
 * could not have seen must never reach an overlay.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { EMPTY_GUARD_DECISIONS, dismissedClaimKey } from '@/preview/vendor/shared';
import type {
  GuardClaimIdentity,
  GuardDecisions,
  GuardDismissedClaim,
  GuardDismissedFlow,
} from '@/preview/vendor/shared';
import * as api from '@/preview/vendor/lib/api';

/** What a flow dismissal is written with: the id it keys on plus its display copy. */
export interface GuardFlowDismissalInput {
  flowId: string;
  title: string;
  note?: string;
}

export interface GuardDecisionsState {
  /** The recorded dismissal for this claim, or undefined, carries `auto`/`reason`. */
  dismissalFor: (claim: GuardClaimIdentity) => GuardDismissedClaim | undefined;
  /** Record the dismissal, the next generate rebuilds the flow without the claim. */
  dismiss: (claim: GuardClaimIdentity) => Promise<void>;
  /** Reverse it. */
  undismiss: (claim: GuardClaimIdentity) => Promise<void>;
  /** The recorded dismissal for this flow, or undefined. */
  flowDismissal: (flowId: string) => GuardDismissedFlow | undefined;
  /** Every dismissed flow id, what a list marks its rows from. */
  dismissedFlowIds: ReadonlySet<string>;
  /** Rule the whole flow out, the next generate drops it with its tests. */
  dismissFlow: (flow: GuardFlowDismissalInput) => Promise<void>;
  /** Reverse it. */
  undismissFlow: (flowId: string) => Promise<void>;
}

export function useGuardDecisions(
  repoId: string | undefined,
  enabled: boolean,
  reloadKey = 0,
  pr?: number,
): GuardDecisionsState {
  const [decisions, setDecisions] = useState<GuardDecisions>(EMPTY_GUARD_DECISIONS);

  useEffect(() => {
    if (!repoId || !enabled) return;
    let cancelled = false;
    // With `pr` (EE) the PR's overlay is merged over the repo row.
    api
      .getGuardDecisions(repoId, pr)
      .then((d) => !cancelled && setDecisions(d))
      .catch(() => !cancelled && setDecisions(EMPTY_GUARD_DECISIONS));
    return () => {
      cancelled = true;
    };
  }, [repoId, enabled, reloadKey, pr]);

  const claimsByKey = useMemo(
    () =>
      new Map(
        (decisions.dismissedClaims ?? []).map(
          (c) => [dismissedClaimKey(c.doc, c.anchor, c.title), c] as const,
        ),
      ),
    [decisions],
  );
  const flowsById = useMemo(
    () => new Map((decisions.dismissedFlows ?? []).map((f) => [f.flowId, f] as const)),
    [decisions],
  );

  // ONE write tail for both tiers: run the route, land the decisions it answers
  // with. A disabled hook writes nothing at all.
  const write = useCallback(
    async (run: (repoId: string, pr?: number) => Promise<GuardDecisions>) => {
      if (!repoId || !enabled) return;
      setDecisions(await run(repoId, pr));
    },
    [repoId, enabled, pr],
  );

  return useMemo<GuardDecisionsState>(
    () => ({
      dismissalFor: (claim) => claimsByKey.get(dismissedClaimKey(claim.doc, claim.anchor, claim.title)),
      dismiss: (claim) => write((id, p) => api.dismissGuardClaim(id, claim, p)),
      undismiss: (claim) => write((id, p) => api.undismissGuardClaim(id, claim, p)),
      flowDismissal: (flowId) => flowsById.get(flowId),
      dismissedFlowIds: new Set(flowsById.keys()),
      dismissFlow: (flow) => write((id, p) => api.dismissGuardFlow(id, flow, p)),
      undismissFlow: (flowId) => write((id, p) => api.undismissGuardFlow(id, flowId, p)),
    }),
    [claimsByKey, flowsById, write],
  );
}
