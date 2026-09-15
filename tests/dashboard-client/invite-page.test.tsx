/**
 * The invite page (`/invite/:token`), outside the auth gate: the manifest of
 * what the link is for, Accept or Sign in for a visitor with no session (both
 * through the server's login with this page as the destination), Join for a
 * signed-in one, and the automatic join on the way back.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthContext';
import { InvitePage } from '@/auth/InvitePage';

const USER = { id: 'user_me', email: 'dana@acme.dev' };
const PREVIEW = {
  workspaceName: 'Northwind Labs',
  inviterName: 'Dana Rees',
  expiresAt: '2099-01-01T00:00:00.000Z',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const realFetch = window.fetch;
const realLocation = window.location;

interface World {
  signedIn: boolean;
  preview: Response;
  accept: Response;
  accepted: number;
  /** The bodies posted to /logout. */
  logouts: unknown[];
}

let world: World;

function serve(over: Partial<World> = {}) {
  world = {
    signedIn: false,
    preview: json(PREVIEW),
    accept: json({ user: USER }),
    accepted: 0,
    logouts: [],
    ...over,
  };
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    if (pathname === '/api/auth/me') {
      return world.signedIn ? json({ user: USER }) : json({ error: 'Not authenticated' }, 401);
    }
    if (pathname === '/api/auth/logout' && init?.method === 'POST') {
      world.logouts.push(JSON.parse(String(init.body)));
      return json({ logoutUrl: 'http://workos/logout' });
    }
    if (pathname === '/api/auth/invite/tok_1' && (init?.method ?? 'GET') === 'GET') return world.preview.clone();
    if (pathname === '/api/auth/invite/tok_1/accept' && init?.method === 'POST') {
      world.accepted += 1;
      return world.accept.clone();
    }
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
}

/** Where the page sends the browser, captured instead of navigating. */
function captureNavigation() {
  const gone: string[] = [];
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...realLocation,
      origin: 'http://localhost:3000',
      assign: (url: string) => gone.push(url),
      set href(url: string) {
        gone.push(url);
      },
    },
  });
  return gone;
}

function renderInvite(path = '/invite/tok_1') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/invite/:token" element={<InvitePage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  window.fetch = realFetch;
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('the invite page', () => {
  it('sends a visitor with no session to sign up, coming back here to join', async () => {
    const user = userEvent.setup();
    serve();
    const gone = captureNavigation();
    renderInvite();

    expect(await screen.findByText("You’re invited to Northwind Labs")).toBeInTheDocument();
    expect(screen.getByText('Dana Rees')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept and create your account' }));

    expect(gone).toHaveLength(1);
    const url = new URL(gone[0]!, 'http://localhost:3000');
    expect(url.pathname).toBe('/api/auth/login');
    expect(url.searchParams.get('screen')).toBe('sign-up');
    expect(url.searchParams.get('next')).toBe('/invite/tok_1?accept=1');
    expect(world.accepted).toBe(0);
  });

  it('sends someone with an account to sign in, coming back here to join', async () => {
    const user = userEvent.setup();
    serve();
    const gone = captureNavigation();
    renderInvite();

    await user.click(await screen.findByRole('button', { name: 'I already have an account' }));

    const url = new URL(gone[0]!, 'http://localhost:3000');
    expect(url.pathname).toBe('/api/auth/login');
    expect(url.searchParams.get('screen')).toBeNull();
    expect(url.searchParams.get('next')).toBe('/invite/tok_1?accept=1');
  });

  it('offers a signed-in visitor to join as themselves, then loads the dashboard', async () => {
    const user = userEvent.setup();
    serve({ signedIn: true });
    const gone = captureNavigation();
    renderInvite();

    // The manifest names the account the seat would go to.
    expect(await screen.findByText('dana@acme.dev')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Join Northwind Labs' }));

    await waitFor(() => expect(world.accepted).toBe(1));
    await waitFor(() => expect(gone).toEqual(['/']));
  });

  it('joins on its own when coming back from sign-up', async () => {
    serve({ signedIn: true });
    const gone = captureNavigation();
    renderInvite('/invite/tok_1?accept=1');

    await waitFor(() => expect(world.accepted).toBe(1));
    await waitFor(() => expect(gone).toEqual(['/']));
  });

  it('says why a link cannot be opened and what to do, offering only Sign in', async () => {
    serve({ preview: json({ error: 'This invite link has already been used.', reason: 'used' }, 409) });
    renderInvite();

    expect(await screen.findByText('This invite link was already used')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Northwind Labs')).toBeNull();
  });

  it('offers a signed-in visitor on a spent link the dashboard, not a sign-in', async () => {
    serve({
      signedIn: true,
      preview: json({ error: 'This invite link has already been used.', reason: 'used' }, 409),
    });
    renderInvite();

    expect(await screen.findByText('This invite link was already used')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open TrueCourse' })).toHaveAttribute('href', '/');
  });

  it('switches account by signing out back to this invite', async () => {
    const user = userEvent.setup();
    serve({ signedIn: true });
    const gone = captureNavigation();
    renderInvite();

    await user.click(await screen.findByRole('button', { name: 'Not dana@acme.dev? Switch account' }));

    await waitFor(() => expect(gone).toEqual(['http://workos/logout']));
    expect(world.logouts).toEqual([{ returnTo: '/invite/tok_1' }]);
  });

  it('tells a visitor already in another workspace so, with only the account to switch', async () => {
    const user = userEvent.setup();
    serve({
      signedIn: true,
      accept: json({ error: 'You are already in a workspace.', reason: 'elsewhere' }, 409),
    });
    const gone = captureNavigation();
    renderInvite();

    await user.click(await screen.findByRole('button', { name: 'Join Northwind Labs' }));

    expect(await screen.findByText('You are already in a workspace')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Switch account' }));
    await waitFor(() => expect(gone).toEqual(['http://workos/logout']));
    expect(world.logouts).toEqual([{ returnTo: '/invite/tok_1' }]);
  });

  it('shows the server’s refusal to join, and stays', async () => {
    const user = userEvent.setup();
    serve({ signedIn: true, accept: json({ error: 'Could not join the workspace: no seats' }, 502) });
    const gone = captureNavigation();
    renderInvite();

    await user.click(await screen.findByRole('button', { name: 'Join Northwind Labs' }));

    expect(await screen.findByText('Could not join the workspace: no seats')).toBeInTheDocument();
    expect(gone).toEqual([]);
  });
});
