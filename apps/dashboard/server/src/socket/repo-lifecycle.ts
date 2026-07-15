/**
 * The socket-side impl of the core `repo-lifecycle` seam: turn a background
 * job's "repo X finished a scan / guard generate / guard run" announcement into
 * the SAME `spec:complete` event the OSS routes emit into the `repo:<slug>`
 * room — so a client sitting on the Spec/Scenarios/Runs tab refreshes live when
 * a hosted job (auto-regen, chained baseline run) lands, not just on a manual
 * trigger. Installed by `setupSocket`; deps are injected for tests.
 */

import { getProjectByPath } from '@truecourse/core/config/registry';
import type { RepoLifecycleEmitter, RepoLifecycleKind } from '@truecourse/core/lib/repo-lifecycle';
import { emitSpecComplete } from './handlers.js';

export interface RepoLifecycleSocketDeps {
  /** Registry lookup: repoKey (path in OSS, `owner/repo` hosted) → entry. */
  getProjectByPath: (repoKey: string) => Promise<{ slug: string } | null>;
  /** Emit `spec:complete` into the repo's room (production: emitSpecComplete). */
  emit: (repoId: string, kind: RepoLifecycleKind) => void;
}

/** Build the emitter: resolve the repo's slug, emit into its room. A repoKey the
 *  registry doesn't know emits nothing (an unlinked/unknown repo has no room). */
export function createRepoLifecycleSocketEmitter(deps: RepoLifecycleSocketDeps): RepoLifecycleEmitter {
  return async (repoKey, kind) => {
    const entry = await deps.getProjectByPath(repoKey);
    if (entry) deps.emit(entry.slug, kind);
  };
}

/** The production emitter (real registry + real socket emit). */
export function productionRepoLifecycleEmitter(): RepoLifecycleEmitter {
  return createRepoLifecycleSocketEmitter({ getProjectByPath, emit: emitSpecComplete });
}
