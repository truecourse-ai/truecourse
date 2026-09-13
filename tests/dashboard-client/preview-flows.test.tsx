/**
 * Flows: every flow of every repository of the workspace, in one list.
 *
 * The page is REAL all the way down — it fans out over the connected registry
 * and reads each repository's stored flows — so what is asserted here is what
 * it does with those answers: the rows it draws across repositories, the
 * filters it writes into the address, the search, the flow it opens through
 * `?repo=`, and the re-read a generate landing on the socket triggers.
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

import PreviewApp from '@/preview/PreviewApp';

function fireSocket(event: string, payload: unknown): void {
  for (const fn of listeners.get(event) ?? []) fn(payload);
}

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const realFetch = window.fetch;

const CLI = {
  id: 'filecli',
  name: 'spiderhands/filecli',
  path: 'spiderhands/filecli',
  remoteUrl: 'https://github.com/spiderhands/filecli',
};

const WEB = {
  id: 'web',
  name: 'acme/web',
  path: 'acme/web',
  remoteUrl: 'https://github.com/acme/web',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function flow(over: Record<string, unknown>) {
  return {
    goal: 'a goal',
    status: 'pass',
    bucket: 'guarded',
    epic: false,
    composedOf: [],
    manual: false,
    milestoneCount: 2,
    sectionCount: 1,
    docs: ['docs/cli.md'],
    surfaces: [],
    findings: 0,
    toolDefects: 0,
    errors: 0,
    interfaceDrifted: false,
    ...over,
  };
}

const WRITE_READ = flow({
  flowId: 'write-then-read',
  title: 'Writes a file and reads it back',
  drivers: ['cli'],
  surfaces: [{ surface: 'cli', scenarioId: 'write-then-read.cli.1', status: 'pass', outcome: 'pass' }],
});

const CHECKOUT = flow({
  flowId: 'checkout',
  title: 'Checks out with a saved card',
  drivers: ['web'],
  status: 'blocked-on',
  bucket: 'blocked',
  sectionCount: 0,
});

/** Two connected repositories, one flow each. */
function serve(options: { cliFlows?: unknown[]; webFlows?: unknown[] } = {}) {
  const state = {
    calls: [] as string[],
    cli: options.cliFlows ?? [WRITE_READ],
    web: options.webFlows ?? [CHECKOUT],
  };
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    state.calls.push(method === 'GET' ? `${url.pathname}${url.search}` : `${method} ${url.pathname}`);
    if (url.pathname === '/api/repos') return json([CLI, WEB]);
    if (url.pathname === '/api/llm/config') return json({ config: { provider: 'anthropic' }, providers: ['anthropic'] });
    if (url.pathname === `/api/repos/${CLI.id}/guard/flows`) return json({ recipe: null, flows: state.cli });
    if (url.pathname === `/api/repos/${WEB.id}/guard/flows`) return json({ recipe: null, flows: state.web });
    if (/\/guard\/decisions$/.test(url.pathname)) return json({ version: 1, dismissedClaims: [], dismissedFlows: [] });
    if (/\/guard\/interfaces$/.test(url.pathname)) return json({ mapped: false, interfaces: [], surfaces: [], totals: {} });
    if (/\/guard\/claims$/.test(url.pathname)) return json({ extracted: false, claims: [], flows: [] });
    if (/\/guard\/scenarios$/.test(url.pathname)) return json({ recipe: null, scenarios: [] });
    if (/\/sessions\/runs$/.test(url.pathname)) return json({ runs: [] });
    return json({ error: `not found: ${url.pathname}` }, 404);
  }) as unknown as typeof window.fetch;
  return state;
}

/** The address, so a filter's effect on it can be read. */
function Address() {
  const { pathname, search } = useLocation();
  return <span data-testid="address">{`${pathname}${search}`}</span>;
}

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/preview/*" element={<PreviewApp />} />
      </Routes>
      <Address />
    </MemoryRouter>,
  );
}

/** The table's data rows, in the order they render. */
function rows() {
  const table = screen.getByRole('table', { name: 'Flows' });
  return within(table).getAllByRole('row').slice(1);
}

beforeEach(() => {
  listeners.clear();
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
});

describe('Flows, the index', () => {
  it('lists the flows of every connected repository, each naming the repository it belongs to', async () => {
    const state = serve();
    renderAt('/preview/flows');

    expect(await screen.findByRole('heading', { name: 'Flows' })).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(2));

    const byTitle = (title: string) => rows().find((r) => within(r).queryByText(title))!;
    const cli = byTitle('Writes a file and reads it back');
    expect(within(cli).getByText('spiderhands/filecli')).toBeInTheDocument();
    expect(within(cli).getByText('CLI')).toBeInTheDocument();
    expect(within(cli).getByText('Succeeded')).toBeInTheDocument();
    // The one section this flow binds; a flow bound to none says nothing.
    expect(within(cli).getByText('1')).toBeInTheDocument();

    const web = byTitle('Checks out with a saved card');
    expect(within(web).getByText('acme/web')).toBeInTheDocument();
    expect(within(web).queryByText('0')).toBeNull();

    expect(state.calls).toContain(`/api/repos/${CLI.id}/guard/flows`);
    expect(state.calls).toContain(`/api/repos/${WEB.id}/guard/flows`);
  });

  it('puts a filter picked through Add filter into the address', async () => {
    serve();
    renderAt('/preview/flows');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Repository/ }));
    await user.click(await screen.findByRole('option', { name: /acme\/web/ }));

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByTestId('address')).toHaveTextContent('/preview/flows?repo=web');
    expect(within(rows()[0]!).getByText('Checks out with a saved card')).toBeInTheDocument();
  });

  it('reads the address it arrives on, and narrows by driver too', async () => {
    serve();
    renderAt('/preview/flows?driver=cli');

    expect(await screen.findByText('Writes a file and reads it back')).toBeInTheDocument();
    expect(rows()).toHaveLength(1);
    expect(screen.queryByText('Checks out with a saved card')).toBeNull();

    const filters = screen.getByRole('group', { name: 'Filter flows' });
    expect(within(filters).getByRole('button', { name: 'Remove Driver CLI' })).toBeInTheDocument();
  });

  it('searches the title', async () => {
    serve();
    renderAt('/preview/flows');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    await user.type(screen.getByRole('textbox', { name: 'Search flows' }), 'saved card');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('Checks out with a saved card')).toBeInTheDocument();
  });

  it('says what an empty workspace is waiting for, and what a filter excluded', async () => {
    serve({ cliFlows: [], webFlows: [] });
    renderAt('/preview/flows');
    const user = userEvent.setup();

    expect(await screen.findByText(/No flow generated yet\./)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Search flows' }), 'nothing');
    expect(await screen.findByText('Nothing matches.')).toBeInTheDocument();
  });

  it('re-reads when a generate of a repository lands on the socket', async () => {
    const state = serve();
    renderAt('/preview/flows');
    await waitFor(() => expect(rows()).toHaveLength(2));
    const reads = () => state.calls.filter((c) => c.endsWith('/guard/flows')).length;
    const before = reads();

    // A kind that changes no flow changes nothing.
    fireSocket('spec:complete', { repoId: CLI.id, kind: 'spec-scan' });
    expect(reads()).toBe(before);

    state.web = [CHECKOUT, flow({ flowId: 'refund', title: 'Refunds an order', drivers: ['api'] })];
    fireSocket('spec:complete', { repoId: WEB.id, kind: 'guard-generate' });
    await waitFor(() => expect(rows()).toHaveLength(3), { timeout: 3000 });
  });
});

describe('one flow', () => {
  it('opens from its row, through the repository the address names', async () => {
    serve();
    renderAt('/preview/flows');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    const cli = rows().find((r) => within(r).queryByText('Writes a file and reads it back'))!;
    await user.click(cli);

    await waitFor(() =>
      expect(screen.getByTestId('address')).toHaveTextContent(
        '/preview/flows/write-then-read?repo=filecli',
      ),
    );
    expect(
      await screen.findByRole('heading', { name: 'Writes a file and reads it back' }),
    ).toBeInTheDocument();
    const crumbs = screen.getAllByRole('navigation', { name: 'Breadcrumb' }).at(-1)!;
    expect(within(crumbs).getByRole('link', { name: 'Flows' })).toHaveAttribute('href', '/preview/flows');
  });
});
