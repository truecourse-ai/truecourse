/**
 * Flows: every flow of every repository of the workspace, in one place, one
 * table per status.
 *
 * The page is REAL all the way down — it fans out over the connected registry
 * and reads each repository's stored flows — so what is asserted here is what
 * it does with those answers: the rows it draws under each status, what a
 * failed flow and a blocked one say, the filters it writes into the address,
 * the search, the flow it opens through `?repo=`, and the re-read a generate
 * landing on the socket triggers.
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
  provider: 'github',
};

const WEB = {
  id: 'web',
  name: 'acme/web',
  path: 'acme/web',
  provider: 'github',
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
function serve(options: { cliFlows?: unknown[]; webFlows?: unknown[]; showBlocked?: boolean } = {}) {
  const state = {
    showBlocked: options.showBlocked ?? true,
    calls: [] as string[],
    cli: options.cliFlows ?? [WRITE_READ],
    web: options.webFlows ?? [CHECKOUT],
  };
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    state.calls.push(method === 'GET' ? `${url.pathname}${url.search}` : `${method} ${url.pathname}`);
    if (url.pathname === '/api/workspace/profile') return json({ description: 'Acme store', updatedAt: null, showBlocked: state.showBlocked });
    if (url.pathname === '/api/workspace/display') {
      state.showBlocked = JSON.parse(String(init?.body)).showBlocked;
      return json({ description: 'Acme store', updatedAt: null, showBlocked: state.showBlocked });
    }
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
        <Route path="/*" element={<DashboardApp />} />
      </Routes>
      <Address />
    </MemoryRouter>,
  );
}

/** Every status table's data rows, in the order they render. */
function rows() {
  return screen.queryAllByRole('table').flatMap((table) => within(table).getAllByRole('row').slice(1));
}

beforeEach(() => {
  listeners.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  window.fetch = realFetch;
});

describe('Flows, the index', () => {
  it('uses the workspace preference and removes the page control', async () => {
    serve({ showBlocked: false });
    renderAt('/flows');
    await screen.findByText('Writes a file and reads it back');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.queryByText('Checks out with a saved card')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Show blocked' })).toBeNull();
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }));
    const setting = await screen.findByRole('checkbox', { name: 'Show blocked results' });
    await waitFor(() => expect(setting).toBeEnabled());
    await userEvent.click(setting);
    await waitFor(() => expect(setting).toBeChecked());
    await waitFor(() => expect(setting).toBeEnabled());
    await userEvent.click(screen.getByRole('link', { name: 'Flows' }));
    await waitFor(() => expect(rows()).toHaveLength(2));
  });

  it('honors a link to blocked flows even when the workspace excludes them', async () => {
    serve({ showBlocked: false });
    renderAt('/flows?status=blocked');
    expect(await screen.findByText('Checks out with a saved card')).toBeInTheDocument();
    expect(rows()).toHaveLength(1);
  });

  it('lists the flows of every connected repository under the status each wears', async () => {
    const state = serve();
    renderAt('/flows');

    expect(await screen.findByRole('heading', { name: 'Flows' })).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(2));

    const succeeded = screen.getByRole('table', { name: 'Succeeded flows' });
    const cli = within(succeeded).getByText('Writes a file and reads it back').closest('tr')!;
    // The document the flow cites, by file name.
    expect(within(cli).getByText('cli.md')).toBeInTheDocument();

    // A thing only one flow waits on names that flow.
    const blocked = screen.getByRole('table', { name: 'Blocked flows' });
    expect(within(blocked).getByText('Checks out with a saved card')).toBeInTheDocument();

    expect(state.calls).toContain(`/api/repos/${CLI.id}/guard/flows`);
    expect(state.calls).toContain(`/api/repos/${WEB.id}/guard/flows`);
  });

  it('says what a failed flow observed, and folds blocked flows into what they wait on', async () => {
    const blockedOn = (flowId: string, title: string) =>
      flow({
        flowId,
        title,
        status: 'blocked-on',
        bucket: 'blocked',
        test: { status: 'blocked', seeded: false, blockedOn: 'CurrencyBeacon API key' },
      });
    serve({
      cliFlows: [
        flow({
          flowId: 'edit-expense',
          title: 'Edit expense',
          status: 'fail',
          test: {
            status: 'failing',
            seeded: true,
            documented: 'Editing opens a separate page.',
            observed: 'Editing opens an in-page dialog.',
          },
        }),
        blockedOn('convert', 'Convert an expense'),
        blockedOn('convert-again', 'Convert an expense twice'),
        flow({ flowId: 'open-expense', title: 'Open an expense', test: { status: 'passing', seeded: true } }),
      ],
      webFlows: [],
    });
    renderAt('/flows');
    const user = userEvent.setup();

    const failed = await screen.findByRole('table', { name: 'Failed flows' });
    const row = within(failed).getByText('Edit expense').closest('tr')!;
    expect(within(row).getByText('Editing opens an in-page dialog.')).toBeInTheDocument();

    // Two flows, one missing thing: one row, which opens to the flows.
    const blocked = screen.getByRole('table', { name: 'Blocked flows' });
    const reason = within(blocked).getByText('CurrencyBeacon API key').closest('tr')!;
    expect(within(reason).getByText('2 flows')).toBeInTheDocument();
    expect(within(blocked).queryByText('Convert an expense')).toBeNull();
    await user.click(reason);
    expect(within(blocked).getByText('Convert an expense')).toBeInTheDocument();
    expect(within(blocked).getByText('Convert an expense twice')).toBeInTheDocument();

    const succeeded = screen.getByRole('table', { name: 'Succeeded flows' });
    expect(within(within(succeeded).getByText('Open an expense').closest('tr')!).getByText('Seeded')).toBeInTheDocument();
  });

  it('lists a flow whose test passed after healing around a renamed control as partially succeeded', async () => {
    serve({
      cliFlows: [
        flow({ flowId: 'open-expense', title: 'Open an expense', test: { status: 'passing', seeded: true } }),
        flow({
          flowId: 'rename-expense',
          title: 'Rename an expense',
          test: { status: 'passing', seeded: true, copyDrift: [{ step: 1, documented: 'Update', observed: 'Edit details' }] },
        }),
      ],
      webFlows: [],
    });
    renderAt('/flows');

    const partial = await screen.findByRole('table', { name: 'Partially succeeded flows' });
    expect(within(partial).getByText('Rename an expense')).toBeInTheDocument();
    const succeeded = screen.getByRole('table', { name: 'Succeeded flows' });
    expect(within(succeeded).getByText('Open an expense')).toBeInTheDocument();
    expect(within(succeeded).queryByText('Rename an expense')).toBeNull();
  });

  it('puts a filter picked through Add filter into the address', async () => {
    serve();
    renderAt('/flows');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Repository/ }));
    await user.click(await screen.findByRole('option', { name: /acme\/web/ }));

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByTestId('address')).toHaveTextContent('/flows?repo=web');
    expect(within(rows()[0]!).getByText('Checks out with a saved card')).toBeInTheDocument();
  });

  it('tallies the flows it shows, and the tally follows the narrowing', async () => {
    serve();
    renderAt('/flows');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    const tally = () => screen.getByRole('group', { name: 'Flows tally' });
    expect(tally().textContent).toBe('1 Blocked1 Succeeded2 total');

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Repository/ }));
    await user.click(await screen.findByRole('option', { name: /acme\/web/ }));

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(tally().textContent).toBe('1 Blocked1 of 2');
  });

  it('counts each filter value over what the other filters already keep', async () => {
    serve();
    renderAt('/flows');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    // Both statuses, before anything narrows them.
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Status/ }));
    expect(await screen.findByRole('option', { name: 'Blocked 1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Succeeded 1' })).toBeInTheDocument();

    // One repository picked: the statuses are what THAT repository holds, and
    // the repositories still say what swapping to them would give.
    await user.click(screen.getByRole('option', { name: 'Blocked 1' }));
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Repository/ }));
    expect(await screen.findByRole('option', { name: 'acme/web 1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'spiderhands/filecli 0' })).toBeInTheDocument();
  });

  it('names an applied filter without a number, and the tally says what the list was cut from', async () => {
    // Five flows: two blocked (one per repository), and two in acme/web.
    serve({
      cliFlows: [
        WRITE_READ,
        flow({ flowId: 'purge', title: 'Purges the cache', drivers: ['cli'] }),
        flow({
          flowId: 'restore',
          title: 'Restores a backup',
          drivers: ['cli'],
          status: 'blocked-on',
          bucket: 'blocked',
        }),
      ],
      webFlows: [CHECKOUT, flow({ flowId: 'signup', title: 'Signs up', drivers: ['web'] })],
    });
    renderAt('/flows');
    const user = userEvent.setup();
    // Three succeeded rows, and the two blocked flows as the one thing they wait on.
    await waitFor(() => expect(rows()).toHaveLength(4));

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Status/ }));
    await user.click(await screen.findByRole('option', { name: 'Blocked 2' }));
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Repository/ }));
    await user.click(await screen.findByRole('option', { name: 'acme/web 1' }));

    await waitFor(() => expect(rows()).toHaveLength(1));
    // A pill names its filter and nothing more: the numbers live in the tally.
    const filters = screen.getByRole('group', { name: 'Filter flows' });
    const pill = (name: string) =>
      within(filters).getByRole('button', { name: `Remove ${name}` }).parentElement!;
    expect(pill('Status Blocked').textContent).toBe('Status ·Blocked');
    expect(pill('Repository acme/web').textContent).toBe('Repository ·acme/web');
    expect(screen.getByRole('group', { name: 'Flows tally' }).textContent).toBe('1 Blocked1 of 5');
  });

  it('reads the address it arrives on, and narrows by driver too', async () => {
    serve();
    renderAt('/flows?driver=cli');

    expect(await screen.findByText('Writes a file and reads it back')).toBeInTheDocument();
    expect(rows()).toHaveLength(1);
    expect(screen.queryByText('Checks out with a saved card')).toBeNull();

    const filters = screen.getByRole('group', { name: 'Filter flows' });
    expect(within(filters).getByRole('button', { name: 'Remove Driver CLI' })).toBeInTheDocument();
  });

  it('searches the title', async () => {
    serve();
    renderAt('/flows');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    await user.type(screen.getByRole('textbox', { name: 'Search flows' }), 'saved card');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('Checks out with a saved card')).toBeInTheDocument();
  });

  it('says what an empty workspace is waiting for, and what a filter excluded', async () => {
    serve({ cliFlows: [], webFlows: [] });
    renderAt('/flows');
    const user = userEvent.setup();

    expect(await screen.findByText(/No flow generated yet\./)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Search flows' }), 'nothing');
    expect(await screen.findByText('Nothing matches.')).toBeInTheDocument();
  });

  it('re-reads when a generate of a repository lands on the socket', async () => {
    const state = serve();
    renderAt('/flows');
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
    renderAt('/flows');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    const cli = rows().find((r) => within(r).queryByText('Writes a file and reads it back'))!;
    await user.click(cli);

    await waitFor(() =>
      expect(screen.getByTestId('address')).toHaveTextContent(
        '/flows/write-then-read?repo=filecli',
      ),
    );
    expect(
      await screen.findByRole('heading', { name: 'Writes a file and reads it back' }),
    ).toBeInTheDocument();
    const crumbs = screen.getAllByRole('navigation', { name: 'Breadcrumb' }).at(-1)!;
    expect(within(crumbs).getByRole('link', { name: 'Flows' })).toHaveAttribute('href', '/flows');
  });
});
