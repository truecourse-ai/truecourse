/**
 * The Runs tab of a CONNECTED repository reads the server, not the fixtures: it
 * lists every stored run — the baseline runs and the pull-request head runs the
 * gate wrote — opens one as its own page, and re-reads itself when a run of the
 * repository lands on the socket. Generating this repository's flows is its
 * header's action, since generating is done to one repository even though the
 * flows it writes are listed at the workspace (see preview-flows.test.tsx).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// A socket the test drives: `fireSocket` delivers to whatever subscribed.
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

function fireSocket(event: string, payload: unknown): void {
  for (const fn of listeners.get(event) ?? []) fn(payload);
}

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const realFetch = window.fetch;

const REAL = {
  id: 'filecli',
  name: 'spiderhands/filecli',
  path: 'spiderhands/filecli',
  remoteUrl: 'https://github.com/spiderhands/filecli',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The stored flow inventory: one guarded cli flow. */
const FLOWS = {
  recipe: null,
  flows: [
    {
      flowId: 'write-then-read',
      title: 'Writes a file and reads it back',
      goal: 'round-trip a file',
      status: 'pass',
      bucket: 'guarded',
      epic: false,
      composedOf: [],
      manual: false,
      milestoneCount: 2,
      sectionCount: 1,
      docs: ['docs/cli.md'],
      surfaces: [{ surface: 'cli', scenarioId: 'write-then-read.cli.1', status: 'pass', outcome: 'pass' }],
      drivers: ['cli'],
    },
  ],
};

const summary = { total: 1, pass: 0, fail: 1, stale: 0, orphaned: 0, error: 0, blocked: 0 };

/** The stored runs: the baseline run, then a pull request's head run. */
const HISTORY = {
  runs: [
    { runId: 'r-main1', ranAt: '2026-09-01T10:00:00Z', branch: 'main', commit: 'a1b2c3d', summary, origin: 'hosted' },
    { runId: 'r-head7', ranAt: '2026-09-02T10:00:00Z', branch: 'feature', commit: 'f00d123', summary, pullRequest: 7, origin: 'hosted' },
  ],
};

/** The head run's snapshot: one failing scenario. */
const HEAD_RUN = {
  run: {
    runId: 'r-head7',
    ranAt: '2026-09-02T10:00:00Z',
    branch: 'feature',
    commit: 'f00d123',
    recipeFingerprint: 'sha256:r',
    pullRequest: 7,
    origin: 'hosted',
  },
  summary,
  scenarios: [
    {
      id: 'write-then-read.cli.1',
      title: 'Writes a file and reads it back',
      binds: { doc: 'docs/cli.md', section: 'round-trip', fingerprint: 'sha256:x' },
      outcome: 'fail',
      durationMs: 12,
      flowId: 'write-then-read',
      failure: { step: 2, expected: 'exit 0', actual: 'exit 1' },
    },
  ],
  sections: [],
  runFlows: [],
};

/** One connected repository and what its server answers. */
function serve(options: { flows?: unknown; history?: unknown } = {}) {
  const calls: string[] = [];
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(method === 'GET' ? `${url.pathname}${url.search}` : `${method} ${url.pathname}`);
    const rest = url.pathname.replace(`/api/repos/${REAL.id}/`, '');
    if (url.pathname === '/api/repos') return json([REAL]);
    if (url.pathname === '/api/llm/config') return json({ config: { provider: 'anthropic' }, providers: ['anthropic'] });
    if (rest === 'sessions/runs') return json({ runs: [] });
    if (rest === 'guard/generate' && method === 'POST') return json({ jobId: 'generation-retry' }, 202);
    if (rest === 'guard/flows') return json(options.flows ?? FLOWS);
    if (rest === 'guard/flows/write-then-read') return json({ error: 'not here' }, 404);
    if (rest === 'guard/decisions') return json({ version: 1, dismissedClaims: [], dismissedFlows: [] });
    if (rest === 'guard/interfaces') return json({ mapped: false, interfaces: [], surfaces: [], totals: {} });
    if (rest === 'guard/claims') return json({ extracted: false, claims: [], flows: [] });
    if (rest === 'guard/scenarios') return json({ recipe: null, scenarios: [] });
    if (rest === 'guard/history') return json(options.history ?? HISTORY);
    if (rest === 'guard/runs/r-head7') return json(HEAD_RUN);
    if (rest === 'guard/latest') return json({ error: 'no run' }, 404);
    return json({ error: `not found: ${rest}` }, 404);
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
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listeners.clear();
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
});

describe('generating the flows of a connected repository', () => {
  it.each([FLOWS, { recipe: null, flows: [] }])('always offers manual generation regardless of the existing inventory', async (flows) => {
    const calls = serve({ flows });
    renderAt(`/preview/repos/${REAL.id}/runs`);
    const generate = await screen.findByRole('button', { name: 'Generate flows' });
    await waitFor(() => expect(generate).toBeEnabled());
    await userEvent.click(generate);
    await waitFor(() => expect(calls).toContain(`POST /api/repos/${REAL.id}/guard/generate`));
    expect(calls.some((call) => call.includes('/api/ee/'))).toBe(false);
    expect(screen.getByRole('link', { name: 'Open Agent' })).toHaveAttribute('href', `/preview/agent?repo=${REAL.id}`);
  });
});

describe('the Runs tab of a connected repository', () => {
  it('shows a short commit while preserving the full hash for hover and search', async () => {
    const commit = '3ec877a68bc423373220f9ee2fda3d93ba368680';
    serve({ history: { runs: [{ ...HISTORY.runs[0], commit }, HISTORY.runs[1]] } });
    renderAt(`/preview/repos/${REAL.id}/runs`);
    const user = userEvent.setup();
    const table = await screen.findByRole('table', { name: 'Runs' });
    const shortCommit = await within(table).findByText(commit.slice(0, 8));
    expect(shortCommit).toHaveAttribute('title', commit);

    await user.type(screen.getByRole('textbox', { name: 'Search runs' }), commit);
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText(commit.slice(0, 8))).toBeInTheDocument();
    expect(within(table).queryByText('f00d123')).not.toBeInTheDocument();
  });

  it('lists every stored run, newest first, naming its pull request and origin', async () => {
    const calls = serve();
    renderAt(`/preview/repos/${REAL.id}/runs`);

    const table = await screen.findByRole('table', { name: 'Runs' });
    await within(table).findByText('f00d123');
    expect(calls).toContain(`/api/repos/${REAL.id}/guard/history?all=1`);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual(['f00d123', 'a1b2c3d']);
    expect(within(rows[0]!).getByText('#7')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('hosted')).toBeInTheDocument();
    // No run names a coverage version, so the column stays out of the table.
    expect(within(table).queryByRole('columnheader', { name: 'Coverage' })).toBeNull();
  });

  it('is a full-width search over an opaque sticky head, and no filter row', async () => {
    serve();
    renderAt(`/preview/repos/${REAL.id}/runs`);

    const table = await screen.findByRole('table', { name: 'Runs' });
    // The search box is the whole toolbar: Origin is a column, and one
    // dimension does not earn a filter row.
    expect(screen.getByRole('textbox', { name: 'Search runs' }).className).toContain('w-full');
    expect(screen.queryByRole('group', { name: /^Filter/ })).toBeNull();
    // The head sticks, so the rows scrolling under it must be hidden.
    const head = within(table).getAllByRole('columnheader')[0]!.closest('thead')!;
    expect(head.className).toContain('sticky');
    expect(head.className).toContain('bg-card');
  });

  it('opens a run as its own page, reading exactly that run', async () => {
    const calls = serve();
    renderAt(`/preview/repos/${REAL.id}/runs/r-head7`);

    await screen.findByRole('heading', { name: 'f00d123' });
    const crumbs = screen.getAllByRole('navigation', { name: 'Breadcrumb' }).at(-1)!;
    expect(within(crumbs).getByRole('link', { name: 'Runs' })).toBeInTheDocument();
    await screen.findByText('Writes a file and reads it back');
    expect(calls).toContain(`/api/repos/${REAL.id}/guard/runs/r-head7`);
    expect(screen.queryByText('No such run')).toBeNull();
  });

  it('re-reads the list when a run of the repository lands on the socket', async () => {
    const calls = serve();
    renderAt(`/preview/repos/${REAL.id}/runs`);
    const table = await screen.findByRole('table', { name: 'Runs' });
    await within(table).findByText('f00d123');
    const reads = () => calls.filter((c) => c === `/api/repos/${REAL.id}/guard/history?all=1`).length;
    expect(reads()).toBe(1);

    fireSocket('spec:complete', { repoId: 'other', kind: 'guard-run' });
    fireSocket('spec:complete', { repoId: REAL.id, kind: 'guard-setup' });
    expect(reads()).toBe(1);

    fireSocket('spec:complete', { repoId: REAL.id, kind: 'guard-run' });
    await waitFor(() => expect(reads()).toBe(2));
  });
});
