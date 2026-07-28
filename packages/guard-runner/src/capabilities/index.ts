/**
 * Setup-capability registry — the world-state vocabulary a scenario's `setup`
 * can declare beyond `files`/`env`. Each capability is one module with a provider
 * that materializes its declared state in the sandbox cwd, after `setup.files`
 * seeding. Adding the next capability is a new module plus one entry in
 * {@link CAPABILITY_PROVIDERS}; there is no plugin loading and no config.
 *
 * A provider failure (missing tool, a command that fails, an ill-formed
 * declaration) throws {@link CapabilityError}; the run engine maps that to the
 * scenario's `error` outcome — never a silent skip, never a `fail`.
 *
 * Two provider SHAPES exist, and the difference is lifecycle, not status:
 *   - a MATERIALIZER (`git`) writes state into the sandbox and is done; it is one
 *     entry in {@link CAPABILITY_PROVIDERS} and runs inside {@link applyCapabilities}.
 *   - a LIVE capability (`http` — see `./http.ts`) owns a process/server for the
 *     scenario's duration and must exist BEFORE the sandbox env is constructed
 *     (its origin is substituted into `setup.env`, which the app under test reads
 *     at boot). It is therefore started and stopped by each driver around the
 *     scenario body rather than dispatched here; it is not in the registry map.
 * Both raise the same {@link CapabilityError} and map to the same `error` outcome.
 */

import type { GuardSetup } from '@truecourse/shared'
import { materializeGit } from './git.js'

/** Thrown when a capability cannot materialize its declared world-state. The
 *  message names the capability so the `error` outcome points at the culprit. */
export class CapabilityError extends Error {
  constructor(
    readonly capability: string,
    detail: string,
  ) {
    super(`setup.${capability}: ${detail}`)
    this.name = 'CapabilityError'
  }
}

/** What a provider is handed: the sandbox cwd and its allowlisted base env. */
export interface CapabilityContext {
  cwd: string
  env: NodeJS.ProcessEnv
}

type CapabilityProvider = (declaration: never, ctx: CapabilityContext) => void

/** capabilityName → provider. Iterated in insertion order per scenario. */
const CAPABILITY_PROVIDERS: Record<string, CapabilityProvider> = {
  git: materializeGit as CapabilityProvider,
}

/**
 * Materialize every declared setup capability in the sandbox. Called after
 * `setup.files` seeding. Throws {@link CapabilityError} on the first failure.
 */
export function applyCapabilities(setup: GuardSetup | undefined, ctx: CapabilityContext): void {
  if (!setup) return
  const declared = setup as Record<string, unknown>
  for (const [name, provider] of Object.entries(CAPABILITY_PROVIDERS)) {
    const declaration = declared[name]
    if (declaration === undefined) continue
    provider(declaration as never, ctx)
  }
}
