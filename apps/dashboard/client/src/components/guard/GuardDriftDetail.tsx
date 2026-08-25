/**
 * A TEST as an INSTANCE — how it ran in THIS run.
 *
 * The screen is {@link GuardTestView}: the merged flow detail's own scenario
 * rendering under a header of its own (a run instance has no flow header above
 * it). Only the feed differs (this run's result) and the provenance line says so.
 * It opens IN PLACE: a run is history, so its evidence stays where the run put it
 * and the reader is never navigated away from the run to read it. An "open this
 * flow →" link goes to the flow's own home — the one entity destination — when
 * they want its current state instead.
 *
 * Read-only; the tab strip owns the close, and drift-vs-bug is the developer's
 * call, never resolved here. The steps are already grouped under the claim each
 * one realizes, so the run says where it broke without a second state beside the
 * verdict.
 */

import { ArrowUpRight } from 'lucide-react';
import { guardResultRunId } from '@truecourse/shared';
import type { GuardInterfaceRow, GuardRunFlow, GuardScenarioResult } from '@truecourse/shared';
import { guardTestStatusView } from '@/lib/guard-flow-status';
import { GuardTestView, type GuardTestViewModel } from './GuardTestView';

export function GuardDriftDetail({
  repoId,
  scenario,
  runId,
  runFlow = null,
  interfaces = null,
  onOpenSpec,
  onOpenFlow,
}: {
  repoId: string;
  scenario: GuardScenarioResult;
  runId: string;
  /** The flow this result instantiates, joined onto the run payload (`runFlows`). */
  runFlow?: GuardRunFlow | null;
  /** The mapped catalog, when the view has one; null = unmapped. */
  interfaces?: GuardInterfaceRow[] | null;
  onOpenSpec: (doc: string, section: string) => void;
  /** Jump to the test's own home — its flow. Omitted in read-only embeds. */
  onOpenFlow?: (flowId: string) => void;
}) {
  // The flow this result instantiates — the one destination the page links out to.
  const flowId = runFlow?.flowId ?? scenario.flowId;
  const failedMilestone = runFlow?.milestones.find((m) => m.order === scenario.failedMilestone);

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
    ...(scenario.interfaceDrifted ? { interfaceDrifted: true } : {}),
    ...(scenario.blockedPrecondition ? { blockedPrecondition: true } : {}),
    ...(runFlow?.goal ? { goal: runFlow.goal } : {}),
    ...(runFlow ? { flow: { id: runFlow.flowId, title: runFlow.title } } : {}),
    binds: {
      doc: scenario.binds.doc,
      section: scenario.binds.section,
      fingerprint: scenario.binds.fingerprint,
    },
    interfacePath: [],
    // Any executed outcome that captured a transcript renders it — passes
    // included. A non-executed stale/orphaned, or an older pass without one, has
    // no evidencePath, so no evidence section renders. The transcript is addressed
    // by the run THIS result came from: on a merged board (a scoped run leaves every
    // other verdict standing) a carried row's evidence is filed under its own run,
    // not under the run that wrote the board.
    evidence:
      scenario.evidencePath != null
        ? { kind: 'run', runId: guardResultRunId(scenario, { runId }) }
        : null,
  };

  return (
    <GuardTestView
      repoId={repoId}
      test={model}
      interfaces={interfaces}
      onOpenSpec={onOpenSpec}
      headerAction={
        onOpenFlow && flowId ? (
          // This pane is THIS RUN's record. The test's own home — its FLOW, the one
          // entity destination — is one click away, never the default, or a reader
          // loses the run they came to read.
          <button
            type="button"
            onClick={() => onOpenFlow(flowId)}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            open this flow
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
    />
  );
}
