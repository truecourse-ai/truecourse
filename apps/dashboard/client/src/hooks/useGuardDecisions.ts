/**
 * The stored guard decisions (materialized into a run as
 * `scenarios/decisions.json`) as ONE state object: what the user ruled out of
 * testing, plus the writes that change it.
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
 * state without a follow-up GET. While `enabled` is false (guard reads are off)
 * the hook neither reads nor writes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { EMPTY_GUARD_DECISIONS, dismissedClaimKey } from '@truecourse/shared';
import type {
  GuardClaimIdentity,
  GuardDecisions,
  GuardDismissedClaim,
  GuardDismissedFlow,
} from '@truecourse/shared';
import * as api from '@/lib/api';
import { EVENTS, trackEvent } from '@/lib/posthog';

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
): GuardDecisionsState {
  const [decisions, setDecisions] = useState<GuardDecisions>(EMPTY_GUARD_DECISIONS);

  useEffect(() => {
    if (!repoId || !enabled) return;
    let cancelled = false;
    api
      .getGuardDecisions(repoId)
      .then((d) => !cancelled && setDecisions(d))
      .catch(() => !cancelled && setDecisions(EMPTY_GUARD_DECISIONS));
    return () => {
      cancelled = true;
    };
  }, [repoId, enabled, reloadKey]);

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
  // with, and only then tell `wrote` the ruling stands. A disabled hook writes
  // nothing at all, and so reports nothing.
  const write = useCallback(
    async (run: (repoId: string) => Promise<GuardDecisions>, wrote?: () => void) => {
      if (!repoId || !enabled) return;
      setDecisions(await run(repoId));
      wrote?.();
    },
    [repoId, enabled],
  );

  return useMemo<GuardDecisionsState>(
    () => ({
      dismissalFor: (claim) => claimsByKey.get(dismissedClaimKey(claim.doc, claim.anchor, claim.title)),
      dismiss: (claim) =>
        write(
          (id) => api.dismissGuardClaim(id, claim),
          () => trackEvent(EVENTS.findingDismissed, { kind: 'claim', repoId }),
        ),
      undismiss: (claim) => write((id) => api.undismissGuardClaim(id, claim)),
      flowDismissal: (flowId) => flowsById.get(flowId),
      dismissedFlowIds: new Set(flowsById.keys()),
      dismissFlow: (flow) =>
        write(
          (id) => api.dismissGuardFlow(id, flow),
          () => trackEvent(EVENTS.findingDismissed, { kind: 'flow', repoId }),
        ),
      undismissFlow: (flowId) => write((id) => api.undismissGuardFlow(id, flowId)),
    }),
    [claimsByKey, flowsById, repoId, write],
  );
}
