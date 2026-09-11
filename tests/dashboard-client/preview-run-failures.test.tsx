/**
 * A run that ended badly, told in the three places a user could be standing.
 *
 * The run record carries its own reason, and that reason beats every derived
 * sentence: the conversation opens with it rather than with how far the
 * checklist got, and the shell announces it once as it happens, with a link to
 * the conversation itself rather than to the page it is listed on.
 *
 * Announcing once matters: the runs are re-read on every store write, so the
 * surface tracks run ids, not renders. A run that was already failed when the
 * page loaded is history and stays silent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
    if (pathname === '/api/sessions/runs') {
      return json({ runs: state.runs.map((run) => ({ ...run, repo: { id: REAL.id, fullName: REAL.name } })) });
    }
    const one = /^\/api\/sessions\/runs\/(.+)$/.exec(pathname);
    if (one) {
      const found = state.runs.find((run) => run.runId === decodeURIComponent(one[1]));
      return found
        ? json({ run: { ...found, repo: { id: REAL.id, fullName: REAL.name } } })
        : json({ error: 'not found' }, 404);
    }
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

const AGENT = '/preview/agent';

beforeEach(() => {
  listeners.clear();
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// the conversation
// ---------------------------------------------------------------------------

describe('what a failed run says about itself', () => {
  it('opens the conversation with its own reason under the step it died in', async () => {
    serve([failed()]);
    renderAt(`${AGENT}/${encodeURIComponent(failed().runId)}`);

    const reason = await screen.findByText(REASON);
    // The step that was open when the run died carries the reason; the one it
    // got through stays as it was.
    const done = screen.getByRole('heading', { name: 'Discover documents' });
    const dying = screen.getByRole('heading', { name: 'Curate documents' });
    expect(done.compareDocumentPosition(dying) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dying.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says nothing of the sort when the run has no reason to give', async () => {
    serve([scan()]);
    renderAt(`${AGENT}/${encodeURIComponent(scan().runId)}`);

    // The checklist is the whole story: the steps, and their own counters.
    await screen.findByRole('heading', { name: 'Curate documents' });
    expect(screen.getByText('3/12 docs')).toBeInTheDocument();
    expect(screen.queryByText(REASON)).toBeNull();
  });

  it('is announced with the reason and an address that opens the run itself', () => {
    const repo = { id: REAL.id, fullName: REAL.name };
    expect(toFailure(repo, failed())).toEqual({
      id: `real-${REAL.id}-${failed().runId}`,
      title: 'Document scan failed on linkwarden/linkwarden',
      body: REASON,
      href: `/preview/agent/${encodeURIComponent(failed().runId)}`,
    });
    // A run that is merely finished is not an announcement.
    expect(toFailure(repo, scan({ status: 'completed' }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// the surfaces
// ---------------------------------------------------------------------------

describe('the Agent index', () => {
  it('says a conversation failed, and opens at its own address', async () => {
    serve([failed()]);
    renderAt(AGENT);

    const table = await screen.findByRole('table', { name: 'Agent conversations' });
    const row = within(table).getAllByRole('row')[1]!;
    expect(within(row).getByText('Failed')).toBeInTheDocument();
    // The reason is the conversation's to tell; the row carries the status.
    expect(row).not.toHaveTextContent(REASON);
  });

  it('leaves a conversation with nothing to confess alone', async () => {
    serve([scan({ status: 'completed', finishedAt: '2026-08-30T10:05:00.000Z' })]);
    renderAt(AGENT);

    const table = await screen.findByRole('table', { name: 'Agent conversations' });
    expect(within(table).getByText('Finished')).toBeInTheDocument();
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

    expect(await screen.findByText('Document scan failed on linkwarden/linkwarden')).toBeInTheDocument();
    expect(screen.getByText(REASON)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open conversation/ })).toBeInTheDocument();

    // Every store write re-reads the runs; the announcement is per run, not per read.
    fireSocket('session:runs-changed', { repoId: REAL.id });
    fireSocket('session:runs-changed', { repoId: REAL.id });
    await waitFor(() =>
      expect(screen.getAllByText('Document scan failed on linkwarden/linkwarden')).toHaveLength(1),
    );
  });

  it('stays silent for a run that was already dead when the page loaded', async () => {
    serve([failed()]);
    renderAt('/preview');

    await screen.findByText('linkwarden/linkwarden');
    // The row knows; the shell does not shout about it.
    await waitFor(() => expect(screen.queryByRole('button', { name: /Open conversation/ })).toBeNull());
    expect(screen.queryByText('Document scan failed on linkwarden/linkwarden')).toBeNull();
  });

  it('files the failure in the feed as well, still holding the reason', async () => {
    serve([failed()]);
    renderAt('/preview/notifications');

    expect(await screen.findByText('Document scan failed on linkwarden/linkwarden')).toBeInTheDocument();
    // The feed row shows the title only, so the reason is asserted on the
    // notification itself: it is what a reader searches and what the bell body
    // renders.
    const settled = toNotifications({ id: REAL.id, fullName: REAL.name }, failed(), Date.now()).at(-1);
    expect(settled?.body).toBe(REASON);
  });
});
