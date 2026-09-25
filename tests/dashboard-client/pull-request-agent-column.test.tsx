/**
 * Agent: the Pull request column and filter. A run of a check, and the scan a
 * check ran, name their pull request on the record; the row draws it as `#<n>`
 * and `?pr=<owner/repo>#<n>` narrows the list to it. The conversation header
 * carries the number beside the repository.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('@/lib/socket', () => {
  const socket = { connected: true, on: () => socket, off: () => socket, emit: vi.fn(), connect: vi.fn() };
  return {
    connectSocket: () => socket,
    getSocket: () => socket,
    disconnectSocket: vi.fn(),
    joinRepoRoom: vi.fn(),
    leaveRepoRoom: vi.fn(),
  };
});

vi.mock('@/components/sessions/RunConversationPage', () => ({
  RunConversationPage: ({ run }: { run: { runId: string } }) => <div data-testid="conversation">{run.runId}</div>,
  RunElapsed: () => <span />,
}));

import DashboardApp from '@/dashboard/DashboardApp';
import type { WorkspaceRun } from '@/lib/api';

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const realFetch = window.fetch;

const REPO = { id: 'widgets', name: 'acme/widgets', path: 'acme/widgets', provider: 'github' };

function run(over: Partial<WorkspaceRun> = {}): WorkspaceRun {
  return {
    command: 'guard-run',
    runId: 'run-main',
    gitRef: 'abc1234',
    startedAt: '2026-09-01T10:00:00.000Z',
    finishedAt: '2026-09-01T10:04:00.000Z',
    status: 'completed',
    sessions: [],
    repo: { id: REPO.id, fullName: REPO.name },
    ...over,
  } as WorkspaceRun;
}

const MAIN = run();
const CHECK = run({
  command: 'pr-check',
  runId: 'run-check-7',
  gitRef: 'f00d123',
  startedAt: '2026-09-02T10:00:00.000Z',
  finishedAt: '2026-09-02T10:06:00.000Z',
  pullRequest: { repoFullName: REPO.name, number: 7, headSha: 'f00d123', checkId: 'check_1' },
} as Partial<WorkspaceRun>);
/** The scan the check ran: a run of the WORKSPACE, with no repository of its own. */
const CHECK_SCAN = run({
  command: 'spec-scan',
  runId: 'run-scan-7',
  gitRef: 'f00d123',
  startedAt: '2026-09-02T10:01:00.000Z',
  finishedAt: '2026-09-02T10:02:00.000Z',
  repo: null,
  pullRequest: { repoFullName: REPO.name, number: 7, headSha: 'f00d123', checkId: 'check_1' },
} as Partial<WorkspaceRun>);
/** The workspace's own scan, nobody's pull request. */
const WORKSPACE_SCAN = run({ command: 'spec-scan', runId: 'run-scan-ws', gitRef: 'workspace', startedAt: '2026-08-30T10:00:00.000Z', repo: null });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function serve(runs: WorkspaceRun[]) {
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    if (url.pathname === '/api/repos') return json([REPO]);
    if (url.pathname === '/api/llm/config') return json({ config: { provider: 'anthropic' }, providers: ['anthropic'] });
    if (url.pathname === '/api/jobs') return json({ jobs: [] });
    if (url.pathname === '/api/sessions/runs') return json({ runs });
    if (url.pathname.startsWith('/api/sessions/runs/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/sessions/runs/'.length));
      const found = runs.find((r) => r.runId === id);
      return found ? json({ run: found, pausedJobId: null }) : json({ error: 'run not found' }, 404);
    }
    if (/^\/api\/repos\/[^/]+\/sessions\/runs$/.test(url.pathname)) return json({ runs: [] });
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
}

function Address() {
  const { pathname, search } = useLocation();
  return <div data-testid="address">{`${pathname}${search}`}</div>;
}

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/*" element={<DashboardApp />} />
      </Routes>
      <Address />
    </MemoryRouter>,
  );
}

function rows() {
  const table = screen.getByRole('table', { name: 'Agent conversations' });
  return within(table).getAllByRole('row').slice(1);
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  window.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('Agent, the Pull request column', () => {
  it('draws #<n> on the check’s row and nothing on the main branch’s', async () => {
    serve([CHECK, MAIN]);
    renderAt('/agent');
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByRole('columnheader', { name: 'Pull request' })).toBeInTheDocument();
    expect(within(rows()[0]!).getByText('#7')).toBeInTheDocument();
    expect(within(rows()[1]!).queryByText(/^#\d+$/)).toBeNull();
  });

  it('narrows to the pull request from the address: the check and the scan it ran, not the workspace’s own', async () => {
    serve([CHECK, CHECK_SCAN, MAIN, WORKSPACE_SCAN]);
    renderAt(`/agent?pr=${encodeURIComponent('acme/widgets#7')}`);
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows().map((row) => within(row).getAllByRole('cell')[0]!.textContent)).toEqual(['Document scan', 'Pull request check']);
    for (const row of rows()) expect(within(row).getByText('#7')).toBeInTheDocument();
  });

  it('offers the pull request under its own dimension, and a pick lands in the address', async () => {
    serve([CHECK, MAIN]);
    renderAt('/agent');
    await waitFor(() => expect(rows()).toHaveLength(2));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Add filter/ }));
    await user.click(await screen.findByRole('option', { name: /Pull request/ }));
    await user.click(await screen.findByRole('option', { name: /#7/ }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByTestId('address')).toHaveTextContent(`/agent?pr=${encodeURIComponent('acme/widgets#7')}`);
  });

  it('names the pull request in the conversation header', async () => {
    serve([CHECK, MAIN]);
    renderAt('/agent/run-check-7');
    expect(await screen.findByTestId('conversation')).toHaveTextContent('run-check-7');
    const header = screen.getByRole('heading', { name: 'Pull request check' }).closest('header') ?? document.body;
    expect(within(header as HTMLElement).getByText('#7')).toBeInTheDocument();
  });
});
