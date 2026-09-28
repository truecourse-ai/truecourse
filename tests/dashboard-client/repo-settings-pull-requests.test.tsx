/**
 * The repository's Settings tab turns checking its pull requests on and off.
 * Off by default; the switch saves as it flips, and goes back with the
 * server's reason when the save is refused. A provider with no pull requests
 * (a folder on this machine) has no switch at all.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

/** What each PUT asked for, in order. */
let puts: unknown[];
/** The reason the next PUT is refused with, if any. */
let refusal: string | null;
let provider: string;

beforeEach(() => {
  puts = [];
  refusal = null;
  provider = 'github';
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (pathname === '/api/repos' && method === 'GET') {
      return json([{ id: 'acme-api', name: 'acme/api', path: '/tmp/acme', provider, checkPullRequests: false }]);
    }
    if (pathname === '/api/repos/acme-api/pull-request-checks' && method === 'PUT') {
      puts.push(JSON.parse(String(init?.body)));
      if (refusal) return json({ error: refusal }, 409);
      return json({ checkPullRequests: (puts.at(-1) as { enabled: boolean }).enabled });
    }
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
});

afterEach(() => {
  window.fetch = realFetch;
});

function openSettings(): void {
  render(
    <MemoryRouter initialEntries={['/repos/acme-api/settings']}>
      <Routes>
        <Route path="/*" element={<DashboardApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('checking a repository’s pull requests', () => {
  it('is off by default, and the switch saves it on and off', async () => {
    openSettings();
    const toggle = await screen.findByRole('switch', { name: 'Check pull requests' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(puts).toEqual([{ enabled: true }, { enabled: false }]);
  });

  it('goes back and says why when the server refuses', async () => {
    refusal = 'No repositories are connected on this server';
    openSettings();
    const toggle = await screen.findByRole('switch', { name: 'Check pull requests' });
    await userEvent.click(toggle);
    expect(await screen.findByText('No repositories are connected on this server')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('is not offered for a provider with no pull requests', async () => {
    provider = 'local';
    openSettings();
    await screen.findByRole('button', { name: 'Unlink repository' });
    expect(screen.queryByRole('switch', { name: 'Check pull requests' })).toBeNull();
  });
});
