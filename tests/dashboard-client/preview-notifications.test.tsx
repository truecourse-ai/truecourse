/**
 * Notifications: the workspace's stored feed, as the page reads it.
 *
 * Nothing here is derived. The rows are what `GET /api/notifications` answered,
 * a `notification` frame on the event stream prepends one, and read state is the
 * server's: opening a row posts its id, Mark all read posts them all, and the
 * sidebar badge is the store's unread count.
 *
 * The addresses are the point of the row: a setup, a generation and a scan open
 * the run's own conversation, a flow run opens the repository's run page, a sync
 * opens the source. A row whose event named no address stays put.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { NotificationView } from '@truecourse/shared';

vi.mock('@/lib/socket', () => {
  const socket = {
    connected: true,
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

vi.mock('@/components/sessions/RunConversationPage', () => ({
  RunConversationPage: () => <div data-testid="conversation" />,
}));

import PreviewApp from '@/preview/PreviewApp';

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

// ---------------------------------------------------------------------------
// The event stream, as a stub jsdom does not provide.
// ---------------------------------------------------------------------------

const streams: StubEventSource[] = [];

class StubEventSource {
  listeners = new Set<(e: MessageEvent<string>) => void>();
  closed = false;
  constructor(readonly url: string) {
    streams.push(this);
  }
  addEventListener(_type: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.add(fn);
  }
  removeEventListener(_type: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.delete(fn);
  }
  close() {
    this.closed = true;
  }
}

/** Deliver one server frame to every open stream. */
function fireFrame(payload: unknown): void {
  act(() => {
    for (const stream of streams) {
      for (const fn of stream.listeners) {
        fn({ data: JSON.stringify(payload) } as MessageEvent<string>);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

const REPO = {
  id: 'widgets',
  name: 'acme/widgets',
  path: '/clones/acme__widgets',
  remoteUrl: 'https://github.com/acme/widgets',
};

const SETUP_RUN = '2026-09-11T09-00-00Z_setup001';
const SCAN_RUN = '2026-09-11T08-00-00Z_scan0001';
const GUARD_RUN = '2026-09-11T10-00-00Z_guardrun';

function note(over: Partial<NotificationView> = {}): NotificationView {
  return {
    id: 'n-1',
    kind: 'repo.guard-setup',
    level: 'success',
    title: 'Flow setup complete',
    body: 'The recipe and its dependencies are ready.',
    data: { jobId: 'job-1', repoFullName: REPO.name, runId: SETUP_RUN },
    readAt: null,
    createdAt: '2026-09-11T09:05:00.000Z',
    ...over,
  };
}

const SETUP = note();

const RUN = note({
  id: 'n-2',
  kind: 'repo.guard-run',
  level: 'warning',
  title: 'Flows ran, failures to review',
  body: '4 of 6 passed, 2 failed.',
  data: { jobId: 'job-2', repoFullName: REPO.name, guardRunId: GUARD_RUN },
  createdAt: '2026-09-11T10:05:00.000Z',
});

const SYNC = note({
  id: 'n-3',
  kind: 'context.sync',
  level: 'success',
  title: 'Source synced',
  body: '2 added, 1 changed.',
  data: { jobId: 'job-3', sourceId: 'stripe-docs', sourceTitle: 'Stripe Docs' },
  readAt: '2026-09-11T08:30:00.000Z',
  createdAt: '2026-09-11T08:10:00.000Z',
});

const SCAN_FAILED = note({
  id: 'n-4',
  kind: 'context.scan',
  level: 'error',
  title: 'Document scan failed',
  body: 'the workspace store went away',
  data: { jobId: 'job-4', runId: SCAN_RUN },
  createdAt: '2026-09-11T07:00:00.000Z',
});

const NO_ADDRESS = note({
  id: 'n-5',
  kind: 'knowledge.sync',
  level: 'info',
  title: 'Nothing to see',
  body: null,
  data: { jobId: 'job-5' },
  createdAt: '2026-09-11T06:00:00.000Z',
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const realFetch = window.fetch;

/** A workspace holding one repository and the feed the store answers with. */
function serve(feed: NotificationView[]) {
  const state = { feed, reads: [] as unknown[] };
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    if (pathname === '/api/repos') return json([REPO]);
    if (pathname === '/api/notifications') {
      return json({
        notifications: state.feed,
        unreadCount: state.feed.filter((n) => n.readAt === null).length,
      });
    }
    if (pathname === '/api/notifications/read') {
      const body = JSON.parse(String(init?.body ?? '{}')) as unknown;
      state.reads.push(body);
      return json({ unreadCount: 0 });
    }
    return json({ error: 'not found' }, 404);
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
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/preview/*" element={<PreviewApp />} />
      </Routes>
      <Address />
    </MemoryRouter>,
  );
}

/** The table's data rows, in the order they render. */
function rows() {
  const table = screen.getByRole('table', { name: 'Workspace notifications' });
  return within(table).getAllByRole('row').slice(1);
}

beforeEach(() => {
  streams.length = 0;
  (globalThis as { EventSource?: unknown }).EventSource = StubEventSource;
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
  delete (globalThis as { EventSource?: unknown }).EventSource;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// the feed
// ---------------------------------------------------------------------------

describe('the notification feed', () => {
  it('renders the stored rows in the order the store sent them', async () => {
    serve([RUN, SETUP, SYNC, SCAN_FAILED]);
    renderAt('/preview/notifications');

    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(4));

    const [first, second, third, fourth] = rows();
    expect(within(first!).getByText('Flows ran, failures to review')).toBeInTheDocument();
    expect(within(first!).getByText('4 of 6 passed, 2 failed.')).toBeInTheDocument();
    expect(within(first!).getByText('acme/widgets')).toBeInTheDocument();
    expect(within(first!).getByText('Needs you')).toBeInTheDocument();

    expect(within(second!).getByText('Done')).toBeInTheDocument();
    expect(within(third!).getByText('Source synced')).toBeInTheDocument();
    expect(within(fourth!).getByText('Failed')).toBeInTheDocument();
    // A workspace event names no repository.
    expect(within(fourth!).queryByText('acme/widgets')).toBeNull();
  });

  it('carries an unread title in the foreground weight and a read one muted', async () => {
    serve([SETUP, SYNC]);
    renderAt('/preview/notifications');
    await waitFor(() => expect(rows()).toHaveLength(2));

    expect(screen.getByText('Flow setup complete')).toHaveClass('font-medium', 'text-foreground');
    expect(screen.getByText('Source synced')).toHaveClass('text-muted-foreground');
    // No dot, and no second line under the title.
    expect(screen.queryByLabelText('unread')).toBeNull();
  });

  it('counts the unread rows on the sidebar badge', async () => {
    serve([SETUP, RUN, SYNC]);
    renderAt('/preview/notifications');

    await waitFor(() => expect(rows()).toHaveLength(3));
    const link = screen.getAllByRole('link', { name: /Notifications/ })[0]!;
    expect(link).toHaveTextContent('2');
  });

  it('says so when nothing has happened, and when a filter excluded everything', async () => {
    serve([]);
    renderAt('/preview/notifications');

    expect(await screen.findByText('Nothing has happened yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();

    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Search notifications' }), 'nothing here');
    expect(await screen.findByText('Nothing matches.')).toBeInTheDocument();
  });

  it('searches the title and the body', async () => {
    serve([SETUP, RUN]);
    renderAt('/preview/notifications');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    const search = screen.getByRole('textbox', { name: 'Search notifications' });
    await user.type(search, 'dependencies');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('Flow setup complete')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'failures');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('Flows ran, failures to review')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// the filters
// ---------------------------------------------------------------------------

describe('the filters', () => {
  it('narrows to what the address names, and reads AND across dimensions', async () => {
    serve([SETUP, RUN, SYNC, SCAN_FAILED]);
    renderAt('/preview/notifications?read=unread');
    // Everything but the sync, which is already read.
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.queryByText('Source synced')).toBeNull();
  });

  it('reads OR within one dimension and AND across two', async () => {
    serve([SETUP, RUN, SYNC, SCAN_FAILED]);
    renderAt('/preview/notifications?status=success&status=error&repo=acme%2Fwidgets');

    // success OR error, AND the one repository: the setup alone.
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('Flow setup complete')).toBeInTheDocument();
  });

  it('puts a Read filter picked through Add filter into the address', async () => {
    serve([SETUP, RUN, SYNC, SCAN_FAILED]);
    renderAt('/preview/notifications');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(4));

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Read/ }));
    await user.click(await screen.findByRole('option', { name: /^Read/ }));

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByTestId('address')).toHaveTextContent('/preview/notifications?read=read');
  });

  it('puts a Status filter into the address', async () => {
    serve([SETUP, RUN, SYNC, SCAN_FAILED]);
    renderAt('/preview/notifications');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(4));

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Status/ }));
    await user.click(await screen.findByRole('option', { name: /Failed/ }));

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByTestId('address')).toHaveTextContent('/preview/notifications?status=error');
    expect(within(rows()[0]!).getByText('Document scan failed')).toBeInTheDocument();
  });

  it('puts a Repository filter into the address', async () => {
    serve([SETUP, RUN, SYNC, SCAN_FAILED]);
    renderAt('/preview/notifications');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(4));

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Repository/ }));
    await user.click(await screen.findByRole('option', { name: /acme\/widgets/ }));

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByTestId('address')).toHaveTextContent(
      '/preview/notifications?repo=acme%2Fwidgets',
    );
  });
});

// ---------------------------------------------------------------------------
// opening a row
// ---------------------------------------------------------------------------

describe('opening a row', () => {
  it('marks a setup read and opens the run’s own conversation', async () => {
    const state = serve([SETUP]);
    renderAt('/preview/notifications');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(1));

    await user.click(rows()[0]!);

    await waitFor(() => expect(state.reads).toEqual([{ ids: ['n-1'] }]));
    expect(screen.getByTestId('address')).toHaveTextContent(
      `/preview/agent/${encodeURIComponent(SETUP_RUN)}`,
    );
  });

  it('opens a scan at its conversation too', async () => {
    const state = serve([SCAN_FAILED]);
    renderAt('/preview/notifications');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(1));

    await user.click(rows()[0]!);

    await waitFor(() => expect(state.reads).toEqual([{ ids: ['n-4'] }]));
    expect(screen.getByTestId('address')).toHaveTextContent(
      `/preview/agent/${encodeURIComponent(SCAN_RUN)}`,
    );
  });

  it('opens a flow run at the repository’s run page', async () => {
    const state = serve([RUN]);
    renderAt('/preview/notifications');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(1));

    await user.click(rows()[0]!);

    await waitFor(() => expect(state.reads).toEqual([{ ids: ['n-2'] }]));
    expect(screen.getByTestId('address')).toHaveTextContent(
      `/preview/repos/${REPO.id}/runs/${encodeURIComponent(GUARD_RUN)}`,
    );
  });

  it('opens a sync at the source’s page', async () => {
    const state = serve([SYNC]);
    renderAt('/preview/notifications');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(1));

    await user.click(rows()[0]!);

    // Already read: nothing is posted, and the address is still the source's.
    expect(state.reads).toEqual([]);
    expect(screen.getByTestId('address')).toHaveTextContent(
      '/preview/context/sources/stripe-docs',
    );
  });

  it('stays put for a row whose event named no address', async () => {
    const state = serve([NO_ADDRESS]);
    renderAt('/preview/notifications');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(1));

    await user.click(rows()[0]!);

    await waitFor(() => expect(state.reads).toEqual([{ ids: ['n-5'] }]));
    expect(screen.getByTestId('address')).toHaveTextContent('/preview/notifications');
  });

  it('stays put for a setup whose event named no run', async () => {
    const state = serve([note({ id: 'n-6', data: { jobId: 'job-6', repoFullName: REPO.name } })]);
    renderAt('/preview/notifications');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(1));

    await user.click(rows()[0]!);

    await waitFor(() => expect(state.reads).toEqual([{ ids: ['n-6'] }]));
    expect(screen.getByTestId('address')).toHaveTextContent('/preview/notifications');
  });
});

// ---------------------------------------------------------------------------
// marking read, and what lands live
// ---------------------------------------------------------------------------

describe('read state and the live stream', () => {
  it('marks everything read from the header, and the badge clears', async () => {
    const state = serve([SETUP, RUN]);
    renderAt('/preview/notifications');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Mark all read' }));

    await waitFor(() => expect(state.reads).toEqual([{ all: true }]));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull(),
    );
    expect(screen.getByText('Flow setup complete')).toHaveClass('text-muted-foreground');
    const link = screen.getAllByRole('link', { name: /Notifications/ })[0]!;
    expect(link).not.toHaveTextContent('2');
  });

  it('prepends a notification the event stream delivers', async () => {
    serve([SETUP]);
    renderAt('/preview/notifications');
    await waitFor(() => expect(rows()).toHaveLength(1));

    fireFrame({ type: 'notification', notification: RUN, jobId: 'job-2' });

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(within(rows()[0]!).getByText('Flows ran, failures to review')).toBeInTheDocument();
    // The same frame twice is one row: the store's id is the identity.
    fireFrame({ type: 'notification', notification: RUN, jobId: 'job-2' });
    await waitFor(() => expect(rows()).toHaveLength(2));
  });

  it('ignores every other frame on the stream', async () => {
    serve([SETUP]);
    renderAt('/preview/notifications');
    await waitFor(() => expect(rows()).toHaveLength(1));

    fireFrame({ type: 'job.progress', job: { id: 'job-9' } });
    fireFrame({ type: 'context.changed', change: 'documents' });

    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it('shows an empty feed and throws nothing when there is no server', async () => {
    window.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof window.fetch;

    renderAt('/preview/notifications');

    expect(await screen.findByText('Nothing has happened yet.')).toBeInTheDocument();
  });

  it('opens no stream in a runtime that has none', async () => {
    delete (globalThis as { EventSource?: unknown }).EventSource;
    serve([SETUP]);
    renderAt('/preview/notifications');

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(streams).toEqual([]);
  });
});
