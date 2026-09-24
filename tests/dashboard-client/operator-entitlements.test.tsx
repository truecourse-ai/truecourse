/**
 * The operator's Entitlements page: every workspace, and which of the three
 * enterprise features it may use.
 *
 * Real all the way down — the page reads the console's answer and draws it.
 * What is asserted is what it DOES with that answer: a workspace named with
 * what it holds, a grant that is ONE click and comes back reflected, a revoke
 * that says what it will pause before it does it and reports what it paused
 * after, and a refused movement that says so instead of failing quietly.
 *
 * And what a member does NOT get: the page shows them nothing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  AuthUser,
  EnterpriseFeature,
  OperatorEntitlementsResponse,
} from '@truecourse/shared';

vi.mock('@/lib/socket', () => {
  const socket = {
    connected: false,
    on: () => socket,
    off: () => socket,
    emit: vi.fn(),
    connect: vi.fn(),
  };
  return {
    connectSocket: () => socket,
    getSocket: () => socket,
    disconnectSocket: vi.fn(),
    joinRepoRoom: vi.fn(),
    leaveRepoRoom: vi.fn(),
  };
});

import DashboardApp from '@/dashboard/DashboardApp';
import { AuthProvider } from '@/auth/AuthContext';

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const realFetch = window.fetch;

const OPERATOR: AuthUser = {
  id: 'user_op',
  email: 'ops@truecourse.dev',
  organizationId: 'org_acme',
  isOperator: true,
};

const MEMBER: AuthUser = { id: 'user_1', email: 'a@acme.test', organizationId: 'org_acme' };

const ENTITLEMENTS: OperatorEntitlementsResponse = {
  workspaces: [
    { workspaceOrgId: 'org_acme', workspaceName: 'Acme Inc.', features: ['connections'] },
    // Nobody could name this one, so it is listed by its id and nothing else.
    { workspaceOrgId: 'org_beta', workspaceName: null, features: [] },
  ],
};

/** How many sources a revoke of each feature pauses, as the server answers it. */
const PAUSED: Partial<Record<EnterpriseFeature, string[]>> = {
  connections: ['src_jira', 'src_conf'],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface World {
  user: AuthUser;
  /** What each workspace holds, moved by the movements the page makes. */
  held: Map<string, EnterpriseFeature[]>;
  /** Every non-GET the page made, in order. */
  posts: { path: string; body: unknown }[];
  /** When set, every movement is refused with this message. */
  refuse?: string;
}

function serve(over: Partial<World> = {}) {
  const state: World = {
    user: OPERATOR,
    held: new Map(ENTITLEMENTS.workspaces.map((row) => [row.workspaceOrgId, [...row.features]])),
    posts: [],
    ...over,
  };
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    if (init?.method && init.method !== 'GET') {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      state.posts.push({ path: url.pathname, body });
      if (state.refuse) return json({ error: state.refuse }, 500);
      const { workspaceOrgId, feature } = body as {
        workspaceOrgId: string;
        feature: EnterpriseFeature;
      };
      const held = new Set(state.held.get(workspaceOrgId) ?? []);
      const revoking = url.pathname.endsWith('/revoke');
      if (revoking) held.delete(feature);
      else held.add(feature);
      const features = [...held];
      state.held.set(workspaceOrgId, features);
      return json({
        workspaceOrgId,
        features,
        ...(revoking ? { paused: PAUSED[feature] ?? [] } : {}),
      });
    }
    if (url.pathname === '/api/operator/entitlements') {
      if (!state.user.isOperator) return json({ error: 'The server has no such route.' }, 404);
      return json({
        workspaces: ENTITLEMENTS.workspaces.map((row) => ({
          ...row,
          features: state.held.get(row.workspaceOrgId) ?? [],
        })),
      });
    }
    if (url.pathname === '/api/auth/me') return json({ user: state.user });
    if (url.pathname === '/api/repos') return json([]);
    if (url.pathname === '/api/sessions/runs') return json({ runs: [] });
    if (url.pathname === '/api/notifications') return json({ notifications: [], unreadCount: 0 });
    return json({ error: `not found: ${url.pathname}` }, 404);
  }) as unknown as typeof window.fetch;
  return state;
}

function renderPage() {
  const path = '/operator/entitlements';
  window.history.replaceState({}, '', path);
  render(
    // The page reads the signed-in person, so the session is real here: the
    // provider probes `/api/auth/me` like the shell does.
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/*" element={<DashboardApp />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

/** The workspaces, once the console has answered. */
async function rows(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('list', { name: 'Workspaces' });
  return within(list).getAllByRole('listitem');
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  window.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('the operator’s Entitlements page', () => {
  it('lists every workspace with what it holds, and what it does not', async () => {
    serve();
    renderPage();
    const listed = await rows();
    expect(listed).toHaveLength(2);

    // Named, holding one: the name is the title, the id and the feature the
    // line beneath it, and the toggle for it reads as held.
    expect(within(listed[0]!).getByText('Acme Inc.')).toBeInTheDocument();
    expect(within(listed[0]!).getByText('org_acme')).toBeInTheDocument();
    expect(within(listed[0]!).getByText('Granted')).toBeInTheDocument();
    expect(within(listed[0]!).getByRole('button', { name: 'Connections' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(listed[0]!).getByRole('button', { name: 'Workspaces' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Unnamed and holding nothing: the id is the title, said once.
    expect(within(listed[1]!).getAllByText('org_beta')).toHaveLength(1);
    expect(within(listed[1]!).getByText('Nothing granted')).toBeInTheDocument();
    for (const label of ['Connections', 'Repository providers', 'Workspaces']) {
      expect(within(listed[1]!).getByRole('button', { name: label })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
  });

  it('grants in one click, and reflects what came back', async () => {
    const state = serve();
    renderPage();
    const listed = await rows();
    await userEvent.click(within(listed[1]!).getByRole('button', { name: 'Connections' }));

    await waitFor(() =>
      expect(state.posts).toEqual([
        {
          path: '/api/operator/entitlements/grant',
          body: { workspaceOrgId: 'org_beta', feature: 'connections' },
        },
      ]),
    );
    const after = await rows();
    await waitFor(() =>
      expect(within(after[1]!).getByRole('button', { name: 'Connections' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(screen.getByText('Granted Connections to org_beta')).toBeInTheDocument();
    // Nothing was asked: a grant takes no confirmation and no second read.
    expect(screen.queryByRole('group', { name: 'Revoke Connections' })).not.toBeInTheDocument();
  });

  it('asks before a revoke, and says what it will pause', async () => {
    const state = serve();
    renderPage();
    const listed = await rows();
    await userEvent.click(within(listed[0]!).getByRole('button', { name: 'Connections' }));

    // Nothing has been sent yet: the consequence is stated first.
    expect(state.posts).toEqual([]);
    const confirm = screen.getByRole('group', { name: 'Revoke Connections' });
    expect(confirm).toHaveTextContent(/Acme Inc\./);
    expect(confirm).toHaveTextContent(/Jira and Confluence sources pause/);
    expect(confirm).toHaveTextContent(/keep their documents/);

    await userEvent.click(within(confirm).getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(state.posts).toEqual([
        {
          path: '/api/operator/entitlements/revoke',
          body: { workspaceOrgId: 'org_acme', feature: 'connections' },
        },
      ]),
    );

    // The row lets go of it, and the page says what the revoke stopped.
    const after = await rows();
    await waitFor(() =>
      expect(within(after[0]!).getByRole('button', { name: 'Connections' })).toHaveAttribute(
        'aria-pressed',
        'false',
      ),
    );
    expect(
      screen.getByText('Revoked Connections from Acme Inc. · 2 sources paused'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Revoke Connections' })).not.toBeInTheDocument();
  });

  it('cancels a revoke without sending anything', async () => {
    const state = serve();
    renderPage();
    const listed = await rows();
    await userEvent.click(within(listed[0]!).getByRole('button', { name: 'Connections' }));
    const confirm = screen.getByRole('group', { name: 'Revoke Connections' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('group', { name: 'Revoke Connections' })).not.toBeInTheDocument();
    expect(state.posts).toEqual([]);
    const after = await rows();
    expect(within(after[0]!).getByRole('button', { name: 'Connections' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('says why a movement was refused, and leaves the row as it was', async () => {
    serve({ refuse: 'The entitlements store is not installed.' });
    renderPage();
    const listed = await rows();
    await userEvent.click(within(listed[1]!).getByRole('button', { name: 'Workspaces' }));

    expect(
      await screen.findByText('The entitlements store is not installed.'),
    ).toBeInTheDocument();
    const after = await rows();
    expect(within(after[1]!).getByRole('button', { name: 'Workspaces' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('shows a member nothing at all', async () => {
    serve({ user: MEMBER });
    renderPage();
    expect(await screen.findByText('Nothing here')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Workspaces' })).not.toBeInTheDocument();
  });
});
