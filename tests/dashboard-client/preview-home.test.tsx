/**
 * Home, the product owner's dashboard.
 *
 * The page is real all the way down: it reads `GET /api/home`, whose numbers
 * the server folded and whose addresses the server computed. What is asserted
 * here is what the page DOES with that answer: the chart it draws and the
 * doors its words open, the three widgets and their rows, the period in the
 * address of the next read, and the re-read a moved workspace earns. The
 * dashboard is only reached by a workspace that has both a context source and a
 * connected repository, so the world here has one of each.
 *
 * The second describe is the other Home: the two checkpoints a workspace sees
 * until it has both, which are decided from the sources and the registry alone
 * and never read the dashboard.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ContextSourceView, HomeResponse } from '@truecourse/shared';

vi.mock('@/lib/socket', () => {
  const socket = {
    connected: false,
    on: () => socket,
    off: () => socket,
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

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const realFetch = window.fetch;

// --- The event stream, as a stub jsdom does not provide ---------------------

const streams: StubEventSource[] = [];

class StubEventSource {
  listeners = new Set<(e: MessageEvent<string>) => void>();
  constructor(readonly url: string) {
    streams.push(this);
  }
  addEventListener(_type: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.add(fn);
  }
  removeEventListener(_type: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.delete(fn);
  }
  close() {}
}

function fireFrame(payload: unknown): void {
  act(() => {
    for (const stream of streams) {
      for (const fn of stream.listeners) fn({ data: JSON.stringify(payload) } as MessageEvent<string>);
    }
  });
}

// --- The world --------------------------------------------------------------

const REFUNDS = 'context/site-docs-acme/refunds.md';
const SHIPPING = 'context/site-docs-acme/shipping.md';

const HOME: HomeResponse = {
  period: '30d',
  today: {
    total: 5,
    byStatus: { proved: 2, failed: 1, blocked: 1, 'not-testable': 0, 'not-run': 1 },
  },
  trend: [
    {
      at: '2026-09-01T10:00:00.000Z',
      byStatus: { proved: 1, failed: 2, blocked: 1, 'not-testable': 0, 'not-run': 1 },
    },
    {
      at: '2026-09-09T10:00:00.000Z',
      byStatus: { proved: 2, failed: 1, blocked: 1, 'not-testable': 0, 'not-run': 1 },
    },
  ],
  areas: [
    {
      area: 'acme/payments',
      total: 3,
      byStatus: { proved: 1, failed: 1, blocked: 1, 'not-testable': 0, 'not-run': 0 },
    },
    {
      area: 'acme/logistics',
      total: 2,
      byStatus: { proved: 1, failed: 0, blocked: 0, 'not-testable': 0, 'not-run': 1 },
    },
  ],
  attention: [
    {
      id: 'conversation:run-1',
      kind: 'conversation',
      title: 'Flow generation',
      status: 'Failed',
      fact: 'acme/web, the provider refused',
      at: '2026-09-09T09:00:00.000Z',
      href: '/preview/agent/run-1',
    },
    {
      id: 'conflict:c-1',
      kind: 'conflict',
      title: 'refund window disagrees',
      status: 'Conflict',
      fact: 'acme/payments',
      at: null,
      href: '/preview/context/conflicts/c-1',
    },
    {
      id: 'provider',
      kind: 'provider',
      title: 'No model provider',
      status: 'Needs setup',
      fact: 'Nothing can run until this workspace names a provider',
      at: null,
      href: '/preview/settings/models',
    },
  ],
  changed: [
    {
      ref: REFUNDS,
      title: 'Refunds',
      event: 'Proved',
      at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      href: `/preview/context/doc/${encodeURIComponent(REFUNDS)}`,
    },
    {
      ref: SHIPPING,
      title: 'Shipping',
      event: 'First read',
      at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      href: `/preview/context/doc/${encodeURIComponent(SHIPPING)}`,
    },
  ],
};

/** What makes the workspace a dashboard: one source and one repository. */
const SOURCE: ContextSourceView = {
  id: 'site-docs-acme',
  kind: 'site',
  title: 'docs.acme.com',
  config: { llmsTxtUrl: 'https://docs.acme.com/llms.txt' },
  status: 'synced',
  statusNote: null,
  lastSyncAt: '2026-09-01T10:00:00.000Z',
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  docCount: 12,
  repositories: ['acme/web'],
};

const REPO = {
  id: 'web',
  name: 'acme/web',
  path: 'acme/web',
  remoteUrl: 'https://github.com/acme/web',
};

const EMPTY: HomeResponse = {
  period: '30d',
  today: { total: 0, byStatus: { proved: 0, failed: 0, blocked: 0, 'not-testable': 0, 'not-run': 0 } },
  trend: [],
  areas: [],
  attention: [],
  changed: [],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface World {
  home: HomeResponse;
  /** The registry, as `/api/repos` answers it. */
  repos: unknown[];
  /** The workspace's context sources. */
  sources: ContextSourceView[];
  calls: string[];
}

function serve(over: Partial<World> = {}) {
  const state: World = { home: HOME, repos: [REPO], sources: [SOURCE], calls: [], ...over };
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    state.calls.push(method === 'GET' ? `${url.pathname}${url.search}` : `${method} ${url.pathname}`);
    if (url.pathname === '/api/home') return json(state.home);
    if (url.pathname === '/api/repos') return json(state.repos);
    if (url.pathname === '/api/llm/config') {
      return json({ config: { provider: 'anthropic' }, providers: ['anthropic'] });
    }
    if (url.pathname === '/api/sessions/runs') return json({ runs: [] });
    if (url.pathname === '/api/context/sources') {
      return json({ sources: state.sources, changedAt: null });
    }
    if (url.pathname === '/api/context/documents') return json({ documents: [], corpusAt: null });
    if (url.pathname === '/api/context/staleness') {
      return json({ changedAt: null, corpusAt: null, stale: false });
    }
    if (url.pathname === '/api/notifications') return json({ notifications: [], unreadCount: 0 });
    return json({ error: `not found: ${url.pathname}` }, 404);
  }) as unknown as typeof window.fetch;
  return state;
}

/** The router's address, so a navigation can be asserted. */
function Address() {
  const { pathname, search } = useLocation();
  return <div data-testid="address">{`${pathname}${search}`}</div>;
}

function renderHome() {
  window.history.replaceState({}, '', '/preview');
  render(
    <MemoryRouter initialEntries={['/preview']}>
      <Routes>
        <Route path="/preview/*" element={<PreviewApp />} />
      </Routes>
      <Address />
    </MemoryRouter>,
  );
}

const address = () => screen.getByTestId('address').textContent;
const chart = () => screen.getByRole('region', { name: 'Sections over time' });
const homeCalls = (state: World) => state.calls.filter((call) => call.startsWith('/api/home'));

beforeEach(() => {
  streams.length = 0;
  (globalThis as { EventSource?: unknown }).EventSource = StubEventSource;
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
  delete (globalThis as { EventSource?: unknown }).EventSource;
  vi.restoreAllMocks();
});

describe('Home', () => {
  it('draws today’s numbers in the strip above the chart, the proved share first', async () => {
    serve();
    renderHome();

    const strip = await screen.findByRole('list', { name: 'Today' });
    expect(within(strip).getByText('40%')).toBeInTheDocument();
    expect(within(strip).getByText('proved')).toBeInTheDocument();
    expect(within(strip).getByRole('listitem', { name: '2 Proved' })).toBeInTheDocument();
    expect(within(strip).getByRole('listitem', { name: '1 Failed' })).toBeInTheDocument();
    expect(within(strip).getByRole('listitem', { name: '1 Blocked' })).toBeInTheDocument();
    expect(within(strip).getByRole('listitem', { name: '0 Not testable' })).toBeInTheDocument();
    expect(within(strip).getByRole('listitem', { name: '1 Not run' })).toBeInTheDocument();
    // The chart's readout is the legend; its numbers appear under the pointer only.
    await waitFor(() => expect(chart()).toBeInTheDocument());
    expect(within(chart()).getByRole('button', { name: 'Proved' })).toBeInTheDocument();
    expect(within(chart()).queryByRole('button', { name: '2 Proved' })).toBeNull();
  });

  it('opens Documents narrowed to a status from the strip', async () => {
    serve();
    renderHome();

    const strip = await screen.findByRole('list', { name: 'Today' });
    await userEvent.click(within(strip).getByRole('listitem', { name: '1 Failed' }));

    expect(address()).toBe('/preview/context/documents?status=failed');
  });

  it('opens Documents narrowed to a status from the readout', async () => {
    serve();
    renderHome();

    await waitFor(() => expect(chart()).toBeInTheDocument());
    await userEvent.click(within(chart()).getByRole('button', { name: 'Blocked' }));

    expect(address()).toBe('/preview/context/documents?status=blocked');
  });

  it('reads the period the chips ask for', async () => {
    const state = serve();
    renderHome();

    await waitFor(() => expect(homeCalls(state)).toEqual(['/api/home?period=30d']));
    await userEvent.click(screen.getByRole('button', { name: '7d' }));

    await waitFor(() => expect(homeCalls(state)).toContain('/api/home?period=7d'));
  });

  it('draws the three widgets the server filled', async () => {
    serve();
    renderHome();

    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    expect(await within(attention).findByText('Flow generation')).toBeInTheDocument();
    expect(within(attention).getByText('Failed')).toBeInTheDocument();
    expect(within(attention).getByText('acme/web, the provider refused')).toBeInTheDocument();
    expect(within(attention).getByText('refund window disagrees')).toBeInTheDocument();
    expect(within(attention).getByText('Needs setup')).toBeInTheDocument();

    const areas = screen.getByRole('region', { name: 'Areas' });
    expect(within(areas).getByText('acme/payments')).toBeInTheDocument();
    expect(within(areas).getByText('acme/logistics')).toBeInTheDocument();

    const changed = screen.getByRole('region', { name: 'Recently changed' });
    expect(within(changed).getByText('Refunds')).toBeInTheDocument();
    expect(within(changed).getByText('Proved')).toBeInTheDocument();
    expect(within(changed).getByText('First read')).toBeInTheDocument();
    // Grouped by day, as the feed reads.
    expect(within(changed).getByText('Today')).toBeInTheDocument();
    expect(within(changed).getByText('Earlier')).toBeInTheDocument();
  });

  it('opens an attention row where the server addressed it', async () => {
    serve();
    renderHome();

    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    await userEvent.click(await within(attention).findByText('Flow generation'));

    expect(address()).toBe('/preview/agent/run-1');
  });

  it('opens the document a change is about', async () => {
    serve();
    renderHome();

    const changed = await screen.findByRole('region', { name: 'Recently changed' });
    await userEvent.click(await within(changed).findByText('Refunds'));

    expect(address()).toBe(`/preview/context/doc/${encodeURIComponent(REFUNDS)}`);
  });

  it('narrows Documents to an area from its strip', async () => {
    serve();
    renderHome();

    const areas = await screen.findByRole('region', { name: 'Areas' });
    await userEvent.click(await within(areas).findByText('acme/payments'));

    expect(address()).toBe('/preview/context/documents?area=acme%2Fpayments');
  });

  it('says what an empty workspace has, and draws no chart', async () => {
    serve({ home: EMPTY });
    renderHome();

    expect(await screen.findByText('Nothing is waiting on you.')).toBeInTheDocument();
    expect(screen.getByText('No document is read by a repository yet.')).toBeInTheDocument();
    expect(screen.getByText('Nothing has changed.')).toBeInTheDocument();
    expect(screen.getByText('Nothing has run yet, so there is nothing to draw.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sections over time' })).not.toBeInTheDocument();
  });

  it('re-reads when the workspace moves', async () => {
    const state = serve();
    renderHome();

    await waitFor(() => expect(homeCalls(state)).toHaveLength(1));
    fireFrame({ type: 'context.changed' });

    await waitFor(() => expect(homeCalls(state).length).toBeGreaterThan(1), { timeout: 2000 });
  });
});

describe('Home onboarding', () => {
  const list = () => screen.getByRole('list', { name: 'Getting started' });
  const rows = () => within(list()).getAllByRole('listitem');
  // The page's own checkpoints; the side menu tracks the same two under the same words.
  const action = (name: string) =>
    within(screen.getByRole('list', { name: 'Getting started' })).getByRole('link', { name });

  it('asks for both when the workspace has neither, Add context first', async () => {
    serve({ repos: [], sources: [] });
    renderHome();

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(within(rows()[0]!).getByText('Connect your first context')).toBeInTheDocument();
    expect(within(rows()[1]!).getByText('Connect your first repository')).toBeInTheDocument();
    expect(screen.queryByText('Done')).toBeNull();
    // Either order works, so both actions read the same.
    expect(action('Add context')).toHaveClass('bg-primary');
    expect(action('Connect repository')).toHaveClass('bg-primary');
    expect(screen.queryByRole('list', { name: 'Today' })).toBeNull();
  });

  it('marks the context checkpoint Done and asks for the repository next', async () => {
    serve({ repos: [] });
    renderHome();

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(within(rows()[0]!).getByText('Done')).toBeInTheDocument();
    expect(within(rows()[1]!).queryByText('Done')).toBeNull();
    expect(action('Connect repository')).toHaveClass('bg-primary');
    expect(screen.queryByRole('link', { name: 'Add context' })).toBeNull();
  });

  it('marks the repository checkpoint Done when that half came first', async () => {
    serve({ sources: [] });
    renderHome();

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(within(rows()[1]!).getByText('Done')).toBeInTheDocument();
    expect(within(rows()[0]!).queryByText('Done')).toBeNull();
    expect(action('Add context')).toHaveClass('bg-primary');
    expect(screen.queryByRole('link', { name: 'Connect repository' })).toBeNull();
  });

  it('is the dashboard once the workspace has both', async () => {
    const state = serve();
    renderHome();

    expect(await screen.findByRole('list', { name: 'Today' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Getting started' })).toBeNull();
    expect(homeCalls(state)).toEqual(['/api/home?period=30d']);
  });

  it('never reads the dashboard while a checkpoint is open', async () => {
    const state = serve({ repos: [], sources: [] });
    renderHome();

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(homeCalls(state)).toEqual([]);
  });

  it('opens Add context on Context and the connect dialog on Code', async () => {
    serve({ repos: [], sources: [] });
    renderHome();

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(action('Add context')).toHaveAttribute('href', '/preview/context?add=1');
    expect(action('Connect repository')).toHaveAttribute('href', '/preview/code?connect=1');

    await userEvent.click(action('Add context'));
    expect(await screen.findByRole('dialog', { name: 'Add context' })).toBeInTheDocument();
  });

  it('flips the context checkpoint when a source appears, with no reload', async () => {
    const state = serve({ repos: [], sources: [] });
    renderHome();

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.queryByText('Done')).toBeNull();

    state.sources = [SOURCE];
    fireFrame({ type: 'context.changed' });

    await waitFor(() => expect(within(rows()[0]!).getByText('Done')).toBeInTheDocument(), {
      timeout: 2000,
    });
  });
});

