/**
 * The step-driver REGISTRY — the one place that knows which drivers exist.
 *
 * A scenario's world is built once per run (`buildStepDrivers`), and the run loop
 * routes each step through {@link driverFor}. Adding a surface means adding a module
 * and one line here; it never means another branch inside the run loop, and it never
 * means the runner learning what a step kind is.
 *
 * The world the drivers SHARE — the sandbox's served surface — is built here too, and
 * torn down by the bundle's `close` AFTER every driver has let go of it. One server
 * per scenario, whichever driver reaches it first: the browser drives it and the
 * request steps read it, and two servers would be two worlds wearing one name.
 */

import type { GuardSandboxStep } from '@truecourse/shared'
import { apiStepDriver } from './api-driver.js'
import { cliStepDriver, type CliStepDriverOptions } from './cli-driver.js'
import { webStepDriver } from './web-driver.js'
import { sandboxSurface, type SandboxSurface } from './surface.js'
import type { ResolvedWebSurface } from '../recipe.js'
import type { StepDriver } from './types.js'

export type { StepDriver, StepOutcome, StepRunContext } from './types.js'
export { cliStepDriver, SANDBOX_SETUP_EXPECTED, ORPHANED_STDIO_INFRA } from './cli-driver.js'
export type { CliStepDriverOptions } from './cli-driver.js'
export { webStepDriver, NO_WEB_SURFACE_INFRA } from './web-driver.js'
export type { WebStepDriverOptions } from './web-driver.js'
export { apiStepDriver, NO_SERVED_SURFACE_INFRA, NO_SCHEMA_BINDING_INFRA, resolveRequestStep } from './api-driver.js'
export type { ApiStepDriverOptions } from './api-driver.js'
export { sandboxSurface } from './surface.js'
export type { SandboxSurface, SurfaceOpenContext, OpenSurfaceResult } from './surface.js'

export type BuildStepDriversOptions = CliStepDriverOptions & {
  /**
   * The recipe's web surface — what the browser drives and what a `request` step is
   * sent to. `null` when the repo declares none: the drivers that need it still own
   * their steps, and each settles as its own loud error naming the missing block.
   */
  surface: ResolvedWebSurface | null
}

/** ONE scenario's drivers, and the shared world they act in. */
export interface ScenarioDrivers {
  /** The step drivers, in routing order. */
  drivers: StepDriver[]
  /** The served surface they share — started lazily by whichever needs it first. */
  served: SandboxSurface
  /**
   * Close every driver's world, then the surface they were all talking to. The order
   * is load-bearing: the browser must let go before the server dies, or the evidence
   * fills with connection errors from a page whose backend just vanished.
   */
  close(): Promise<void>
}

/**
 * The drivers ONE scenario runs with, in routing order. The specific claims come
 * first — web owns a closed, self-declaring set (`driver: web`), api owns the
 * self-naming `request` verb — and the cli driver is the DEFAULT world that claims
 * everything else. Ordering specific claims ahead of a catch-all is what keeps the
 * catch-all honest.
 */
export function buildStepDrivers(opts: BuildStepDriversOptions): ScenarioDrivers {
  const served = sandboxSurface(opts.surface)
  const drivers = [webStepDriver({ served }), apiStepDriver({ served }), cliStepDriver(opts)]
  return {
    drivers,
    served,
    async close() {
      await closeStepDrivers(drivers)
      await served.close().catch(() => undefined)
    },
  }
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
