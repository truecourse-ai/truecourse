/**
 * THE SHARED WORLD — one prepared world (api `services.up` + `seed`) reused by
 * every execution of a generate run, instead of one per sandbox.
 *
 * WHY (the documenso 13-worker bench, 2026-08-24): the recipe's compose project
 * is a SINGLETON — its file pins one project name, one set of container names,
 * one datastore volume. When every sandboxed `run_scenario` and every birth
 * round boots and tears down that project independently, any concurrency makes
 * the lifecycles race: sandbox A's `services.down` lands under sandbox B's
 * seed, which dies mid-connection (Prisma P1017 / "can't reach database"), and
 * one such death latches a run-wide seed-failed refusal. The per-sandbox
 * up/down bought no isolation to begin with — every sandbox talked to the SAME
 * datastore — so sharing the booted world changes no state semantics; it only
 * removes the races (and the ~20s boot each sandbox paid).
 *
 * MECHANISM: a single-flight memo, deliberately free of world knowledge — the
 * boot/teardown logic stays in `run.ts`, which passes it in as thunks, so the
 * two can never drift. The FIRST `ensure` runs the boot thunk and registers the
 * matching teardown; concurrent and later callers await the same boot. A boot
 * that failed (threw, or resolved to the caller's failure shape via
 * `retryable`) clears the memo so the NEXT execution re-attempts — mirroring
 * the old per-run behavior where every round tried its own `up` — while the
 * teardown registration survives, so `shutdown()` still sweeps a half-created
 * world. `shutdown()` is idempotent, best-effort, and runs the teardown only
 * if a boot ever started.
 *
 * The handle is IN-PROCESS (same class as `signal`/`visualJudge` on the
 * executor seam): a hosted/EE executor simply ignores it and keeps booting its
 * own per-run worlds — remote runs never shared a host to race on.
 */

/**
 * The single-flight world memo. `ensure` is generic PER CALL rather than per
 * handle — the boot-result shape is `run.ts`-internal, and every caller of one
 * handle is the same code path (`runGuard`), so the internal `unknown` memo is
 * cast back to the caller's `T`.
 */
export interface GuardSharedWorld {
  /**
   * Return the prepared world, booting it via `boot` if this is the first (or
   * a retry after a failed) call. `down` is registered ONCE, by whichever call
   * actually boots, and runs only at {@link shutdown}. `retryable` marks a
   * RESOLVED boot value as a failure the next caller should re-attempt
   * (run.ts resolves failures into run-result shapes rather than throwing).
   */
  ensure<T>(boot: () => Promise<T>, down: () => Promise<void>, retryable?: (value: T) => boolean): Promise<T>
  /** True once a boot has been attempted — `shutdown` will have work to do. */
  booted(): boolean
  /** Run the registered teardown once, best-effort. Safe to call repeatedly,
   *  and a no-op when nothing ever booted. */
  shutdown(): Promise<void>
}

export function createGuardSharedWorld(): GuardSharedWorld {
  let inFlight: Promise<unknown> | null = null
  let down: (() => Promise<void>) | null = null
  let torndown = false

  return {
    ensure<T>(boot: () => Promise<T>, registerDown: () => Promise<void>, retryable?: (value: T) => boolean) {
      if (inFlight === null) {
        down ??= registerDown
        const attempt = boot().then(
          (value) => {
            // A resolved failure (run.ts's non-ok shapes) must not memoize as
            // the world — the next execution re-attempts, like today.
            if (retryable?.(value)) inFlight = null
            return value
          },
          (e) => {
            inFlight = null
            throw e
          },
        )
        inFlight = attempt
        return attempt
      }
      return inFlight as Promise<T>
    },
    booted() {
      return down !== null
    },
    async shutdown() {
      if (torndown || down === null) return
      torndown = true
      // Let an in-flight boot settle first so the teardown never races it —
      // the exact overlap this module exists to remove.
      await inFlight?.catch(() => undefined)
      await down().catch(() => undefined)
    },
  }
}
