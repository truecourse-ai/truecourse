/**
 * The socket-side impl of the core `repo-lifecycle` seam: turn a background
 * job's "repo X finished a setup / generate / run" announcement into the SAME
 * `spec:complete` event the routes emit into the repository's room — so a
 * client sitting on the Pipeline or Runs tab refreshes live when a chained job
 * lands, not just on a manual trigger. Installed by `setupSocket`; deps are
 * injected for tests.
 */

import { getProjectByPath } from '@truecourse/core/config/registry';
import type { RepoLifecycleEmitter, RepoLifecycleKind } from '@truecourse/core/lib/repo-lifecycle';
import { emitSpecComplete } from './handlers.js';

export interface RepoLifecycleSocketDeps {
  /** Registry lookup within the workspace: `owner/repo` → entry. */
  getProjectByPath: (workspaceOrgId: string, repoKey: string) => Promise<{ slug: string } | null>;
  /** Emit `spec:complete` into the repo's room (production: emitSpecComplete). */
  emit: (workspaceOrgId: string, repoId: string, kind: RepoLifecycleKind) => void;
}

/** Build the emitter: resolve the repo's slug in its workspace, emit into its room. A
 *  repoKey the workspace's registry doesn't know emits nothing (an unlinked/unknown repo has no room). */
export function createRepoLifecycleSocketEmitter(deps: RepoLifecycleSocketDeps): RepoLifecycleEmitter {
  return async (workspaceOrgId, repoKey, kind) => {
    const entry = await deps.getProjectByPath(workspaceOrgId, repoKey);
    if (entry) deps.emit(workspaceOrgId, entry.slug, kind);
  };
}

/** The production emitter (real registry + real socket emit). */
export function productionRepoLifecycleEmitter(): RepoLifecycleEmitter {
  return createRepoLifecycleSocketEmitter({ getProjectByPath, emit: emitSpecComplete });
}
