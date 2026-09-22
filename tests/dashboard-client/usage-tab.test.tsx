/**
 * Settings › Usage.
 *
 * The page is real all the way down: it reads `GET /api/usage`, whose numbers
 * the server folded, whose filter values the server faceted and whose period
 * the server resolved. What is asserted here is what the page DOES with that
 * answer — the trend it draws and the total beneath it, the runs list and what
 * a row opens, the measure the chart plots, and the control row,
 * whose every choice lands in the address and is read back from it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { UsageResponse } from '@truecourse/shared';

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

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const realFetch = window.fetch;

const USAGE: UsageResponse = {
  period: {
    key: '30d',
    from: '2026-08-17T00:00:00.000Z',
    to: '2026-09-16T00:00:00.000Z',
    bucket: 'day',
  },
  since: '2026-07-02T09:00:00.000Z',
  totals: {
    costUsd: 12.5,
    inputTokens: 1_000_000,
    outputTokens: 200_000,
    cacheReadTokens: 800_000,
    cacheCreateTokens: 0,
    tokens: 2_000_000,
    split: { input: 1_000_000, output: 200_000, cached: 800_000, cacheHitRate: 800_000 / 1_800_000 },
    calls: 412,
    runs: 2,
  },
  series: [
    { at: '2026-09-14', costUsd: 0, input: 0, output: 0, cached: 0, byJobType: {} },
    {
      at: '2026-09-15',
      costUsd: 12.5,
      input: 980_000,
      output: 220_000,
      cached: 800_000,
      byJobType: {
        'repo.guard-generate': { costUsd: 10, input: 600_000, output: 200_000, cached: 800_000 },
        'context.scan': { costUsd: 2.5, input: 380_000, output: 20_000, cached: 0 },
      },
    },
  ],
  runs: [
    {
      jobId: 'job_gen',
      runId: 'run_gen',
      jobType: 'repo.guard-generate',
      title: 'Flow generation',
      repository: 'acme/web',
      repoId: 'web',
      costUsd: 10,
      inputTokens: 500_000,
      outputTokens: 200_000,
      cacheReadTokens: 800_000,
      cacheCreateTokens: 100_000,
      tokens: 1_600_000,
      split: { input: 600_000, output: 200_000, cached: 800_000, cacheHitRate: 800_000 / 1_400_000 },
      calls: 380,
      model: 'claude-opus-5',
      startedAt: '2026-09-15T09:00:00.000Z',
      finishedAt: '2026-09-15T09:12:00.000Z',
      durationMs: 720_000,
      outcome: 'succeeded',
    },
    {
      jobId: 'job_scan',
      runId: null,
      jobType: 'context.scan',
      title: 'Document scan',
      repository: null,
      repoId: null,
      costUsd: 2.5,
      inputTokens: 380_000,
      outputTokens: 20_000,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      tokens: 400_000,
      split: { input: 380_000, output: 20_000, cached: 0, cacheHitRate: null },
      calls: 32,
      model: 'claude-opus-5',
      startedAt: '2026-09-15T08:00:00.000Z',
      finishedAt: '2026-09-15T08:02:00.000Z',
      durationMs: 120_000,
      outcome: 'failed',
    },
  ],
  repositories: [{ value: 'web', label: 'acme/web', count: 1, total: 1 }],
  jobTypes: [
    { value: 'context.scan', label: 'Document scan', count: 1, total: 1 },
    { value: 'repo.guard-generate', label: 'Flow generation', count: 1, total: 1 },
  ],
};

const EMPTY: UsageResponse = {
  ...USAGE,
  totals: {
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    tokens: 0,
    split: { input: 0, output: 0, cached: 0, cacheHitRate: null },
    calls: 0,
    runs: 0,
  },
  series: [{ at: '2026-09-15', costUsd: 0, input: 0, output: 0, cached: 0, byJobType: {} }],
  runs: [],
  repositories: [],
  jobTypes: [],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface World {
  usage: UsageResponse;
  calls: string[];
}

function serve(over: Partial<World> = {}) {
  const state: World = { usage: USAGE, calls: [], ...over };
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    if (url.pathname === '/api/usage') {
      state.calls.push(`${url.pathname}${url.search}`);
      return json(state.usage);
    }
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

function renderUsage(path = '/settings/usage') {
  window.history.replaceState({}, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/*" element={<DashboardApp />} />
      </Routes>
      <Address />
    </MemoryRouter>,
  );
}

const address = () => screen.getByTestId('address').textContent;
const lastCall = (state: World) => state.calls[state.calls.length - 1];

/** What the last read asked for, `tz` and all. */
const asked = (state: World): URLSearchParams =>
  new URLSearchParams(new URL(lastCall(state)!, 'http://x').search);

/** The zone the browser is in, which is the one the page is expected to send. */
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

beforeEach(() => {
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  window.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('Settings › Usage', () => {
  it('draws the trend, the period total and the runs that spent it', async () => {
    serve();
    renderUsage();

    const chart = await screen.findByRole('region', { name: 'Spend over time' });
    // One band per job type that spent, named in the product's words.
    expect(within(chart).getByText('Flow generation')).toBeInTheDocument();
    expect(within(chart).getByText('Document scan')).toBeInTheDocument();
    // The total, once, beneath the chart, and its tokens split beneath that.
    expect(screen.getByText('$12.50')).toBeInTheDocument();
    expect(
      screen.getByText('1.0M input · 200.0K output · 800.0K cached · 44% cache hits'),
    ).toBeInTheDocument();

    const runs = screen.getByRole('list', { name: 'Runs' });
    const rows = within(runs).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Flow generation');
    expect(rows[0]).toHaveTextContent('acme/web');
    expect(rows[0]).toHaveTextContent('Finished');
    expect(rows[0]).toHaveTextContent('$10.00');
    // The run's tokens split the way the period's do, cache writes counted as input.
    expect(rows[0]).toHaveTextContent('600.0K input · 200.0K output · 800.0K cached · 57% cache hits');
    // The workspace's own work belongs to no repository and says so by saying nothing.
    expect(rows[1]).toHaveTextContent('Document scan');
    expect(rows[1]).toHaveTextContent('Failed');
    // A run that cached nothing shows no cached figure and no rate, never a 0%.
    expect(rows[1]).toHaveTextContent('380.0K input · 20.0K output');
    expect(rows[1]).not.toHaveTextContent('cached');
    expect(rows[1]).not.toHaveTextContent('cache hits');

    // The numbers appear once more, at the bottom, as the list's tally.
    const tally = screen.getByRole('group', { name: 'Runs tally' });
    expect(tally).toHaveTextContent('1 Failed');
    expect(tally).toHaveTextContent('1 Finished');
  });

  it('opens the conversation a run belongs to, and nothing for a run that has none', async () => {
    serve();
    renderUsage();

    const runs = await screen.findByRole('list', { name: 'Runs' });
    const rows = within(runs).getAllByRole('listitem');

    // A Flow run has no conversation: its row takes no click and no focus.
    expect(rows[1]).not.toHaveAttribute('tabindex');
    await userEvent.click(rows[1]!);
    expect(address()).toBe('/settings/usage');

    await userEvent.click(rows[0]!);
    expect(address()).toBe('/agent/run_gen');
  });

  it('plots the one measure picked, per job type, without asking the server again', async () => {
    const state = serve();
    renderUsage();

    const chart = await screen.findByRole('region', { name: 'Spend over time' });
    const measures = within(chart).getByRole('group', { name: 'Measure' });
    // Four measures, no summed token count among them.
    expect(within(measures).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Cost',
      'Input',
      'Output',
      'Cached',
    ]);
    const plotted = () => within(chart).getByRole('img').querySelector('desc')!.textContent;
    expect(plotted()).toContain('Sep 15: $2.50 document scan, $10.00 flow generation');

    const before = state.calls.length;
    await userEvent.click(within(measures).getByRole('button', { name: 'Output' }));
    expect(within(measures).getByRole('button', { name: 'Output' })).toHaveAttribute('aria-pressed', 'true');
    expect(plotted()).toContain('Sep 15: 20.0K document scan, 200.0K flow generation');

    await userEvent.click(within(measures).getByRole('button', { name: 'Input' }));
    expect(plotted()).toContain('Sep 15: 380.0K document scan, 600.0K flow generation');

    await userEvent.click(within(measures).getByRole('button', { name: 'Cached' }));
    expect(plotted()).toContain('Sep 15: 0 document scan, 800.0K flow generation');

    // The period's total beneath stays what it is, each number said once.
    expect(screen.getByText('$12.50')).toBeInTheDocument();
    expect(
      screen.getByText('1.0M input · 200.0K output · 800.0K cached · 44% cache hits'),
    ).toBeInTheDocument();
    expect(state.calls).toHaveLength(before);
  });

  it('shows no cached figure or rate for a period nothing was cached in', async () => {
    serve({
      usage: {
        ...USAGE,
        totals: {
          ...USAGE.totals,
          cacheReadTokens: 0,
          split: { input: 1_000_000, output: 200_000, cached: 0, cacheHitRate: null },
        },
      },
    });
    renderUsage();

    // The line says exactly the two figures there are, with nothing cached after them.
    const line = await screen.findByText('1.0M input · 200.0K output');
    expect(line).toHaveTextContent(/^1\.0M input · 200\.0K output$/);
    // Nor does the chart offer to plot a cache that held nothing.
    const measures = screen.getByRole('group', { name: 'Measure' });
    expect(within(measures).queryByRole('button', { name: 'Cached' })).toBeNull();
  });

  it('puts the period in the address and reads it back', async () => {
    const state = serve();
    renderUsage();

    await screen.findByRole('region', { name: 'Spend over time' });
    expect(asked(state).get('period')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => expect(asked(state).get('period')).toBe('7d'));
    expect(address()).toBe('/settings/usage?period=7d');
  });

  it('sends the reader’s own zone, and keeps it off the address', async () => {
    const state = serve();
    renderUsage();

    await screen.findByRole('region', { name: 'Spend over time' });
    // The chart's days are cut in the zone the reader is in, the way the runs
    // beneath it are already written in it.
    expect(asked(state).get('tz')).toBe(ZONE);
    expect(address()).toBe('/settings/usage');

    await userEvent.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => expect(asked(state).get('period')).toBe('7d'));
    expect(asked(state).get('tz')).toBe(ZONE);
    expect(address()).toBe('/settings/usage?period=7d');
  });

  it('starts from the address, so a narrowed page survives a reload', async () => {
    const state = serve();
    renderUsage('/settings/usage?period=90d&repo=web&jobType=repo.guard-generate');

    await screen.findByRole('region', { name: 'Spend over time' });
    const sent = asked(state);
    expect(sent.get('period')).toBe('90d');
    expect(sent.get('repo')).toBe('web');
    expect(sent.get('jobType')).toBe('repo.guard-generate');
    // The applied filters read as pills, in the words the server gave them.
    const filters = screen.getByRole('group', { name: 'Filter usage' });
    expect(within(filters).getByText('acme/web')).toBeInTheDocument();
    expect(within(filters).getByText('Flow generation')).toBeInTheDocument();
  });

  it('adds a filter from the menu, in the server’s own values', async () => {
    const state = serve();
    renderUsage();

    await screen.findByRole('region', { name: 'Spend over time' });
    await userEvent.click(screen.getByRole('button', { name: 'Add filter' }));
    await userEvent.click(screen.getByRole('option', { name: /Repository/ }));
    await userEvent.click(screen.getByRole('option', { name: /acme\/web/ }));

    await waitFor(() => expect(address()).toBe('/settings/usage?repo=web'));
    expect(asked(state).get('repo')).toBe('web');
  });

  it('asks for two dates once the period is custom', async () => {
    const state = serve();
    renderUsage();

    await screen.findByRole('region', { name: 'Spend over time' });
    await userEvent.click(screen.getByRole('button', { name: 'Custom' }));

    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
    const sent = asked(state);
    expect(sent.get('period')).toBe('custom');
    expect(sent.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The days it opens on are the reader's own, so today is today where they are.
    expect(sent.get('to')).toBe(new Date().toLocaleDateString('sv-SE'));
  });

  it('says when the record began, when the period holds nothing', async () => {
    serve({ usage: EMPTY });
    renderUsage();

    expect(await screen.findByText('No usage in this period')).toBeInTheDocument();
    expect(screen.getByText(/Usage is on record from/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Spend over time' })).toBeNull();
    // The control row stays: the period that shows nothing is the one to change.
    expect(screen.getByRole('group', { name: 'Period' })).toBeInTheDocument();
  });

  it('says so when nothing has ever spent', async () => {
    serve({ usage: { ...EMPTY, since: null } });
    renderUsage();

    expect(await screen.findByText('No run has spent at the model yet.')).toBeInTheDocument();
  });

  it('says the server’s words when the read is refused', async () => {
    window.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(href, window.location.origin);
      if (pathname === '/api/usage') return json({ error: 'A custom period ends before it begins.' }, 400);
      if (pathname === '/api/repos') return json([]);
      if (pathname === '/api/sessions/runs') return json({ runs: [] });
      if (pathname === '/api/notifications') return json({ notifications: [], unreadCount: 0 });
      return json({ error: 'not found' }, 404);
    }) as unknown as typeof window.fetch;
    renderUsage();

    expect(
      await screen.findByText(/A custom period ends before it begins\./),
    ).toBeInTheDocument();
  });
});
