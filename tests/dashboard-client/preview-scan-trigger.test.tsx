/**
 * Starting a scan from the product surface, and being told when it cannot.
 *
 * The start route answers three refusals that each have their own remedy — no
 * provider configured, a provider that failed its pre-flight probe, and a
 * repository already scanning — and two of them share a status code, so the
 * helper reads the body's own error CODE rather than the number.
 *
 * Above it sit the two affordances: a connected repository with no runs is
 * offered its first scan, and a run that ended badly is offered another. A
 * command with no entry in the trigger map has no button, which is how guard's
 * steps stay quiet until they have one.
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

import PreviewApp from '@/preview/PreviewApp';
import { startSpecScan } from '@/preview/data/scan';
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
}) {
  const calls: string[] = [];
  const scan = options.scan ?? (() => json({ noChanges: false }));
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    calls.push(`${url.pathname}${url.search}`);
    if (url.pathname === '/api/repos') return json([REAL]);
    if (url.pathname === '/api/llm/config') {
      return json({ config: options.config ?? null, providers: ['anthropic'] });
    }
    if (url.pathname === `/api/repos/${REAL.id}/sessions/runs`) return json({ runs: options.runs ?? [] });
    if (url.pathname === `/api/repos/${REAL.id}/spec/corpus/scan`) return scan();
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

const ACTIVITY = `/preview/repos/${REAL.id}/activity`;

beforeEach(() => {
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// the helper, on its own
// ---------------------------------------------------------------------------

describe('starting a scan', () => {
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

  it('asks without the estimate gate, and calls a 200 a start', async () => {
    const calls = serve({});
    expect(await startSpecScan('linkwarden')).toEqual({ kind: 'started' });
    expect(calls).toContain('/api/repos/linkwarden/spec/corpus/scan?confirm=none');
  });

  it('offers a trigger for the scan and none for a command that has no start yet', () => {
    expect(triggerFor('spec-scan')).not.toBeNull();
    expect(triggerFor('guard-generate')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// the affordances
// ---------------------------------------------------------------------------

describe('the Activity surface of a connected repository', () => {
  it('offers the first scan when the store is empty, and starts it', async () => {
    const calls = serve({ runs: [], config: { provider: 'anthropic' } });
    renderAt(ACTIVITY);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Start scan' }));
    await waitFor(() =>
      expect(calls).toContain(`/api/repos/${REAL.id}/spec/corpus/scan?confirm=none`),
    );
  });

  it('offers another run on one that ended badly, and none on one that finished', async () => {
    const calls = serve({
      runs: [failedScan({ error: { message: 'The provider refused the key.', kind: 'llm-probe' } })],
      config: { provider: 'anthropic' },
    });
    renderAt(ACTIVITY);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Open spec scan run/ }));
    await user.click(await screen.findByRole('button', { name: 'Run again' }));
    await waitFor(() =>
      expect(calls).toContain(`/api/repos/${REAL.id}/spec/corpus/scan?confirm=none`),
    );
  });

  it('leaves a finished run alone', async () => {
    serve({
      runs: [failedScan({ status: 'completed', error: undefined })],
      config: { provider: 'anthropic' },
    });
    renderAt(ACTIVITY);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Open spec scan run/ }));
    expect(await screen.findByText(/spec scan/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run again' })).toBeNull();
  });

  it('names the remedy when the workspace has no provider', async () => {
    serve({
      runs: [],
      scan: () => json({ error: 'llm-not-configured', message: 'Set one in Settings.' }, 409),
    });
    renderAt(ACTIVITY);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Start scan' }));
    expect(await screen.findByText('No LLM provider configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Models' })).toBeInTheDocument();
  });

  it('quotes the provider when its pre-flight probe fails', async () => {
    serve({
      runs: [],
      config: { provider: 'anthropic' },
      scan: () => json({ error: 'llm-probe-failed', message: '401 invalid x-api-key' }, 502),
    });
    renderAt(ACTIVITY);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Start scan' }));
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
    renderAt(ACTIVITY);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Start scan' }));
    expect(await screen.findByText('A scan is already running')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// the banner
// ---------------------------------------------------------------------------

describe('a workspace with no provider', () => {
  it('says so on a connected repository, with the way to set one', async () => {
    serve({ runs: [], config: null });
    renderAt(ACTIVITY);

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
    renderAt(ACTIVITY);

    await screen.findByRole('button', { name: 'Start scan' });
    expect(screen.queryByText(/No LLM provider configured\./)).toBeNull();
  });

  it('stays quiet when the read never answered, which is not the same claim', async () => {
    window.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(href, window.location.origin);
      if (pathname === '/api/repos') return json([REAL]);
      if (pathname === `/api/repos/${REAL.id}/sessions/runs`) return json({ runs: [] });
      return json({ error: 'no session' }, 403);
    }) as unknown as typeof window.fetch;
    renderAt(ACTIVITY);

    await screen.findByRole('button', { name: 'Start scan' });
    expect(screen.queryByText(/No LLM provider configured\./)).toBeNull();
  });
});
