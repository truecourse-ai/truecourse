/**
 * The per-scenario `${unique}` token. Every scenario in a run gets one short token
 * it can embed in the identifiers it CREATES (slugs, names, urls, emails) so a
 * resource it makes collides neither with a prior run nor with a sibling scenario
 * sharing the same booted server. Derived from a per-invocation random nonce and
 * the scenario id, so it is:
 *   - distinct per scenario within a run (different id → different token),
 *   - distinct across runs (a fresh nonce moves every token),
 *   - stable within one scenario across its steps (a pure function of nonce + id,
 *     seeded once before the step loop and never re-derived), and
 *   - filesystem/URL-safe: lowercase hex, 10 chars.
 */

import { createHash, randomBytes } from 'node:crypto'

/** A fresh per-run nonce — one per `runGuard` invocation (and thus per birth round). */
export function newRunNonce(): string {
  return randomBytes(8).toString('hex')
}

/** The `${unique}` value for one scenario: a stable, collision-free short token. */
export function scenarioUnique(runNonce: string, scenarioId: string): string {
  return createHash('sha256').update(`${runNonce}\0${scenarioId}`).digest('hex').slice(0, 10)
}
