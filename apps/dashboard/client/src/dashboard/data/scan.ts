/**
 * Ask the server to start a run, and say what happened in words a surface can
 * act on.
 *
 * The route ENQUEUES: a `202` means the job is on the queue, not that the work
 * is done. Progress arrives on the run stream, so this promise is only ever
 * about whether the run started.
 *
 * Six refusals matter and each is its own outcome, because each has its own
 * remedy: the workspace has not said what its product is (Settings › Workspace,
 * and the scan has nothing to attribute against without it), it has no provider
 * to run on (Settings › Models — which is also where a workspace that chose
 * credits on a server holding no platform key is sent), the provider failed its
 * pre-flight probe (the provider's own words, which the user must read), a
 * workspace on TrueCourse credits has no model price to be charged at yet (try
 * again shortly), its credit balance is empty (Settings › Credits), and the
 * repository is already working (wait). All but the last are coded in the
 * body's `error` field with the human sentence in `message` — so this reads the
 * body itself rather than going through `fetchApi`, whose one-string `ApiError`
 * would keep the code and drop the sentence.
 */

import {
  CREDITS_EXHAUSTED,
  CREDITS_PRICES_UNAVAILABLE,
  CREDITS_PROVIDER_UNAVAILABLE,
  WORKSPACE_DESCRIPTION_REQUIRED,
} from '@truecourse/shared';
import { getServerUrl } from '@/lib/server-url';

export type RunStart =
  | { kind: 'started' }
  | { kind: 'not-configured'; message: string }
  /** The workspace has not said what its product is; the scan has no subject. */
  | { kind: 'no-description'; message: string }
  | { kind: 'probe-failed'; message: string }
  /** The workspace spends credits and there is no price to charge the run at yet. */
  | { kind: 'prices-unavailable'; message: string }
  /** The workspace spends credits and its balance is empty. */
  | { kind: 'no-credits'; message: string }
  | { kind: 'busy'; message: string }
  | { kind: 'failed'; message: string };

/** POST a repo-scoped start route (`spec/corpus/scan`, `guard/setup`, …). */
export async function startRun(repoId: string, path: string, payload?: unknown): Promise<RunStart> {
  const url = `${getServerUrl()}/api/repos/${encodeURIComponent(repoId)}/${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch (e) {
    return { kind: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
  if (res.ok) return { kind: 'started' };

  return refusalOf(res);
}

export const startGuardSetup = (repoId: string): Promise<RunStart> =>
  startRun(repoId, 'guard/setup');

export const startGuardGenerate = (repoId: string, resumeRunId?: string): Promise<RunStart> =>
  startRun(repoId, 'guard/generate', resumeRunId ? { resumeRunId } : undefined);

export const startGuardRun = (repoId: string): Promise<RunStart> => startRun(repoId, 'guard/run');

/**
 * The workspace Document scan — the one run that belongs to no repository, so
 * it is started at the workspace address rather than under a repository's. Its
 * refusals are the repository routes' own, word for word.
 */
export async function startContextScan(): Promise<RunStart> {
  const url = `${getServerUrl()}/api/context/scan`;
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
  return refusalOf(res);
}

/**
 * Name the refusal by its code, never its status: an unconfigured workspace, an
 * empty balance and a busy repository all answer 409, and only the code tells
 * them apart. A 409 that names no code is the busy one.
 */
async function refusalOf(res: Response): Promise<RunStart> {
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  const code = body?.error ?? '';
  const message = body?.message || code || `The server answered ${res.status}.`;
  if (code === WORKSPACE_DESCRIPTION_REQUIRED) return { kind: 'no-description', message };
  if (code === 'llm-not-configured' || code === CREDITS_PROVIDER_UNAVAILABLE) {
    return { kind: 'not-configured', message };
  }
  if (code === 'llm-probe-failed') return { kind: 'probe-failed', message };
  if (code === CREDITS_PRICES_UNAVAILABLE) return { kind: 'prices-unavailable', message };
  if (code === CREDITS_EXHAUSTED) return { kind: 'no-credits', message };
  if (res.status === 409) return { kind: 'busy', message };
  return { kind: 'failed', message };
}
