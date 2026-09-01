// PREVIEW: REAL — starting a spec scan on a connected repository.

/**
 * Start a scan, and say what happened in words a surface can act on.
 *
 * `?confirm=none` skips the estimate gate: pressing the button IS the
 * confirmation here, so there is no second dialog to answer over a socket.
 *
 * Three refusals matter and each is its own outcome, because each has its own
 * remedy: the workspace has no provider (fill in Settings), the provider failed
 * its pre-flight probe (the provider's own words, which the user must read),
 * and a scan is already running (wait). The first two are coded in the body's
 * `error` field with the human sentence in `message` — so this reads the body
 * itself rather than going through `fetchApi`, whose one-string `ApiError`
 * would keep the code and drop the sentence.
 *
 * `started` resolves only when the scan ENDS: the route runs the whole scan
 * inside the request. Callers watch the run stream for progress and use this
 * promise for its refusals, not as a finish line.
 */

import { getServerUrl } from '@/lib/server-url';

export type ScanStart =
  | { kind: 'started' }
  | { kind: 'not-configured'; message: string }
  | { kind: 'probe-failed'; message: string }
  | { kind: 'busy'; message: string }
  | { kind: 'failed'; message: string };

export async function startSpecScan(repoId: string): Promise<ScanStart> {
  const url = `${getServerUrl()}/api/repos/${encodeURIComponent(repoId)}/spec/corpus/scan?confirm=none`;
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return { kind: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
  if (res.ok) return { kind: 'started' };

  const body = (await res.json().catch(() => null)) as
    | { error?: string; message?: string }
    | null;
  const code = body?.error ?? '';
  const detail = body?.message ?? code ?? '';
  const message = detail || `The server answered ${res.status}.`;
  // The code, not the status: an unconfigured workspace and a busy repository
  // both answer 409.
  if (code === 'llm-not-configured') return { kind: 'not-configured', message };
  if (code === 'llm-probe-failed') return { kind: 'probe-failed', message };
  if (res.status === 409) return { kind: 'busy', message };
  return { kind: 'failed', message };
}
