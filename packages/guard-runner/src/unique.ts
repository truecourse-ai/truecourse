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
import type { GuardSetup } from '@truecourse/shared'

/** A fresh per-run nonce — one per `runGuard` invocation (and thus per birth round). */
export function newRunNonce(): string {
  return randomBytes(8).toString('hex')
}

/** The `${unique}` value for one scenario: a stable, collision-free short token. */
export function scenarioUnique(runNonce: string, scenarioId: string): string {
  return createHash('sha256').update(`${runNonce}\0${scenarioId}`).digest('hex').slice(0, 10)
}

/** Replace every literal `${unique}` occurrence with the scenario's token. */
export function applyUnique(text: string, unique: string): string {
  return text.split('${unique}').join(unique)
}

/** Interpolate every VALUE of a scenario-authored string map (an env overlay). */
export function applyUniqueEnv(env: Record<string, string>, unique: string): Record<string, string> {
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, applyUnique(v, unique)]))
}

/**
 * Interpolate `${unique}` across a scenario's SETUP — the seeded world-state, which is
 * scenario-authored exactly like its argv. Both drivers apply this before handing
 * `setup` to the sandbox and the capability providers, so a scenario that seeds
 * `notes-${unique}.txt` gets the file at the SAME resolved path its steps pass on the
 * command line and its `expect.files` asserts on. Left un-interpolated the token lands
 * on disk verbatim and every reference to it misses.
 *
 * Covered: `files` keys (the path) and values (the content), `env` values, the
 * `git` capability's committed/staged path lists — those name `setup.files` entries,
 * so they must resolve identically or the commit stages a path that does not exist —
 * and the `http` capability's every string (route paths, scripted response bodies,
 * and the request assertions), so a stub can assert that the app forwarded the very
 * identifier the scenario created with `${unique}`.
 */
export function applyUniqueSetup(
  setup: GuardSetup | undefined,
  unique: string,
): GuardSetup | undefined {
  if (!setup) return setup
  const u = (s: string): string => applyUnique(s, unique)
  return {
    ...setup,
    ...(setup.files
      ? { files: Object.fromEntries(Object.entries(setup.files).map(([k, v]) => [u(k), u(v)])) }
      : {}),
    ...(setup.env ? { env: applyUniqueEnv(setup.env, unique) } : {}),
    ...(setup.git
      ? {
          git: {
            ...setup.git,
            ...(setup.git.commits
              ? { commits: setup.git.commits.map((c) => ({ ...c, files: c.files.map(u) })) }
              : {}),
            ...(setup.git.staged ? { staged: setup.git.staged.map(u) } : {}),
          },
        }
      : {}),
    ...(setup.http
      ? {
          http: Object.fromEntries(
            Object.entries(setup.http).map(([name, stub]) => [
              name,
              {
                ...stub,
                routes: stub.routes.map((route) => ({
                  ...route,
                  path: u(route.path),
                  ...(route.headers ? { headers: applyUniqueEnv(route.headers, unique) } : {}),
                  ...(route.body !== undefined ? { body: u(route.body) } : {}),
                  ...(route.json !== undefined ? { json: applyUniqueJson(route.json, unique) } : {}),
                  ...(route.expect
                    ? {
                        expect: {
                          ...route.expect,
                          ...(route.expect.bodyContains
                            ? { bodyContains: route.expect.bodyContains.map(u) }
                            : {}),
                          ...(route.expect.query ? { query: applyUniqueEnv(route.expect.query, unique) } : {}),
                          ...(route.expect.headers ? { headers: applyUniqueEnv(route.expect.headers, unique) } : {}),
                          ...(route.expect.jsonPath
                            ? {
                                jsonPath: Object.fromEntries(
                                  Object.entries(route.expect.jsonPath).map(([p, v]) => [
                                    p,
                                    applyUniqueJson(v, unique),
                                  ]),
                                ),
                              }
                            : {}),
                        },
                      }
                    : {}),
                })),
              },
            ]),
          ),
        }
      : {}),
  }
}

/** Interpolate `${unique}` in every STRING inside a JSON value (arrays/objects walked). */
function applyUniqueJson(value: unknown, unique: string): unknown {
  if (typeof value === 'string') return applyUnique(value, unique)
  if (Array.isArray(value)) return value.map((v) => applyUniqueJson(v, unique))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, applyUniqueJson(v, unique)]),
    )
  }
  return value
}
