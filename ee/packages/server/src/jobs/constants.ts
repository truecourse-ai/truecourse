/**
 * Job task identifiers + payload shapes, kept dependency-free so routers can
 * reference them without pulling in graphile-worker (only the worker does).
 */

/** A single phase in a job's stepped-progress checklist (popup). */
export interface JobStepDef {
  key: string;
  label: string;
}

export const KNOWLEDGE_SYNC_TASK = 'knowledge.sync';

export interface SyncJobPayload {
  jobId: string;
  org: string;
  kind: string;
}

export const REPO_BASELINE_TASK = 'repo.baseline';

/** Display title + stepped checklist for the repo-scan job popup. */
export const REPO_BASELINE_TITLE = 'Scanning repository';
export const REPO_BASELINE_STEPS: readonly JobStepDef[] = [
  { key: 'clone', label: 'Cloning repository' },
  { key: 'spec', label: 'Extracting spec' },
  { key: 'contracts', label: 'Generating contracts' },
  { key: 'drift', label: 'Computing drift baseline' },
  { key: 'analyze', label: 'Analyzing code' },
];

/** Single-flight key for a repo-baseline job — one scan per repo at a time. */
export function baselineJobKey(repoFullName: string): string {
  return `${REPO_BASELINE_TASK}:${repoFullName}`;
}

/** Display title + stepped checklist for the knowledge-sync job popup. */
export const KNOWLEDGE_SYNC_TITLE = 'Syncing knowledge';
export const KNOWLEDGE_SYNC_STEPS: readonly JobStepDef[] = [
  { key: 'fetch', label: 'Fetching documents' },
  { key: 'consolidate', label: 'Consolidating spec & contracts' },
];

/** The intent a dashboard decision hands to the background-task seam when the
 *  spec becomes conflict-free: regenerate the repo's contracts. The runner acts on
 *  it directly (a forced re-baseline + PR re-verify) — there is no standalone
 *  `repo.contracts` job or progress popup; the baseline's own panel shows the work. */
export const REPO_CONTRACTS_TASK = 'repo.contracts';

/** The PR-scoped analog: a PR-scoped decision cleared that PR's last conflict, so
 *  re-gate exactly that one PR (no repo-wide contract regeneration). Matches the
 *  core `PrRegateTask.type` literal, and is also the graphile task identifier. */
export const PR_REGATE_TASK = 'pr.regate';

/** Display title + stepped checklist for the PR re-gate job popup. Step keys are
 *  the gate flow's `GatePhase` literals (github-app), advanced over onPhase. */
export const PR_REGATE_TITLE = 'Re-gating pull request';
export const PR_REGATE_STEPS: readonly JobStepDef[] = [
  { key: 'spec', label: 'Re-checking spec' },
  { key: 'contracts', label: 'Generating contracts' },
  { key: 'verify', label: 'Verifying against baseline' },
  { key: 'verdict', label: 'Posting verdict' },
];

/** The worker's `pr.regate` task payload (the resolved re-gate target + job id). */
export interface PrRegateJobPayload {
  jobId: string;
  /** The repo's workspace org — scopes the job + its notification. */
  workspaceOrgId: string;
  /** `owner/repo` of the PR to re-gate. */
  repoFullName: string;
  /** The PR to re-gate. */
  prNumber: number;
}

/** Single-flight key for a `pr.regate` job — per repo AND PR: two different PRs of
 *  one repo may re-gate concurrently, but the same PR must not. */
export function prRegateJobKey(repoFullName: string, prNumber: number): string {
  return `${PR_REGATE_TASK}:${repoFullName}#${prNumber}`;
}

/** The workspace analogue: refresh the workspace `.tc` corpus after a workspace
 *  Knowledge decision (same debounced, tracked model). */
export const WORKSPACE_CONTRACTS_TASK = 'workspace.contracts';
export interface WorkspaceContractsJobPayload {
  jobId: string;
  workspaceOrgId: string;
}

/** Display title + stepped checklist for the workspace-contracts job popup. */
export const WORKSPACE_CONTRACTS_TITLE = 'Updating contracts';
export const WORKSPACE_CONTRACTS_STEPS: readonly JobStepDef[] = [
  { key: 'contracts', label: 'Refreshing contracts' },
];

/** Single-flight key for a workspace-contracts refresh — one per workspace. */
export function workspaceContractsJobKey(workspaceOrgId: string): string {
  return `${WORKSPACE_CONTRACTS_TASK}:${workspaceOrgId}`;
}

/** What a caller (connect / push webhook) hands to `enqueueBaseline`. */
export interface BaselineEnqueueRequest {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  commitSha: string;
  /**
   * Bypass the "baseline already current for this commit" skip. Set when contracts
   * were (re)generated for an UNCHANGED commit (post-conflict-resolve), so verify
   * must re-run against the new contracts even though the head didn't move. Left
   * unset for connect/push (their dedup is intentional).
   */
  force?: boolean;
  /**
   * Suppress the success notification (still tracks the job + notifies on FAILURE).
   * Set for the workspace→repos ripple, where one KB sync re-verifies N repos and
   * N success toasts would be a storm.
   */
  quiet?: boolean;
  /** The repo's workspace org — scopes the job + its notifications. */
  workspaceOrgId: string;
}

/** The worker's task payload (the enqueue request plus the created job id). */
export interface BaselineJobPayload extends BaselineEnqueueRequest {
  jobId: string;
}
