// PREVIEW: REAL — starting an agentic run on a connected repository.

/**
 * Ask the server to start a run, and say what happened in words a surface can
 * act on.
 *
 * The route ENQUEUES: a `202` means the job is on the queue, not that the work
 * is done. Progress arrives on the run stream, so this promise is only ever
 * about whether the run started.
 *
 * Three refusals matter and each is its own outcome, because each has its own
 * remedy: the workspace has no provider (fill in Settings), the provider failed
 * its pre-flight probe (the provider's own words, which the user must read),
 * and the repository is already working (wait). The first two are coded in the
 * body's `error` field with the human sentence in `message` — so this reads the
 * body itself rather than going through `fetchApi`, whose one-string `ApiError`
 * would keep the code and drop the sentence.
 */

import { getServerUrl } from '@/lib/server-url';

export type RunStart =
  | { kind: 'started' }
  | { kind: 'not-configured'; message: string }
  | { kind: 'probe-failed'; message: string }
  | { kind: 'busy'; message: string }
  | { kind: 'failed'; message: string };

/** POST a repo-scoped start route (`spec/corpus/scan`, `guard/setup`, …). */
export async function startRun(repoId: string, path: string): Promise<RunStart> {
  const url = `${getServerUrl()}/api/repos/${encodeURIComponent(repoId)}/${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
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

export const startSpecScan = (repoId: string): Promise<RunStart> =>
  startRun(repoId, 'spec/corpus/scan');

export const startGuardSetup = (repoId: string): Promise<RunStart> =>
  startRun(repoId, 'guard/setup');

export const startGuardGenerate = (repoId: string): Promise<RunStart> =>
  startRun(repoId, 'guard/generate');
