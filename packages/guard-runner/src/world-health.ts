/**
 * WORLD HEALTH — telling "the world is gone" apart from "this scenario failed".
 *
 * A scenario's server (the api driver's per-scenario boot, the sandbox's served
 * web surface) boots against the PREPARED WORLD: the recipe's services and the
 * seed they hold. When that world dies under a run — a container that exited, a
 * port another process took, a reset that ran where it should not have — every
 * later boot fails the same way, and each failure is evidence about the run,
 * not about the scenario it happened to. The generator's world-health latch
 * reads that signal off the result shape the drivers already produce, so the
 * drivers say it in ONE place: the sentinel `expected` strings below.
 */

import type { GuardScenarioResult } from '@truecourse/shared'

/** The api driver's `failure.expected` when the scenario's server never came up. */
export const API_SERVER_BOOT_EXPECTED = 'the api server to start'

/** A sandbox step's `failure.expected` when the step could not be taken at all. */
export const STEP_TO_RUN_EXPECTED = 'the step to run'

/** The sandbox's `failure.actual` prefix when its served web surface never came up. */
export const WEB_SURFACE_DOWN_PREFIX = 'the web surface did not come up: '

/**
 * True when a scenario result says its server could not boot against the
 * world — the api server (either lifecycle path), or the sandbox's served web
 * surface. A browser that failed to launch, a capability that could not be
 * applied, or a step the page refused are NOT this: those happened on a world
 * that was there.
 */
export function isWorldBootFailure(result: Pick<GuardScenarioResult, 'outcome' | 'failure'>): boolean {
  if (result.outcome !== 'error' || !result.failure) return false
  const { expected, actual } = result.failure
  if (expected === API_SERVER_BOOT_EXPECTED) return true
  return expected === STEP_TO_RUN_EXPECTED && actual.startsWith(WEB_SURFACE_DOWN_PREFIX)
}
