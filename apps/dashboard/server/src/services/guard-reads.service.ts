/**
 * A repository's guard READS that answer more than one core read: a flow list
 * narrowed by status, one flow or a refusal, a run by id or the latest, a run's
 * failures with their evidence, the claims narrowed by coverage. What the guard
 * routes and the MCP tools both call, so the two can never answer differently.
 *
 * Refusals are `AppError`s carrying the status a route answers with.
 */

import { createAppError } from '@truecourse/core/lib/errors';
import {
  listGuardFlows,
  readGuardClaims,
  readGuardEvidence,
  readGuardFlowDetail,
  readGuardRun,
  readGuardRunForView,
} from '@truecourse/core/commands/guard-read';
import {
  guardFlowPlainStatus,
  guardResultRunId,
  isGuardFailure,
  type GuardClaimCoverage,
  type GuardClaimsView,
  type GuardCoveragePlainStatus,
  type GuardFlowDetail,
  type GuardFlowsView,
  type GuardLatest,
  type GuardScenarioResult,
} from '@truecourse/shared';

/**
 * The Flows payload, narrowed to the flows wearing one of `status` (the five
 * coverage words) when it is given. The totals stay the whole repository's.
 */
export async function listRepoFlows(
  repoPath: string,
  filter: { status?: readonly GuardCoveragePlainStatus[]; ref?: string } = {},
): Promise<GuardFlowsView> {
  const view = await listGuardFlows(repoPath, filter.ref);
  const status = filter.status;
  if (!status || status.length === 0) return view;
  return { ...view, flows: view.flows.filter((f) => status.includes(guardFlowPlainStatus(f))) };
}

/** One flow's detail, or a 404 when no flow carries the id. */
export async function readRepoFlow(repoPath: string, flowId: string, ref?: string): Promise<GuardFlowDetail> {
  const detail = await readGuardFlowDetail(repoPath, flowId, ref);
  if (!detail) throw createAppError(`Flow not found: ${flowId}`, 404);
  return detail;
}

/** The run `runId` names, or the latest one; a 404 when there is none. */
export async function readRepoRun(repoPath: string, runId?: string): Promise<GuardLatest> {
  if (runId) {
    const run = await readGuardRun(repoPath, runId);
    if (!run) throw createAppError('Guard run not found.', 404);
    return run;
  }
  const latest = await readGuardRunForView(repoPath);
  if (!latest) throw createAppError('No guard run has been recorded yet.', 404);
  return latest;
}

/** One failed test of a run, with the evidence of what it did. */
export interface RunFailure {
  result: GuardScenarioResult;
  /** The run that produced this row — the one its evidence is filed under. */
  runId: string;
  /** The evidence transcript; null when the run recorded none, or it is gone. */
  evidence: string | null;
}

/**
 * The FAILURES of a run (the latest when no `runId`): every test whose outcome
 * is a failure by the shared definition, each with the transcript of what it
 * did. `testId` narrows to one test.
 */
export async function readRepoRunFailures(
  repoPath: string,
  filter: { runId?: string; testId?: string } = {},
): Promise<{ run: GuardLatest; failures: RunFailure[] }> {
  const run = await readRepoRun(repoPath, filter.runId);
  const failed = run.scenarios.filter(
    (s) => isGuardFailure(s.outcome) && (!filter.testId || s.id === filter.testId),
  );
  const failures = await Promise.all(
    failed.map(async (result) => {
      const runId = guardResultRunId(result, run.run);
      const evidence = result.evidencePath ? await readGuardEvidence(repoPath, runId, result.id) : null;
      return { result, runId, evidence };
    }),
  );
  return { run, failures };
}

/**
 * The claims payload, narrowed: `withFlow` true keeps the claims a flow
 * carries, false the ones none does; `coverage` keeps the claims in one of
 * those states. The totals stay the whole repository's.
 */
export async function readRepoClaims(
  repoPath: string,
  filter: { withFlow?: boolean; coverage?: readonly GuardClaimCoverage[]; ref?: string } = {},
): Promise<GuardClaimsView> {
  const view = await readGuardClaims(repoPath, filter.ref);
  const coverage = filter.coverage ?? [];
  return {
    ...view,
    claims: view.claims
      .filter((c) => filter.withFlow === undefined || c.flows.length > 0 === filter.withFlow)
      .filter((c) => coverage.length === 0 || coverage.includes(c.coverage)),
  };
}
