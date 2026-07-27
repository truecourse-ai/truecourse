/**
 * A TEST as an INSTANCE — how it ran in THIS run.
 *
 * The screen is {@link GuardTestView}, the same one the Tests tab shows; only the
 * feed differs (this run's result) and the provenance line says so. It opens IN
 * PLACE: a run is history, so its evidence stays where the run put it and the
 * reader is never navigated away from the run to read it. An "open this test →"
 * link goes to the test's own home when they want its current state instead.
 *
 * The run-scoped chrome this view adds is the FLOW INSTANCE: when the run joined a
 * flow, the milestone chain in execution paint (green up to the failure, red at
 * `failedMilestone`, grey after — neutral throughout when the failure names no
 * milestone) leads the body. Read-only; the tab strip owns the close, and
 * drift-vs-bug is the developer's call, never resolved here.
 */

import { ArrowUpRight } from 'lucide-react';
import type { GuardJourneyRow, GuardRunFlow, GuardScenarioResult } from '@truecourse/shared';
import { guardTestStatusView } from '@/lib/guard-flow-status';
import { runPaintNodes } from '@/lib/guard-flow-paint';
import { GuardMilestoneGraph } from './GuardMilestoneGraph';
import { GuardTestView, type GuardTestViewModel } from './GuardTestView';

const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';

export function GuardDriftDetail({
  repoId,
  scenario,
  runId,
  runFlow = null,
  journeys = null,
  onOpenSpec,
  onOpenTest,
}: {
  repoId: string;
  scenario: GuardScenarioResult;
  runId: string;
  /** The flow this result instantiates, joined onto the run payload (`runFlows`). */
  runFlow?: GuardRunFlow | null;
  /** The mapped catalog, when the view has one; null = unmapped. */
  journeys?: GuardJourneyRow[] | null;
  onOpenSpec: (doc: string, section: string) => void;
  /** Jump to the test's own home (the Tests tab). Omitted in read-only embeds. */
  onOpenTest?: (testId: string) => void;
}) {
  // A run result is an instance of its flow — paint the chain when the run joined one.
  const showFlowInstance = runFlow != null && runFlow.milestones.length > 0;
  const milestoneNodes = showFlowInstance
    ? runPaintNodes(runFlow.milestones, scenario.outcome, scenario.failedMilestone)
    : [];
  const failedMilestone = showFlowInstance
    ? runFlow.milestones.find((m) => m.order === scenario.failedMilestone)
    : undefined;

  const model: GuardTestViewModel = {
    id: scenario.id,
    title: scenario.title,
    status: guardTestStatusView({ status: scenario.outcome, stage: 'run' }),
    provenance: `As of run ${runId}`,
    durationMs: scenario.durationMs,
    ...(scenario.failure ? { failure: scenario.failure } : {}),
    ...(scenario.failedMilestone != null ? { failedMilestone: scenario.failedMilestone } : {}),
    ...(failedMilestone ? { failedMilestoneClaim: failedMilestone.claimTitle } : {}),
    // The chain the step list is grouped under — each section headed by the claim
    // its steps realize.
    ...(runFlow ? { milestones: runFlow.milestones } : {}),
    ...(scenario.journeyDrifted ? { journeyDrifted: true } : {}),
    ...(runFlow?.goal ? { goal: runFlow.goal } : {}),
    ...(runFlow ? { flow: { id: runFlow.flowId, title: runFlow.title } } : {}),
    binds: {
      doc: scenario.binds.doc,
      section: scenario.binds.section,
      fingerprint: scenario.binds.fingerprint,
    },
    journeyPath: [],
    // Any executed outcome that captured a transcript renders it — passes
    // included. A non-executed stale/orphaned, or an older pass without one, has
    // no evidencePath, so no evidence section renders.
    evidence: scenario.evidencePath != null ? { kind: 'run', runId } : null,
  };

  return (
    <GuardTestView
      repoId={repoId}
      test={model}
      journeys={journeys}
      onOpenSpec={onOpenSpec}
      headerAction={
        onOpenTest ? (
          // This pane is THIS RUN's record. The test's own home is one click away
          // — never the default, or a reader loses the run they came to read.
          <button
            type="button"
            onClick={() => onOpenTest(scenario.id)}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            open this test
            <ArrowUpRight className="h-3 w-3" />
          </button>
        ) : null
      }
      notes={
        <>
          {scenario.remappedTo && (
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              Section re-anchored to <code className="text-foreground">{scenario.remappedTo}</code>
            </p>
          )}
          {scenario.currentFingerprint && (
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              Section text changed since generation (stale binding).
            </p>
          )}
          {scenario.outcome === 'stale' && !scenario.failure && (
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              The bound section was edited since this test was written — regenerate to re-anchor it.
            </p>
          )}
          {scenario.outcome === 'orphaned' && !scenario.failure && (
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              The bound section no longer exists in the spec — the test was not run.
            </p>
          )}
        </>
      }
      lead={
        showFlowInstance ? (
          <div className="min-w-0">
            <div className={LABEL}>Flow instance</div>
            <div className="mb-2 break-words text-[12px] text-muted-foreground">
              <span className="text-foreground">{runFlow.title}</span>
              {runFlow.goal ? ` — ${runFlow.goal}` : ''}
            </div>
            <GuardMilestoneGraph
              nodes={milestoneNodes}
              onSelectMilestone={(node) => node.doc && node.anchor && onOpenSpec(node.doc, node.anchor)}
            />
          </div>
        ) : null
      }
    />
  );
}
