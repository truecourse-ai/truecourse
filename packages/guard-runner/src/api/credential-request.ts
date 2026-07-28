/**
 * The `fromRequest` credential source (Phase 5 / item 59b): a login request the
 * runner makes ONCE per run against the booted server, whose captured response
 * value becomes a credential's secret. It is the zero-script alternative to
 * `api.seed` for the common simple case — "log in, then use the token" — and its
 * product merges into exactly the same resolved-credential map, so scenarios,
 * `{{cred:<name>}}` substitution, and evidence redaction are unchanged.
 *
 * WHEN it runs is the load-bearing detail: after the run-level api PREFLIGHT boot
 * turns healthy (a login needs a live app) and before any scenario starts, against
 * the preflight server itself. Every scenario then boots its own fresh server, so
 * the minted value survives only when the auth state does — a stateless signed
 * token, or a session in an external datastore `api.services.up` brought up. That
 * is the same survival contract `api.seed` documents.
 *
 * Every failure is a HARD STOP (`credential-request-failed`), never a silent skip:
 * a scenario referencing a credential that quietly failed to mint would run
 * un-authenticated and blame the app for a 401.
 */

import { GUARD_HTTP_METHODS, type GuardHttpRequest } from '@truecourse/shared'
import {
  warnCredentialShapes,
  type RecipeApiCredential,
  type RecipeApiCredentialRequest,
  type ResolvedCredential,
} from '../recipe.js'
import { executeApiRequest } from './executor.js'
import { parseJsonBody } from './expect.js'
import { lookupJsonPath, captureValueToString, JSON_PATH_MISS } from './vars.js'

/** A `fromRequest` credential could not be minted — a hard run stop. */
export class CredentialRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialRequestError'
  }
}

export interface RunCredentialRequestsOptions {
  /** Origin of the booted (preflight) server, e.g. `http://127.0.0.1:53412`. */
  baseUrl: string
  /** The recipe's declared credentials; only the `fromRequest` ones are executed. */
  credentials: Record<string, RecipeApiCredential> | undefined
  /** Per-request wall-clock budget. */
  timeoutMs: number
  signal?: AbortSignal
}

/** How much of a login response body rides a failure message. */
const BODY_TAIL = 500

/** The login request as an api-driver request (no interpolation — recipes have no vars). */
function toHttpRequest(spec: RecipeApiCredentialRequest): GuardHttpRequest {
  return {
    method: spec.method as (typeof GUARD_HTTP_METHODS)[number],
    path: spec.path,
    ...(spec.headers ? { headers: spec.headers } : {}),
    ...(spec.body !== undefined ? { body: spec.body } : {}),
    ...(spec.json !== undefined ? { json: spec.json } : {}),
  }
}

/**
 * Execute every declared `fromRequest` credential against the booted server, in
 * declaration order, returning name → resolved credential. Nothing to do (no
 * `fromRequest` credential) returns an empty map without touching the network.
 *
 * The response STATUS is deliberately not asserted: an API that answers a login
 * with 200, 201, or a 302 + `Set-Cookie` are all legitimate, and pinning a code
 * here would reject working recipes. What must hold is that the declared value is
 * THERE — a missing capture path/header is the failure, and it names what it
 * looked for. A request that cannot complete at all (connection refused, timeout)
 * is the same hard stop with the transport reason.
 */
export async function runCredentialRequests(
  opts: RunCredentialRequestsOptions,
): Promise<Map<string, ResolvedCredential>> {
  const resolved = new Map<string, ResolvedCredential>()
  const pending = Object.entries(opts.credentials ?? {}).filter(([, c]) => c.fromRequest !== undefined)
  if (pending.length === 0) return resolved

  for (const [name, cred] of pending) {
    const spec = cred.fromRequest!
    const where = `credential "${name}" (${spec.method} ${spec.path})`
    const capture = await executeApiRequest({
      baseUrl: opts.baseUrl,
      request: toHttpRequest(spec),
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
    })
    if (capture.timedOut) {
      throw new CredentialRequestError(`${where} timed out after ${opts.timeoutMs}ms`)
    }
    if (capture.requestError) {
      throw new CredentialRequestError(`${where} could not be sent: ${capture.requestError}`)
    }

    let value: string
    if (spec.captureHeader !== undefined) {
      const header = capture.headers[spec.captureHeader.toLowerCase()]
      if (header === undefined) {
        throw new CredentialRequestError(
          `${where} answered ${capture.status} but carries no "${spec.captureHeader}" response header`,
        )
      }
      value = header
    } else {
      const parsed = parseJsonBody(capture.bodyText)
      if ('error' in parsed) {
        throw new CredentialRequestError(
          `${where} answered ${capture.status} with a body that is not JSON: ${parsed.error}`,
        )
      }
      const found = lookupJsonPath(parsed.value, spec.capture!)
      if (found === JSON_PATH_MISS) {
        throw new CredentialRequestError(
          `${where} answered ${capture.status} but nothing is at body path "${spec.capture}": ${capture.bodyText.slice(0, BODY_TAIL)}`,
        )
      }
      value = captureValueToString(found)
    }

    // A blank secret injects an empty header and runs un-authenticated, and the
    // redactor would have nothing to mask — the same floor the seed manifest holds.
    if (value.trim() === '') {
      throw new CredentialRequestError(
        `${where} captured a blank value from ${spec.captureHeader !== undefined ? `header "${spec.captureHeader}"` : `body path "${spec.capture}"`}`,
      )
    }

    resolved.set(name, {
      header: cred.header,
      value: spec.template === undefined ? value : spec.template.split('${value}').join(value),
    })
  }

  // One diagnostics block after every login resolved, mirroring the static path.
  warnCredentialShapes(resolved)
  return resolved
}
