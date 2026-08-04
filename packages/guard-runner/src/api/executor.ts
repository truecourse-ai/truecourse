/**
 * Api-step executor — send ONE (already-interpolated) HTTP request to the booted
 * server and capture status, headers, and the raw body text. A request that
 * cannot complete (connection refused, timeout, abort) is an infrastructure
 * problem (mapped to the `error` outcome upstream), never a scenario `fail`.
 * Zero retries by design — the server was health-checked before any step ran.
 *
 * The one piece of state a request carries across steps is the caller's cookie
 * jar (see `./cookies.js`): cookies in, `Set-Cookie` out, so a session survives
 * the scenario without any scenario-level declaration.
 */

import type { GuardHttpRequest } from '@truecourse/shared'
import type { CookieJar } from './cookies.js'

export interface ApiStepCapture {
  /** HTTP status, or null when the request never completed. */
  status: number | null
  /** Response headers, lower-cased names. */
  headers: Record<string, string>
  /** Raw response body text. */
  bodyText: string
  timedOut: boolean
  /** Present when the request could not complete (connection refused, DNS, abort). */
  requestError?: string
  durationMs: number
}

export interface ExecuteApiRequestOptions {
  baseUrl: string
  request: GuardHttpRequest
  timeoutMs: number
  /** Run-level cancellation: aborts the in-flight request. */
  signal?: AbortSignal
  /**
   * The scenario's cookie jar. When present, matching stored cookies ride the
   * request as a `Cookie` header and the response's `Set-Cookie` lines are folded
   * back in — so a login step's session reaches every later step. A step that
   * writes its OWN `Cookie` header wins for that request (explicit beats implicit)
   * and the jar is left to observe the response as usual. Absent ⇒ no cookies.
   */
  cookies?: CookieJar
}

export async function executeApiRequest(opts: ExecuteApiRequestOptions): Promise<ApiStepCapture> {
  const start = Date.now()

  if (opts.signal?.aborted) {
    return { status: null, headers: {}, bodyText: '', timedOut: false, durationMs: 0 }
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, opts.timeoutMs)
  const onAbort = (): void => controller.abort()
  opts.signal?.addEventListener('abort', onAbort, { once: true })

  const { request } = opts
  const headers: Record<string, string> = { ...(request.headers ?? {}) }
  let body: string | undefined
  if (request.json !== undefined) {
    body = JSON.stringify(request.json)
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/json'
    }
  } else {
    body = request.body
  }

  // The jar fills `Cookie` only when the step did not write one itself.
  if (opts.cookies && !Object.keys(headers).some((h) => h.toLowerCase() === 'cookie')) {
    const cookieHeader = opts.cookies.header(request.path)
    if (cookieHeader) headers.cookie = cookieHeader
  }

  try {
    const res = await fetch(`${opts.baseUrl}${request.path}`, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      redirect: 'manual',
      signal: controller.signal,
    })
    const bodyText = await res.text()
    // `getSetCookie()` is the only accessor that keeps repeated `Set-Cookie`
    // headers apart (the joined form cannot be split — `Expires` carries commas).
    opts.cookies?.store(res.headers.getSetCookie(), request.path)
    const headerRecord: Record<string, string> = {}
    res.headers.forEach((value, name) => {
      headerRecord[name.toLowerCase()] = value
    })
    return {
      status: res.status,
      headers: headerRecord,
      bodyText,
      timedOut: false,
      durationMs: Date.now() - start,
    }
  } catch (e) {
    return {
      status: null,
      headers: {},
      bodyText: '',
      timedOut,
      ...(timedOut ? {} : { requestError: e instanceof Error ? (e.cause instanceof Error ? `${e.message}: ${e.cause.message}` : e.message) : String(e) }),
      durationMs: Date.now() - start,
    }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}
