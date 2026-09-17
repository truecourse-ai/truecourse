/**
 * Settings › Credits, and the operator's Credits page.
 *
 * Both are real all the way down: they read the answers the server composes and
 * draw them. What is asserted is what the pages DO with those answers — the
 * balance said once, a run's spending as ONE line opening the conversation it
 * belongs to, a paused run with the one thing to do about it, and, on the
 * operator's side, a grant that says what it resumed.
 *
 * And what a member does NOT get: the operator's page shows them nothing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { AuthUser, CreditsResponse, OperatorCreditsResponse } from '@truecourse/shared';

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

const CREDITS: CreditsResponse = {
  balance: 4880,
  lastGrantCredits: 5000,
  lastGrantAt: '2026-09-01T09:00:00.000Z',
  onCredits: true,
  entries: [
    {
      id: 'run:job_gen',
      kind: 'debit',
      amount: -120,
      balanceAfter: 4880,
      note: null,
      actorUserId: null,
      at: '2026-09-15T09:12:00.000Z',
      jobId: 'job_gen',
      runId: 'run_gen',
      jobType: 'repo.guard-generate',
      title: 'Flow generation',
      repository: 'acme/web',
    },
    {
      id: 'ledger_grant',
      kind: 'grant',
      amount: 5000,
      balanceAfter: 5000,
      note: 'pilot',
      actorUserId: 'user_operator',
      at: '2026-09-01T09:00:00.000Z',
    },
  ],
  pausedRuns: [
    {
      jobId: 'job_paused',
      jobType: 'repo.guard-setup',
      title: 'Flow setup',
      repository: 'acme/api',
      runId: 'run_setup',
      pausedAt: '2026-09-15T10:00:00.000Z',
    },
  ],
};

const OPERATOR_CREDITS: OperatorCreditsResponse = {
  workspaces: [
    {
      workspaceOrgId: 'org_acme',
      balance: 4880,
      lastGrantCredits: 5000,
      lastGrantAt: '2026-09-01T09:00:00.000Z',
      spent30d: 120,
      pausedRuns: 1,
    },
    {
      workspaceOrgId: 'org_beta',
      balance: 0,
      lastGrantCredits: 0,
      lastGrantAt: null,
      spent30d: 0,
      pausedRuns: 0,
    },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface World {
  credits: CreditsResponse;
  operator: OperatorCreditsResponse;
  user: AuthUser;
  /** Every non-GET the page made, in order. */
  posts: { path: string; body: unknown }[];
}

function serve(over: Partial<World> = {}) {
  const state: World = {
    credits: CREDITS,
    operator: OPERATOR_CREDITS,
    user: { id: 'user_1', email: 'a@acme.test', organizationId: 'org_acme' },
    posts: [],
    ...over,
  };
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    if (init?.method && init.method !== 'GET') {
      state.posts.push({
        path: url.pathname,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.pathname.startsWith('/api/credits/resume/')) {
        state.credits = { ...state.credits, pausedRuns: [] };
        return json({ jobId: 'job_new' });
      }
      return json({ balance: 10000, resumed: 1 });
    }
    if (url.pathname === '/api/credits') return json(state.credits);
    if (url.pathname === '/api/operator/credits') {
      if (!state.user.isOperator) return json({ error: 'The server has no such route.' }, 404);
      return json(state.operator);
    }
    if (url.pathname === '/api/auth/me') return json({ user: state.user });
    if (url.pathname === '/api/repos') return json([]);
    if (url.pathname === '/api/sessions/runs') return json({ runs: [] });
    if (url.pathname === '/api/notifications') return json({ notifications: [], unreadCount: 0 });
    return json({ error: `not found: ${url.pathname}` }, 404);
  }) as unknown as typeof window.fetch;
  return state;
}

/** The router's address, so a navigation can be asserted. */
function Address() {
  const { pathname, search } = useLocation();
  return <div data-testid="address">{`${pathname}${search}`}</div>;
}

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  render(
    // The operator page reads the signed-in person, so the session is real
    // here: the provider probes `/api/auth/me` like the shell does.
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/*" element={<DashboardApp />} />
        </Routes>
        <Address />
      </MemoryRouter>
    </AuthProvider>,
  );
}

const address = () => screen.getByTestId('address').textContent;

beforeEach(() => {
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  window.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('Settings › Credits', () => {
  it('says the balance once', async () => {
    serve();
    renderAt('/settings/credits');
    expect(await screen.findByText('4,880')).toBeInTheDocument();
    expect(screen.queryByText(/of model spend/)).toBeNull();
    expect(screen.getByText(/5,000 on/)).toBeInTheDocument();
    expect(screen.getByText('TrueCourse credits')).toBeInTheDocument();
  });

  it('shows a run’s spending as one line, and opens the conversation it belongs to', async () => {
    serve();
    renderAt('/settings/credits');
    const ledger = await screen.findByRole('list', { name: 'Ledger' });
    const rows = within(ledger).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Flow generation')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('-120')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('+5,000')).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/pilot/)).toBeInTheDocument();

    await userEvent.click(rows[0]!);
    await waitFor(() => expect(address()).toBe('/agent/run_gen'));
  });

  it('a grant line opens nowhere — there is no run behind it', async () => {
    serve();
    renderAt('/settings/credits');
    const ledger = await screen.findByRole('list', { name: 'Ledger' });
    const rows = within(ledger).getAllByRole('listitem');
    expect(rows[1]).not.toHaveAttribute('tabindex');
  });

  it('lists a paused run with the one thing to do about it', async () => {
    const state = serve();
    renderAt('/settings/credits');
    const list = await screen.findByRole('list', { name: 'Paused runs' });
    expect(within(list).getByText('Flow setup')).toBeInTheDocument();
    expect(within(list).getByText('acme/api')).toBeInTheDocument();

    await userEvent.click(within(list).getByRole('button', { name: 'Resume' }));
    await waitFor(() =>
      expect(state.posts.map((post) => post.path)).toEqual(['/api/credits/resume/job_paused']),
    );
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Paused runs' })).not.toBeInTheDocument(),
    );
  });

  it('cannot resume on an empty balance', async () => {
    serve({ credits: { ...CREDITS, balance: 0 } });
    renderAt('/settings/credits');
    const list = await screen.findByRole('list', { name: 'Paused runs' });
    expect(within(list).getByRole('button', { name: 'Resume' })).toBeDisabled();
  });

  it('offers the one way to ask for credits, and says who they are for', async () => {
    serve();
    renderAt('/settings/credits');
    const actions = await screen.findByRole('group', { name: 'Credits actions' });
    expect(within(actions).getByRole('link', { name: 'Request credits' })).toHaveAttribute(
      'href',
      expect.stringContaining('discord.gg'),
    );
    expect(
      within(actions).getByText('Credits are granted to open source repositories.'),
    ).toBeInTheDocument();
    expect(within(actions).queryByRole('link', { name: 'Email' })).toBeNull();
    // The side menu has a Usage link of its own; among the actions there is none.
    expect(within(actions).queryByRole('link', { name: 'Usage' })).toBeNull();
  });

  it('says so plainly when nothing has been granted or spent', async () => {
    serve({
      credits: {
        balance: 0,
        lastGrantCredits: 0,
        lastGrantAt: null,
        onCredits: false,
        entries: [],
        pausedRuns: [],
      },
    });
    renderAt('/settings/credits');
    expect(await screen.findByText('No credits yet')).toBeInTheDocument();
    expect(screen.getByText("this workspace's own provider key")).toBeInTheDocument();
  });
});

describe('the operator’s Credits page', () => {
  it('lists every workspace with its balance, its spend and what it stopped', async () => {
    serve({ user: { id: 'op', email: 'ops@truecourse.dev', organizationId: 'org_acme', isOperator: true } });
    renderAt('/operator/credits');
    const list = await screen.findByRole('list', { name: 'Workspaces' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('org_acme')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('4,880')).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/120 spent in 30 days/)).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/last grant 5,000 on/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/never granted/)).toBeInTheDocument();
  });

  it('grants, with resuming on by default', async () => {
    const state = serve({
      user: { id: 'op', email: 'ops@truecourse.dev', organizationId: 'org_acme', isOperator: true },
    });
    renderAt('/operator/credits');
    const list = await screen.findByRole('list', { name: 'Workspaces' });
    const rows = within(list).getAllByRole('listitem');
    await userEvent.click(within(rows[0]!).getByRole('button', { name: 'Grant' }));

    const form = screen.getByRole('form', { name: 'Grant credits' });
    expect(within(form).getByRole('checkbox', { name: /Resume paused runs/ })).toBeChecked();
    await userEvent.type(within(form).getByLabelText('Credits'), '10000');
    await userEvent.type(within(form).getByLabelText('Note'), 'pilot');
    await userEvent.click(within(form).getByRole('button', { name: 'Grant' }));

    await waitFor(() =>
      expect(state.posts).toEqual([
        {
          path: '/api/operator/credits/grant',
          body: { workspaceOrgId: 'org_acme', credits: 10000, note: 'pilot', resumePaused: true },
        },
      ]),
    );
  });

  it('adjusts either way, and never offers to resume', async () => {
    const state = serve({
      user: { id: 'op', email: 'ops@truecourse.dev', organizationId: 'org_acme', isOperator: true },
    });
    renderAt('/operator/credits');
    const list = await screen.findByRole('list', { name: 'Workspaces' });
    await userEvent.click(within(within(list).getAllByRole('listitem')[0]!).getByRole('button', { name: 'Adjust' }));
    const form = screen.getByRole('form', { name: 'Adjust credits' });
    expect(within(form).queryByRole('checkbox', { name: /Resume paused runs/ })).not.toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText('Credits'), '-500');
    await userEvent.click(within(form).getByRole('button', { name: 'Adjust' }));
    await waitFor(() =>
      expect(state.posts).toEqual([
        {
          path: '/api/operator/credits/adjust',
          body: { workspaceOrgId: 'org_acme', credits: -500 },
        },
      ]),
    );
  });

  it('shows a member nothing at all', async () => {
    serve();
    renderAt('/operator/credits');
    expect(await screen.findByText('Nothing here')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Workspaces' })).not.toBeInTheDocument();
  });
});
