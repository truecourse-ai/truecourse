import type { ServerResponse } from 'node:http'

/** A delayed reply belongs to the listener and the client, never to a detached timer. */
export function waitForReply(res: ServerResponse, ms: number | undefined, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted || res.destroyed) return Promise.resolve(false)
  if (!ms) return Promise.resolve(true)
  return new Promise(resolve => {
    const finish = (ready: boolean) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      res.removeListener('close', cancel)
      resolve(ready)
    }
    const cancel = () => finish(false)
    const timer = setTimeout(() => finish(true), ms)
    signal.addEventListener('abort', cancel, { once: true })
    res.once('close', cancel)
  })
}

export async function sendScriptedResponse(
  res: ServerResponse,
  response: { status?: number; headers?: Record<string, string>; body?: string; json?: unknown; delayMs?: number; bodyDelayMs?: number; refuse?: true },
  signal: AbortSignal,
): Promise<void> {
  if (!await waitForReply(res, response.delayMs, signal)) return
  if (response.refuse) { res.destroy(); return }
  const payload = response.json !== undefined ? JSON.stringify(response.json) : response.body ?? ''
  res.writeHead(response.status ?? 200, {
    ...(response.json !== undefined ? { 'content-type': 'application/json' } : {}),
    ...response.headers,
  })
  if (response.bodyDelayMs) {
    res.flushHeaders()
    if (!await waitForReply(res, response.bodyDelayMs, signal)) return
  }
  res.end(payload)
}
