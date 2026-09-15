/**
 * The Pipeline tab of a connected repository: the three pieces of work it runs,
 * each reading what the server stored for it — the repository's own agent runs,
 * the setup report, the generate report and the run history — with a Re-run that
 * enqueues that job and a row that opens what it is about.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

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

import DashboardApp from '@/dashboard/DashboardApp';
import type { JobView } from '@truecourse/shared';

function fireSocket(event: string, payload: unknown): void {
  for (const fn of listeners.get(event) ?? []) fn(payload);
}

const realFetch = window.fetch;

const REAL = {
  id: 'filecli',
  name: 'spiderhands/filecli',
  path: 'spiderhands/filecli',
  provider: 'github',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const SETUP_RUN = {
  runId: 'setup-1',
  command: 'guard-setup',
  status: 'completed',
  gitRef: 'main',
  startedAt: '2026-09-01T09:00:00.000Z',
  finishedAt: '2026-09-01T09:12:00.000Z',
  sessions: [],
};

const GENERATE_RUN = {
  runId: 'generate-1',
  command: 'guard-generate',
  status: 'failed',
  gitRef: 'main',
  startedAt: '2026-09-02T09:00:00.000Z',
  finishedAt: '2026-09-02T09:30:00.000Z',
  sessions: [],
};

const SETUP_REPORT = {
  ranAt: '2026-09-01T09:12:00.000Z',
  status: 'ok',
  steps: [
    { key: 'recipe', status: 'ok', inputFingerprint: 'sha256:a' },
    { key: 'detect', status: 'ok', inputFingerprint: '' },
    { key: 'auth', status: 'blocked', inputFingerprint: 'sha256:b' },
  ],
  recipe: { status: 'ok', outcome: 'discovered' },
};

const GENERATE_REPORT = {
  generatedAt: '2026-09-02T09:30:00.000Z',
  status: 'ok',
  sectionsTotal: 4,
  sectionsChanged: 2,
  skippedUnchanged: 2,
  noChanges: false,
  written: [{ id: 'a.cli.1' }, { id: 'b.cli.1' }],
  coverageGaps: [{ doc: 'docs/cli.md', anchor: 'purge', kind: 'no-interface', reason: 'no command purges' }],
  birthFindings: [],
  errors: [],
  extractionFailures: [],
};

const HISTORY = {
  runs: [
    {
      runId: 'r-main1',
      ranAt: '2026-09-03T10:00:00.000Z',
      branch: 'main',
      commit: 'a1b2c3d',
      summary: { total: 2, pass: 1, fail: 1, stale: 0, orphaned: 0, error: 0, blocked: 0 },
      origin: 'hosted',
    },
  ],
};

/**
 * A job of the workspace. `key` is the server's own (`<type>:<owner/repo>`),
 * which is how a job names the repository it runs for.
 */
function job(over: Partial<JobView> & Pick<JobView, 'type'>): JobView {
  return {
    id: over.type,
    workspaceOrgId: 'org_1',
    key: `${over.type}:${REAL.name}`,
    status: 'queued',
    progress: { current: 0, total: 0, message: null },
    result: null,
    error: null,
    createdAt: '2026-09-03T11:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...over,
  };
}

/** One connected repository, with a settled setup, generate and run behind it. */
function serve(
  options: {
    runs?: unknown[];
    setup?: unknown;
    report?: unknown;
    history?: unknown;
    jobs?: JobView[];
  } = {},
) {
  const calls: string[] = [];
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(method === 'GET' ? `${url.pathname}${url.search}` : `${method} ${url.pathname}`);
    const rest = url.pathname.replace(`/api/repos/${REAL.id}/`, '');
    if (url.pathname === '/api/repos') return json([REAL]);
    if (url.pathname === '/api/llm/config') return json({ config: { provider: 'anthropic' }, providers: ['anthropic'] });
    if (url.pathname === '/api/sessions/runs') return json({ runs: [] });
    if (url.pathname === '/api/jobs') return json({ jobs: options.jobs ?? [] });
    if (rest === 'sessions/runs') return json({ runs: options.runs ?? [SETUP_RUN, GENERATE_RUN] });
    if (rest === 'guard/setup') {
      const report = options.setup === undefined ? SETUP_REPORT : options.setup;
      return report ? json({ report }) : json({ error: 'never run' }, 404);
    }
    if (rest === 'guard/report') {
      const report = options.report === undefined ? GENERATE_REPORT : options.report;
      return report ? json(report) : json({ error: 'never generated' }, 404);
    }
    if (rest === 'guard/history') return json(options.history ?? HISTORY);
    if (method === 'POST') return json({ jobId: 'job-1' }, 202);
    return json({ error: `not found: ${rest}` }, 404);
  }) as unknown as typeof window.fetch;
  return calls;
}

function Address() {
  const { pathname } = useLocation();
  return <span data-testid="address">{pathname}</span>;
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

/** The three rows, in the order the work chains. */
async function rows(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('list', { name: 'Pipeline' });
  return within(list).getAllByRole('listitem');
}

/** A row's two lines: title and word above, fact and time below. */
function lines(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelector('button')!.children) as HTMLElement[];
}

/** Whether the row's action is spinning. */
function spins(row: HTMLElement): boolean {
  return row.querySelectorAll('.animate-spin').length > 0;
}

beforeEach(() => {
  listeners.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  window.fetch = realFetch;
});

describe('the Pipeline tab of a connected repository', () => {
  it('is one row per piece of work, each with its last outcome and when it was', async () => {
    const calls = serve();
    renderAt(`/repos/${REAL.id}/pipeline`);

    const [setup, generate, run] = await rows();
    expect(within(setup!).getByText('Flow setup')).toBeInTheDocument();
    expect(within(setup!).getByText('Finished')).toBeInTheDocument();
    expect(within(setup!).getByText('2 of 3 steps settled')).toBeInTheDocument();

    expect(within(generate!).getByText('Flow generation')).toBeInTheDocument();
    expect(within(generate!).getByText('Failed')).toBeInTheDocument();
    expect(within(generate!).getByText('2 written, 1 blocked')).toBeInTheDocument();

    expect(within(run!).getByText('Flow run')).toBeInTheDocument();
    expect(within(run!).getByText('Failed')).toBeInTheDocument();
    expect(within(run!).getByText('1 passing, 1 failing')).toBeInTheDocument();

    expect(calls).toContain(`/api/repos/${REAL.id}/sessions/runs`);
    expect(calls).toContain(`/api/repos/${REAL.id}/guard/setup`);
    expect(calls).toContain(`/api/repos/${REAL.id}/guard/report`);
    expect(calls).toContain(`/api/repos/${REAL.id}/guard/history?all=1`);
  });

  it('says Never run for work this repository has never done, and offers Run', async () => {
    serve({ runs: [], setup: null, report: null, history: { runs: [] } });
    renderAt(`/repos/${REAL.id}/pipeline`);

    for (const row of await rows()) {
      expect(within(row).getByText('Never run')).toBeInTheDocument();
      // Nothing to re-do: the button offers the first run.
      expect(within(row).getByRole('button', { name: /^Run / })).toBeInTheDocument();
      expect(within(row).queryByRole('button', { name: /^Re-run / })).toBeNull();
    }
  });

  it('gives the three rows one shape, whatever each has to say', async () => {
    serve({ runs: [], setup: null, report: null, history: { runs: [] } });
    renderAt(`/repos/${REAL.id}/pipeline`);

    const shapes = (await rows()).map((row) => lines(row).map((line) => line.className));
    // Two lines each, the same two, and the second is a FIXED height: a row with
    // no fact and no time takes exactly as much room as one with both, so the
    // status word sits on the same line down the column.
    expect(shapes.map((shape) => shape.length)).toEqual([2, 2, 2]);
    expect(new Set(shapes.map((shape) => shape.join('|'))).size).toBe(1);
    expect(shapes[0]![1]).toContain('h-4');
    expect(shapes[0]![1]).not.toContain('min-h-4');

    const [setup] = await rows();
    const [top, bottom] = lines(setup!);
    expect(top!.textContent).toBe('Flow setupNever run');
    expect(bottom!.textContent).toBe('');
  });

  it('says what a running row is doing, and spins that row alone', async () => {
    serve({
      runs: [
        SETUP_RUN,
        {
          ...GENERATE_RUN,
          status: 'running',
          finishedAt: undefined,
          display: {
            blocks: [
              {
                kind: 'checklist',
                items: [
                  { key: 'extract', label: 'Reading the documents', status: 'done' },
                  { key: 'flows', label: 'Writing the flows', status: 'active' },
                  { key: 'prove', label: 'Proving the scenarios', status: 'pending' },
                ],
              },
            ],
          },
        },
      ],
    });
    renderAt(`/repos/${REAL.id}/pipeline`);

    const [setup, generate, run] = await rows();
    await waitFor(() => expect(within(generate!).getByText('Writing the flows')).toBeInTheDocument());
    expect(spins(generate!)).toBe(true);
    // The others wait with it, but a dead button is how they say so.
    expect(spins(setup!)).toBe(false);
    expect(spins(run!)).toBe(false);
  });

  it.each([
    [0, 'Re-run Flow setup', 'guard/setup'],
    [1, 'Re-run Flow generation', 'guard/generate'],
    [2, 'Re-run Flow run', 'guard/run'],
  ])('re-runs %s by enqueuing its own job', async (index, label, route) => {
    const calls = serve();
    renderAt(`/repos/${REAL.id}/pipeline`);

    const row = (await rows())[index as number]!;
    const button = within(row).getByRole('button', { name: label as string });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    await waitFor(() => expect(calls).toContain(`POST /api/repos/${REAL.id}/${route}`));
  });

  it('waits while this repository is already working, and only for its own work', async () => {
    serve({ runs: [SETUP_RUN, { ...GENERATE_RUN, status: 'running', finishedAt: undefined }] });
    renderAt(`/repos/${REAL.id}/pipeline`);

    const [setup, generate] = await rows();
    await waitFor(() =>
      expect(within(generate!).getByRole('button', { name: 'Re-run Flow generation' })).toBeDisabled(),
    );
    // One heavy job at a time per repository: every row waits with it.
    expect(within(setup!).getByRole('button', { name: 'Re-run Flow setup' })).toBeDisabled();
    // …and the row says what the run itself says.
    expect(within(generate!).getByText('Running')).toBeInTheDocument();
  });

  it('says a piece of work waiting its turn is queued, and holds every Re-run', async () => {
    serve({
      jobs: [
        job({
          id: 'job-holding',
          type: 'repo.guard-setup',
          key: 'repo.guard-setup:spiderhands/expense-tracker',
          status: 'running',
          startedAt: '2026-09-03T10:59:00.000Z',
        }),
        job({ type: 'repo.guard-generate' }),
      ],
    });
    renderAt(`/repos/${REAL.id}/pipeline`);

    const [setup, generate] = await rows();
    await waitFor(() => expect(within(generate!).getByText('Queued')).toBeInTheDocument());
    expect(
      within(generate!).getByText('waiting for Flow setup on spiderhands/expense-tracker'),
    ).toBeInTheDocument();
    // Its own Re-run waits, and so does every other row's: one at a time.
    expect(within(generate!).getByRole('button', { name: 'Re-run Flow generation' })).toBeDisabled();
    expect(within(setup!).getByRole('button', { name: 'Re-run Flow setup' })).toBeDisabled();
    // The waiting row is the one that spins; the rest are simply dead.
    expect(spins(generate!)).toBe(true);
    expect(spins(setup!)).toBe(false);
    // The row that is not waiting still says what it last did.
    expect(within(setup!).getByText('Finished')).toBeInTheDocument();
  });

  it('opens a setup or generation row as its conversation, and the run row as the run', async () => {
    serve();
    renderAt(`/repos/${REAL.id}/pipeline`);
    const user = userEvent.setup();

    await user.click(within((await rows())[0]!).getByText('Flow setup'));
    expect(screen.getByTestId('address')).toHaveTextContent('/agent/setup-1');

    renderAt(`/repos/${REAL.id}/pipeline`);
    await user.click(within((await rows())[2]!).getByText('Flow run'));
    expect(screen.getAllByTestId('address').at(-1)).toHaveTextContent(
      `/repos/${REAL.id}/runs/r-main1`,
    );
  });

  it('opens the repository’s work when the row has no conversation to open', async () => {
    serve({ runs: [], setup: null, report: null, history: { runs: [] } });
    renderAt(`/repos/${REAL.id}/pipeline`);

    await userEvent.click(within((await rows())[0]!).getByText('Flow setup'));
    expect(screen.getByTestId('address')).toHaveTextContent('/agent');
  });

  it('re-reads itself when a guard job of this repository settles', async () => {
    const calls = serve();
    renderAt(`/repos/${REAL.id}/pipeline`);
    await rows();
    const reads = () => calls.filter((c) => c === `/api/repos/${REAL.id}/guard/setup`).length;
    expect(reads()).toBe(1);

    fireSocket('spec:complete', { repoId: 'other', kind: 'guard-setup' });
    expect(reads()).toBe(1);

    fireSocket('spec:complete', { repoId: REAL.id, kind: 'guard-setup' });
    await waitFor(() => expect(reads()).toBe(2));
  });
});

describe('the Runs tab', () => {
  it('keeps its search only: the repository’s actions live on Pipeline', async () => {
    serve();
    renderAt(`/repos/${REAL.id}/runs`);

    await screen.findByRole('table', { name: 'Runs' });
    expect(screen.getByRole('textbox', { name: 'Search runs' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate flows' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open Agent' })).toBeNull();
  });
});
