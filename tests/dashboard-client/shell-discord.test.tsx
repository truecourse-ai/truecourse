/**
 * The user menu's way out to the community.
 *
 * It is a link OFF the app, so it is an anchor and not a route: the same
 * invitation the README and the site give, opened in a new tab. It lives in
 * the account menu, so it is there for whoever is signed in, expanded or
 * collapsed, and nowhere when nobody is.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AuthUser } from '@truecourse/shared';

// The shell holds a socket for the repositories' runs; nothing here is about
// that, so it is a stub that answers nothing.
vi.mock('@/lib/socket', () => {
  const socket = { connected: true, on: () => socket, off: () => socket, emit: () => {} };
  return {
    connectSocket: () => socket,
    getSocket: () => socket,
    disconnectSocket: () => {},
    joinRepoRoom: () => {},
    leaveRepoRoom: () => {},
  };
});

// The real module, with the one call this asserts on spied.
vi.mock('@/lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/posthog')>()),
  trackEvent: vi.fn(),
}));

import { AuthProvider } from '@/auth/AuthContext';
import { DashboardShell, DISCORD_INVITE_URL } from '@/dashboard/shell/DashboardShell';
import { DashboardStateProvider } from '@/dashboard/shell/dashboard-state';
import { EVENTS, trackEvent } from '@/lib/posthog';

/** No server behind the shell: every read 404s, which is a workspace with nothing in it. */
function stubServer(user?: AuthUser) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      user && String(input).includes('/api/auth/me')
        ? new Response(JSON.stringify({ user }), { status: 200 })
        : new Response('', { status: 404 }),
    ),
  );
}

function renderShell(user?: AuthUser) {
  stubServer(user);
  return render(
    <MemoryRouter>
      <AuthProvider>
        <DashboardStateProvider>
          <DashboardShell>
            <div />
          </DashboardShell>
        </DashboardStateProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const USER: AuthUser = {
  id: 'user_1',
  email: 'dana@acme.dev',
  firstName: 'Dana',
  organizationId: 'org_1',
  organizationName: 'Northwind Labs',
};

/** Open the account menu once the session probe has drawn it. */
async function openMenu() {
  fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
}

const discordLink = () => screen.getByRole('link', { name: 'Join Discord' });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(trackEvent).mockClear();
});

describe('the account menu Discord link', () => {
  it('is the invitation, opened in a new tab', async () => {
    renderShell(USER);
    await openMenu();
    const link = discordLink();
    expect(link).toHaveAttribute('href', DISCORD_INVITE_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('is in the menu and not in the sidebar until the menu opens', async () => {
    renderShell(USER);
    await screen.findByRole('button', { name: 'Account menu' });
    expect(screen.queryByRole('link', { name: 'Join Discord' })).toBeNull();
    await openMenu();
    const sidebar = screen.getByRole('complementary');
    expect(within(sidebar).getByRole('link', { name: 'Join Discord' })).toBe(discordLink());
  });

  it('is nowhere with nobody signed in', () => {
    renderShell();
    expect(screen.queryByRole('button', { name: 'Account menu' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Join Discord' })).toBeNull();
  });

  it('survives the collapse, behind the same menu', async () => {
    renderShell(USER);
    await screen.findByRole('button', { name: 'Account menu' });
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    await openMenu();
    expect(discordLink()).toHaveAttribute('href', DISCORD_INVITE_URL);
  });

  it('reports the click and closes the menu', async () => {
    renderShell(USER);
    await openMenu();
    // jsdom would try to open the tab for real; the app's handler has already
    // run by the time this bubbles to the document, so the default is dropped
    // here rather than in the component.
    document.addEventListener('click', (e) => e.preventDefault(), { once: true });
    fireEvent.click(discordLink());

    expect(trackEvent).toHaveBeenCalledWith(EVENTS.discordJoinClicked);
    expect(screen.queryByRole('link', { name: 'Join Discord' })).toBeNull();
  });
});
