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
 *  it directly (a forced re-baseline) — there is no standalone `repo.contracts` job
 *  or progress popup; the baseline's own panel shows the work. */
export const REPO_CONTRACTS_TASK = 'repo.contracts';

/** What a caller (connect / push webhook) hands to `enqueueBaseline`. */
export interface BaselineEnqueueRequest {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  commitSha: string;
  /**
   * Bypass the "baseline already current for this commit" skip. Set when a spec
   * conflict was resolved on an UNCHANGED commit (post-conflict-resolve), so the
   * contracts regenerate even though the head didn't move. Left unset for
   * connect/push (their dedup is intentional).
   */
  force?: boolean;
  /** Suppress the success notification (still tracks the job + notifies on FAILURE). */
  quiet?: boolean;
  /** The repo's workspace org — scopes the job + its notifications. */
  workspaceOrgId: string;
}

/** The worker's task payload (the enqueue request plus the created job id). */
export interface BaselineJobPayload extends BaselineEnqueueRequest {
  jobId: string;
}

/**
 * Enqueue an initial/refresh repo baseline (connect / push / post-resolve). Returns
 * the new job id, or null when a baseline is already running for that repo
 * (single-flight).
 */
export type EnqueueBaseline = (req: BaselineEnqueueRequest) => Promise<string | null>;
