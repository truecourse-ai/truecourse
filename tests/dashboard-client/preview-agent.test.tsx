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
  RunConversationPage: ({ run, repoId }: { run: { runId: string }; repoId: string | null }) => (
    <div data-testid="conversation">
      {run.runId} in {repoId ?? ''}
    </div>
  ),
  // The header's clock: the real one ticks off the page's own interval; here it
  // reads the record's own span so the header carries the same words either way.
  RunElapsed: ({ run }: { run: { startedAt: string; finishedAt?: string } }) => (
    <span className="tabular-nums text-muted-foreground">
      {run.finishedAt ? `${Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000)}s` : ''}
    </span>
  ),
}));

import DashboardApp from '@/dashboard/DashboardApp';
import type { WorkspaceRun } from '@/lib/api';
import type { JobView } from '@truecourse/shared';

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const realFetch = window.fetch;

const REPO_A = {
  id: 'expense-tracker',
  name: 'spiderhands/expense-tracker',
  path: '/clones/spiderhands__expense-tracker',
  provider: 'github',
};

const REPO_B = {
  id: 'filecli',
  name: 'spiderhands/filecli',
  path: '/clones/spiderhands__filecli',
  provider: 'github',
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

/** The workspace's OWN work: a Document scan belongs to no repository. */
const WORKSPACE_SCAN = run({
  runId: 'run-scan-workspace',
  gitRef: 'workspace',
  startedAt: '2026-09-03T09:00:00.000Z',
  finishedAt: '2026-09-03T09:01:00.000Z',
  repo: null,
});

/**
 * A job of the workspace. `key` is the server's own (`<type>:<owner/repo>`),
 * which is how a job names the repository it runs for.
 */
function job(over: Partial<JobView> = {}): JobView {
  const type = over.type ?? 'repo.guard-generate';
  return {
    id: 'job-1',
    workspaceOrgId: 'org_1',
    type,
    key: `${type}:${REPO_A.name}`,
    status: 'queued',
    progress: { current: 0, total: 0, message: null },
    result: null,
    error: null,
    createdAt: '2026-09-04T09:10:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...over,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A world: two connected repositories, the runs the workspace route lists, and
 *  the jobs it has in flight. */
function serve(runs: WorkspaceRun[], jobs: JobView[] = [], pausedJobId: string | null = null) {
  const state = { runs, jobs, pausedJobId, calls: [] as string[] };
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    state.calls.push(`${url.pathname}${url.search}`);
    if (url.pathname === '/api/repos') return json([REPO_A, REPO_B]);
    if (url.pathname === '/api/llm/config') return json({ config: { provider: 'anthropic' }, providers: ['anthropic'] });
    if (url.pathname === '/api/jobs') return json({ jobs: state.jobs });
    if (url.pathname === '/api/sessions/runs') return json({ runs: state.runs });
    if (url.pathname.startsWith('/api/sessions/runs/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/sessions/runs/'.length));
      const found = state.runs.find((r) => r.runId === id);
      return found
        ? json({ run: found, pausedJobId: found.status === 'paused' ? state.pausedJobId : null })
        : json({ error: 'run not found' }, 404);
    }
    if (/^\/api\/repos\/[^/]+\/sessions\/runs$/.test(url.pathname)) return json({ runs: [] });
    if (url.pathname.startsWith('/api/credits/resume/')) return json({ jobId: state.pausedJobId }, 202);
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
  return state;
}

function fireSocket(event: string, payload: unknown) {
  act(() => {
    for (const handler of listeners.get(event) ?? []) handler(payload);
  });
}

/**
 * The workspace's live stream (`/api/events`), which is where a run's record
 * writes arrive — the only signal work of the workspace itself ever gets.
 */
class FakeEventSource {
  static open: FakeEventSource[] = [];
  readyState = 1;
  private readonly handlers = new Set<(e: MessageEvent<string>) => void>();
  constructor(readonly url: string) {
    FakeEventSource.open.push(this);
  }
  addEventListener(type: string, handler: (e: MessageEvent<string>) => void) {
    if (type === 'message') this.handlers.add(handler);
  }
  removeEventListener(_type: string, handler: (e: MessageEvent<string>) => void) {
    this.handlers.delete(handler);
  }
  close() {
    this.readyState = 2;
    FakeEventSource.open = FakeEventSource.open.filter((s) => s !== this);
  }
  deliver(event: unknown) {
    for (const handler of [...this.handlers]) {
      handler({ data: JSON.stringify(event) } as MessageEvent<string>);
    }
  }
}

function fireServerEvent(event: unknown) {
  act(() => {
    for (const source of [...FakeEventSource.open]) source.deliver(event);
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
        <Route path="/*" element={<DashboardApp />} />
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
  (window as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  window.fetch = realFetch;
  delete (window as unknown as { EventSource?: unknown }).EventSource;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// the index
// ---------------------------------------------------------------------------

describe('Agent, the index', () => {
  it('lists the workspace conversations in the order the server sent them', async () => {
    serve([SETUP, SCAN]);
    renderAt('/agent');

    expect(await screen.findByRole('heading', { name: 'Agent' })).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(2));

    const [first, second] = rows();
    expect(within(first!).getByText('Flow setup')).toBeInTheDocument();
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
    renderAt('/agent');

    expect(await screen.findByText('Needs you')).toBeInTheDocument();
    expect(screen.queryByText('Running')).toBeNull();
  });

  it('narrows to the repository the address names, and says so in a pill', async () => {
    serve([SETUP, SCAN]);
    renderAt(`/agent?repo=${REPO_B.id}`);

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('spiderhands/filecli')).toBeInTheDocument();
    const filters = screen.getByRole('group', { name: 'Filter conversations' });
    expect(
      await within(filters).findByRole('button', { name: 'Remove Repository spiderhands/filecli' }),
    ).toBeInTheDocument();
  });

  it('puts a filter picked through Add filter into the address', async () => {
    serve([SETUP, SCAN]);
    renderAt('/agent');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Kind/ }));
    await user.click(await screen.findByRole('option', { name: /Flow setup/ }));

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByTestId('address')).toHaveTextContent('/agent?kind=guard-setup');
  });

  it('searches the command, the repository and the ref', async () => {
    serve([SETUP, SCAN]);
    renderAt('/agent');
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
    renderAt('/agent');
    const user = userEvent.setup();

    expect(
      await screen.findByText("Nothing yet. A repository's first scan starts the agent."),
    ).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Search conversations' }), 'nothing');
    expect(await screen.findByText('Nothing matches.')).toBeInTheDocument();
  });

  it("shows the workspace's own work with no repository, and still by kind", async () => {
    serve([WORKSPACE_SCAN, SETUP, SCAN]);
    renderAt('/agent');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(3));

    const first = rows()[0]!;
    expect(within(first).getByText('Document scan')).toBeInTheDocument();
    expect(within(first).getByText('—')).toBeInTheDocument();

    // The Kind filter still lists it, and narrowing keeps it.
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Kind/ }));
    await user.click(await screen.findByRole('option', { name: /Document scan/ }));
    await waitFor(() => expect(rows()).toHaveLength(2));

    // A repository's filter is not about the workspace's own work.
    await user.click(screen.getByRole('button', { name: 'Remove Kind Document scan' }));
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Repository/ }));
    await user.click(await screen.findByRole('option', { name: /expense-tracker/ }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('spiderhands/expense-tracker')).toBeInTheDocument();
  });

  it('re-reads when a repository writes its store, without a reload', async () => {
    const state = serve([SCAN]);
    renderAt('/agent');
    await waitFor(() => expect(rows()).toHaveLength(1));

    state.runs = [SETUP, SCAN];
    fireSocket('session:runs-changed', { repoId: REPO_B.id });

    await waitFor(() => expect(rows()).toHaveLength(2), { timeout: 3000 });
  });

  it('re-reads on a run change of the workspace itself, which has no room', async () => {
    const state = serve([SCAN]);
    renderAt('/agent');
    await waitFor(() => expect(rows()).toHaveLength(1));

    state.runs = [WORKSPACE_SCAN, SCAN];
    fireServerEvent({
      type: 'run.changed',
      runId: WORKSPACE_SCAN.runId,
      repoKey: 'workspace:org_1',
    });

    await waitFor(() => expect(rows()).toHaveLength(2), { timeout: 3000 });
    // The new row is the workspace's own work: it names no repository.
    expect(within(rows()[0]!).getByText('—')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// work that has not started
// ---------------------------------------------------------------------------

/** Another repository's generation, holding the workspace's one heavy lane. */
const GENERATING = run({
  command: 'guard-generate',
  runId: 'run-generate-b',
  status: 'running',
  startedAt: '2026-09-04T09:05:00.000Z',
  finishedAt: undefined,
  repo: { id: REPO_B.id, fullName: REPO_B.name },
});

const HOLDING_JOB = job({
  id: 'job-holding',
  key: `repo.guard-generate:${REPO_B.name}`,
  status: 'running',
  createdAt: '2026-09-04T09:04:00.000Z',
  startedAt: '2026-09-04T09:04:30.000Z',
});

describe('work waiting its turn', () => {
  it('lists a queued job as a row, saying what it waits for', async () => {
    serve([GENERATING], [HOLDING_JOB, job()]);
    renderAt('/agent');

    await waitFor(() => expect(rows()).toHaveLength(2));
    const [waiting, working] = rows();
    expect(within(waiting!).getByText('Flow generation')).toBeInTheDocument();
    expect(within(waiting!).getByText('spiderhands/expense-tracker')).toBeInTheDocument();
    expect(within(waiting!).getByText('Queued')).toBeInTheDocument();
    expect(
      within(waiting!).getByText('waiting for Flow generation on spiderhands/filecli'),
    ).toBeInTheDocument();
    // The job holding the lane has its run record, so its work is one row.
    expect(within(working!).getByText('Running')).toBeInTheDocument();
    expect(within(working!).getByText('spiderhands/filecli')).toBeInTheDocument();
  });

  it('keeps one row when the job starts, until its own run record arrives', async () => {
    const state = serve(
      [],
      [
        job({
          id: 'job-setup',
          type: 'repo.guard-setup',
          status: 'running',
          createdAt: '2026-09-04T09:00:00.000Z',
          startedAt: '2026-09-04T09:00:10.000Z',
        }),
      ],
    );
    renderAt('/agent');
    const user = userEvent.setup();

    // The body has not written its record yet: the job is still the only row
    // this work has, and it does not blink out while the record is on its way.
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('Flow setup')).toBeInTheDocument();
    expect(within(rows()[0]!).getByText('Running')).toBeInTheDocument();

    state.runs = [
      run({
        command: 'guard-setup',
        runId: 'run-setup-live',
        status: 'running',
        startedAt: '2026-09-04T09:00:12.000Z',
        finishedAt: undefined,
      }),
    ];
    fireSocket('session:runs-changed', { repoId: REPO_A.id });

    await waitFor(
      () =>
        expect(
          state.calls.filter((c) => c.startsWith('/api/sessions/runs?limit=200')).length,
        ).toBe(2),
      { timeout: 3000 },
    );
    expect(rows()).toHaveLength(1);
    await user.click(rows()[0]!);
    expect(screen.getByTestId('address')).toHaveTextContent('/agent/run-setup-live');
  });

  it('opens a queued job where its work will appear', async () => {
    serve([], [job({ type: 'repo.guard-setup' })]);
    renderAt('/agent');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(1));

    await user.click(rows()[0]!);
    expect(screen.getByTestId('address')).toHaveTextContent(`/repos/${REPO_A.id}/pipeline`);
  });

  it('sends a queued document scan to the Context it reads', async () => {
    serve([], [job({ type: 'context.scan', key: 'context.scan' })]);
    renderAt('/agent');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(1));

    const row = rows()[0]!;
    expect(within(row).getByText('Document scan')).toBeInTheDocument();
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).getByText('waiting in the queue')).toBeInTheDocument();

    await user.click(row);
    expect(screen.getByTestId('address')).toHaveTextContent('/context');
  });

  it('counts Queued among the statuses, and narrows to it', async () => {
    serve([GENERATING], [HOLDING_JOB, job()]);
    renderAt('/agent');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Status/ }));
    await user.click(await screen.findByRole('option', { name: /Queued/ }));

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('Queued')).toBeInTheDocument();
    expect(screen.getByTestId('address')).toHaveTextContent('/agent?status=queued');
  });
});

// ---------------------------------------------------------------------------
// one conversation
// ---------------------------------------------------------------------------

describe('one conversation', () => {
  it('opens from its row, under a header naming the repository and the ref', async () => {
    serve([SETUP, SCAN]);
    renderAt('/agent');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    await user.click(rows()[0]!);

    expect(await screen.findByRole('heading', { name: 'Flow setup' })).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Agent' })).toHaveAttribute('href', '/agent');
    expect(screen.getByText('spiderhands/filecli')).toBeInTheDocument();
    expect(screen.getByText('0f1e2d3c')).toBeInTheDocument();
    expect(screen.getByTestId('conversation')).toHaveTextContent('run-setup-2 in filecli');
  });

  it('offers another go at one that ended badly, and starts it', async () => {
    const state = serve([SETUP]);
    renderAt(`/agent/${SETUP.runId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Run again' }));
    await waitFor(() =>
      expect(state.calls).toContain(`/api/repos/${REPO_B.id}/guard/setup`),
    );
  });

  // The word has to be true: Resume carries the paused JOB on — one row, one
  // conversation — and it is offered for every command, not only the one that
  // can replay its own record.
  it('carries a run that stopped for credits on, rather than starting a second one', async () => {
    const paused = run({
      command: 'guard-setup',
      runId: 'run-setup-paused',
      status: 'paused',
      finishedAt: '2026-09-02T09:02:30.000Z',
      repo: { id: REPO_B.id, fullName: REPO_B.name },
    });
    const state = serve([paused], [], 'job_paused_1');
    renderAt(`/agent/${paused.runId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(state.calls).toContain('/api/credits/resume/job_paused_1'));
    // Never the start route: that would be a second job over the same work.
    expect(state.calls).not.toContain(`/api/repos/${REPO_B.id}/guard/setup`);
  });

  it('says Run again when the paused work has no job left to carry it on', async () => {
    const paused = run({
      command: 'guard-setup',
      runId: 'run-setup-carried',
      status: 'paused',
      finishedAt: '2026-09-02T09:02:30.000Z',
      repo: { id: REPO_B.id, fullName: REPO_B.name },
    });
    serve([paused]);
    renderAt(`/agent/${paused.runId}`);

    expect(await screen.findByRole('button', { name: 'Run again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
  });

  it('still offers a failed generate its own record to replay', async () => {
    const failed = run({
      command: 'guard-generate',
      runId: 'run-generate-failed',
      status: 'failed',
      finishedAt: '2026-09-02T09:02:30.000Z',
      repo: { id: REPO_B.id, fullName: REPO_B.name },
    });
    const state = serve([failed]);
    renderAt(`/agent/${failed.runId}`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    await waitFor(() =>
      expect(state.calls.some((c) => c.startsWith(`/api/repos/${REPO_B.id}/guard/generate`))).toBe(true),
    );
  });

  it('leaves a finished conversation alone', async () => {
    serve([SCAN]);
    renderAt(`/agent/${SCAN.runId}`);

    expect(await screen.findByTestId('conversation')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run again' })).toBeNull();
  });

  it("opens the workspace's own conversation, which names no repository", async () => {
    serve([WORKSPACE_SCAN]);
    renderAt(`/agent/${WORKSPACE_SCAN.runId}`);

    expect(await screen.findByRole('heading', { name: 'Document scan' })).toBeInTheDocument();
    expect(screen.getByTestId('conversation')).toHaveTextContent('run-scan-workspace in');
    expect(screen.queryByText('spiderhands/expense-tracker')).toBeNull();
    // Nothing offers to run it again from here: it starts on Context.
    expect(screen.queryByRole('button', { name: 'Run again' })).toBeNull();
  });

  it("follows its own run's record writes, and leaves another run's alone", async () => {
    const running = run({
      runId: WORKSPACE_SCAN.runId,
      status: 'running',
      startedAt: '2026-09-03T09:00:00.000Z',
      finishedAt: undefined,
      repo: null,
    });
    const state = serve([running]);
    renderAt(`/agent/${running.runId}`);
    const reads = () =>
      state.calls.filter((c) => c === `/api/sessions/runs/${running.runId}`).length;

    expect(await screen.findByText('Running')).toBeInTheDocument();
    const settled = reads();

    // Another run's write is not this conversation's business.
    fireServerEvent({ type: 'run.changed', runId: 'run-elsewhere', repoKey: 'workspace:org_1' });

    state.runs = [WORKSPACE_SCAN];
    fireServerEvent({
      type: 'run.changed',
      runId: WORKSPACE_SCAN.runId,
      repoKey: 'workspace:org_1',
    });

    expect(await screen.findByText('Finished')).toBeInTheDocument();
    expect(reads()).toBe(settled + 1);
  });

  it('says so at an address this workspace has nothing at', async () => {
    serve([SCAN]);
    renderAt('/agent/not-a-run');

    expect(await screen.findByText('No such conversation')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Agent' })).toHaveAttribute('href', '/agent');
    expect(screen.queryByTestId('conversation')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// where it is reached from
// ---------------------------------------------------------------------------

describe('the way in', () => {
  it('is a workspace nav entry', async () => {
    serve([SCAN]);
    renderAt('/agent');

    const nav = screen.getByRole('navigation', { name: 'Workspace' });
    expect(within(nav).getByRole('link', { name: 'Agent' })).toHaveAttribute('href', '/agent');
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it('is no longer a tab of the repository console', async () => {
    serve([SCAN]);
    renderAt(`/repos/${REPO_A.id}/runs`);

    const menu = await screen.findByRole('navigation', { name: 'Repository sections' });
    expect(within(menu).queryByRole('link', { name: 'Activity' })).toBeNull();
    expect(within(menu).getByRole('link', { name: 'Runs' })).toBeInTheDocument();
  });
});
