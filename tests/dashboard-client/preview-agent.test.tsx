/**
 * Agent: the workspace's conversations in one place, and one of them opened.
 *
 * The index is real all the way down: it reads `GET /api/sessions/runs`, which
 * spans every connected repository, so the assertions here are about what the
 * page does with that answer. The row it draws, the filters in the address, the
 * search, and the re-read a store write triggers without a reload.
 *
 * The conversation body itself belongs to `RunConversationPage` and is stubbed:
 * what this file owns is the one-row header around it, Run again, and the
 * address that names no run of this workspace.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';

const listeners = new Map<string, Set<(payload: unknown) => void>>();

vi.mock('@/lib/socket', () => {
  const socket = {
    connected: true,
    on: (event: string, handler: (payload: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return socket;
    },
    off: (event: string, handler: (payload: unknown) => void) => {
      listeners.get(event)?.delete(handler);
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

vi.mock('@/components/sessions/RunConversationPage', () => ({
  RunConversationPage: ({ run, repoId }: { run: { runId: string }; repoId: string }) => (
    <div data-testid="conversation">
      {run.runId} in {repoId}
    </div>
  ),
}));

import PreviewApp from '@/preview/PreviewApp';
import type { WorkspaceRun } from '@/lib/api';

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const realFetch = window.fetch;

const REPO_A = {
  id: 'expense-tracker',
  name: 'spiderhands/expense-tracker',
  path: '/clones/spiderhands__expense-tracker',
  remoteUrl: 'https://github.com/spiderhands/expense-tracker',
};

const REPO_B = {
  id: 'filecli',
  name: 'spiderhands/filecli',
  path: '/clones/spiderhands__filecli',
  remoteUrl: 'https://github.com/spiderhands/filecli',
};

function run(over: Partial<WorkspaceRun> = {}): WorkspaceRun {
  return {
    command: 'spec-scan',
    runId: 'run-scan-1',
    gitRef: 'abc1234',
    startedAt: '2026-09-01T10:00:00.000Z',
    finishedAt: '2026-09-01T10:04:00.000Z',
    status: 'completed',
    sessions: [],
    repo: { id: REPO_A.id, fullName: REPO_A.name },
    ...over,
  } as WorkspaceRun;
}

const SETUP = run({
  command: 'guard-setup',
  runId: 'run-setup-2',
  gitRef: '0f1e2d3c4b5a69788796a5b4c3d2e1f0deadbeef',
  startedAt: '2026-09-02T09:00:00.000Z',
  finishedAt: '2026-09-02T09:02:30.000Z',
  status: 'failed',
  repo: { id: REPO_B.id, fullName: REPO_B.name },
});

const SCAN = run();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A world: two connected repositories and the runs the workspace route lists. */
function serve(runs: WorkspaceRun[]) {
  const state = { runs, calls: [] as string[] };
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    state.calls.push(`${url.pathname}${url.search}`);
    if (url.pathname === '/api/repos') return json([REPO_A, REPO_B]);
    if (url.pathname === '/api/llm/config') return json({ config: { provider: 'anthropic' }, providers: ['anthropic'] });
    if (url.pathname === '/api/sessions/runs') return json({ runs: state.runs });
    if (url.pathname.startsWith('/api/sessions/runs/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/sessions/runs/'.length));
      const found = state.runs.find((r) => r.runId === id);
      return found ? json({ run: found }) : json({ error: 'run not found' }, 404);
    }
    if (/^\/api\/repos\/[^/]+\/sessions\/runs$/.test(url.pathname)) return json({ runs: [] });
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
  return state;
}

function fireSocket(event: string, payload: unknown) {
  act(() => {
    for (const handler of listeners.get(event) ?? []) handler(payload);
  });
}

/** The router's address, so a URL-backed selection can be asserted. */
function Address() {
  const { pathname, search } = useLocation();
  return <div data-testid="address">{`${pathname}${search}`}</div>;
}

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/preview/*" element={<PreviewApp />} />
      </Routes>
      <Address />
      <Toaster />
    </MemoryRouter>,
  );
}

/** The table's data rows, in the order they render. */
function rows() {
  const table = screen.getByRole('table', { name: 'Agent conversations' });
  return within(table)
    .getAllByRole('row')
    .slice(1);
}

beforeEach(() => {
  listeners.clear();
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// the index
// ---------------------------------------------------------------------------

describe('Agent, the index', () => {
  it('lists the workspace conversations in the order the server sent them', async () => {
    serve([SETUP, SCAN]);
    renderAt('/preview/agent');

    expect(await screen.findByRole('heading', { name: 'Agent' })).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(2));

    const [first, second] = rows();
    expect(within(first!).getByText('Test setup')).toBeInTheDocument();
    expect(within(first!).getByText('spiderhands/filecli')).toBeInTheDocument();
    expect(within(first!).getByText('Failed')).toBeInTheDocument();
    expect(within(first!).getByText('2m 30s')).toBeInTheDocument();
    expect(within(second!).getByText('Document scan')).toBeInTheDocument();
    expect(within(second!).getByText('Finished')).toBeInTheDocument();
  });

  it('says a conversation needs you instead of that it is running', async () => {
    serve([
      run({
        runId: 'run-waiting',
        status: 'running',
        finishedAt: undefined,
        sessions: [{ sessionId: 's1', kind: 'curate-doc', workItem: 'doc:README.md', status: 'waiting', spent: { turns: 2, tokens: 100, costUsd: 0 } }],
      }),
    ]);
    renderAt('/preview/agent');

    expect(await screen.findByText('Needs you')).toBeInTheDocument();
    expect(screen.queryByText('Running')).toBeNull();
  });

  it('narrows to the repository the address names, and says so in a pill', async () => {
    serve([SETUP, SCAN]);
    renderAt(`/preview/agent?repo=${REPO_B.id}`);

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('spiderhands/filecli')).toBeInTheDocument();
    const filters = screen.getByRole('group', { name: 'Filter conversations' });
    expect(
      await within(filters).findByRole('button', { name: 'Remove Repository spiderhands/filecli' }),
    ).toBeInTheDocument();
  });

  it('puts a filter picked through Add filter into the address', async () => {
    serve([SETUP, SCAN]);
    renderAt('/preview/agent');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Kind/ }));
    await user.click(await screen.findByRole('option', { name: /Test setup/ }));

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByTestId('address')).toHaveTextContent('/preview/agent?kind=guard-setup');
  });

  it('searches the command, the repository and the ref', async () => {
    serve([SETUP, SCAN]);
    renderAt('/preview/agent');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    const search = screen.getByRole('textbox', { name: 'Search conversations' });
    await user.type(search, 'filecli');
    await waitFor(() => expect(rows()).toHaveLength(1));

    await user.clear(search);
    await user.type(search, 'abc1234');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('Document scan')).toBeInTheDocument();
  });

  it('says what an empty workspace is waiting for, and what a filter excluded', async () => {
    serve([]);
    renderAt('/preview/agent');
    const user = userEvent.setup();

    expect(
      await screen.findByText("Nothing yet. A repository's first scan starts the agent."),
    ).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Search conversations' }), 'nothing');
    expect(await screen.findByText('Nothing matches.')).toBeInTheDocument();
  });

  it('re-reads when a repository writes its store, without a reload', async () => {
    const state = serve([SCAN]);
    renderAt('/preview/agent');
    await waitFor(() => expect(rows()).toHaveLength(1));

    state.runs = [SETUP, SCAN];
    fireSocket('session:runs-changed', { repoId: REPO_B.id });

    await waitFor(() => expect(rows()).toHaveLength(2), { timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------
// one conversation
// ---------------------------------------------------------------------------

describe('one conversation', () => {
  it('opens from its row, under a header naming the repository and the ref', async () => {
    serve([SETUP, SCAN]);
    renderAt('/preview/agent');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    await user.click(rows()[0]!);

    expect(await screen.findByRole('heading', { name: 'Test setup' })).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Agent' })).toHaveAttribute('href', '/preview/agent');
    expect(screen.getByText('spiderhands/filecli')).toBeInTheDocument();
    expect(screen.getByText('0f1e2d3c')).toBeInTheDocument();
    expect(screen.getByTestId('conversation')).toHaveTextContent('run-setup-2 in filecli');
  });

  it('offers another go at one that ended badly, and starts it', async () => {
    const state = serve([SETUP]);
    renderAt(`/preview/agent/${SETUP.runId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Run again' }));
    await waitFor(() =>
      expect(state.calls).toContain(`/api/repos/${REPO_B.id}/guard/setup`),
    );
  });

  it('leaves a finished conversation alone', async () => {
    serve([SCAN]);
    renderAt(`/preview/agent/${SCAN.runId}`);

    expect(await screen.findByTestId('conversation')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run again' })).toBeNull();
  });

  it('says so at an address this workspace has nothing at', async () => {
    serve([SCAN]);
    renderAt('/preview/agent/not-a-run');

    expect(await screen.findByText('No such conversation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Agent' })).toHaveAttribute('href', '/preview/agent');
    expect(screen.queryByTestId('conversation')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// where it is reached from
// ---------------------------------------------------------------------------

describe('the way in', () => {
  it('is a workspace nav entry', async () => {
    serve([SCAN]);
    renderAt('/preview/agent');

    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    expect(within(nav).getByRole('link', { name: 'Agent' })).toHaveAttribute('href', '/preview/agent');
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it('is no longer a tab of the repository console', async () => {
    serve([SCAN]);
    renderAt('/preview/repos/orders-api/coverage');

    const menu = await screen.findByRole('navigation', { name: 'Repository sections' });
    expect(within(menu).queryByRole('link', { name: 'Activity' })).toBeNull();
    expect(within(menu).getByRole('link', { name: 'Coverage' })).toBeInTheDocument();
  });
});
