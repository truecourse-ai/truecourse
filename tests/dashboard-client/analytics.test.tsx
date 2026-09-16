/**
 * The analytics mount: the one component the app root carries, and the reset
 * that rides sign-out.
 *
 * Three behaviours, each of which would be a lie if it were wrong: the load is
 * counted once (PostHog's own init does that, so only a real address CHANGE is
 * a pageview from here), the person is named as soon as the session probe
 * answers, and the identity ends when the session does.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { AuthUser } from '@truecourse/shared';

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  group: vi.fn(),
  register: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: posthog }));

import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { Analytics } from '@/lib/analytics';

const USER: AuthUser = {
  id: 'user_1',
  email: 'dana@acme.dev',
  firstName: 'Dana',
  lastName: 'Rees',
  organizationId: 'org_1',
  organizationName: 'Northwind Labs',
};

/** `/me` answers with a session; `/logout` answers a same-document return, so
 *  the sign-out's redirect stays inside jsdom. */
function stubServer(user?: AuthUser) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/logout')) {
        return new Response(JSON.stringify({ logoutUrl: '#signed-out' }), { status: 200 });
      }
      if (user && url.includes('/api/auth/me')) {
        return new Response(JSON.stringify({ user }), { status: 200 });
      }
      return new Response('', { status: 404 });
    }),
  );
}

/** The auth state, so a test can wait for the session probe to settle. */
function Status() {
  return <span>{useAuth().status}</span>;
}

function Go({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      go
    </button>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the analytics mount', () => {
  it('counts a route change, and not the load PostHog already counted', async () => {
    stubServer();
    render(
      <MemoryRouter initialEntries={['/code']}>
        <Analytics />
        <Routes>
          <Route path="/code" element={<Go to="/flows" />} />
          <Route path="/flows" element={<span>flows</span>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.capture).not.toHaveBeenCalled();

    screen.getByRole('button', { name: 'go' }).click();

    await waitFor(() => expect(posthog.capture).toHaveBeenCalledTimes(1));
    expect(posthog.capture).toHaveBeenCalledWith('$pageview', {
      $current_url: `${window.location.origin}/flows`,
    });
  });

  it('names the person and their workspace once the session answers', async () => {
    stubServer(USER);
    render(
      <AuthProvider>
        <MemoryRouter>
          <Analytics />
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(posthog.identify).toHaveBeenCalledWith('user_1', {
        email: 'dana@acme.dev',
        name: 'Dana Rees',
      }),
    );
    expect(posthog.group).toHaveBeenCalledWith('workspace', 'org_1', { name: 'Northwind Labs' });
  });

  it('names nobody while there is no session', async () => {
    stubServer();
    render(
      <AuthProvider>
        <MemoryRouter>
          <Analytics />
          <Status />
        </MemoryRouter>
      </AuthProvider>,
    );

    // The probe has answered: anonymous is settled, not still loading.
    expect(await screen.findByText('anon')).toBeInTheDocument();
    expect(posthog.identify).not.toHaveBeenCalled();
  });
});

describe('signing out', () => {
  function SignOut() {
    const { signOut } = useAuth();
    return (
      <button type="button" onClick={() => void signOut()}>
        sign out
      </button>
    );
  }

  it('ends the analytics identity with the session', async () => {
    stubServer(USER);
    render(
      <AuthProvider>
        <MemoryRouter>
          <Analytics />
          <SignOut />
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => expect(posthog.identify).toHaveBeenCalled());
    screen.getByRole('button', { name: 'sign out' }).click();

    expect(posthog.reset).toHaveBeenCalledTimes(1);
  });
});
