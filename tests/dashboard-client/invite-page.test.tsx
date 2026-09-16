/**
 * The invite page (`/invite/:token`), outside the auth gate: the manifest of
 * what the link is for, Accept invite for a visitor with no session (through
 * the server's login with this page as the destination), Join for a signed-in
 * one, the automatic join on the way back, and the switch of account that
 * remembers the page across the sign-out.
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
      world.logouts.push(init.body ?? null);
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
      replace: (url: string) => gone.push(url),
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
  window.sessionStorage.clear();
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('the invite page', () => {
  it('shows a visitor with no session who sent it and to where, and one button through sign-in back here', async () => {
    const user = userEvent.setup();
    serve();
    const gone = captureNavigation();
    renderInvite();

    expect(await screen.findByText("You’re invited to Northwind Labs")).toBeInTheDocument();
    expect(screen.getByText('Dana Rees')).toBeInTheDocument();
    // The manifest is the sender and the workspace, nothing about how joining works.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByText(/code/)).toBeNull();
    expect(screen.queryByText(/expires/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Accept invite' }));

    expect(gone).toHaveLength(1);
    const url = new URL(gone[0]!, 'http://localhost:3000');
    expect(url.pathname).toBe('/api/auth/login');
    expect(url.searchParams.get('screen')).toBeNull();
    expect(url.searchParams.get('next')).toBe('/invite/tok_1?accept=1');
    expect(world.accepted).toBe(0);
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

  it('switches account by signing out, with this invite remembered for the way back', async () => {
    const user = userEvent.setup();
    serve({ signedIn: true });
    const gone = captureNavigation();
    renderInvite();

    await user.click(await screen.findByRole('button', { name: 'Not dana@acme.dev? Switch account' }));

    await waitFor(() => expect(gone).toEqual(['http://workos/logout']));
    expect(world.logouts).toHaveLength(1);
    expect(window.sessionStorage.getItem('tc.invite.resume')).toBe('/invite/tok_1');
  });

  it('tells a visitor already in another workspace so, with only the account to switch', async () => {
    const user = userEvent.setup();
    serve({
      signedIn: true,
      accept: json({ error: 'This account is already in a workspace.', reason: 'elsewhere' }, 409),
    });
    const gone = captureNavigation();
    renderInvite();

    await user.click(await screen.findByRole('button', { name: 'Join Northwind Labs' }));

    expect(await screen.findByText('This account is already in a workspace')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Switch account' }));
    await waitFor(() => expect(gone).toEqual(['http://workos/logout']));
    expect(window.sessionStorage.getItem('tc.invite.resume')).toBe('/invite/tok_1');
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

describe('the invite page, the edges', () => {
  it('names no sender when the link was minted without one', async () => {
    serve({ preview: json({ ...PREVIEW, inviterName: null }) });
    renderInvite();

    expect(await screen.findByText("You’re invited to Northwind Labs")).toBeInTheDocument();
    expect(screen.getByText('A workspace member')).toBeInTheDocument();
    expect(screen.queryByText('Dana Rees')).toBeNull();
  });

  it('says an expired link has expired, and offers Sign in', async () => {
    serve({ preview: json({ error: 'This invite link has expired.', reason: 'expired' }, 410) });
    renderInvite();
    expect(await screen.findByText('This invite link has expired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Northwind Labs')).toBeNull();
  });

  it('says a missing link is not valid, and offers Sign in', async () => {
    serve({ preview: json({ error: 'This invite link is not valid.', reason: 'invalid' }, 404) });
    renderInvite();
    expect(await screen.findByText('This invite link is not valid')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('shows a preview the server could not read as a generic failure, in its own words', async () => {
    serve({ preview: json({ error: 'SELECT * FROM workspace_invite_links failed' }, 500) });
    renderInvite();
    expect(await screen.findByText('This invite link cannot be opened')).toBeInTheDocument();
    expect(screen.getByText('Try again in a moment.')).toBeInTheDocument();
    expect(screen.queryByText(/SELECT/)).toBeNull();
  });

  it('after a failed automatic join, offers Join again once and joins on the click', async () => {
    const user = userEvent.setup();
    serve({ signedIn: true, accept: json({ error: 'Could not join the workspace: WorkOS is down' }, 502) });
    const gone = captureNavigation();
    renderInvite('/invite/tok_1?accept=1');

    expect(await screen.findByText('Could not join the workspace: WorkOS is down')).toBeInTheDocument();
    expect(world.accepted).toBe(1);
    const join = screen.getByRole('button', { name: 'Join Northwind Labs' });
    expect(join).toBeEnabled();
    expect(gone).toEqual([]);

    world.accept = json({ user: USER });
    await user.click(join);
    await waitFor(() => expect(world.accepted).toBe(2));
    await waitFor(() => expect(gone).toEqual(['/']));
  });

  it('waits for the session probe before deciding who is joining', async () => {
    let releaseMe!: () => void;
    const gate = new Promise<void>((r) => (releaseMe = r));
    serve({ signedIn: true });
    const fetchWithWorld = window.fetch;
    window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(href, window.location.origin).pathname === '/api/auth/me') await gate;
      return fetchWithWorld(input, init);
    }) as unknown as typeof window.fetch;
    renderInvite();

    // Neither the anonymous nor the signed-in button shows while the probe is out.
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull());
    expect(screen.queryByText('Accept invite')).toBeNull();
    releaseMe();
    expect(await screen.findByRole('button', { name: 'Join Northwind Labs' })).toBeInTheDocument();
  });
});
