/**
 * Injectable seam: announce a repo-lifecycle completion (a spec scan, a guard
 * generate, or a guard run finished for a repo) to whoever renders live UI.
 *
 * The reverse twin of `guard-generate-enqueue`: there the EE server installs an
 * impl the dashboard routes call; here the DASHBOARD SERVER installs an impl
 * (resolve the repo's slug, emit the `spec:complete` socket event into the
 * `repo:<slug>` room) that the EE background jobs call when a hosted
 * `repo.baseline` / `repo.guard` / `guard.baseline` job settles — so a client
 * sitting on the Spec/Scenarios/Runs tab refreshes live instead of going stale.
 * Neither side imports the other (sibling adapters over core).
 *
 * Keyed by `repoKey` — the opaque per-repo identity every store keys by (the
 * working-tree path in OSS, `owner/repo` in hosted). Unset (CLI, tests, or a
 * server without sockets) → `emitRepoLifecycle` is a silent no-op. Best-effort:
 * a refresh signal must never fail the job settle that fires it, so emitter
 * errors are swallowed.
 */

/** What just completed for the repo — the `spec:complete` socket kinds. */
export type RepoLifecycleKind = 'scan' | 'guard-generate' | 'guard-run'

export type RepoLifecycleEmitter = (repoKey: string, kind: RepoLifecycleKind) => Promise<void>

let emitter: RepoLifecycleEmitter | null = null

/** Install the emitter (or clear it with null). Called once at server boot. */
export function setRepoLifecycleEmitter(fn: RepoLifecycleEmitter | null): void {
  emitter = fn
}

/** Announce a lifecycle completion. No-op when unset; never throws. */
export async function emitRepoLifecycle(repoKey: string, kind: RepoLifecycleKind): Promise<void> {
  if (!emitter) return
  try {
    await emitter(repoKey, kind)
  } catch {
    /* best-effort — a refresh signal never fails the work that fired it */
  }
}
