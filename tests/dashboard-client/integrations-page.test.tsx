/**
 * The Integrations settings page renders a connector LIST; each "Configure"
 * opens the shared right-side Drawer (same component repos use) with a
 * field-metadata-driven credential form + a Test button. Adding a connector
 * needs no page change — the server describes its fields.
 *
 * A connected row has two explicit buttons: "Sync now" dispatches the pre-flight
 * sweep (`knowledge.estimate`); "Process" — rendered only while the server-
 * persisted `pending` record exists — dispatches the consolidate job
 * (`knowledge.sync`). Busy state is derived from the org's active jobs
 * (`activeJobFor`, mocked here) so it survives refreshes; a settled sweep/sync job
 * reloads the list so the `pending` record (and its Process button) appears.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IntegrationsPage from '../../ee/packages/client/src/IntegrationsPage';

// Controllable stand-in for the app-wide jobs provider: `setActive` drives the
// server-derived busy state (`activeJobFor`), and the captured `onJobSettled`
// subscriber lets `fireSettled` deliver a terminal job.
const jobs = vi.hoisted(() => {
  let settled: ((job: unknown) => void) | null = null;
  let active: Array<{ type: string; key: string }> = [];
  return {
    useJobs: () => ({
      notifications: [],
      unreadCount: 0,
      // Derived from setActive so "Processing…" (any active knowledge.sync job)
      // and the per-kind "Syncing…" both read the same source.
      activeJobs: active.map((a) => ({ id: 'job', type: a.type, key: a.key })),
      activeJobFor: (type: string, key: string) =>
        active.find((a) => a.type === type && a.key === key) ? { id: 'job', type, key } : undefined,
      onJobSettled: (fn: (job: unknown) => void) => {
        settled = fn;
        return () => {
          if (settled === fn) settled = null;
        };
      },
      markAllRead: async () => {},
      markRead: async () => {},
      refresh: async () => {},
    }),
    fireSettled: (job: unknown) => settled?.(job),
    setActive: (a: Array<{ type: string; key: string }>) => {
      active = a;
    },
  };
});
vi.mock('../../ee/packages/client/src/jobs/JobsContext', () => ({ useJobs: jobs.useJobs }));

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const secretField = { key: 'apiToken', label: 'API token', type: 'password' as const, secret: true };

/** Jira: connected, with the OPTIONAL `jql` filter left blank, no pending work. */
const JIRA_CONNECTED = {
  kind: 'jira',
  name: 'Jira',
  description: 'Sync a Jira project as workspace Knowledge.',
  fields: [
    { key: 'baseUrl', label: 'Site base URL', type: 'text' as const },
    { key: 'projectKey', label: 'Project key', type: 'text' as const },
    { key: 'jql', label: 'JQL filter', type: 'text' as const, optional: true },
    { key: 'accountEmail', label: 'Account email', type: 'email' as const },
    secretField,
  ],
  connection: {
    config: { baseUrl: 'https://acme.atlassian.net', projectKey: 'ENG', accountEmail: 'a@b.co' },
    hasToken: true,
    tokenMask: '••••1234',
    updatedAt: '2026-07-07T00:00:00Z',
    pending: null,
  },
};

/**
 * Jira with a sweep result awaiting Process. `{ delta, estimate, sweptAt }`: the
 * estimate is structurally the OSS `LlmEstimateData` the Process confirm modal
 * renders — staged, with a partial (unpriced) ceiling cost.
 */
const JIRA_PENDING = {
  ...JIRA_CONNECTED,
  connection: {
    ...JIRA_CONNECTED.connection,
    pending: {
      delta: { new: 3, changed: 2, removed: 0, total: 40 },
      estimate: {
        totalEstimatedTokens: 120_000,
        tiers: [],
        stages: [
          { stage: 'relevance', label: 'Classify', model: 'claude-haiku', calls: 5, estimatedTokens: 40_000, estimatedCostUsd: 0.2 },
          { stage: 'extract', label: 'Extract', model: 'claude-opus', calls: 3, estimatedTokens: 80_000, estimatedCostUsd: 4.0 },
        ],
        subjectLabel: '3 new · 2 changed of 40 docs',
        estimatedCostUsd: 4.2,
        costPartial: true,
        costSource: 'bundled',
      },
      sweptAt: '2026-07-08T00:00:00Z',
    },
  },
};

/** Jira with a removed-only sweep result: a delta, but NO LLM stages (free work). */
const JIRA_PENDING_NO_STAGES = {
  ...JIRA_CONNECTED,
  connection: {
    ...JIRA_CONNECTED.connection,
    pending: {
      delta: { new: 0, changed: 0, removed: 4, total: 36 },
      estimate: {
        totalEstimatedTokens: 0,
        tiers: [],
        stages: [],
        subjectLabel: '4 removed of 36 docs',
      },
      sweptAt: '2026-07-08T00:00:00Z',
    },
  },
};

/** Confluence: connected, with its own pending sweep result (a second source for
 *  the COMBINED Process dialog). One LLM stage, a small priced cost. */
const CONFLUENCE_PENDING = {
  kind: 'confluence',
  name: 'Confluence',
  description: 'Sync a Confluence space as workspace Knowledge.',
  fields: [
    { key: 'baseUrl', label: 'Site base URL', type: 'text' as const },
    { key: 'spaceKey', label: 'Space key', type: 'text' as const },
    { key: 'accountEmail', label: 'Account email', type: 'email' as const },
    secretField,
  ],
  connection: {
    config: { baseUrl: 'https://acme.atlassian.net', spaceKey: 'DOCS', accountEmail: 'a@b.co' },
    hasToken: true,
    tokenMask: '••••1234',
    updatedAt: '2026-07-07T00:00:00Z',
    pending: {
      delta: { new: 5, changed: 0, removed: 0, total: 20 },
      estimate: {
        totalEstimatedTokens: 30_000,
        tiers: [],
        stages: [
          { stage: 'relevance', label: 'Classify', model: 'claude-haiku', calls: 2, estimatedTokens: 30_000, estimatedCostUsd: 0.1 },
        ],
        subjectLabel: '5 new of 20 docs',
        estimatedCostUsd: 0.1,
        costPartial: false,
        costSource: 'bundled',
      },
      sweptAt: '2026-07-08T00:00:00Z',
    },
  },
};

/** Confluence: a required non-secret field (`spaceKey`) is missing → not connected. */
const CONFLUENCE_MISSING_REQUIRED = {
  kind: 'confluence',
  name: 'Confluence',
  description: 'Sync a Confluence space as workspace Knowledge.',
  fields: [
    { key: 'baseUrl', label: 'Site base URL', type: 'text' as const },
    { key: 'spaceKey', label: 'Space key', type: 'text' as const },
    { key: 'accountEmail', label: 'Account email', type: 'email' as const },
    secretField,
  ],
  connection: {
    config: { baseUrl: 'https://acme.atlassian.net', accountEmail: 'a@b.co' },
    hasToken: true,
    tokenMask: '••••1234',
    updatedAt: '2026-07-07T00:00:00Z',
    pending: null,
  },
};

const CONNECTORS = {
  connectors: [
    {
      kind: 'confluence',
      name: 'Confluence',
      description: 'Sync a Confluence Cloud space as workspace Knowledge.',
      fields: [
        { key: 'baseUrl', label: 'Site base URL', type: 'text' },
        { key: 'spaceKey', label: 'Space key', type: 'text' },
        { key: 'accountEmail', label: 'Account email', type: 'email' },
        { key: 'apiToken', label: 'API token', type: 'password', secret: true },
      ],
      connection: null,
    },
  ],
};

/**
 * URL-routed fetch stub (the house pattern); records calls for POST assertions.
 * `connectors` may be a value or a getter, so a test can flip what a reload sees.
 */
function stubFetch(connectors: unknown | (() => unknown)) {
  const resolve = () => (typeof connectors === 'function' ? (connectors as () => unknown)() : connectors);
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method, body: init?.body as string | undefined });
      if (u.includes('/api/ee/knowledge/estimate')) return json({ jobId: 'est-1' });
      if (u.includes('/api/ee/knowledge/sync')) return json({ jobId: 'sync-1' });
      if (u.includes('/api/ee/integrations')) return json({ connectors: resolve() });
      return json({});
    }),
  );
  return calls;
}

const integrationLoads = (calls: { url: string; method: string }[]) =>
  calls.filter((c) => c.url.includes('/api/ee/integrations') && c.method === 'GET').length;

beforeEach(() => {
  jobs.setActive([]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(CONNECTORS), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('IntegrationsPage', () => {
  it('lists connectors with a Configure button (no per-connector form on the page)', async () => {
    render(<IntegrationsPage />);
    expect(await screen.findByText('Confluence')).toBeInTheDocument();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configure' })).toBeInTheDocument();
  });

  it('Configure opens the drawer with the field form + Test button', async () => {
    const user = userEvent.setup();
    render(<IntegrationsPage />);
    await user.click(await screen.findByRole('button', { name: 'Configure' }));

    expect(await screen.findByText('Configure Confluence')).toBeInTheDocument();
    expect(screen.getByText('Site base URL')).toBeInTheDocument();
    expect(screen.getByText('API token')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Test connection/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Save/ })).toBeInTheDocument();
  });

  it('a blank OPTIONAL field never blocks "Connected"; a blank REQUIRED one does', async () => {
    stubFetch([JIRA_CONNECTED, CONFLUENCE_MISSING_REQUIRED]);
    render(<IntegrationsPage />);

    // Jira has its optional `jql` blank but every required field set → Connected.
    expect(await screen.findByText('Jira')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    // Confluence is missing the required `spaceKey` → Not connected (check still enforced).
    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });

  it('Sync now dispatches the pre-flight estimate (no sync, no modal)', async () => {
    const user = userEvent.setup();
    const calls = stubFetch([JIRA_CONNECTED]);
    render(<IntegrationsPage />);

    await user.click(await screen.findByRole('button', { name: 'Sync now' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/api/ee/knowledge/estimate') && c.method === 'POST')).toBe(true),
    );
    // No modal, and the sync (consolidate) job is not touched by "Sync now".
    expect(screen.queryByRole('button', { name: /Proceed/ })).not.toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/api/ee/knowledge/sync'))).toBe(false);
  });

  it('Process (and its DELTA-ONLY summary, no cost) render only when a pending record exists', async () => {
    const { unmount } = render(<IntegrationsPage />);
    stubFetch([JIRA_CONNECTED]);
    unmount();

    // Without a pending record: Sync now only, no Process button, no summary.
    stubFetch([JIRA_CONNECTED]);
    const { unmount: unmount2 } = render(<IntegrationsPage />);
    await screen.findByRole('button', { name: 'Sync now' });
    expect(screen.queryByRole('button', { name: 'Process' })).not.toBeInTheDocument();
    expect(screen.queryByText(/of 40 docs/)).not.toBeInTheDocument();
    unmount2();

    // With a pending record: Process appears with the delta subject line — and no
    // dollar amount on the row (the cost lives in the confirm modal only).
    stubFetch([JIRA_PENDING]);
    render(<IntegrationsPage />);
    expect(await screen.findByRole('button', { name: 'Process' })).toBeInTheDocument();
    expect(screen.getByText('3 new · 2 changed of 40 docs')).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/up to/)).not.toBeInTheDocument();
  });

  it('Process (staged estimate) opens the confirm modal and does NOT POST /sync until Confirm', async () => {
    const user = userEvent.setup();
    const calls = stubFetch([JIRA_PENDING]);
    render(<IntegrationsPage />);

    await user.click(await screen.findByRole('button', { name: 'Process' }));
    // The stored estimate opens the OSS modal instantly (no re-sweep, no /sync yet).
    expect(await screen.findByText('Proceed with this run?')).toBeInTheDocument();
    expect(screen.getByText('Classify')).toBeInTheDocument();
    expect(screen.getByText(/up to/)).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/api/ee/knowledge/sync'))).toBe(false);
  });

  it('Confirm in the modal dispatches the sync (consolidate) job', async () => {
    const user = userEvent.setup();
    const calls = stubFetch([JIRA_PENDING]);
    render(<IntegrationsPage />);

    await user.click(await screen.findByRole('button', { name: 'Process' }));
    await user.click(await screen.findByRole('button', { name: 'Proceed' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/api/ee/knowledge/sync') && c.method === 'POST')).toBe(true),
    );
    // The modal closes on Confirm.
    expect(screen.queryByText('Proceed with this run?')).not.toBeInTheDocument();
  });

  it('Cancel closes the modal and dispatches nothing', async () => {
    const user = userEvent.setup();
    const calls = stubFetch([JIRA_PENDING]);
    render(<IntegrationsPage />);

    await user.click(await screen.findByRole('button', { name: 'Process' }));
    await screen.findByText('Proceed with this run?');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('Proceed with this run?')).not.toBeInTheDocument());
    expect(calls.some((c) => c.url.includes('/api/ee/knowledge/sync'))).toBe(false);
  });

  it('Process (no-stage estimate) dispatches /sync directly with no modal', async () => {
    const user = userEvent.setup();
    const calls = stubFetch([JIRA_PENDING_NO_STAGES]);
    render(<IntegrationsPage />);

    await user.click(await screen.findByRole('button', { name: 'Process' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/api/ee/knowledge/sync') && c.method === 'POST')).toBe(true),
    );
    // Free work: the explicit click is consent enough — no confirm modal.
    expect(screen.queryByText('Proceed with this run?')).not.toBeInTheDocument();
  });

  it('an active estimate job shows "Syncing…" and disables both buttons', async () => {
    jobs.setActive([{ type: 'knowledge.estimate', key: 'knowledge.estimate:jira' }]);
    stubFetch([JIRA_PENDING]);
    render(<IntegrationsPage />);

    const syncBtn = await screen.findByRole('button', { name: 'Syncing…' });
    expect(syncBtn).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Process' })).toBeDisabled();
  });

  it('an active sync job shows "Processing…" and disables both buttons', async () => {
    jobs.setActive([{ type: 'knowledge.sync', key: 'knowledge.sync:jira' }]);
    stubFetch([JIRA_PENDING]);
    render(<IntegrationsPage />);

    const procBtn = await screen.findByRole('button', { name: 'Processing…' });
    expect(procBtn).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();
  });

  it('processing is workspace-scoped: ANY active sync job shows "Processing…" on EVERY pending row', async () => {
    // The union job's single-flight key is `knowledge.sync:<org>` — not per kind —
    // so the row derives its busy state from the job TYPE, regardless of key.
    jobs.setActive([{ type: 'knowledge.sync', key: 'knowledge.sync:ws:org-123' }]);
    stubFetch([JIRA_PENDING, CONFLUENCE_PENDING]);
    render(<IntegrationsPage />);

    const procBtns = await screen.findAllByRole('button', { name: 'Processing…' });
    expect(procBtns).toHaveLength(2);
    procBtns.forEach((b) => expect(b).toBeDisabled());
  });

  it('Process opens the COMBINED confirm dialog — every source summed, per-source lines', async () => {
    const user = userEvent.setup();
    const calls = stubFetch([JIRA_PENDING, CONFLUENCE_PENDING]);
    render(<IntegrationsPage />);

    // Clicking either row's Process opens the same combined dialog.
    await user.click((await screen.findAllByRole('button', { name: 'Process' }))[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Proceed with this run?')).toBeInTheDocument();
    // Per-source delta lines (both sources named with their deltas).
    expect(within(dialog).getByText('Jira')).toBeInTheDocument();
    expect(within(dialog).getByText('3 new · 2 changed of 40 docs')).toBeInTheDocument();
    expect(within(dialog).getByText('Confluence')).toBeInTheDocument();
    expect(within(dialog).getByText('5 new of 20 docs')).toBeInTheDocument();
    // Costs summed (4.20 + 0.10) with the partial marker OR-ed on (Jira's estimate).
    expect(within(dialog).getByText(/\$4\.30\+/)).toBeInTheDocument();
    // Nothing dispatched until Confirm.
    expect(calls.some((c) => c.url.includes('/api/ee/knowledge/sync'))).toBe(false);

    await user.click(within(dialog).getByRole('button', { name: 'Proceed' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/api/ee/knowledge/sync') && c.method === 'POST')).toBe(true),
    );
  });

  it('a settled estimate job reloads the list so the pending Process button appears', async () => {
    let current: unknown[] = [JIRA_CONNECTED]; // no pending yet
    const calls = stubFetch(() => current);
    render(<IntegrationsPage />);

    await screen.findByRole('button', { name: 'Sync now' });
    expect(screen.queryByRole('button', { name: 'Process' })).not.toBeInTheDocument();
    const before = integrationLoads(calls);

    // The sweep found work; the server now returns a pending record.
    current = [JIRA_PENDING];
    await act(async () => {
      jobs.fireSettled({ id: 'est-1', type: 'knowledge.estimate', status: 'succeeded' });
    });

    await waitFor(() => expect(integrationLoads(calls)).toBeGreaterThan(before));
    expect(await screen.findByRole('button', { name: 'Process' })).toBeInTheDocument();
  });
});
