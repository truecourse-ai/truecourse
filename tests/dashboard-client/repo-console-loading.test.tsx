/**
 * The repository console says a slug names nothing only once the registry has
 * been read: before that, a connected repository would flash "No such
 * repository" on every load.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DashboardApp from '@/dashboard/DashboardApp';

vi.mock('@/lib/socket', () => {
  const socket = { connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn() };
  return {
    connectSocket: () => socket,
    getSocket: () => socket,
    disconnectSocket: vi.fn(),
    joinRepoRoom: vi.fn(),
    leaveRepoRoom: vi.fn(),
  };
});

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const realFetch = window.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Lets the registry read go through; until then `/api/repos` hangs. */
let answerRepos!: () => void;

beforeEach(() => {
  const answered = new Promise<void>((resolve) => {
    answerRepos = resolve;
  });
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    if (pathname === '/api/repos' && (init?.method ?? 'GET') === 'GET') {
      await answered;
      return json([{ id: 'acme-api', name: 'acme/api', path: '/tmp/acme', provider: 'github' }]);
    }
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
});

afterEach(() => {
  window.fetch = realFetch;
});

function open(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/*" element={<DashboardApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the repository console while the registry loads', () => {
  it('does not say a connected repository is missing before the registry has been read', async () => {
    open('/repos/acme-api/settings');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('No such repository')).toBeNull();

    answerRepos();
    expect(await screen.findByRole('button', { name: 'Unlink repository' })).toBeInTheDocument();
    expect(screen.queryByText('No such repository')).toBeNull();
  });

  it('says a slug names nothing once the registry has been read', async () => {
    open('/repos/nobody/settings');
    answerRepos();
    expect(await screen.findByText('No such repository')).toBeInTheDocument();
  });
});
