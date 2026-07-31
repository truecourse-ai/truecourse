/**
 * NEEDS SETUP — the ACTIONABLE half of `blocked-on` (item 65).
 *
 * A `blocked-on` gap names capability nouns (`composeBlockedOnReason`), and since
 * item 57 those nouns include DETECTED SERVICE NAMES (`open-meteo`, `stripe`).
 * Some of those services are ones the user can simply hand guard an account for
 * (the External APIs page, item 62) — and the moment they do, the recipe
 * fingerprint moves and the next `guard generate` authors the flows that were
 * blocked. That is a to-do, not an inert grey wall.
 *
 * This module is the ONE rule that tells the two apart:
 *
 *   known to the externals machinery (detected or declared) AND not provided
 *     ⇒ NEEDS SETUP — an attention state with a CTA;
 *   known AND already provided
 *     ⇒ needs setup, SUB-STATE "setup done" — the account is there and the gap is
 *       simply the last generate's stale answer; re-run `guard generate`;
 *   anything else (a generic noun like `external-service`, a service nothing
 *   knows about, no externals data at all)
 *     ⇒ plain `blocked-on`. There is nothing to provide yet, and claiming
 *       otherwise would send a user to a page with no row for it.
 *
 * It is a READ-MODEL derivation, never a schema mutation: the gap KIND is still
 * `blocked-on`, the outcome enum is untouched, and pass/fail counts do not move.
 * Only the presentation is promoted.
 */

import { z } from 'zod'
import { parseBlockedOnCapabilities } from './report.js'

/**
 * How an external service resolves on this machine — the `ExternalState` of
 * `@truecourse/guard-runner`, restated here because `@truecourse/shared` is the
 * dependency of that package, not the other way round.
 */
export type GuardExternalSetupState = 'provided' | 'incomplete' | 'unprovided'

/**
 * Service name → its state, for every service the externals machinery KNOWS
 * (detected by the analyzer, or declared in `recipe.json`). A service absent from
 * this index is one nothing can be provided for, which is exactly why an unknown
 * noun stays plain `blocked-on`.
 */
export type GuardExternalSetupIndex = Readonly<Record<string, GuardExternalSetupState>>

/**
 * The enumerated noun item 60 taught both authoring prompts to use when a flow is
 * blocked because a ROW does not exist ("blocked on missing-data, an
 * already-cancelled booking"). Item 66 makes it providable once `api.seed` exists,
 * and the index carries it in one of two states depending on whether the LAST
 * GENERATE already saw the current seed (`readGuardExternalSetupIndex`):
 * `provided` when the seed postdates that generate — the gap is a stale answer and
 * the "setup done — re-run guard generate" sub-state is honest — and `incomplete`
 * when the seed already fed it: a gap that survived a generate run with this seed
 * means the seed does not create those rows, so the gap renders as a to-do
 * ("extend the seed script"), never as "already set up". It is NEVER carried as
 * `unprovided`: without a seed there is no form to send anyone to, and the gap
 * stays plain `blocked-on` (the CLI/dashboard hint offers `guard seed --init`
 * instead).
 */
export const MISSING_DATA_NOUN = 'missing-data'

/**
 * The words a setup row uses for a service key. Every real service is its own
 * name; the one synthetic key ({@link MISSING_DATA_NOUN}) is not a third party and
 * must not read like one.
 */
export function guardSetupServiceLabel(service: string): string {
  return service === MISSING_DATA_NOUN ? 'seed data' : service
}

/**
 * The needs-setup derivation of ONE `blocked-on` gap: which of its nouns name a
 * providable service that is still missing, and which name one already provided.
 * Both lists are service names exactly as the externals page keys them, so a CTA
 * can name the service it will open.
 */
export const GuardNeedsSetupSchema = z
  .object({
    /** Known services that are NOT provided (unprovided or incomplete) — the to-do. */
    services: z.array(z.string()),
    /** Known services that ARE provided — the gap is stale; re-run `guard generate`. */
    provided: z.array(z.string()),
  })
  .strict()
export type GuardNeedsSetup = z.infer<typeof GuardNeedsSetupSchema>

/**
 * Derive {@link GuardNeedsSetup} from a `blocked-on` gap reason, or `null` when
 * the gap names no known service — the caller then leaves it as plain
 * `blocked-on`. Matching is case-insensitive on the whole noun: item 57 already
 * canonicalizes a noun that names a detected service (`stripe api` → `stripe`),
 * so a partial match here would only ever be a guess.
 */
export function deriveNeedsSetup(
  reason: string,
  externals: GuardExternalSetupIndex | null | undefined,
): GuardNeedsSetup | null {
  if (!externals) return null
  const byLower = new Map(
    Object.entries(externals).map(([service, state]) => [service.toLowerCase(), { service, state }]),
  )
  const services: string[] = []
  const provided: string[] = []
  for (const noun of parseBlockedOnCapabilities(reason)) {
    const hit = byLower.get(noun.trim().toLowerCase())
    if (!hit) continue
    const list = hit.state === 'provided' ? provided : services
    if (!list.includes(hit.service)) list.push(hit.service)
  }
  if (services.length === 0 && provided.length === 0) return null
  return { services, provided }
}

/**
 * True for the "setup done" sub-state: every service this gap names is already
 * provided, so nothing is left to do but re-generate. Distinct on purpose — it is
 * the one needs-setup row whose CTA is a command, not a form.
 */
export function needsSetupIsDone(needsSetup: GuardNeedsSetup): boolean {
  return needsSetup.services.length === 0 && needsSetup.provided.length > 0
}

/** The services a needs-setup row is ABOUT — the outstanding ones, else the provided ones. */
export function needsSetupServices(needsSetup: GuardNeedsSetup): string[] {
  return needsSetup.services.length > 0 ? needsSetup.services : needsSetup.provided
}
