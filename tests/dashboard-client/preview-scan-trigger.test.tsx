/**
 * Starting a run from the product surface, and being told when it cannot.
 *
 * The start route ENQUEUES (202) and answers three refusals that each have
 * their own remedy — no provider configured, a provider that failed its
 * pre-flight probe, and a repository already working — and two of them share a
 * status code, so the helper reads the body's own error CODE rather than the
 * number.
 *
 * Above it sit the two affordances: a connected repository with no corpus is
 * offered its first scan on Corpus, and a conversation that ended badly is
 * offered another go on the Agent page. A command with no entry in the trigger
 * map has no button, which is how guard's steps stay quiet until they have one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';

vi.mock('@/lib/socket', () => {
  const socket = {
    connected: false,
    on: () => socket,
    off: () => socket,
    emit: vi.fn(),
    connect: vi.fn(),
  };
  return {
    connectSocket: () => socket,
    getSocket: () => socket,
    disconnectSocket: vi.fn(),
    joinRepoRoom: vi.fn(),
    leaveRepoRoom: vi.fn(),
  };
});

vi.mock('@/components/sessions/RunConversationPage', () => ({
  RunConversationPage: () => <div data-testid="conversation" />,
}));

import PreviewApp from '@/preview/PreviewApp';
import { startGuardGenerate, startGuardSetup, startSpecScan } from '@/preview/data/scan';
import { triggerFor } from '@/preview/data/run-triggers';
import type { PublicSessionRun } from '@/lib/api';

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const realFetch = window.fetch;

const REAL = {
  id: 'linkwarden',
  name: 'linkwarden/linkwarden',
  path: '/clones/linkwarden__linkwarden',
  remoteUrl: 'https://github.com/linkwarden/linkwarden',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function failedScan(over: Partial<PublicSessionRun> = {}): PublicSessionRun {
  return {
    command: 'spec-scan',
    runId: '2026-08-30T10-00-00Z_dead',
    gitRef: 'deadbeef',
    startedAt: '2026-08-30T10:00:00.000Z',
    finishedAt: '2026-08-30T10:00:04.000Z',
    status: 'failed',
    sessions: [],
    ...over,
  } as PublicSessionRun;
}

/** A world: one connected repository, its runs, its workspace provider. */
function serve(options: {
  runs?: PublicSessionRun[];
  config?: unknown;
  scan?: () => Response;
  setup?: () => Response;
  generate?: () => Response;
}) {
  const calls: string[] = [];
  const scan = options.scan ?? (() => json({ jobId: 'job_1' }, 202));
  const setup = options.setup ?? (() => json({ jobId: 'job_2' }, 202));
  const generate = options.generate ?? (() => json({ jobId: 'job_3' }, 202));
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(method === 'GET' ? `${url.pathname}${url.search}` : `${method} ${url.pathname}`);
    if (url.pathname === '/api/repos') return json([REAL]);
    if (url.pathname === '/api/llm/config') {
      return json({ config: options.config ?? null, providers: ['anthropic'] });
    }
    if (url.pathname === `/api/repos/${REAL.id}/sessions/runs`) return json({ runs: options.runs ?? [] });
    if (url.pathname === '/api/sessions/runs') {
      return json({ runs: (options.runs ?? []).map((run) => ({ ...run, repo: { id: REAL.id, fullName: REAL.name } })) });
    }
    if (url.pathname.startsWith('/api/sessions/runs/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/sessions/runs/'.length));
      const found = (options.runs ?? []).find((r) => r.runId === id);
      return found
        ? json({ run: { ...found, repo: { id: REAL.id, fullName: REAL.name } } })
        : json({ error: 'run not found' }, 404);
    }
    if (url.pathname === `/api/repos/${REAL.id}/spec/corpus/scan`) return scan();
    if (url.pathname === `/api/repos/${REAL.id}/guard/setup`) return setup();
    if (url.pathname === `/api/repos/${REAL.id}/guard/generate`) return generate();
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
  return calls;
}

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/preview/*" element={<PreviewApp />} />
      </Routes>
      <Toaster />
    </MemoryRouter>,
  );
}

/** Where the first scan is started from: the repository's Corpus. */
const CORPUS = `/preview/repos/${REAL.id}/corpus`;

/** One conversation, where another go at it is offered. */
const conversation = (runId: string) => `/preview/agent/${encodeURIComponent(runId)}`;

beforeEach(() => {
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// the helper, on its own
// ---------------------------------------------------------------------------

describe('starting a run', () => {
  it('reads the refusals apart by their code, not their status', async () => {
    serve({
      scan: () => json({ error: 'llm-not-configured', message: 'This workspace has no LLM provider.' }, 409),
    });
    expect(await startSpecScan('linkwarden')).toEqual({
      kind: 'not-configured',
      message: 'This workspace has no LLM provider.',
    });

    serve({
      scan: () => json({ error: 'llm-probe-failed', message: '401 invalid x-api-key' }, 502),
    });
    expect(await startSpecScan('linkwarden')).toEqual({
      kind: 'probe-failed',
      message: '401 invalid x-api-key',
    });

    // Same 409 as the unconfigured case, and only the code tells them apart.
    serve({
      scan: () => json({ error: 'A spec scan is already running for this repository.' }, 409),
    });
    expect(await startSpecScan('linkwarden')).toEqual({
      kind: 'busy',
      message: 'A spec scan is already running for this repository.',
    });
  });

  it('POSTs the start route, and calls the 202 a start', async () => {
    const calls = serve({ scan: () => json({ jobId: 'job_1' }, 202) });
    expect(await startSpecScan('linkwarden')).toEqual({ kind: 'started' });
    expect(calls).toContain('POST /api/repos/linkwarden/spec/corpus/scan');
  });

  it('starts guard setup through the same route shape', async () => {
    const calls = serve({ setup: () => json({ jobId: 'job_2' }, 202) });
    expect(await startGuardSetup('linkwarden')).toEqual({ kind: 'started' });
    expect(calls).toContain('POST /api/repos/linkwarden/guard/setup');
  });

  it('starts scenario generation through the same route shape', async () => {
    const calls = serve({ generate: () => json({ jobId: 'job_3' }, 202) });
    expect(await startGuardGenerate('linkwarden')).toEqual({ kind: 'started' });
    expect(calls).toContain('POST /api/repos/linkwarden/guard/generate');
  });

  it('offers a trigger for the scan, guard setup and generate, none for one with no start yet', () => {
    expect(triggerFor('spec-scan')).not.toBeNull();
    expect(triggerFor('guard-setup')).not.toBeNull();
    expect(triggerFor('guard-generate')).not.toBeNull();
    expect(triggerFor('guard-adjudicate')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// the affordances
// ---------------------------------------------------------------------------

describe('the surfaces of a connected repository', () => {
  it('offers the first scan on Corpus, and starts it', async () => {
    const calls = serve({ runs: [], config: { provider: 'anthropic' } });
    renderAt(CORPUS);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Scan' }));
    await waitFor(() =>
      expect(calls).toContain(`POST /api/repos/${REAL.id}/spec/corpus/scan`),
    );
  });

  it('offers another go at a conversation that ended badly', async () => {
    const failed = failedScan({ error: { message: 'The provider refused the key.', kind: 'llm-probe' } });
    const calls = serve({ runs: [failed], config: { provider: 'anthropic' } });
    renderAt(conversation(failed.runId));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Run again' }));
    await waitFor(() =>
      expect(calls).toContain(`POST /api/repos/${REAL.id}/spec/corpus/scan`),
    );
  });

  it.each(['interrupted', 'failed'] as const)('resumes %s generation with its run ID', async status => {
    const run = failedScan({ command: 'guard-generate', status });
    serve({ runs: [run], config: { provider: 'anthropic' } });
    renderAt(conversation(run.runId));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(window.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/api/repos/${REAL.id}/guard/generate`),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ resumeRunId: run.runId }) }),
    ));
    expect(screen.queryByRole('button', { name: 'Run again' })).toBeNull();
  });

  it('leaves a finished one alone', async () => {
    const done = failedScan({ status: 'completed', error: undefined });
    serve({ runs: [done], config: { provider: 'anthropic' } });
    renderAt(conversation(done.runId));

    expect(await screen.findByRole('heading', { name: 'Document scan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run again' })).toBeNull();
  });

  it('names the remedy when the workspace has no provider', async () => {
    serve({
      runs: [],
      scan: () => json({ error: 'llm-not-configured', message: 'Set one in Settings.' }, 409),
    });
    renderAt(CORPUS);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Scan' }));
    expect(await screen.findByText('No LLM provider configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Models' })).toBeInTheDocument();
  });

  it('quotes the provider when its pre-flight probe fails', async () => {
    serve({
      runs: [],
      config: { provider: 'anthropic' },
      scan: () => json({ error: 'llm-probe-failed', message: '401 invalid x-api-key' }, 502),
    });
    renderAt(CORPUS);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Scan' }));
    expect(
      await screen.findByText('Provider check failed: 401 invalid x-api-key'),
    ).toBeInTheDocument();
  });

  it('says so when the repository is already scanning', async () => {
    serve({
      runs: [],
      config: { provider: 'anthropic' },
      scan: () => json({ error: 'A spec scan is already running for this repository.' }, 409),
    });
    renderAt(CORPUS);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Scan' }));
    expect(await screen.findByText('A run is already in progress')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// the banner
// ---------------------------------------------------------------------------

describe('a workspace with no provider', () => {
  it('says so on a connected repository, with the way to set one', async () => {
    serve({ runs: [], config: null });
    renderAt(CORPUS);

    expect(
      await screen.findByText(/No LLM provider configured\. Spec scans cannot run/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set one in Settings' })).toHaveAttribute(
      'href',
      '/preview/settings/models',
    );
  });

  it('stays quiet once one is set', async () => {
    serve({ runs: [], config: { provider: 'anthropic' } });
    renderAt(CORPUS);

    await screen.findByRole('button', { name: 'Scan' });
    expect(screen.queryByText(/No LLM provider configured\./)).toBeNull();
  });

  it('stays quiet when the read never answered, which is not the same claim', async () => {
    window.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(href, window.location.origin);
      if (pathname === '/api/repos') return json([REAL]);
      if (pathname === `/api/repos/${REAL.id}/sessions/runs`) return json({ runs: [] });
      if (pathname === '/api/sessions/runs') return json({ runs: [] });
      return json({ error: 'no session' }, 403);
    }) as unknown as typeof window.fetch;
    renderAt(CORPUS);

    await screen.findByRole('button', { name: 'Scan' });
    expect(screen.queryByText(/No LLM provider configured\./)).toBeNull();
  });
});
