/**
 * The conversation as a page: the run's work as a list on the left (steps as
 * headings, one row per piece of work with its status dot and title), and the
 * selected work's transcript on the right, verbatim, with the history behind
 * it read by page off the activity route.
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
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { createUIMessageStreamResponse, type UIMessageChunk } from 'ai';
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
    if (url.pathname.endsWith('/activity')) {
      const after = Number(url.searchParams.get('after'));
      const rest = journal.filter((e) => e.cursor > after);
      const events = rest.slice(0, pageSize);
      const last = events[events.length - 1];
      return json({ events, nextCursor: last ? last.cursor : after, done: rest.length <= pageSize });
    }
    return json({ error: 'not found' }, 404);
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

  it('waits for the whole history, then paints it', async () => {
    serve(SETUP_JOURNAL, 20);
    renderPage(SETUP_RUN);

    // Nothing half-read is painted: the list appears with the whole of it.
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('Reading the conversation…');
    await screen.findByRole('heading', { level: 2, name: /Deriving the recipe/ });
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(8);
  });

  it('reads the history in pages, then tails what is still happening into the open work', async () => {
    const live: PublicSessionRun = {
      ...SETUP_RUN,
      status: 'running',
      finishedAt: undefined,
      sessions: [{ ...SETUP_RUN.sessions[0], status: 'running' }],
    } as PublicSessionRun;
    // No record snapshots: this one is still going, and the journal's would say
    // otherwise.
    const history = SETUP_JOURNAL.filter(
      (e) => e.kind === 'session-event' && e.sessionId === RECIPE,
    );
    serve(history, 20);
    const paged = window.fetch;

    let sink!: ReadableStreamDefaultController<UIMessageChunk>;
    const stream = new ReadableStream<UIMessageChunk>({ start: (c) => (sink = c) });
    window.fetch = vi.fn(async (input, init) => {
      if (String(input).includes('/stream?')) return createUIMessageStreamResponse({ stream });
      return paged(input, init);
    }) as unknown as typeof window.fetch;

    const view = renderPage(live);
    await screen.findByRole('heading', { level: 2, name: /Deriving the recipe/ });
    const last = history[history.length - 1].cursor;
    await waitFor(() =>
      expect(window.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/stream?after=${last}`),
        expect.objectContaining({ method: 'GET' }),
      ),
    );
    expect(paged).toHaveBeenCalledTimes(Math.ceil(history.length / 20));

    // The running piece of work wears the pulsing dot in the list.
    const [running] = screen.getAllByRole('button', { pressed: false });
    expect(running.querySelector('.animate-pulse')).not.toBeNull();
    await userEvent.click(running);
    const work = within(pane());

    sink.enqueue({ type: 'start', messageId: live.runId });
    // A partial turn stands as the live line until its finished form lands.
    sink.enqueue({
      type: 'data-progress',
      transient: true,
      data: { [RECIPE]: { kind: 'text', turnId: 'm1', text: 'Reading the recipe live' } },
    });
    await work.findByText('Reading the recipe live');

    sink.enqueue({
      type: 'data-activity',
      id: 'live-1',
      data: {
        kind: 'session-event',
        cursor: last + 1,
        sessionId: RECIPE,
        event: {
          type: 'assistant-turn',
          seq: 9999,
          ts: '2026-09-09T16:31:00.000Z',
          text: 'The recipe boots cleanly now.',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheCreateTokens: 0,
            costUsd: 0,
            costSource: 'unpriced',
          },
        },
      },
    });
    expect(await work.findByText('The recipe boots cleanly now.')).toBeInTheDocument();
    expect(work.getAllByText('The recipe boots cleanly now.')).toHaveLength(1);
    expect(work.queryByText('Reading the recipe live')).toBeNull();

    sink.enqueue({ type: 'finish', finishReason: 'stop' });
    sink.close();
    view.unmount();
  });

  it('says the connection dropped at the bottom of the list, never as a strip on top', async () => {
    const live = { ...SETUP_RUN, status: 'running', finishedAt: undefined } as PublicSessionRun;
    serve(SETUP_JOURNAL);
    const paged = window.fetch;
    window.fetch = vi.fn(async (input, init) => {
      if (String(input).includes('/stream?')) return json({ error: 'gone' }, 403);
      return paged(input, init);
    }) as unknown as typeof window.fetch;

    const view = renderPage(live);
    const notice = await screen.findByText(/Activity access was denied/);
    expect(notice).toHaveAttribute('role', 'status');
    view.unmount();
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
