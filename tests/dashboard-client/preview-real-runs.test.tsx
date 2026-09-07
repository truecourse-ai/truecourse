/**
 * The runs of a REAL (URL-connected) repository, streaming into the shell.
 *
 * The shell follows every real repository's agent runs over the one socket it
 * holds, so a run that starts anywhere shows up on whatever page the user is
 * on: a toast, a job chain, the `onboarding` marker on the repository's row,
 * and a notification when it starts and again when it settles.
 *
 * The socket here is a hand-rolled emitter: the point of every case below is
 * what the shell does with a `session:runs-changed` event, so the test fires
 * them and lets the shell re-read the runs the fake server holds.
 *
 * The fixtures are the control group. A fixture repository has no real runs, so
 * its rows, its jobs and its notifications must come out exactly as before.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';

// A socket the test drives. `fireSocket` delivers to whatever the shell
// subscribed, which is the only thing these cases need it to do.
const listeners = new Map<string, Set<(payload: unknown) => void>>();
const socketMock = vi.hoisted(() => ({ joins: [] as string[], leaves: [] as string[] }));

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
    joinRepoRoom: (id: string) => socketMock.joins.push(id),
    leaveRepoRoom: (id: string) => socketMock.leaves.push(id),
  };
});

import PreviewApp from '@/preview/PreviewApp';
import { relativeTime, repoRunState, toJobChain } from '@/preview/shell/real-runs';
import type { PublicSessionRun } from '@/lib/api';

function fireSocket(event: string, payload: unknown): void {
  for (const fn of listeners.get(event) ?? []) fn(payload);
}

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const REAL = {
  id: 'linkwarden',
  name: 'linkwarden/linkwarden',
  path: '/clones/linkwarden__linkwarden',
  remoteUrl: 'https://github.com/linkwarden/linkwarden',
};

function runningScan(overrides: Partial<PublicSessionRun> = {}): PublicSessionRun {
  return {
    command: 'spec-scan',
    runId: '2026-08-25T10-00-00Z_abcd1234',
    gitRef: 'deadbeef',
    startedAt: new Date().toISOString(),
    status: 'running',
    // The checklist is one of the run's own display blocks — the shell reads
    // it there, and has no run-level shape of its own.
    display: {
      blocks: [
        {
          kind: 'checklist',
          items: [
            { key: 'discover', label: 'Discover documents', status: 'done', detail: '41 docs · 12 to curate' },
            { key: 'tag', label: 'Curate documents', status: 'active', detail: '3/12 docs' },
            { key: 'overlap', label: 'Compare areas', status: 'pending' },
            { key: 'verify', label: 'Verify anchors', status: 'pending' },
          ],
        },
      ],
    },
    sessions: [],
    ...overrides,
  } as PublicSessionRun;
}

const realFetch = window.fetch;

/** A server holding one real repository and a mutable run list for it. */
function serve(runs: PublicSessionRun[]) {
  const state = { runs };
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    if (pathname === '/api/repos') return json([REAL]);
    if (pathname === `/api/repos/${REAL.id}/sessions/runs`) return json({ runs: state.runs });
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
  return state;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/preview/*" element={<PreviewApp />} />
      </Routes>
      {/* The real app mounts the Toaster; the preview routes are a descendant of it. */}
      <Toaster />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listeners.clear();
  socketMock.joins.length = 0;
  socketMock.leaves.length = 0;
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// The mapping, on its own
// ---------------------------------------------------------------------------

describe('a run record as the shell reads it', () => {
  const repo = { id: 'linkwarden', fullName: 'linkwarden/linkwarden' };

  it('is an onboarding job whose steps are the run checklist', () => {
    const job = toJobChain(repo, runningScan(), true);
    expect(job.title).toBe('Onboarding linkwarden/linkwarden');
    expect(job.href).toBe('/preview/repos/linkwarden/activity');
    expect(job.steps).toEqual([
      { key: 'discover', label: 'Discover documents', state: 'done', counter: '41 docs · 12 to curate' },
      { key: 'tag', label: 'Curate documents', state: 'active', counter: '3/12 docs' },
      { key: 'overlap', label: 'Compare areas', state: 'pending' },
      { key: 'verify', label: 'Verify anchors', state: 'pending' },
    ]);
  });

  it('names the command instead of onboarding on a re-scan', () => {
    expect(toJobChain(repo, runningScan(), false).title).toBe('Spec scan linkwarden/linkwarden');
  });

  it('has one honest step before the run publishes a checklist', () => {
    const job = toJobChain(repo, runningScan({ display: undefined }), true);
    expect(job.steps).toEqual([{ key: 'start', label: 'Starting', state: 'active' }]);
  });

  it('reads onboarding off the first scan and the last check off what settled', () => {
    const now = Date.parse('2026-08-25T10:10:00Z');
    expect(repoRunState([runningScan()], now)).toMatchObject({ onboarding: true, scanning: true });

    const done = runningScan({ status: 'completed', finishedAt: '2026-08-25T10:05:00Z' });
    const state = repoRunState([done], now);
    expect(state.onboarding).toBe(false);
    expect(state.scanning).toBe(false);
    // A rescan after the first settled: scanning, not onboarding.
    const later = new Date(Date.parse(done.startedAt) + 60_000).toISOString();
    expect(repoRunState([done, runningScan({ runId: 'rescan', startedAt: later })], now)).toMatchObject({
      onboarding: false,
      scanning: true,
    });
    expect(state.lastCheck).toEqual({
      conclusion: 'neutral',
      word: 'Neutral',
      summary: 'Spec scan completed',
      at: '5 minutes ago',
    });

    const failed = runningScan({ status: 'failed', finishedAt: '2026-08-25T10:09:00Z' });
    expect(repoRunState([failed], now).lastCheck?.summary).toBe('Spec scan failed');
  });

  it('says just now inside a minute, and counts up from there', () => {
    const now = Date.parse('2026-08-25T12:00:00Z');
    expect(relativeTime('2026-08-25T11:59:50Z', now)).toBe('just now');
    expect(relativeTime('2026-08-25T11:58:00Z', now)).toBe('2 minutes ago');
    expect(relativeTime('2026-08-25T09:00:00Z', now)).toBe('3 hours ago');
    expect(relativeTime(undefined, now)).toBe('just now');
  });
});

// ---------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------

describe('a real run in the shell', () => {
  it('announces a run that starts while the page is open, and marks the row onboarding', async () => {
    const state = serve([]);
    // Home is not where the subscription lives — the shell is — so any address
    // would do here. This one is also the address that shows the marker.
    renderAt('/preview');

    // The room is joined for the real repository — that is what makes the
    // server watch its store at all.
    await waitFor(() => expect(socketMock.joins).toContain('linkwarden'));
    // The world is loaded and idle; NOW the scan starts.
    const row = (await screen.findByText('linkwarden/linkwarden')).closest('tr')!;
    state.runs = [runningScan()];
    fireSocket('session:runs-changed', { repoId: 'linkwarden' });

    // The toast: one announcement, pointing at the preview's own Activity.
    expect(await screen.findByText('Onboarding linkwarden/linkwarden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Activity/ })).toBeInTheDocument();

    // The row says onboarding while the first scan is up.
    await waitFor(() => expect(within(row).getByText('onboarding')).toBeInTheDocument());

    // The same page, when the run settles: the marker is gone, no reload.
    state.runs = [runningScan({ status: 'completed', finishedAt: new Date().toISOString() })];
    fireSocket('session:runs-changed', { repoId: 'linkwarden' });
    await waitFor(() => expect(within(row).queryByText('onboarding')).toBeNull());
  });

  it('stays silent for a run already in flight when the page loads (every sign-in reloads)', async () => {
    serve([runningScan()]);
    renderAt('/preview');

    // The run is known — the row carries the onboarding marker — but it was
    // in flight on arrival, so it never toasts. The runs arrive AFTER the
    // fixture jobs do (two async hops), which is exactly the window the
    // announce snapshot has to wait out.
    const row = (await screen.findByText('linkwarden/linkwarden')).closest('tr')!;
    await waitFor(() => expect(within(row).getByText('onboarding')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Open Activity/ })).toBeNull();
  });

  it('files a notification when the run starts and another when it settles', async () => {
    const state = serve([runningScan()]);
    renderAt('/preview/notifications');

    const started = await screen.findByText('Spec scan started on linkwarden/linkwarden');
    // Newest first: the real row sits ahead of the fixture feed.
    const newestFixture = screen.getByText('Gate failed on acme/orders-api #482');
    expect(
      started.compareDocumentPosition(newestFixture) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText(/Spec scan completed on/)).toBeNull();

    state.runs = [runningScan({ status: 'completed', finishedAt: new Date().toISOString() })];
    fireSocket('session:runs-changed', { repoId: 'linkwarden' });

    expect(
      await screen.findByText('Spec scan completed on linkwarden/linkwarden'),
    ).toBeInTheDocument();
    // The start stays: the feed is a history, not a status line.
    expect(screen.getByText('Spec scan started on linkwarden/linkwarden')).toBeInTheDocument();
    // The fixtures are still there, below it.
    expect(screen.getByText('Gate failed on acme/orders-api #482')).toBeInTheDocument();
  });

  it('files a failure when the run fails', async () => {
    const state = serve([runningScan()]);
    renderAt('/preview/notifications');
    await screen.findByText('Spec scan started on linkwarden/linkwarden');

    state.runs = [runningScan({ status: 'failed', finishedAt: new Date().toISOString() })];
    fireSocket('session:runs-changed', { repoId: 'linkwarden' });

    expect(await screen.findByText('Spec scan failed on linkwarden/linkwarden')).toBeInTheDocument();
  });

  it('leaves the fixtures exactly as they were', async () => {
    // No real repositories at all: the mock is the whole preview again.
    window.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(href, window.location.origin);
      if (pathname === '/api/repos') return json([]);
      return json({ error: 'not found' }, 404);
    }) as unknown as typeof window.fetch;

    renderAt('/preview/notifications');

    // The fixture feed, unchanged and still first.
    expect(await screen.findByText('Gate failed on acme/orders-api #482')).toBeInTheDocument();
    expect(screen.queryByText(/Spec scan started on/)).toBeNull();
    // And no repository's sessions store was ever asked about.
    const calls = (window.fetch as unknown as { mock: { calls: [RequestInfo | URL][] } }).mock.calls;
    expect(calls.some(([input]) => String(input).includes('/sessions/runs'))).toBe(false);
    expect(socketMock.joins).toEqual([]);
  });

  it('renders the fixtures and nothing throws when there is no server', async () => {
    window.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof window.fetch;

    renderAt('/preview');
    expect(await screen.findByText('acme/orders-api')).toBeInTheDocument();
    expect(screen.queryByText(/Onboarding linkwarden/)).toBeNull();
  });
});
