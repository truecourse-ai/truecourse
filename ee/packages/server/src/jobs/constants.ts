/**
 * Job task identifiers + payload shapes, kept dependency-free so routers can
 * reference them without pulling in graphile-worker (only the worker does).
 */

export const KNOWLEDGE_SYNC_TASK = 'knowledge.sync';

export interface SyncJobPayload {
  jobId: string;
  org: string;
  kind: string;
}

export const REPO_BASELINE_TASK = 'repo.baseline';

/** A debounced refresh of a repo's contracts after a decision. Tracked (a
 *  jobs-table row + a progress popup); jobKey coalesces a burst of decisions and
 *  the single-flight key reuses one row across the burst. */
export const REPO_CONTRACTS_TASK = 'repo.contracts';
export interface ContractsJobPayload {
  jobId: string;
  repoKey: string;
  workspaceOrgId: string;
}

/** The workspace analogue: refresh the workspace `.tc` corpus after a workspace
 *  Knowledge decision (same debounced, tracked model). */
export const WORKSPACE_CONTRACTS_TASK = 'workspace.contracts';
export interface WorkspaceContractsJobPayload {
  jobId: string;
  workspaceOrgId: string;
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
  /** The repo's workspace org — scopes the job + its notifications. */
  workspaceOrgId: string;
}

/** The worker's task payload (the enqueue request plus the created job id). */
export interface BaselineJobPayload extends BaselineEnqueueRequest {
  jobId: string;
}
