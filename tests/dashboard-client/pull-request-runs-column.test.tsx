/**
 * Code › Runs: the Pull request column's hover. The cell has always said
 * `#<n>`; the repository's pull requests (`GET /api/repos/:id/pulls?state=all`)
 * give it the title and the head branch to say on hover, and a folder on this
 * machine, whose provider has no pull requests, gets no column at all.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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

import DashboardApp from '@/dashboard/DashboardApp';

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const realFetch = window.fetch;

const summary = { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0, blocked: 0 };

const HISTORY = {
  runs: [
    { runId: 'r-main1', ranAt: '2026-09-01T10:00:00Z', branch: 'main', commit: 'a1b2c3d', summary, origin: 'hosted' },
    { runId: 'r-head7', ranAt: '2026-09-02T10:00:00Z', branch: 'feature', commit: 'f00d123', summary, pullRequest: 7, origin: 'hosted' },
  ],
};

const PULL = {
  repoFullName: 'acme/widgets',
  number: 7,
  workspaceOrgId: 'org_1',
  provider: 'github',
  title: 'Add widgets',
  authorLogin: 'octocat',
  headSha: 'f00d123',
  headRef: 'feature',
  baseRef: 'main',
  headRepoFullName: 'acme/widgets',
  draft: false,
  state: 'open',
  openedAt: '2026-09-01T00:00:00.000Z',
  closedAt: null,
  updatedAt: '2026-09-02T00:00:00.000Z',
  check: null,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** One connected repository of `provider`, with its runs and its pull requests. */
function serve(provider: 'github' | 'local') {
  const repo = { id: 'widgets', name: 'acme/widgets', path: 'acme/widgets', provider, defaultBranch: 'main' };
  const calls: string[] = [];
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    calls.push(`${url.pathname}${url.search}`);
    const rest = url.pathname.replace(`/api/repos/${repo.id}/`, '');
    if (url.pathname === '/api/repos') return json([repo]);
    if (url.pathname === '/api/jobs') return json({ jobs: [] });
    if (url.pathname === '/api/llm/config') return json({ config: { provider: 'anthropic' }, providers: ['anthropic'] });
    if (rest === 'sessions/runs') return json({ runs: [] });
    if (rest === 'guard/history') return json(HISTORY);
    if (rest === 'pulls') return json({ pullRequests: [PULL] });
    return json({ error: `not found: ${rest}` }, 404);
  }) as unknown as typeof window.fetch;
  return calls;
}

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/*" element={<DashboardApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  window.fetch = realFetch;
});

describe('the Runs tab’s Pull request column', () => {
  it('says #<n>, and the title and head branch on hover, from the repository’s pull requests', async () => {
    const calls = serve('github');
    renderAt('/repos/widgets/runs');
    const table = await screen.findByRole('table', { name: 'Runs' });
    const cell = await within(table).findByText('#7');
    expect(calls).toContain('/api/repos/widgets/pulls?state=all');
    // The hover surface stays mounted (portaled to the body) beside its trigger.
    expect(cell).toBeInTheDocument();
    expect(screen.getByText('Add widgets · feature')).toBeInTheDocument();
  });

  it('draws no column for a provider without pull requests', async () => {
    const calls = serve('local');
    renderAt('/repos/widgets/runs');
    const table = await screen.findByRole('table', { name: 'Runs' });
    await within(table).findByText('f00d123');
    expect(within(table).queryByRole('columnheader', { name: 'Pull request' })).toBeNull();
    expect(calls.some((c) => c.endsWith('/pulls?state=all'))).toBe(false);
  });
});
