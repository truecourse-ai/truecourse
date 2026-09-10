/**
 * The conversation as a page: the transcript itself, verbatim, under the run's
 * steps, with the outline on the left and the history behind it read by page
 * off the activity route.
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

describe('one conversation, as a page', () => {
  it('is the run’s steps in order, each holding the work that happened under it', async () => {
    serve(SETUP_JOURNAL);
    renderPage(SETUP_RUN);

    await screen.findByRole('heading', { level: 2, name: /Deriving the recipe/ });
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.children[1].textContent)).toEqual([
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

    // One paragraph per piece of work, with no header of its own: no kind id,
    // no work item, no status word once it is finished, no tokens or cost.
    const paragraphs = [...document.querySelectorAll('section[id]')];
    expect(paragraphs.map((p) => p.id)).toEqual(SETUP_RUN.sessions.map((s) => s.sessionId));
    const recipe = within(paragraphs[0] as HTMLElement);
    expect(recipe.queryByText('guard-setup.recipe-repair')).toBeNull();
    expect(recipe.queryByText('completed')).toBeNull();
    expect(recipe.queryByText(/tokens/)).toBeNull();
    expect(document.querySelectorAll('[title]')).toHaveLength(0);
  });

  it('shows the system prompt, the briefing and every turn as they were recorded', async () => {
    serve(SETUP_JOURNAL);
    renderPage(SETUP_RUN);
    await screen.findByRole('heading', { level: 2, name: /Deriving the recipe/ });
    const el = document.getElementById(RECIPE)!;
    const recipe = within(el);
    const rx = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    // Every character of a text is on the page, set as paragraphs.
    const asParagraphs = (text: string) =>
      [...el.querySelectorAll('div')].some((d) => [...d.children].every((c) => c.tagName === 'P') && d.textContent === text.replace(/\n{2,}/g, ''));

    // The system prompt starts folded to its first line; opened, it is whole.
    const start = recipeEvents[0] as Extract<SessionEvent, { type: 'session-start' }>;
    expect(asParagraphs(start.systemPrompt)).toBe(false);
    await userEvent.click(recipe.getByRole('button', { name: rx(start.systemPrompt.split('\n')[0].slice(0, 40)) }));
    expect(asParagraphs(start.systemPrompt)).toBe(true);
    // No role labels, no model, no cost, no icons.
    expect(recipe.queryByText('system')).toBeNull();
    expect(recipe.queryByText('user')).toBeNull();
    expect(recipe.queryByText('assistant')).toBeNull();
    expect(recipe.queryByText(start.llm!.model)).toBeNull();
    expect(el.querySelectorAll('svg')).toHaveLength(0);

    // The briefing: its first line and the rest on a click, like every long text.
    const briefing = recipeEvents[1] as Extract<SessionEvent, { type: 'user-message' }>;
    expect(asParagraphs(briefing.content)).toBe(false);
    await userEvent.click(recipe.getByRole('button', { name: rx(briefing.content.split('\n')[0].slice(0, 30)) }));
    expect(asParagraphs(briefing.content)).toBe(true);

    // A call and its result are one mono line: the name, the arguments and
    // the result's first line; opened in place, the arguments as JSON and the result whole.
    const call = recipeEvents[2] as Extract<SessionEvent, { type: 'assistant-turn' }>;
    const result = recipeEvents[3] as Extract<SessionEvent, { type: 'tool-result' }>;
    const [exchange] = recipe.getAllByRole('button', { name: `${call.toolCall!.name} call` });
    expect(verbatim(el, JSON.stringify(call.toolCall!.args, null, 2))).toBe(false);
    expect(verbatim(el, result.content)).toBe(false);
    await userEvent.click(exchange);
    expect(verbatim(el, JSON.stringify(call.toolCall!.args, null, 2))).toBe(true);
    expect(verbatim(el, result.content)).toBe(true);

    // The outcome value: one compact line, the pretty JSON on a click.
    const outcome = recipeEvents.at(-1) as Extract<SessionEvent, { type: 'outcome' }>;
    const prettyOutcome = JSON.stringify(outcome.value, null, 2);
    expect(verbatim(el, prettyOutcome)).toBe(false);
    await userEvent.click(recipe.getByRole('button', { name: 'outcome' }));
    expect(verbatim(el, prettyOutcome)).toBe(true);
    // The reserved outcome tool call carries the same value, so it is not a row of its own.
    expect(recipe.getAllByRole('button', { name: 'outcome' })).toHaveLength(1);
  });

  it('shows a loop intervention as a user message of its own', async () => {
    const events: ActivityEvent[] = [
      {
        cursor: 0,
        kind: 'session-event',
        sessionId: 'ses-a',
        event: {
          type: 'session-start',
          kind: 'guard-setup.seed',
          workItem: 'seed',
          systemPrompt: 'You author the ONE preparation script.',
          toolNames: ['read_file'],
          seq: 0,
          ts: '2026-09-09T10:00:00.000Z',
        },
      },
      {
        cursor: 1,
        kind: 'session-event',
        sessionId: 'ses-a',
        event: {
          type: 'user-message',
          content: '[budget] 2 turns left before I stop you.',
          seq: 1,
          ts: '2026-09-09T10:00:01.000Z',
        },
      },
    ] as ActivityEvent[];
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
          kind: 'guard-setup.seed',
          workItem: 'seed',
          status: 'running',
          spent: { turns: 1, tokens: 10, costUsd: 0 },
        },
      ],
    } as PublicSessionRun);

    expect(await screen.findByText('[budget] 2 turns left before I stop you.')).toBeInTheDocument();
    expect(screen.getByText('You author the ONE preparation script.')).toBeInTheDocument();
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
    expect(screen.queryByRole('navigation', { name: 'Outline' })).toBeNull();
  });

  it('waits for the whole history, then paints it at its end', async () => {
    serve(SETUP_JOURNAL, 20);
    const jump = vi.fn();
    Element.prototype.scrollIntoView = jump as unknown as Element['scrollIntoView'];
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo');
    renderPage(SETUP_RUN);

    // Nothing half-read is painted: the outline appears with the whole of it.
    expect(screen.queryByRole('navigation', { name: 'Outline' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Reading the conversation…');

    const outline = await screen.findByRole('navigation', { name: 'Outline' });
    expect(within(outline).getAllByRole('button')).toHaveLength(8);
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());

    // And the outline jumps to any step.
    await userEvent.click(within(outline).getByRole('button', { name: /Preparing data \+ principals/ }));
    expect(jump).toHaveBeenCalled();
  });

  it('reads the history in pages, then tails what is still happening', async () => {
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

    sink.enqueue({ type: 'start', messageId: live.runId });
    // A partial turn stands as the live line until its finished form lands.
    sink.enqueue({
      type: 'data-progress',
      transient: true,
      data: { [RECIPE]: { kind: 'text', turnId: 'm1', text: 'Reading the recipe live' } },
    });
    await screen.findByText('Reading the recipe live');

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
    expect(await screen.findByText('The recipe boots cleanly now.')).toBeInTheDocument();
    expect(screen.getAllByText('The recipe boots cleanly now.')).toHaveLength(1);
    expect(screen.queryByText('Reading the recipe live')).toBeNull();

    sink.enqueue({ type: 'finish', finishReason: 'stop' });
    sink.close();
    view.unmount();
  });

  it('says the connection dropped at the bottom, never as a strip on top', async () => {
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
