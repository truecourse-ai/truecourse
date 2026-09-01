/**
 * A run that ended badly, told in the three places a user could be standing.
 *
 * The run record carries its own reason, and that reason beats every derived
 * sentence: the index row prefers it to the checklist's "how far it got", the
 * run's own page states it outright, and the shell announces it once as it
 * happens — with a link to the run rather than to the tab it lives in.
 *
 * Announcing once matters: the runs are re-read on every store write, so the
 * surface tracks run ids, not renders. A run that was already failed when the
 * page loaded is history and stays silent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';

const listeners = new Map<string, Set<(payload: unknown) => void>>();

vi.mock('@/lib/socket', () => {
  const socket = {
    connected: true,
    on(event: string, fn: (payload: unknown) => void) {
      const set = listeners.get(event) ?? new Set();
      set.add(fn);
      listeners.set(event, set);
      return socket;
    },
    off(event: string, fn: (payload: unknown) => void) {
      listeners.get(event)?.delete(fn);
      return socket;
    },
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
import { toFailure, toNotifications } from '@/preview/shell/real-runs';
import { runStory } from '@/components/sessions/run-model';
import type { PublicSessionRun } from '@/lib/api';

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const REAL = {
  id: 'linkwarden',
  name: 'linkwarden/linkwarden',
  path: '/clones/linkwarden__linkwarden',
  remoteUrl: 'https://github.com/linkwarden/linkwarden',
};

const REASON = 'The provider refused the key: 401 invalid x-api-key';

/** A scan that got one step in before it died, so both stories are available. */
function scan(over: Partial<PublicSessionRun> = {}): PublicSessionRun {
  return {
    command: 'spec-scan',
    runId: '2026-08-30T10-00-00Z_dead',
    gitRef: 'deadbeef',
    startedAt: '2026-08-30T10:00:00.000Z',
    status: 'running',
    display: {
      blocks: [
        {
          kind: 'checklist',
          items: [
            { key: 'discover', label: 'Discover documents', status: 'done', detail: '41 docs' },
            { key: 'tag', label: 'Curate documents', status: 'active', detail: '3/12 docs' },
          ],
        },
      ],
    },
    sessions: [],
    ...over,
  } as PublicSessionRun;
}

const failed = (over: Partial<PublicSessionRun> = {}): PublicSessionRun =>
  scan({
    status: 'failed',
    finishedAt: '2026-08-30T10:00:04.000Z',
    error: { message: REASON, kind: 'llm-probe' },
    ...over,
  });

const realFetch = window.fetch;

function serve(runs: PublicSessionRun[]) {
  const state = { runs };
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    if (pathname === '/api/repos') return json([REAL]);
    if (pathname === '/api/llm/config') return json({ config: { provider: 'anthropic' }, providers: ['anthropic'] });
    if (pathname === `/api/repos/${REAL.id}/sessions/runs`) return json({ runs: state.runs });
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
  return state;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fireSocket(event: string, payload: unknown): void {
  for (const fn of listeners.get(event) ?? []) fn(payload);
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
  listeners.clear();
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// the model
// ---------------------------------------------------------------------------

describe('what a failed run says about itself', () => {
  it('prefers its own reason to the step the checklist stopped on', () => {
    const steps = [{ key: 'tag', label: 'Curate documents', status: 'active' as const, detail: '3/12 docs' }];
    expect(runStory(failed(), steps)).toBe(REASON);
    // Without one, the checklist is still the story.
    expect(runStory(scan(), steps)).toBe('curate documents · 3/12 docs');
  });

  it('is announced with the reason and an address that opens the run itself', () => {
    const repo = { id: REAL.id, fullName: REAL.name };
    expect(toFailure(repo, failed())).toEqual({
      id: `real-${REAL.id}-${failed().runId}`,
      title: 'Spec scan failed on linkwarden/linkwarden',
      body: REASON,
      href: `/preview/repos/${REAL.id}/activity?run=${encodeURIComponent(failed().runId)}`,
    });
    // A run that is merely finished is not an announcement.
    expect(toFailure(repo, scan({ status: 'completed' }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// the surfaces
// ---------------------------------------------------------------------------

describe('the Activity surface', () => {
  it('tells the reason on the row and again on the run', async () => {
    serve([failed()]);
    renderAt(ACTIVITY);
    const user = userEvent.setup();

    const row = await screen.findByRole('button', { name: /Open spec scan run/ });
    expect(row).toHaveTextContent(REASON);

    await user.click(row);
    expect(await screen.findByText(`Failed · ${REASON}`)).toBeInTheDocument();
  });

  it('leaves a run with nothing to confess alone', async () => {
    serve([scan({ status: 'completed', finishedAt: '2026-08-30T10:05:00.000Z' })]);
    renderAt(ACTIVITY);

    const row = await screen.findByRole('button', { name: /Open spec scan run/ });
    // The checklist's own sentence, not a reason it does not have.
    expect(row).toHaveTextContent('stopped at curate documents');
  });
});

describe('the failure toast', () => {
  it('fires once when a watched run dies, and carries the reason', async () => {
    const state = serve([scan()]);
    renderAt('/preview');

    // The world is loaded and the scan is up; NOW it dies.
    await screen.findByText('linkwarden/linkwarden');
    await waitFor(() => expect(state.runs[0]!.status).toBe('running'));
    state.runs = [failed()];
    fireSocket('session:runs-changed', { repoId: REAL.id });

    expect(await screen.findByText('Spec scan failed on linkwarden/linkwarden')).toBeInTheDocument();
    expect(screen.getByText(REASON)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open run/ })).toBeInTheDocument();

    // Every store write re-reads the runs; the announcement is per run, not per read.
    fireSocket('session:runs-changed', { repoId: REAL.id });
    fireSocket('session:runs-changed', { repoId: REAL.id });
    await waitFor(() =>
      expect(screen.getAllByText('Spec scan failed on linkwarden/linkwarden')).toHaveLength(1),
    );
  });

  it('stays silent for a run that was already dead when the page loaded', async () => {
    serve([failed()]);
    renderAt('/preview');

    await screen.findByText('linkwarden/linkwarden');
    // The row knows; the shell does not shout about it.
    await waitFor(() => expect(screen.queryByRole('button', { name: /Open run/ })).toBeNull());
    expect(screen.queryByText('Spec scan failed on linkwarden/linkwarden')).toBeNull();
  });

  it('files the failure in the feed as well, still holding the reason', async () => {
    serve([failed()]);
    renderAt('/preview/notifications');

    expect(await screen.findByText('Spec scan failed on linkwarden/linkwarden')).toBeInTheDocument();
    // The feed row shows the title only, so the reason is asserted on the
    // notification itself: it is what a reader searches and what the bell body
    // renders.
    const settled = toNotifications({ id: REAL.id, fullName: REAL.name }, failed(), Date.now()).at(-1);
    expect(settled?.body).toBe(REASON);
  });
});
