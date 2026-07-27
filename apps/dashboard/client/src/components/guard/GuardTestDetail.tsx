/**
 * A TEST as an ENTITY — its LATEST state, the one standalone destination every
 * route that names a test lands on (a flow's test row, a run instance's "open this
 * test", a `?gtest=` link).
 *
 * The screen itself is {@link GuardTestView}, shared with the Runs tab's instance
 * view; this adapter feeds it the entity's data and the ONE ruling a reader can
 * make here: on a FAILING result, "don't test this claim" writes the claim behind
 * the failing milestone into `scenarios/decisions.json`, and the next generate
 * rebuilds the flow without it. A passing test offers nothing — there is nothing
 * to rule on.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Ban } from 'lucide-react';
import type {
  GuardClaimIdentity,
  GuardFlowMilestoneView,
  GuardFlowScenarioRow,
  GuardJourneyRow,
} from '@truecourse/shared';
import type { GuardDecisionsState } from '@/hooks/useGuardDecisions';
import { HoverPopover } from '@/components/ui/hover-popover';
import { guardTestStatusView } from '@/lib/guard-flow-status';
import { type GuardTestRow } from '@/lib/guard-tests';
import { GuardTestView, type GuardEvidenceRef, type GuardTestViewModel } from './GuardTestView';

const BTN =
  'inline-flex max-w-full items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground';

/**
 * The claim this test's FAILING result is about: the flow milestone the failing
 * step realized. A step with no milestone recorded still resolves when the flow
 * binds exactly one milestone to the test's own section — unambiguous, so it is
 * the same claim. Anything less certain resolves to null and the action hides
 * (a hand-written test has no claim at all).
 */
function failingClaim(
  test: GuardTestRow,
  row: GuardFlowScenarioRow | null,
  milestones: readonly GuardFlowMilestoneView[],
): GuardClaimIdentity | null {
  const failed = row?.failedMilestone;
  const bound = milestones.filter((m) => m.doc === test.doc && m.anchor === test.anchor);
  const milestone =
    failed != null ? milestones.find((m) => m.order === failed) : bound.length === 1 ? bound[0] : undefined;
  return milestone ? { doc: milestone.doc, anchor: milestone.anchor, title: milestone.claimTitle } : null;
}

export function GuardTestDetail({
  repoId,
  test,
  row,
  runId,
  journeys,
  flowGoal,
  milestones = [],
  decisions,
  onOpenFlow,
  onOpenJourney,
  onOpenSpec,
}: {
  repoId: string;
  /** The inventory row — identity, title, surface, and the flow it belongs to. */
  test: GuardTestRow;
  /** The flow-join row (result, failure, evidence, journey path); null while loading. */
  row: GuardFlowScenarioRow | null;
  /** The run the outcome came from (evidence lives under it); null when never run. */
  runId: string | null;
  /** The mapped catalog, for the journeys this test drives; null = unmapped. */
  journeys: GuardJourneyRow[] | null;
  /** The flow's one-line goal — what this test is ultimately checking. */
  flowGoal?: string;
  /** The flow's milestone chain — resolves the claim behind a failing result. */
  milestones?: readonly GuardFlowMilestoneView[];
  /** The dismissals state; omitted (guard reads off / PR scope unresolved) = no action. */
  decisions?: GuardDecisionsState;
  onOpenFlow: (flowId: string) => void;
  onOpenJourney: (journeyId: string) => void;
  onOpenSpec: (doc: string, section: string) => void;
}) {
  const [ruling, setRuling] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const view = row
    ? guardTestStatusView({ status: row.status, ...(row.stage ? { stage: row.stage } : {}) })
    : test.status;

  // The ruling is offered on a failing result only, and only when the claim
  // behind it resolves — never a guess about which claim the reader meant.
  const claim = useMemo(() => failingClaim(test, row, milestones), [test, row, milestones]);
  const action = view.plain === 'failing' && claim && decisions ? { claim, decisions } : null;
  const dismissed = action ? action.decisions.isDismissed(action.claim) : false;
  const rule = async (write: (claim: GuardClaimIdentity) => Promise<void>) => {
    if (!action) return;
    setRuling(true);
    try {
      await write(action.claim);
    } finally {
      if (mounted.current) setRuling(false);
    }
  };

  // A BIRTH failure's transcript is addressed by its stored path (no run wrote
  // it); a run's transcript is addressed by run + test id.
  const evidence: GuardEvidenceRef | null =
    row?.stage === 'birth' && row.evidencePath
      ? { kind: 'birth', path: row.evidencePath }
      : row?.hasEvidence === true && runId != null && row.stage !== 'birth'
        ? { kind: 'run', runId }
        : null;

  const model: GuardTestViewModel = {
    id: test.id,
    title: test.title,
    ...(test.surface ? { surface: test.surface } : {}),
    status: view,
    provenance: 'Latest state',
    ...(row?.durationMs != null ? { durationMs: row.durationMs } : {}),
    ...(row?.failure ? { failure: row.failure } : {}),
    ...(row?.failedMilestone != null ? { failedMilestone: row.failedMilestone } : {}),
    ...(claim ? { failedMilestoneClaim: claim.title } : {}),
    // The chain the step list is grouped under — each section headed by the claim
    // its steps realize.
    milestones,
    ...(row?.journeyDrifted ? { journeyDrifted: true } : {}),
    ...(flowGoal ? { goal: flowGoal } : {}),
    flow: { id: test.flowId, title: test.flowTitle },
    binds: {
      doc: test.doc,
      section: test.anchor,
      ...(test.headingText ? { headingText: test.headingText } : {}),
    },
    journeyPath: row?.journeyPath ?? [],
    evidence,
  };

  return (
    <GuardTestView
      repoId={repoId}
      test={model}
      journeys={journeys}
      onOpenFlow={onOpenFlow}
      onOpenJourney={onOpenJourney}
      onOpenSpec={onOpenSpec}
      notes={
        row != null && !row.outcome && row.stage !== 'birth' ? (
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            The last run has no result for this test — run{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">truecourse guard run</code> to test it.
          </p>
        ) : null
      }
      action={
        action ? (
          dismissed ? (
            <p className="mt-3 text-[11px] text-muted-foreground">
              This claim is dismissed —{' '}
              <button
                type="button"
                disabled={ruling}
                onClick={() => void rule(action.decisions.undismiss)}
                className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
              >
                undo
              </button>
            </p>
          ) : (
            <div className="mt-3">
              <HoverPopover portal
                align="start"
                width="wide"
                content="Removes this claim from testing. The next generate rebuilds the flow without it and deletes this test."
              >
                <button
                  type="button"
                  disabled={ruling}
                  onClick={() => void rule(action.decisions.dismiss)}
                  className={`${BTN} disabled:opacity-50`}
                >
                  <Ban className="h-3 w-3 shrink-0" />
                  Don&apos;t test this claim
                </button>
              </HoverPopover>
            </div>
          )
        ) : null
      }
    />
  );
}
