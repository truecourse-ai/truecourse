/**
 * The step-driver REGISTRY — the one place that knows which drivers exist.
 *
 * A scenario's world is built once per run (`buildStepDrivers`), and the run loop
 * routes each step through {@link driverFor}. Adding a surface means adding a module
 * and one line here; it never means another branch inside the run loop, and it never
 * means the runner learning what a step kind is.
 */

import type { GuardSandboxStep } from '@truecourse/shared'
import { cliStepDriver, type CliStepDriverOptions } from './cli-driver.js'
import { webStepDriver, type WebStepDriverOptions } from './web-driver.js'
import type { StepDriver } from './types.js'

export type { StepDriver, StepOutcome, StepRunContext } from './types.js'
export { cliStepDriver, SANDBOX_SETUP_EXPECTED, ORPHANED_STDIO_INFRA } from './cli-driver.js'
export type { CliStepDriverOptions } from './cli-driver.js'
export { webStepDriver, NO_WEB_SURFACE_INFRA } from './web-driver.js'
export type { WebStepDriverOptions } from './web-driver.js'

export type BuildStepDriversOptions = CliStepDriverOptions & WebStepDriverOptions

/**
 * The drivers ONE scenario runs with, in routing order. The web driver is asked
 * first: it owns a closed, self-declaring set of steps (`driver: web`), while the
 * cli driver is the DEFAULT world and claims everything else. Ordering a specific
 * claim ahead of a catch-all is what keeps the catch-all honest.
 */
export function buildStepDrivers(opts: BuildStepDriversOptions): StepDriver[] {
  return [webStepDriver({ surface: opts.surface }), cliStepDriver(opts)]
}

/**
 * The driver that owns a step. Every step has one — the cli driver claims whatever
 * no other driver does — so this never returns undefined for a parsed scenario, and
 * the loud fallback exists only for a driver list built without the default.
 */
export function driverFor(step: GuardSandboxStep, drivers: readonly StepDriver[]): StepDriver {
  const driver = drivers.find((d) => d.owns(step))
  if (!driver) {
    throw new Error(
      `no step driver owns this step (drivers: ${drivers.map((d) => d.id).join(', ') || 'none'})`,
    )
  }
  return driver
}

/** Close every driver's per-scenario world, in reverse order, whatever else failed. */
export async function closeStepDrivers(drivers: readonly StepDriver[]): Promise<void> {
  for (const driver of [...drivers].reverse()) {
    await driver.close().catch(() => undefined)
  }
}
