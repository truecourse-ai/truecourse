/**
 * Unlinking a repository from its Settings tab leaves a route that no longer
 * resolves, so the console must navigate back to Home rather than strand the
 * user on "No such repository".
 *
 * And when the server REFUSES the disconnect, the row that was optimistically
 * removed comes back — which on its own reads as a bug, so the reason has to be
 * spoken. The toast is the only place it is.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { toastMock } = vi.hoisted(() => ({
  toastMock: { error: vi.fn(), success: vi.fn(), custom: vi.fn(), dismiss: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: toastMock }));

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PreviewApp from '@/preview/PreviewApp';

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

/** The DELETE the next render's unlink meets. Set per test. */
let refusal: string | null = null;

beforeEach(() => {
  toastMock.error.mockClear();
  refusal = null;
  const registry = [
    {
      id: 'spiderhands-filecli',
      name: 'spiderhands/filecli',
      path: '/tmp/clones/spiderhands__filecli',
      remoteUrl: 'https://github.com/spiderhands/filecli',
    },
  ];
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (pathname === '/api/repos' && method === 'GET') return json(registry);
    if (pathname === '/api/repos/spiderhands-filecli' && method === 'DELETE') {
      // A refused disconnect leaves the registry exactly as it was.
      if (refusal) return json({ error: refusal }, 409);
      registry.length = 0;
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
});

afterEach(() => {
  window.fetch = realFetch;
});

describe('unlinking a repository from its settings', () => {
  it('returns to Home instead of stranding the user on the dead repo route', async () => {
    window.history.replaceState({}, '', '/preview/repos/spiderhands-filecli/settings');
    render(
      <MemoryRouter initialEntries={['/preview/repos/spiderhands-filecli/settings']}>
        <Routes>
          <Route path="/preview/*" element={<PreviewApp />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Unlink repository' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unlink' }));

    // Home, not the dead repo route's empty state.
    await screen.findByRole('button', { name: 'Connect repository' });
    expect(screen.queryByText('No such repository')).toBeNull();
  });

  it('says why when the server refuses, and lets the row come back', async () => {
    refusal = 'Another process is scanning this repository. Wait for it to finish, then disconnect.';
    window.history.replaceState({}, '', '/preview/repos/spiderhands-filecli/settings');
    render(
      <MemoryRouter initialEntries={['/preview/repos/spiderhands-filecli/settings']}>
        <Routes>
          <Route path="/preview/*" element={<PreviewApp />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Unlink repository' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unlink' }));

    // The refusal is spoken, verbatim — a row that reappears with no
    // explanation is indistinguishable from a bug.
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(JSON.stringify(toastMock.error.mock.calls[0])).toContain(refusal);
    // And the refresh puts it back: the repository is still connected.
    await screen.findByText('spiderhands/filecli');
  });
});
