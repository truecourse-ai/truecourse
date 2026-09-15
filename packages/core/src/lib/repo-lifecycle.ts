/**
 * Injectable seam: announce a repo-lifecycle completion (a spec scan, a guard
 * generate, or a guard run finished for a repo) to whoever renders live UI.
 *
 * The reverse twin of `guard-generate-enqueue`: there boot installs an impl the
 * dashboard routes call; here the socket layer installs an impl (resolve the
 * repo's slug in its workspace, emit the `spec:complete` socket event into the
 * repository's room) that the background jobs call when a `repo.guard-setup` /
 * `repo.guard-generate` / `repo.guard-run` job settles — so a client sitting on
 * the Pipeline or Runs tab refreshes live instead of going stale. Neither side
 * imports the other (sibling adapters over core).
 *
 * Keyed by the workspace and `repoKey` — the `owner/repo` identity every store
 * keys by, which the room is named from together with the workspace. Unset
 * (tests, or a server without sockets) → `emitRepoLifecycle` is a silent no-op.
 * Best-effort: a refresh signal must never fail the job settle that fires it,
 * so emitter errors are swallowed.
 */

/** What just completed for the repo — the `spec:complete` socket kinds. */
export type RepoLifecycleKind = 'scan' | 'guard-setup' | 'guard-generate' | 'guard-run'

export type RepoLifecycleEmitter = (
  workspaceOrgId: string,
  repoKey: string,
  kind: RepoLifecycleKind,
) => Promise<void>

let emitter: RepoLifecycleEmitter | null = null

/** Install the emitter (or clear it with null). Called once at server boot. */
export function setRepoLifecycleEmitter(fn: RepoLifecycleEmitter | null): void {
  emitter = fn
}

/** Announce a lifecycle completion. No-op when unset; never throws. */
export async function emitRepoLifecycle(
  workspaceOrgId: string,
  repoKey: string,
  kind: RepoLifecycleKind,
): Promise<void> {
  if (!emitter) return
  try {
    await emitter(workspaceOrgId, repoKey, kind)
  } catch {
    /* best-effort — a refresh signal never fails the work that fired it */
  }
}
