/**
 * The side menu's workspace switcher.
 *
 * The workspace at the top of the menu is the session's, and opening it lists
 * every workspace the signed-in user belongs to, the current one in the
 * foreground weight. Choosing another moves the SESSION into it, so the app
 * starts over at the section root rather than re-reading page by page.
 * Create workspace is the last row: one dialog, one field, and the same
 * restart once the server has minted the session into the new organization.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { WorkspaceSummary } from '@truecourse/shared';
import { AuthProvider } from '@/ee/AuthContext';
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

const USER = {
  id: 'user_me',
  email: 'dana@acme.dev',
  firstName: 'Dana',
  lastName: 'Rees',
  organizationId: 'org_a',
  organizationName: 'Acme',
};

const WORKSPACES: WorkspaceSummary[] = [
  { id: 'org_a', name: 'Acme', current: true },
  { id: 'org_b', name: 'Northwind Labs', current: false },
];

const realFetch = window.fetch;
const realLocation = window.location;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** What the server was asked, and what it answered the two moves with. */
interface World {
  workspaces: WorkspaceSummary[];
  switched: string[];
  created: string[];
  /** The answer to POST /workspaces; the default one creates. */
  create: (name: string) => Response;
  /** The answer to POST /workspaces/switch. */
  switchTo: (organizationId: string) => Response;
}

let world: World;

function serve(over: Partial<World> = {}) {
  world = {
    workspaces: WORKSPACES,
    switched: [],
    created: [],
    create: () => json({ user: { ...USER, organizationId: 'org_new', organizationName: 'Third' } }),
    switchTo: (organizationId) => json({ user: { ...USER, organizationId } }),
    ...over,
  };

  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, 'http://localhost:3000');
    const method = init?.method ?? 'GET';

    if (pathname === '/api/auth/me') return json({ user: USER });
    if (pathname === '/api/auth/workspaces' && method === 'GET') {
      return json({ workspaces: world.workspaces });
    }
    if (pathname === '/api/auth/workspaces' && method === 'POST') {
      const name = (JSON.parse(String(init?.body)) as { name: string }).name;
      world.created.push(name);
      return world.create(name);
    }
    if (pathname === '/api/auth/workspaces/switch') {
      const id = (JSON.parse(String(init?.body)) as { organizationId: string }).organizationId;
      world.switched.push(id);
      return world.switchTo(id);
    }
    if (pathname === '/api/repos') return json([]);
    if (pathname === '/api/sessions/runs') return json({ runs: [] });
    if (pathname === '/api/notifications') return json({ notifications: [], unreadCount: 0 });
    if (pathname === '/api/llm/config') return json({ config: null, providers: ['anthropic'] });
    if (pathname === '/api/workspace/members') return json({ members: [], invitations: [] });
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
}

/** jsdom will not navigate, so the reload is a call this test can read. */
function stubAssign(): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      origin: realLocation.origin,
      href: realLocation.href,
      pathname: realLocation.pathname,
      search: realLocation.search,
      hash: realLocation.hash,
      assign,
      replace: vi.fn(),
      reload: vi.fn(),
    },
  });
  return assign;
}

function renderShell() {
  render(
    <MemoryRouter initialEntries={['/preview']}>
      <AuthProvider>
        <Routes>
          <Route path="/preview/*" element={<PreviewApp />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** The switcher's own button, once the session probe has named the workspace. */
const switcher = (): Promise<HTMLElement> =>
  screen.findByRole('button', { name: 'Switch workspace' });

beforeEach(() => serve());

afterEach(() => {
  window.fetch = realFetch;
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('the workspace switcher', () => {
  it('names the workspace the session is in, and opens closed', async () => {
    renderShell();
    const button = await switcher();
    expect(button).toHaveTextContent('Acme');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Create workspace' })).toBeNull();
  });

  it('lists every workspace when opened, the current one in the foreground', async () => {
    const user = userEvent.setup();
    renderShell();
    await waitFor(() => expect(world.workspaces).toBeTruthy());
    const button = await switcher();
    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    const current = await screen.findByRole('button', { name: /Acme/ });
    const other = screen.getByRole('button', { name: /Northwind Labs/ });
    expect(current.className).toContain('text-foreground');
    expect(other.className).toContain('text-muted-foreground');
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeInTheDocument();
  });

  it('switches into another workspace and starts the app over in it', async () => {
    const user = userEvent.setup();
    const assign = stubAssign();
    renderShell();
    await user.click(await switcher());
    await user.click(await screen.findByRole('button', { name: /Northwind Labs/ }));

    await waitFor(() => expect(world.switched).toEqual(['org_b']));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/preview'));
  });

  it('creates a workspace from the dialog and starts the app over in it', async () => {
    const user = userEvent.setup();
    const assign = stubAssign();
    renderShell();
    await user.click(await switcher());
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(await screen.findByText('Create workspace', { selector: 'h2' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Third');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(world.created).toEqual(['Third']));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/preview'));
  });

  it('shows the server’s refusal under the field, and stays open', async () => {
    const user = userEvent.setup();
    const assign = stubAssign();
    const refusal = 'A workspace name of 1 to 80 characters is required.';
    serve({ create: () => json({ error: refusal }, 400) });
    renderShell();
    await user.click(await switcher());
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  it('is the initial alone when the sidebar is collapsed, and opens the same list', async () => {
    const user = userEvent.setup();
    renderShell();
    await switcher();
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    const button = await switcher();
    expect(button).toHaveTextContent('A');
    expect(button).not.toHaveTextContent('Acme');

    await user.click(button);
    const menu = await screen.findByRole('button', { name: /Northwind Labs/ });
    expect(within(menu).getByText('Northwind Labs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeInTheDocument();
  });

  it('draws no switcher with no session', async () => {
    render(
      <MemoryRouter initialEntries={['/preview']}>
        <Routes>
          <Route path="/preview/*" element={<PreviewApp />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: 'Switch workspace' })).toBeNull();
    const reads = (window.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      (call) => String(call[0]).includes('/api/auth/workspaces'),
    );
    expect(reads).toEqual([]);
  });
});
