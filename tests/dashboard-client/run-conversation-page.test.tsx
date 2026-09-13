/**
 * The conversation as a page: the run's work as a list on the left (steps as
 * headings, one row per piece of work with its status dot and title), and the
 * selected work's transcript on the right, verbatim, with the history behind
 * it read by page from the selected session transcript.
 *
 * The run under test is the real guard setup of `spiderhands/expense-tracker`,
 * served from the fixture journal exactly as the route would page it. What is
 * held here is that the page shows the record and nothing else: the system
 * prompt, the briefing, every call's arguments, every result, the outcome
 * value, and none of the phrasing the old surface used to write.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SessionEvent } from '@truecourse/agent-loop';
import type { ActivityEvent } from '@truecourse/shared/activity-stream';

import { RunConversationPage } from '@/components/sessions/RunConversationPage';
import type { PublicSessionRun } from '@/lib/api';

const read = <T,>(name: string): T =>
  JSON.parse(readFileSync(path.join(process.cwd(), 'tests/fixtures/sessions', name), 'utf8')) as T;

const SETUP_RUN = read<PublicSessionRun>('guard-setup-run.json');
const SETUP_JOURNAL = read<ActivityEvent[]>('guard-setup-journal.json');

const RECIPE = SETUP_RUN.sessions[0].sessionId;
const recipeEvents = SETUP_JOURNAL.filter(
  (e): e is Extract<ActivityEvent, { kind: 'session-event' }> =>
    e.kind === 'session-event' && e.sessionId === RECIPE,
).map((e) => e.event);

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const realFetch = window.fetch;

/** The activity route, paged the way the client asks for it. */
function serve(journal: ActivityEvent[], pageSize = 1000) {
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    if (url.pathname.includes('/transcript/')) {
      const id = decodeURIComponent(url.pathname.split('/transcript/')[1]);
      let events = journal.filter((e): e is Extract<ActivityEvent, { kind: 'session-event' }> => e.kind === 'session-event' && e.sessionId === id).map(e => e.event);
      const since = url.searchParams.get('since'), before = url.searchParams.get('before');
      if (since !== null) events = events.filter(e => e.seq > Number(since));
      if (before !== null) events = events.filter(e => e.seq < Number(before));
      const limit = Math.min(pageSize, Number(url.searchParams.get('limit')));
      return json({ events: since === null ? events.slice(-limit) : events.slice(0, limit), hasMore: events.length > limit });
    }
    throw new Error(`Unexpected request ${href}`);
  }) as unknown as typeof window.fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Whether some element under `root` carries EXACTLY this text. `getByText`
 * collapses whitespace, and every one of these is a multi-line record whose
 * line breaks are the point.
 */
function verbatim(root: HTMLElement, text: string): boolean {
  return [...root.querySelectorAll('pre, p, span')].some((el) => el.textContent === text);
}

/**
 * How many times a fact is on the page: a `label: value` fact is set as a
 * term and its definition, a plain sentence as one definition.
 */
function factCount(text: string): number {
  const sentences = [...document.querySelectorAll('dd')].filter((dd) => dd.textContent === text).length;
  const pairs = [...document.querySelectorAll('dt')].filter(
    (dt) => `${dt.textContent}: ${dt.nextElementSibling?.textContent}` === text,
  ).length;
  return sentences + pairs;
}

/**
 * A run in flight, with the clocks the record carries: one step being worked
 * on, one piece of work still going and one that ended.
 */
const LIVE_RUN = {
  command: 'guard-generate',
  runId: 'run-live-clock',
  gitRef: 'abc1234',
  startedAt: '2026-09-11T10:00:00.000Z',
  status: 'running',
  activityStream: 'ai-sdk-v1',
  display: {
    blocks: [
      {
        kind: 'checklist',
        items: [
          { key: 'extract', label: 'Extracting claims', status: 'done', startedAt: '2026-09-11T10:00:10.000Z', endedAt: '2026-09-11T10:00:20.000Z' },
          { key: 'match', label: 'Matching flows', status: 'active', detail: '46/85 flow×surface', startedAt: '2026-09-11T10:00:30.000Z',
            sessionKinds: ['guard-generate.flow-worker'] },
        ],
      },
    ],
  },
  sessions: [
    { sessionId: 'ses-run', kind: 'guard-generate.flow-worker', workItem: 'flow:create-an-expense:api', status: 'running',
      startedAt: '2026-09-11T10:00:40.000Z', spent: { turns: 1, tokens: 10, costUsd: 0 } },
    { sessionId: 'ses-done', kind: 'guard-generate.flow-worker', workItem: 'flow:list-expenses:api', status: 'completed',
      startedAt: '2026-09-11T10:00:10.000Z', endedAt: '2026-09-11T10:01:42.000Z', spent: { turns: 4, tokens: 90, costUsd: 0 } },
    // Stopped with the machine that ran it: it never recorded an end.
    { sessionId: 'ses-lost', kind: 'guard-generate.flow-worker', workItem: 'flow:pay-an-invoice:api', status: 'parked',
      startedAt: '2026-09-11T10:00:20.000Z', spent: { turns: 2, tokens: 20, costUsd: 0 } },
  ],
} as unknown as PublicSessionRun;

function renderPage(run: PublicSessionRun) {
  return render(
    <MemoryRouter>
      <RunConversationPage run={run} repoId="r1" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  serve([]);
});

afterEach(() => {
  window.fetch = realFetch;
  vi.restoreAllMocks();
});

/** The row of a piece of work, by its title. */
const row = (name: RegExp | string) => screen.getByRole('button', { name, pressed: false });
const pane = () => screen.getByRole('complementary', { name: 'Work' });
const rx = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

describe('one conversation, as a page', () => {
  it('fetches only the opened agent and aborts its pending download when closed', async () => {
    let signal: AbortSignal | undefined;
    let requested: URL | undefined;
    window.fetch = vi.fn((input, init) => {
      requested = new URL(String(input), window.location.origin);
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }) as typeof window.fetch;
    const view = renderPage(SETUP_RUN);
    expect(window.fetch).not.toHaveBeenCalled();
    await userEvent.click(row(rx(SETUP_RUN.sessions[0].workItem)));
    await waitFor(() => expect(requested?.pathname).toContain(`/transcript/${RECIPE}`));
    expect(requested?.searchParams.get('limit')).toBe('100');
    expect(signal?.aborted).toBe(false);
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await Promise.resolve();
    expect(window.fetch).toHaveBeenCalledTimes(1);
  });

  it('ignores a late response from the previously selected agent', async () => {
    let release!: (response: Response) => void;
    let previousSignal: AbortSignal | null | undefined;
    window.fetch = vi.fn(async (input, init) => {
      if (String(input).includes(`/transcript/${RECIPE}?`)) {
        previousSignal = init?.signal;
        return new Promise<Response>(resolve => { release = resolve; });
      }
      return json({ events: [{ type: 'user-message', seq: 0, ts: new Date().toISOString(), content: 'Selected agent message' }], hasMore: false });
    }) as typeof window.fetch;
    renderPage(SETUP_RUN);
    await userEvent.click(row(rx(SETUP_RUN.sessions[0].workItem)));
    await userEvent.click(row(rx(SETUP_RUN.sessions[1].workItem)));
    expect(previousSignal?.aborted).toBe(true);
    await screen.findByText('Selected agent message');
    await act(async () => { release(json({ events: [{ type: 'user-message', seq: 0, ts: new Date().toISOString(), content: 'Stale agent message' }], hasMore: false })); });
    expect(screen.queryByText('Stale agent message')).toBeNull();
    expect(screen.getByText('Selected agent message')).toBeInTheDocument();
  });

  it('lists the run’s steps in order, each with the work that happened under it as rows', async () => {
    serve(SETUP_JOURNAL);
    renderPage(SETUP_RUN);

    await screen.findByRole('heading', { level: 2, name: /Deriving the recipe/ });
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      'Preparing repository',
      'Deriving the recipe',
      'Detecting dependencies',
      'Cataloguing dependencies',
      'Authoring the interface catalog',
      'Preparing data + principals',
      'Verifying private starting states',
      'Verifying supplied auth',
    ]);
    expect(
      screen.getByText('wrote .truecourse/scenarios/recipe.json (llm) · default /api/expenses → 200'),
    ).toBeInTheDocument();

    // One row per piece of work, titled by the work item the run indexed it
    // under; no kind id, no status word, no tokens or cost; no transcript
    // until opened.
    const rows = screen.getAllByRole('button', { pressed: false });
    expect(rows).toHaveLength(SETUP_RUN.sessions.length);
    expect(rows.map((r) => r.textContent)).toEqual(
      SETUP_RUN.sessions.map((session) => expect.stringContaining(session.workItem)),
    );
    expect(screen.queryByText('guard-setup.recipe-repair')).toBeNull();
    expect(screen.queryByText('completed')).toBeNull();
    expect(screen.queryByText(/tokens/)).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Work' })).toBeNull();
    expect(document.querySelectorAll('[title]')).toHaveLength(0);
  });

  it('opens a piece of work beside the list, with the system prompt, the briefing and every turn as they were recorded', async () => {
    serve(SETUP_JOURNAL);
    renderPage(SETUP_RUN);
    await screen.findByRole('heading', { level: 2, name: /Deriving the recipe/ });

    const briefing = recipeEvents[1] as Extract<SessionEvent, { type: 'user-message' }>;
    await userEvent.click(row(rx(SETUP_RUN.sessions[0].workItem)));
    const el = pane();
    const work = within(el);
    // The row is the pressed one, and the address remembers it.
    expect(screen.getByRole('button', { pressed: true })).toHaveTextContent(SETUP_RUN.sessions[0].workItem);
    const asParagraphs = (text: string) =>
      [...el.querySelectorAll('div')].some((d) => [...d.children].every((c) => c.tagName === 'P') && d.textContent === text.replace(/\n{2,}/g, ''));

    // The system prompt starts folded to its first line; opened, it is whole.
    const start = recipeEvents[0] as Extract<SessionEvent, { type: 'session-start' }>;
    expect(asParagraphs(start.systemPrompt)).toBe(false);
    await userEvent.click(work.getByRole('button', { name: rx(start.systemPrompt.split('\n')[0].slice(0, 40)) }));
    expect(asParagraphs(start.systemPrompt)).toBe(true);
    // No role labels, no model, no cost, no icons.
    expect(work.queryByText('system')).toBeNull();
    expect(work.queryByText('user')).toBeNull();
    expect(work.queryByText('assistant')).toBeNull();
    expect(work.queryByText(start.llm!.model)).toBeNull();
    expect(el.querySelectorAll('svg')).toHaveLength(1); // the close
    // No hardcoded narration: the engine's opening line, its phrases, its notes.
    expect(work.queryByText(/^I'm repairing/)).toBeNull();

    // The briefing: its first line and the rest on a click.
    expect(asParagraphs(briefing.content)).toBe(false);
    await userEvent.click(work.getByRole('button', { name: rx(briefing.content.split('\n')[0].slice(0, 30)) }));
    expect(asParagraphs(briefing.content)).toBe(true);

    // A call and its result are one mono line: the name, the arguments and
    // the result's first line; opened in place, the arguments as JSON and the result whole.
    const call = recipeEvents[2] as Extract<SessionEvent, { type: 'assistant-turn' }>;
    const result = recipeEvents[3] as Extract<SessionEvent, { type: 'tool-result' }>;
    const [exchange] = work.getAllByRole('button', { name: `${call.toolCall!.name} call` });
    expect(verbatim(el, JSON.stringify(call.toolCall!.args, null, 2))).toBe(false);
    expect(verbatim(el, result.content)).toBe(false);
    await userEvent.click(exchange);
    expect(verbatim(el, JSON.stringify(call.toolCall!.args, null, 2))).toBe(true);
    expect(verbatim(el, result.content)).toBe(true);

    // The outcome value: one compact line, the pretty JSON on a click. The
    // reserved outcome tool call carries the same value, so it is not a row.
    const outcome = recipeEvents.at(-1) as Extract<SessionEvent, { type: 'outcome' }>;
    const prettyOutcome = JSON.stringify(outcome.value, null, 2);
    expect(verbatim(el, prettyOutcome)).toBe(false);
    await userEvent.click(work.getByRole('button', { name: 'outcome' }));
    expect(verbatim(el, prettyOutcome)).toBe(true);
    expect(work.getAllByRole('button', { name: 'outcome' })).toHaveLength(1);

    // Close returns to the list alone.
    await userEvent.click(work.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary', { name: 'Work' })).toBeNull();
  });

  it('shows a loop intervention as a message of its own', async () => {
    const events: ActivityEvent[] = [
      {
        cursor: 0,
        kind: 'session-event',
        sessionId: 'ses-a',
        event: {
          type: 'session-start',
          seq: 0,
          ts: '2026-09-09T10:00:00.000Z',
          kind: 'guard-setup.preparations',
          workItem: 'preparations',
          systemPrompt: 'You verify.',
          toolNames: [],
        },
      },
      {
        cursor: 1,
        kind: 'session-event',
        sessionId: 'ses-a',
        event: { type: 'user-message', seq: 1, ts: '2026-09-09T10:00:01.000Z', content: 'You author the ONE preparation script.' },
      },
      {
        cursor: 2,
        kind: 'session-event',
        sessionId: 'ses-a',
        event: { type: 'user-message', seq: 2, ts: '2026-09-09T10:00:02.000Z', content: '[budget] 2 turns left before I stop you.' },
      },
    ];
    serve(events);
    renderPage({
      command: 'guard-setup',
      runId: 'run-live',
      gitRef: 'abc1234',
      startedAt: '2026-09-09T10:00:00.000Z',
      status: 'running',
      activityStream: 'ai-sdk-v1',
      sessions: [
        {
          sessionId: 'ses-a',
          kind: 'guard-setup.preparations',
          workItem: 'preparations',
          status: 'running',
          spent: { turns: 1, tokens: 10, costUsd: 0 },
        },
      ],
    } as PublicSessionRun);

    await userEvent.click(await screen.findByRole('button', { name: /^preparations/ }));
    const work = within(pane());
    expect(work.getByText('[budget] 2 turns left before I stop you.')).toBeInTheDocument();
    expect(work.getByText('You author the ONE preparation script.')).toBeInTheDocument();
  });

  it('says a step’s detail once when one of its facts already restates it', async () => {
    serve([]);
    renderPage({
      command: 'guard-setup',
      runId: 'run-facts',
      gitRef: 'abc1234',
      startedAt: '2026-09-10T10:00:00.000Z',
      status: 'completed',
      activityStream: 'ai-sdk-v1',
      display: {
        blocks: [
          {
            kind: 'checklist',
            items: [
              {
                key: 'seed',
                label: 'Preparing data + principals',
                status: 'done',
                detail: 'the recipe has no `api` block',
                facts: ['seed refused: the recipe has no `api` block'],
              },
              {
                key: 'auth',
                label: 'Verifying supplied auth',
                status: 'done',
                detail: 'nothing to verify',
                facts: ['nothing to verify'],
              },
              {
                key: 'detect',
                label: 'Detecting dependencies',
                status: 'done',
                detail: '0 external services · no database',
                facts: ['nothing detected: no external service, no database, no datastore url'],
              },
            ],
          },
        ],
      },
      sessions: [],
    } as unknown as PublicSessionRun);

    await screen.findByRole('heading', { level: 2, name: /Verifying supplied auth/ });
    expect(screen.getAllByText(/the recipe has no `api` block/)).toHaveLength(1);
    expect(factCount('seed refused: the recipe has no `api` block')).toBe(1);
    expect(screen.getAllByText('nothing to verify')).toHaveLength(1);
    expect(screen.getByText('0 external services · no database')).toBeInTheDocument();
    expect(factCount('nothing detected: no external service, no database, no datastore url')).toBe(1);
  });

  it('puts the run’s reason under the step it stopped on, once', async () => {
    serve([]);
    const reason = '1 open spec conflict must be resolved before guard generate.';
    renderPage({
      command: 'guard-generate',
      runId: 'run-stopped',
      gitRef: 'abc1234',
      startedAt: '2026-09-10T10:00:00.000Z',
      status: 'failed',
      activityStream: 'ai-sdk-v1',
      error: { message: reason, kind: 'open-conflicts' },
      display: {
        blocks: [
          {
            kind: 'checklist',
            items: [
              { key: 'clone', label: 'Preparing repository', status: 'done', facts: ['cloned acme/app at abc1234'] },
              { key: 'index', label: 'Indexing sections', status: 'error', detail: reason, facts: [`stopped: ${reason}`] },
              { key: 'extract', label: 'Extracting claims', status: 'pending' },
            ],
          },
        ],
      },
      sessions: [],
    } as unknown as PublicSessionRun);

    const heading = await screen.findByRole('heading', { level: 2, name: /Indexing sections/ });
    // Said once, by the step's own fact: neither the detail nor the record's
    // reason repeats it, and nothing sits above the first step.
    expect(factCount(`stopped: ${reason}`)).toBe(1);
    const line = screen.getByText(reason);
    expect(screen.getAllByText(/1 open spec conflict must be resolved/)).toHaveLength(1);
    expect(heading.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const next = screen.getByRole('heading', { level: 2, name: /Extracting claims/ });
    expect(line.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the lines of a reason the step does not say itself', async () => {
    serve([]);
    const reason = 'the build failed\n  npm run build exited 1';
    renderPage({
      command: 'guard-generate',
      runId: 'run-build',
      gitRef: 'abc1234',
      startedAt: '2026-09-10T10:00:00.000Z',
      status: 'failed',
      activityStream: 'ai-sdk-v1',
      error: { message: reason },
      display: {
        blocks: [
          {
            kind: 'checklist',
            items: [{ key: 'build', label: 'Building', status: 'error', detail: 'the build failed' }],
          },
        ],
      },
      sessions: [],
    } as unknown as PublicSessionRun);

    await screen.findByRole('heading', { level: 2, name: /Building/ });
    expect(verbatim(document.body, reason)).toBe(true);
    // The detail is the reason's first line: the reason says it.
    expect(screen.queryByText('the build failed')).toBeNull();
  });

  it('is the error and nothing else when a gate stopped the work', async () => {
    serve([]);
    renderPage({
      command: 'guard-generate',
      runId: 'run-blocked',
      gitRef: 'abc1234',
      startedAt: '2026-09-09T10:00:00.000Z',
      status: 'failed',
      activityStream: 'ai-sdk-v1',
      error: { message: '56 open spec conflicts must be resolved before guard generate' },
      sessions: [],
    } as PublicSessionRun);

    expect(
      await screen.findByText('56 open spec conflicts must be resolved before guard generate'),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
  });

  it('renders the summary without fetching transcripts and loads older messages only on request', async () => {
    serve(SETUP_JOURNAL, 10);
    renderPage(SETUP_RUN);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(8);
    expect(window.fetch).not.toHaveBeenCalled();
    await userEvent.click(row(rx(SETUP_RUN.sessions[0].workItem)));
    await screen.findByRole('button', { name: 'Load older messages' });
    expect(window.fetch).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Load older messages' }));
    await waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(2));
    expect(String(vi.mocked(window.fetch).mock.calls[1][0])).toContain('before=');
    await userEvent.click(row(rx(SETUP_RUN.sessions[1].workItem)));
    await waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(3));
    expect(String(vi.mocked(window.fetch).mock.calls[2][0])).toContain(`/transcript/${SETUP_RUN.sessions[1].sessionId}`);
  });

  it('fetches only new events for the opened live agent', async () => {
    const live = { ...SETUP_RUN, status: 'running', finishedAt: undefined, sessions: SETUP_RUN.sessions.map(s => s.sessionId === RECIPE ? { ...s, status: 'running' } : s) } as PublicSessionRun;
    const history = [...SETUP_JOURNAL];
    serve(history);
    const view = renderPage(live);
    await userEvent.click(row(rx(SETUP_RUN.sessions[0].workItem)));
    await waitFor(() => expect(window.fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Loading messages…')).toBeNull());
    vi.useFakeTimers();
    try {
      history.push({ cursor: 9999, kind: 'session-event', sessionId: RECIPE,
        event: { type: 'user-message', seq: 9999, ts: '2026-09-09T16:31:00.000Z', content: 'A newly recorded message' } });
      // The first timer was created before fake timers; trigger after mounting afresh.
      view.unmount();
      const fresh = render(<MemoryRouter initialEntries={[`/?work=${RECIPE}`]}><RunConversationPage run={live} repoId="r1" /></MemoryRouter>);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(String(vi.mocked(window.fetch).mock.calls.at(-1)![0])).toContain('since=9999');
      expect(within(pane()).getAllByText('A newly recorded message')).toHaveLength(1);
      fresh.unmount();
    } finally { vi.useRealTimers(); }
  });

  it('shows how long every piece of work has taken, and keeps counting the ones still going', async () => {
    serve([]);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-11T10:01:00.000Z'));
      renderPage(LIVE_RUN);
      const running = screen.getByRole('button', { name: /^flow:create-an-expense:api/ });
      const done = screen.getByRole('button', { name: /^flow:list-expenses:api/ });
      // Nothing is open: every row carries its own elapsed all the same.
      expect(screen.queryByRole('complementary', { name: 'Work' })).toBeNull();
      expect(within(running).getByText('20s')).toBeInTheDocument();
      expect(within(done).getByText('1m 32s')).toBeInTheDocument();

      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(within(running).getByText('21s')).toBeInTheDocument();
      expect(within(done).getByText('1m 32s')).toBeInTheDocument();

      // Work that stopped without recording its end says nothing rather than
      // counting on against a clock it left long ago.
      const lost = screen.getByRole('button', { name: /^flow:pay-an-invoice:api/ });
      expect(lost.textContent).toBe('flow:pay-an-invoice:apiflow-worker');
    } finally { vi.useRealTimers(); }
  });

  it('shows the step being worked on as working: a pulsing dot and its own elapsed', async () => {
    serve([]);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-11T10:01:00.000Z'));
      renderPage(LIVE_RUN);
      const heading = screen.getByRole('heading', { level: 2, name: /Matching flows/ });
      expect(heading.querySelector('[aria-hidden]')?.className).toContain('animate-pulse');
      expect(within(heading).getByText('30s')).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(within(heading).getByText('31s')).toBeInTheDocument();

      // A step that has ended keeps the time it took, and stops pulsing.
      const settled = screen.getByRole('heading', { level: 2, name: /Extracting claims/ });
      expect(settled.querySelector('[aria-hidden]')?.className).not.toContain('animate-pulse');
      expect(within(settled).getByText('10s')).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it('folds a prompt that arrived as one very long line', async () => {
    const blob = JSON.stringify({ instruction: 'Author the scenarios of this flow.', flow: 'x'.repeat(400) });
    serve([
      { cursor: 0, kind: 'session-event', sessionId: 'ses-run',
        event: { type: 'session-start', seq: 0, ts: '2026-09-11T10:00:40.000Z', kind: 'guard-generate.flow-worker', workItem: 'flow:create-an-expense:api', systemPrompt: 'S', toolNames: [] } },
      { cursor: 1, kind: 'session-event', sessionId: 'ses-run',
        event: { type: 'user-message', seq: 1, ts: '2026-09-11T10:00:41.000Z', content: blob } },
    ] as ActivityEvent[]);
    renderPage(LIVE_RUN);
    await userEvent.click(screen.getByRole('button', { name: /^flow:create-an-expense:api/ }));
    const work = within(pane());
    // A text with no line breaks is measured in characters; folded to its
    // first lines until it is opened, exactly as a many-line one.
    await work.findByText(`${blob.length} characters`);
    const asParagraph = (): boolean =>
      [...pane().querySelectorAll('p')].some((p) => p.textContent === blob);
    expect(asParagraph()).toBe(false);
    expect(pane().querySelector('.line-clamp-3')?.textContent).toBe(blob);
    await userEvent.click(work.getByRole('button', { name: rx(blob.slice(0, 30)) }));
    expect(asParagraph()).toBe(true);
  });

  it('shows a selected transcript error without downloading other agents', async () => {
    window.fetch = vi.fn(async () => json({ error: 'Transcript unavailable' }, 500)) as typeof window.fetch;
    renderPage(SETUP_RUN);
    await userEvent.click(row(rx(SETUP_RUN.sessions[0].workItem)));
    expect(await screen.findByText(/Transcript unavailable/)).toBeInTheDocument();
    expect(window.fetch).toHaveBeenCalledTimes(1);
  });

});

describe('the words the page is allowed to use', () => {
  it('has none of the narration the surface used to write', () => {
    const dir = path.join(process.cwd(), 'apps/dashboard/client/src/components/sessions');
    const source = readdirSync(dir)
      .map((name) => readFileSync(path.join(dir, name), 'utf8'))
      .join('\n');
    for (const phrase of ['I ran', "I'm getting started", 'All done here', 'Briefing', 'Still working']) {
      expect(source).not.toContain(phrase);
    }
    // And the vocabulary tables are gone with it.
    expect(readdirSync(dir).sort()).toEqual([
      'RunConversationPage.tsx',
      'conversation-model.ts',
      'conversation-pieces.tsx',
      'run-model.ts',
      'useRunConversation.ts',
    ]);
  });
});
