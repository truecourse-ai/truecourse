/**
 * The one-product shell renders, at every address it offers.
 *
 * This is a SMOKE test, deliberately: what is worth asserting is that each
 * route mounts without throwing and lands on the thing that route is for, not
 * how any of it looks. Each case names one heading only that route produces.
 *
 * Nothing is fixture-backed any more, so the shell is driven by a SERVER: the
 * first half serves a workspace with nothing connected and asserts each page's
 * honest empty state, the second serves one connected repository and walks its
 * console. Both halves answer `window.fetch` in the payload shapes the real
 * routes answer in.
 *
 * `PreviewApp` carries no router: it is mounted as a DESCENDANT route set, the
 * way `App.tsx` mounts it at `/preview/*`, so the test can supply a
 * MemoryRouter and drive it by address.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/lib/socket', () => {
  const socket = { connected: true, on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn() };
  return {
    connectSocket: () => socket,
    getSocket: () => socket,
    disconnectSocket: vi.fn(),
    joinRepoRoom: vi.fn(),
    leaveRepoRoom: vi.fn(),
  };
});

import PreviewApp from '@/preview/PreviewApp';

// jsdom implements no layout, so an element has no scrollTo (the shared setup
// polyfills scrollIntoView for the same reason). A conversation pins itself to
// the bottom in an effect, which is that call.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const REPO = {
  id: 'linkwarden',
  name: 'linkwarden/linkwarden',
  path: '/clones/linkwarden__linkwarden',
  remoteUrl: 'https://github.com/linkwarden/linkwarden',
};

const USER = {
  id: 'user_1',
  email: 'dana@acme.dev',
  firstName: 'Dana',
  lastName: 'Rees',
  organizationId: 'org_1',
  organizationName: 'Northwind Labs',
  isOperator: true,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const realFetch = window.fetch;

/**
 * A server holding the given repositories and nothing else: every guard, spec
 * and context read answers its EMPTY payload, which is what a workspace that
 * has never run anything really holds.
 */
function serve(registry: typeof REPO[] = []) {
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    if (pathname === '/api/auth/me') return json({ user: USER });
    if (pathname === '/api/auth/workspaces') {
      return json({ workspaces: [{ id: 'org_1', name: 'Northwind Labs', current: true }] });
    }
    if (pathname === '/api/repos') return json(registry);
    if (pathname === '/api/llm/config') return json({ config: null, providers: ['anthropic'] });
    if (pathname === '/api/github/status') return json({ installations: [], installUrl: '', repos: [] });
    if (pathname === '/api/workspace/members') return json({ members: [], invitations: [] });
    if (pathname === '/api/context/sources') return json({ sources: [] });
    if (pathname === '/api/context/documents') return json({ documents: [], areas: [], repositories: [] });
    if (pathname === '/api/context/conflicts') return json({ conflicts: [] });
    if (pathname === '/api/sessions/runs') return json({ runs: [] });
    if (pathname.endsWith('/sessions/runs')) return json({ runs: [] });
    if (pathname.endsWith('/guard/flows')) return json({ flows: [], totals: { total: 0 }, recipe: null });
    if (pathname.endsWith('/guard/history')) return json({ runs: [] });
    if (pathname.endsWith('/guard/interfaces')) return json({ interfaces: [] });
    if (pathname.endsWith('/guard/dependencies')) return json({ dependencies: [] });
    if (pathname.endsWith('/guard/status')) {
      return json({ sections: null, coverage: null, lastRun: null, lastGenerate: null });
    }
    if (pathname.endsWith('/context/bindings')) return json({ sourceIds: [] });
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
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

beforeEach(() => serve());
afterEach(() => {
  window.fetch = realFetch;
});

const ROUTES: { path: string; heading: RegExp }[] = [
  { path: '/preview', heading: /^Home$/ },
  { path: '/preview/code', heading: /^Code$/ },
  { path: '/preview/flows', heading: /^Flows$/ },
  { path: '/preview/context', heading: /^Context$/ },
  { path: '/preview/context/documents', heading: /^Documents$/ },
  { path: '/preview/context/conflicts', heading: /^Conflicts$/ },
  { path: '/preview/settings', heading: /^Settings$/ },
  { path: '/preview/agent', heading: /^Agent$/ },
  { path: '/preview/notifications', heading: /^Notifications$/ },
  { path: '/preview/admin', heading: /^Admin$/ },
];

describe('the one-product shell', () => {
  for (const route of ROUTES) {
    it(`renders ${route.path}`, () => {
      renderAt(route.path);
      expect(screen.getAllByRole('heading', { name: route.heading }).length).toBeGreaterThan(0);
    });
  }

  it('keeps the workspace shell around every route', () => {
    renderAt('/preview/notifications');
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Context' })).toHaveAttribute('href', '/preview/context');
    expect(screen.getByRole('link', { name: 'Code' })).toHaveAttribute('href', '/preview/code');
    expect(screen.getByRole('link', { name: 'Flows' })).toHaveAttribute('href', '/preview/flows');
    // Knowledge is gone: Context is where the workspace's documents live.
    expect(screen.queryByText('Knowledge')).toBeNull();
    // There is no pull request page anywhere: a PR is seen through its runs.
    expect(screen.queryByRole('link', { name: 'Pull requests' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A workspace with nothing connected: every page says so in its own words.
// ---------------------------------------------------------------------------

describe('a workspace with nothing connected', () => {
  it('offers Code the one action there is, over an empty table', async () => {
    renderAt('/preview/code');
    expect(await screen.findByText('No repository connected yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect repository' })).toBeInTheDocument();
  });

  it('has no flow to list', async () => {
    renderAt('/preview/flows');
    expect(await screen.findByText(/No flow generated yet/)).toBeInTheDocument();
  });

  it('has no conversation to list', async () => {
    renderAt('/preview/agent');
    const table = await screen.findByRole('table', { name: 'Agent conversations' });
    // The header row, and the one row that says there is nothing under it.
    expect(within(table).getAllByRole('row')).toHaveLength(2);
  });

  it('has no source to read', async () => {
    renderAt('/preview/context');
    expect(await screen.findByText(/No source yet/)).toBeInTheDocument();
  });

  it('has nothing in the notification feed', async () => {
    renderAt('/preview/notifications');
    expect(await screen.findByText('Nothing has happened yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
  });

  it('leaves Home its placeholder, and sends the reader to Code', () => {
    renderAt('/preview');
    expect(screen.getAllByRole('link', { name: 'Code' }).length).toBeGreaterThan(0);
    // Home holds no repository table.
    expect(screen.queryByRole('button', { name: 'Connect repository' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// One connected repository: its console is a place, tab by tab.
// ---------------------------------------------------------------------------

describe('a connected repository', () => {
  beforeEach(() => serve([REPO]));

  it('is a row on Code, opening its console', async () => {
    renderAt('/preview/code');
    expect(await screen.findByText('linkwarden/linkwarden')).toBeInTheDocument();
  });

  it('lands an address with no tab on Runs, under the Code crumb', async () => {
    renderAt('/preview/repos/linkwarden');
    const menu = await screen.findByRole('navigation', { name: 'Repository sections' });
    expect(within(menu).getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page');
    const crumbs = screen.getAllByRole('navigation', { name: 'Breadcrumb' })[0]!;
    expect(within(crumbs).getByRole('link', { name: 'Code' })).toHaveAttribute('href', '/preview/code');
  });

  it("has no Corpus and no Sources tab: documentation is the workspace's", async () => {
    renderAt('/preview/repos/linkwarden/runs');
    const menu = await screen.findByRole('navigation', { name: 'Repository sections' });
    expect(within(menu).queryByRole('link', { name: 'Corpus' })).toBeNull();
    expect(within(menu).queryByRole('link', { name: 'Sources' })).toBeNull();
    expect(within(menu).getByRole('link', { name: 'Context' })).toHaveAttribute(
      'href',
      '/preview/repos/linkwarden/context',
    );
  });

  it('searches its runs, and says there is no run yet', async () => {
    renderAt('/preview/repos/linkwarden/runs');
    expect(await screen.findByRole('textbox', { name: 'Search runs' })).toBeInTheDocument();
    expect(await screen.findByText('No run yet.')).toBeInTheDocument();
  });

  it('renders its interfaces tab', async () => {
    renderAt('/preview/repos/linkwarden/interfaces');
    expect(await screen.findByRole('heading', { name: 'Interfaces' })).toBeInTheDocument();
  });

  it('renders its dependencies tab', async () => {
    renderAt('/preview/repos/linkwarden/dependencies');
    expect(await screen.findByRole('heading', { name: 'Dependencies' })).toBeInTheDocument();
  });

  it('offers unlink on its settings tab, and no gate policy nobody stores', async () => {
    renderAt('/preview/repos/linkwarden/settings');
    expect(await screen.findByRole('button', { name: 'Unlink repository' })).toBeInTheDocument();
    expect(screen.queryByText('Gate policy')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Notify e-mail addresses' })).toBeNull();
  });

  it('answers an address no repository is under', async () => {
    renderAt('/preview/repos/no-such-repo/runs');
    expect(await screen.findByText('No such repository')).toBeInTheDocument();
  });
});
