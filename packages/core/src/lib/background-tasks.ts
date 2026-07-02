/**
 * A tiny process-wide seam for deferring work to a background queue, kept in
 * `core` so OSS adapters (e.g. the dashboard spec routes) can hand work off
 * without importing `ee/`. The enterprise server installs a queue-backed runner
 * (graphile-worker) via `setBackgroundTaskRunner`; when none is installed (OSS,
 * or tests) the caller runs the work inline instead.
 *
 * Mirrors the `@truecourse/shared/llm` transport seam: a single nullable function
 * pointer, set at boot, read at call sites.
 */

/** A unit of deferrable work. `type` selects the worker handler. */
export interface BackgroundTask {
  /** Task kind, e.g. `repo.contracts`. */
  type: string;
  /**
   * Workspace org — scopes the job + any notification it emits. Optional: an OSS
   * adapter (e.g. the shared spec routes) knows the `repoKey` but not the org, so
   * the EE runner resolves the org from `repoKey` when this is omitted.
   */
  workspaceOrgId?: string;
  /** The repo the task acts on, when applicable (`owner/repo`). */
  repoKey?: string;
}

/** Enqueue a task onto the background queue. */
export type BackgroundTaskRunner = (task: BackgroundTask) => Promise<void>;

let runner: BackgroundTaskRunner | null = null;

/** Install (or clear, with `null`) the queue-backed runner. EE-only. */
export function setBackgroundTaskRunner(r: BackgroundTaskRunner | null): void {
  runner = r;
}

/** The installed runner, or `null` when work must run inline (OSS/tests). */
export function getBackgroundTaskRunner(): BackgroundTaskRunner | null {
  return runner;
}
