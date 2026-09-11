/**
 * The repository's Context tab: which of the workspace's sources it reads.
 *
 * It is a SELECTION, not a place documents live: one list of every workspace
 * source in one order, a Linked switch per row, and the whole set saved when
 * one moves. Nothing is added here and no scan starts here — both belong to
 * Context, which this tab links to.
 *
 * The retirements ride along: the console has no Corpus tab and no Sources tab
 * any more, and a bare repository address lands on Tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import type { ContextSourceView } from '@truecourse/shared';

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

const REPO = { id: 'web', name: 'acme/web', path: 'acme/web', remoteUrl: 'https://github.com/acme/web' };

const OWN: ContextSourceView = {
  id: 'repo-acme-web',
  kind: 'repository',
  title: 'acme/web',
  config: { repoFullName: 'acme/web', include: ['docs/**'], exclude: [], branch: '' },
  status: 'synced',
  statusNote: null,
  lastSyncAt: '2026-09-01T10:00:00.000Z',
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  docCount: 4,
  repositories: [REPO.name],
};

const SITE: ContextSourceView = {
  id: 'site-docs-acme',
  kind: 'site',
  title: 'docs.acme.com',
  config: { llmsTxtUrl: 'https://docs.acme.com/llms.txt' },
  status: 'never',
  statusNote: null,
  lastSyncAt: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
  docCount: 1,
  repositories: [],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function serve(options: { linked?: string[]; put?: () => Response } = {}) {
  const state = { linked: options.linked ?? [OWN.id], calls: [] as string[], bodies: [] as unknown[] };
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    state.calls.push(method === 'GET' ? `${url.pathname}${url.search}` : `${method} ${url.pathname}`);
    if (url.pathname === '/api/repos') return json([REPO]);
    if (url.pathname === '/api/llm/config') {
      return json({ config: { provider: 'anthropic' }, providers: ['anthropic'] });
    }
    if (url.pathname === '/api/sessions/runs') return json({ runs: [] });
    if (url.pathname === `/api/repos/${REPO.id}/sessions/runs`) return json({ runs: [] });
    if (url.pathname === '/api/context/sources') return json({ sources: [OWN, SITE], changedAt: null });
    if (url.pathname === `/api/repos/${REPO.id}/context/bindings`) {
      if (method === 'PUT') {
        if (options.put) return options.put();
        const body = JSON.parse(String(init?.body ?? '{}')) as { sourceIds: string[] };
        state.bodies.push(body);
        state.linked = body.sourceIds;
      }
      return json({ repoFullName: REPO.name, sourceIds: state.linked });
    }
    if (url.pathname === `/api/repos/${REPO.id}/guard/flows`) {
      return json({ flows: [], recipe: null });
    }
    return json({ error: `not found: ${url.pathname}` }, 404);
  }) as unknown as typeof window.fetch;
  return state;
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

const CONTEXT_TAB = `/preview/repos/${REPO.id}/context`;

beforeEach(() => {
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("the repository's Context tab", () => {
  it('lists every workspace source in one order, with what each is', async () => {
    serve();
    renderAt(CONTEXT_TAB);

    const list = await screen.findByRole('list', { name: 'Workspace sources' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
    const items = within(list).getAllByRole('listitem');

    const own = items[0]!;
    expect(within(own).getByRole('link', { name: 'acme/web' })).toHaveAttribute(
      'href',
      '/preview/context?source=repo-acme-web',
    );
    expect(within(own).getByText('Synced')).toBeInTheDocument();
    expect(within(own).getByText('repository')).toBeInTheDocument();
    expect(within(own).getByText('4 documents')).toBeInTheDocument();

    const site = items[1]!;
    expect(within(site).getByText('Never synced')).toBeInTheDocument();
    expect(within(site).getByText('1 document')).toBeInTheDocument();
    expect(within(site).getByText('never synced')).toBeInTheDocument();
  });

  it('shows what this repository reads, and saves the whole set when one moves', async () => {
    const state = serve();
    renderAt(CONTEXT_TAB);
    const user = userEvent.setup();

    const own = await screen.findByRole('switch', { name: 'acme/web linked' });
    const site = screen.getByRole('switch', { name: 'docs.acme.com linked' });
    await waitFor(() => expect(own).toBeChecked());
    expect(site).not.toBeChecked();

    await user.click(site);
    await waitFor(() =>
      expect(state.calls).toContain(`PUT /api/repos/${REPO.id}/context/bindings`),
    );
    expect(state.bodies).toEqual([{ sourceIds: [OWN.id, SITE.id] }]);
    await waitFor(() => expect(site).toBeChecked());

    // A row never moves when it is switched.
    const list = screen.getByRole('list', { name: 'Workspace sources' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });

  it('puts the switch back and says so when the save is refused', async () => {
    serve({ put: () => json({ error: 'Context source "x" not found' }, 404) });
    renderAt(CONTEXT_TAB);
    const user = userEvent.setup();

    const site = await screen.findByRole('switch', { name: 'docs.acme.com linked' });
    await user.click(site);

    expect(await screen.findByText(/not found/)).toBeInTheDocument();
    await waitFor(() => expect(site).not.toBeChecked());
  });

  it('adds nothing itself: Add context is Context', async () => {
    serve();
    renderAt(CONTEXT_TAB);
    expect(await screen.findByRole('link', { name: 'Add context' })).toHaveAttribute(
      'href',
      '/preview/context',
    );
  });
});

describe('what the console no longer has', () => {
  it('has no Corpus tab and no Sources tab, and a Context one instead', async () => {
    serve();
    renderAt(CONTEXT_TAB);

    const menu = await screen.findByRole('navigation', { name: 'Repository sections' });
    expect(within(menu).queryByRole('link', { name: 'Corpus' })).toBeNull();
    expect(within(menu).queryByRole('link', { name: 'Sources' })).toBeNull();
    expect(within(menu).getByRole('link', { name: 'Context' })).toHaveAttribute(
      'href',
      CONTEXT_TAB,
    );
  });

  it('lands a bare repository address on Tests', async () => {
    serve();
    renderAt(`/preview/repos/${REPO.id}`);
    const menu = await screen.findByRole('navigation', { name: 'Repository sections' });
    expect(within(menu).getByRole('link', { name: 'Tests' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('offers no scan anywhere in the console: the scan starts on Context', async () => {
    serve();
    renderAt(CONTEXT_TAB);

    await screen.findByRole('list', { name: 'Workspace sources' });
    expect(screen.queryByRole('button', { name: 'Rescan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scan' })).toBeNull();
  });
});
