/**
 * BLOCKED-ON ENRICHMENT — turning "blocked on external-service" into "blocked on
 * stripe, sendgrid".
 *
 * A flow the authoring model refuses names the capability it lacks as a free-text
 * noun. When that noun is a GENERIC placeholder for "somebody else's server", the
 * repo's own detected third parties are a strictly better answer: they ride the
 * SAME `blocked on <caps>: <claim>` format, so `parseBlockedOnCapabilities` recovers
 * them and the existing `blockedOnCapabilities` tally counts per SERVICE ({stripe: 3})
 * instead of collapsing every integration into one opaque bucket.
 *
 * Granularity is REPO-level, not flow-level, and the wording says so ("detected"):
 * a journey carries no source-file identity (see `JourneySchema` — an entry is a
 * command or an operation, never a file), so there is nothing to intersect a
 * service's evidence files against. Claiming per-flow precision we cannot compute
 * would be a lie; naming the repo's actual dependencies is not.
 */

import type { DetectedExternalService } from '@truecourse/shared'

/**
 * The nouns that mean "an external system" without naming one. Matched on the
 * WHOLE normalized noun, never as a substring: `service` is deliberately absent —
 * it is what a model writes for a sibling microservice or a local daemon just as
 * often as for a SaaS, and rewriting it to `stripe` would invent a fact.
 */
const GENERIC_EXTERNAL_NOUNS = new Set([
  'external-service',
  'external service',
  'external-services',
  'external services',
  'external',
  'external-api',
  'external api',
  'external-system',
  'external system',
  'third-party',
  'third party',
  'third-party-service',
  'third party service',
  'third-party-api',
  'third party api',
  'saas',
  'integration',
  'integrations',
  'upstream',
  'upstream-service',
  'upstream service',
])

/** How many detected services one reason names before it stops being readable. */
const MAX_NAMED = 6

/** Whether a capability noun is a generic stand-in for an unnamed third party. */
export function isGenericExternalNoun(capability: string): boolean {
  return GENERIC_EXTERNAL_NOUNS.has(capability.trim().toLowerCase())
}

/** What the caller knows about the repo that the service list cannot say. */
export interface EnrichBlockedOnOptions {
  /**
   * The repo's OWN product names. A service named after the product must never be
   * canonicalized onto: the noun match is word-boundary containment, so ANY refusal
   * that mentions the product by name would collapse onto "the <product> external
   * service" and render self-reference as a configuration ask. Detection drops such
   * a service at the source; this is the second lock, for a list that predates the
   * rule or came from somewhere else.
   */
  ownProductNames?: readonly string[]
}

/**
 * The detected service a noun already names, if any — so `"stripe api"` or
 * `"Stripe"` collapse onto the canonical `stripe` and tally with it rather than
 * splintering the breakdown across spellings.
 */
function canonicalize(
  capability: string,
  services: readonly DetectedExternalService[],
  own: ReadonlySet<string>,
): string | null {
  const noun = capability.trim().toLowerCase()
  for (const { service } of services) {
    if (own.has(service.toLowerCase())) continue
    if (noun === service) return service
    // Word-boundary containment only: `stripe`/`stripe api` yes, `restripe` no.
    if (new RegExp(`(^|[^a-z0-9])${escapeRegExp(service)}([^a-z0-9]|$)`).test(noun)) return service
  }
  return null
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The capability nouns to record for a blocked flow, given what the repo actually
 * depends on. Order-preserving and deduped; a repo with no detected services (or a
 * noun that is neither generic nor a service name) is returned UNCHANGED, so this
 * only ever adds information.
 */
export function enrichBlockedOn(
  capabilities: readonly string[],
  services: readonly DetectedExternalService[],
  options: EnrichBlockedOnOptions = {},
): string[] {
  const own = new Set((options.ownProductNames ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean))
  const named = services
    .filter((s) => !own.has(s.service.toLowerCase()))
    .slice(0, MAX_NAMED)
    .map((s) => s.service)
  const out: string[] = []
  const push = (value: string): void => {
    if (value && !out.includes(value)) out.push(value)
  }

  for (const capability of capabilities) {
    const canonical = canonicalize(capability, services, own)
    if (canonical) {
      push(canonical)
      continue
    }
    if (named.length > 0 && isGenericExternalNoun(capability)) {
      for (const service of named) push(service)
      continue
    }
    push(capability)
  }
  return out.length > 0 ? out : [...capabilities]
}
