/**
 * The sidebar's way out to the community.
 *
 * It is a link OFF the app, so it is an anchor and not a route: the same
 * invitation the README and the site give, opened in a new tab. It is there
 * whether or not anyone is signed in, and it survives the collapse into the
 * icon rail, where the label becomes the accessible name.
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

const discordLink = () => screen.getByRole('link', { name: 'Join Discord' });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(trackEvent).mockClear();
});

describe('the sidebar Discord link', () => {
  it('is the invitation, opened in a new tab', () => {
    renderShell();
    const link = discordLink();
    expect(link).toHaveAttribute('href', DISCORD_INVITE_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('is above the user menu, in the sidebar and not in the page', () => {
    renderShell();
    const sidebar = screen.getByRole('complementary');
    expect(within(sidebar).getByRole('link', { name: 'Join Discord' })).toBe(discordLink());
  });

  it('is there with nobody signed in, and with somebody', async () => {
    const { unmount } = renderShell();
    expect(discordLink()).toBeInTheDocument();
    unmount();

    renderShell({
      id: 'user_1',
      email: 'dana@acme.dev',
      firstName: 'Dana',
      organizationId: 'org_1',
      organizationName: 'Northwind Labs',
    });
    expect(await screen.findByRole('link', { name: 'Join Discord' })).toHaveAttribute(
      'href',
      DISCORD_INVITE_URL,
    );
  });

  it('survives the collapse as an icon, named by its label', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    const link = discordLink();
    expect(link).toHaveAttribute('href', DISCORD_INVITE_URL);
    expect(link).toHaveAttribute('aria-label', 'Join Discord');
    expect(link).toHaveTextContent('');
  });

  it('reports the click', () => {
    renderShell();
    // jsdom would try to open the tab for real; the app's handler has already
    // run by the time this bubbles to the document, so the default is dropped
    // here rather than in the component.
    document.addEventListener('click', (e) => e.preventDefault(), { once: true });
    fireEvent.click(discordLink());

    expect(trackEvent).toHaveBeenCalledWith(EVENTS.discordJoinClicked);
  });
});
