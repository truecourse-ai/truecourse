// Sync pipeline — orchestrates incremental sync runs against external
// catalogs. Each run carries a small run-state machine; stages (build /
// deploy / release / test) are tracked by the orchestrator service that
// schedules these runs, not here. The spec-side `PipelineStage` enum
// therefore has no code counterpart in this module — that absence is
// intentional and the verifier must report it.
//
// IL-DRIFT: Enum:PipelineStage / enum.PipelineStage.no-code-counterpart

// FP-GUARD: enum/no-code-counterpart — must NOT drift
// A module-scoped 2-value type alias (`RunState`) that matches the
// spec-side `FlowRunStatus` enum by value-set even though the names
// don't normalize equal. The 2-value exact-match path in the enum
// comparator must accept this as a counterpart.
type RunState = 'active' | 'inactive';

export interface PipelineRun {
  id: string;
  state: RunState;
  startedAt: Date;
  finishedAt: Date | null;
}

export function createRun(id: string): PipelineRun {
  return { id, state: 'active', startedAt: new Date(), finishedAt: null };
}

export function finishRun(run: PipelineRun): PipelineRun {
  return { ...run, state: 'inactive', finishedAt: new Date() };
}
