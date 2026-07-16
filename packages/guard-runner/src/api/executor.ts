/**
 * Api-step executor — send ONE (already-interpolated) HTTP request to the booted
 * server and capture status, headers, and the raw body text. A request that
 * cannot complete (connection refused, timeout, abort) is an infrastructure
 * problem (mapped to the `error` outcome upstream), never a scenario `fail`.
 * Zero retries by design — the server was health-checked before any step ran.
 */

import type { GuardHttpRequest } from '@truecourse/shared'

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

  try {
    const res = await fetch(`${opts.baseUrl}${request.path}`, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      redirect: 'manual',
      signal: controller.signal,
    })
    const bodyText = await res.text()
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
