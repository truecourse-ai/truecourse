/**
 * The Activity surface, both levels.
 *
 * Level one is the runs index: one row per run carrying its status word, its
 * phase dots and the active phase's own counter, its session count and how
 * many of them wait on a person — narrowed by the kind and status chips.
 * Level two is the run as a conversation: the phase checklist and the session
 * index merged into one stream, the open phase expanded to its session lines,
 * a landed one compacted, a waiting session's question posted as a real
 * message out of its transcript, and a composer that is deliberately inert.
 *
 * The fixtures are store shapes: `PublicSessionRun` records as the sessions
 * route serializes them, and `SessionEvent`s as the transcript stores them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SessionEvent } from '@truecourse/agent-loop';

vi.mock('@/lib/socket', () => {
  const socket = {
    connected: false,
    on: () => socket,
    off: () => socket,
    emit: vi.fn(),
    connect: vi.fn(),
  };
  return { connectSocket: () => socket, getSocket: () => socket, disconnectSocket: vi.fn() };
});

import { SessionsActivityView } from '@/components/sessions/SessionsActivityView';
import { buildRunStream, progressSentence, runDuration } from '@/components/sessions/run-model';
import type { PublicSessionRun } from '@/lib/api';

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const spent = { turns: 0, tokens: 0, costUsd: 0 };

function session(over: Partial<PublicSessionRun['sessions'][number]> = {}): PublicSessionRun['sessions'][number] {
  return {
    sessionId: 'ses-1',
    kind: 'spec-scan.curate-doc',
    workItem: 'docs/getting-started.md',
    status: 'completed',
    spent: { ...spent },
    ...over,
  };
}

/** A live scan: discovery landed, curation is the open phase. */
function scan(over: Partial<PublicSessionRun> = {}): PublicSessionRun {
  return {
    command: 'spec-scan',
    runId: 'run-scan',
    gitRef: '4d80ec9a1b2c3d4e5f60718293a4b5c6d7e8f900',
    startedAt: '2026-08-25T14:32:00.000Z',
    status: 'running',
    progress: [
      { key: 'discover', label: 'Discovering docs', status: 'done', detail: '41 docs · 12 to curate' },
      { key: 'tag', label: 'Tagging doc areas', status: 'active', detail: '7/12 docs' },
      { key: 'overlap', label: 'Flagging overlaps', status: 'pending' },
      { key: 'verify', label: 'Verifying conflicts', status: 'pending' },
    ],
    sessions: [
      session({ sessionId: 'ses-scope', kind: 'spec-scan.orchestrate', workItem: 'scan scope' }),
      session({ sessionId: 'ses-kept', spent: { ...spent, turns: 4 } }),
      session({
        sessionId: 'ses-asks',
        workItem: 'docs/guides/booking.md',
        status: 'waiting',
        spent: { ...spent, turns: 3 },
      }),
    ],
    ...over,
  } as PublicSessionRun;
}

/** A settled setup run — a second kind, so the Kind chips have two options. */
function setup(over: Partial<PublicSessionRun> = {}): PublicSessionRun {
  return {
    command: 'guard-setup',
    runId: 'run-setup',
    gitRef: '9d20b410',
    startedAt: '2026-08-24T19:47:00.000Z',
    finishedAt: '2026-08-24T19:56:03.000Z',
    status: 'completed',
    progress: [{ key: 'recipe', label: 'Writing the recipe', status: 'done' }],
    sessions: [session({ sessionId: 'ses-setup', kind: 'guard-setup.map', workItem: 'journeys' })],
    ...over,
  } as PublicSessionRun;
}

const at = (n: number): string => new Date(Date.parse('2026-08-25T14:36:00.000Z') + n * 1000).toISOString();

/** The waiting session's transcript: an intro, then the open question. */
const askingTranscript: SessionEvent[] = [
  {
    seq: 0,
    ts: at(0),
    type: 'session-start',
    kind: 'spec-scan.curate-doc',
    workItem: 'docs/guides/booking.md',
    systemPrompt: 'MACHINERY',
    toolNames: [],
  },
  {
    seq: 1,
    ts: at(30),
    type: 'question-asked',
    question: {
      id: 'q1',
      header: 'Cancellation window',
      question: 'The guide says 24 hours, the API reference says 48. Which document wins?',
      options: [{ label: 'the guide' }, { label: 'the API reference' }],
      multiSelect: false,
    },
  },
] as SessionEvent[];

/** A completed session's transcript — what a session line expands into. */
const keptTranscript: SessionEvent[] = [
  {
    seq: 0,
    ts: at(0),
    type: 'session-start',
    kind: 'spec-scan.curate-doc',
    workItem: 'docs/getting-started.md',
    systemPrompt: 'MACHINERY',
    toolNames: [],
  },
] as SessionEvent[];

const realFetch = window.fetch;

function serve(runs: PublicSessionRun[], transcripts: Record<string, SessionEvent[]> = {}) {
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    if (pathname === '/api/repos/r1/sessions/runs') return json({ runs });
    const transcript = /\/transcript\/(.+)$/.exec(pathname);
    if (transcript) return json({ events: transcripts[decodeURIComponent(transcript[1])] ?? [] });
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/repos/r1${search}`]}>
      <SessionsActivityView repoId="r1" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  serve([]);
});

afterEach(() => {
  window.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// the model, on its own
// ---------------------------------------------------------------------------

describe('a run record as the stream reads it', () => {
  it('gives each phase its sessions and holds pending phases back as what comes next', () => {
    const { phases, next } = buildRunStream(scan());
    expect(phases.map((p) => p.key)).toEqual(['discover', 'tag']);
    expect(phases[0].sessions.map((s) => s.sessionId)).toEqual(['ses-scope']);
    // Curation and the vocabulary settlement are both the tagging phase's work.
    expect(phases[1].sessions.map((s) => s.sessionId)).toEqual(['ses-kept', 'ses-asks']);
    expect(next).toBe('Flagging overlaps');
  });

  it('still shows the work of a command the table does not know', () => {
    const { phases } = buildRunStream(
      setup({
        status: 'running',
        progress: [{ key: 'recipe', label: 'Writing the recipe', status: 'active' }],
        sessions: [
          session({ sessionId: 'a', kind: 'guard-setup.map', status: 'completed' }),
          session({ sessionId: 'b', kind: 'guard-setup.map', status: 'running' }),
        ],
      }),
    );
    // The checklist card carries no session lines, and the unmapped kind gets
    // its own card after it — nothing disappears for want of a mapping.
    expect(phases.map((p) => [p.key, p.label, p.detail, p.sessions.length])).toEqual([
      ['recipe', 'Writing the recipe', undefined, 0],
      ['kind:guard-setup.map', 'guard-setup.map', '1 of 2', 2],
    ]);
    expect(phases[1].status).toBe('active');
  });

  it('says what a run is doing, what broke, or how many phases it had', () => {
    expect(progressSentence(scan())).toBe('tagging doc areas · 7/12 docs');
    expect(progressSentence(setup())).toBe('1 phase');
    expect(progressSentence(scan({ status: 'interrupted' }))).toBe(
      'stopped at tagging doc areas · 7/12 docs',
    );
    const broken = scan({
      status: 'failed',
      progress: [{ key: 'tag', label: 'Tagging doc areas', status: 'error', detail: 'every session lost its transport' }],
    });
    expect(progressSentence(broken)).toBe('tagging doc areas failed · every session lost its transport');
  });

  it('takes a settled run from its own timestamps and leaves the undatable blank', () => {
    expect(runDuration(setup())).toBe('9m 03s');
    expect(runDuration(scan(), Date.parse('2026-08-25T14:38:12.000Z'))).toBe('6m 12s');
    expect(runDuration(scan({ startedAt: 'not-a-date' }))).toBe('');
  });
});

// ---------------------------------------------------------------------------
// level one — the runs index
// ---------------------------------------------------------------------------

describe('the runs index', () => {
  it('is one row per run, carrying its status, progress and sessions', async () => {
    serve([scan(), setup()]);
    renderAt('');

    const row = await screen.findByRole('button', { name: /Open spec scan run/ });
    expect(within(row).getByText('Running')).toBeInTheDocument();
    // The active phase's own counter, in words.
    expect(within(row).getByText('tagging doc areas · 7/12 docs')).toBeInTheDocument();
    // Three sessions, one of them holding a question.
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getByText('· 1 needs you')).toBeInTheDocument();
    // The ref is short and monospaced; the run's own 40-hex ref is not.
    expect(within(row).getByText('4d80ec9a')).toBeInTheDocument();

    const settled = screen.getByRole('button', { name: /Open guard setup run/ });
    expect(within(settled).getByText('Finished')).toBeInTheDocument();
    expect(within(settled).getByText('9m 03s')).toBeInTheDocument();
  });

  it('narrows by kind and by status, and offers no chip nothing matches', async () => {
    serve([scan(), setup()]);
    renderAt('');
    await screen.findByRole('button', { name: /Open spec scan run/ });

    const kind = screen.getByRole('group', { name: 'Filter runs by kind' });
    const status = screen.getByRole('group', { name: 'Filter runs by status' });
    // Only the two statuses these runs are in.
    expect(within(status).getByRole('button', { name: 'Running 1' })).toBeInTheDocument();
    expect(within(status).queryByRole('button', { name: /Failed/ })).toBeNull();
    expect(within(status).queryByRole('button', { name: /Interrupted/ })).toBeNull();

    await userEvent.click(within(kind).getByRole('button', { name: 'guard setup 1' }));
    expect(screen.queryByRole('button', { name: /Open spec scan run/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Open guard setup run/ })).toBeInTheDocument();

    await userEvent.click(within(kind).getByRole('button', { name: 'guard setup 1' }));
    await userEvent.click(within(status).getByRole('button', { name: 'Running 1' }));
    expect(screen.getByRole('button', { name: /Open spec scan run/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open guard setup run/ })).toBeNull();
  });

  it('keeps the empty state that names the command which fills it', async () => {
    serve([]);
    renderAt('');
    expect(
      await screen.findByText(/No agentic runs yet\. Start one with/),
    ).toBeInTheDocument();
  });

  it('opens a run when its row is clicked', async () => {
    serve([scan()]);
    renderAt('');
    await userEvent.click(await screen.findByRole('button', { name: /Open spec scan run/ }));
    expect(await screen.findByText(/spec scan ·/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activity' })).toBeInTheDocument();
  });

  it('says so when a deep link names a run this store does not have', async () => {
    serve([scan()]);
    renderAt('?run=nope');
    expect(await screen.findByText('The linked run is not in this store.')).toBeInTheDocument();
    // And the index is what renders — not somebody else's run.
    expect(screen.getByRole('button', { name: /Open spec scan run/ })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// level two — the run as a conversation
// ---------------------------------------------------------------------------

describe('a run as a conversation', () => {
  it('is phase cards: the open one expanded to its sessions, a landed one compact', async () => {
    serve([scan()], { 'ses-asks': askingTranscript });
    renderAt('?run=run-scan');

    // The open phase: its card carries its counter and one line per session.
    const open = await screen.findByRole('button', { name: /Tagging doc areas/ });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('7/12 docs')).toBeInTheDocument();
    expect(screen.getByText('docs/getting-started.md')).toBeInTheDocument();

    // The landed phase: header row only, until its chevron says otherwise.
    const done = screen.getByRole('button', { name: /Discovering docs/ });
    expect(done).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('scan scope')).toBeNull();
    await userEvent.click(done);
    expect(await screen.findByText('scan scope')).toBeInTheDocument();

    // Pending phases are not cards yet; the next one names itself.
    expect(screen.queryByRole('button', { name: /Verifying conflicts/ })).toBeNull();
    expect(screen.getByText('Next: Flagging overlaps')).toBeInTheDocument();
  });

  it('posts a waiting session’s question into the stream as a Needs-you message', async () => {
    serve([scan()], { 'ses-asks': askingTranscript });
    renderAt('?run=run-scan');

    // The text is the session's own — read out of its transcript, not written
    // for it.
    const bubble = await screen.findByRole('button', {
      name: /The guide says 24 hours, the API reference says 48/,
    });
    expect(within(bubble.parentElement!).getByText('Needs you')).toBeInTheDocument();
    expect(screen.getByText('1 question needs you')).toBeInTheDocument();

    // Clicking it opens that session's thread, where the machinery still
    // never shows.
    await userEvent.click(bubble);
    expect(await screen.findByText(/reading its docs side by side|I'm reading docs\/guides\/booking\.md/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('MACHINERY');
  });

  it('expands the session a ?ses= link names', async () => {
    serve([scan()], { 'ses-kept': keptTranscript });
    renderAt('?run=run-scan&ses=ses-kept');

    const line = await screen.findByRole('button', { name: /docs\/getting-started\.md/ });
    expect(line).toHaveAttribute('aria-expanded', 'true');
    expect(line).toHaveAttribute('aria-current', 'true');
    // The thread underneath is the transcript fold's own opening line.
    expect(
      await screen.findByText(/I'm reading docs\/getting-started\.md to decide whether it belongs/),
    ).toBeInTheDocument();
  });

  it('expands a session line in place, and closes it again', async () => {
    serve([scan()], { 'ses-kept': keptTranscript });
    renderAt('?run=run-scan');

    const line = await screen.findByRole('button', { name: /docs\/getting-started\.md/ });
    expect(line).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(line);
    expect(await screen.findByText(/I'm reading docs\/getting-started\.md/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /docs\/getting-started\.md/ }));
    await waitFor(() =>
      expect(screen.queryByText(/I'm reading docs\/getting-started\.md/)).toBeNull(),
    );
  });

  it('offers the composer, and refuses to pretend it can send', async () => {
    serve([scan()]);
    renderAt('?run=run-scan');

    const input = await screen.findByLabelText('Message this run');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('placeholder', 'Answer, or steer the run');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('changes the composer’s invitation once the run has settled', async () => {
    serve([setup()]);
    renderAt('?run=run-setup');
    const input = await screen.findByLabelText('Message this run');
    expect(input).toHaveAttribute('placeholder', 'Ask about this run, or start another');
  });

  it('goes back to the index', async () => {
    serve([scan()]);
    renderAt('?run=run-scan');
    await userEvent.click(await screen.findByRole('button', { name: 'Activity' }));
    expect(await screen.findByRole('group', { name: 'Filter runs by kind' })).toBeInTheDocument();
  });
});
