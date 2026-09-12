/**
 * The fold from a run record plus its activity journal to the conversation.
 *
 * The rule under test is that NOTHING IS INVENTED: every line carries the
 * event's own fields, whole, in `seq` order. The fold only orders and groups.
 *
 * The main fixture is REAL: the guard setup of `spiderhands/expense-tracker`
 * as the store holds it (long strings trimmed, driver wire payloads dropped;
 * nothing else touched). The hand-built cases cover what that run has no
 * example of: a failure, a worker, a loop intervention, a kind no step claims.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import type { SessionEvent } from '@truecourse/agent-loop';
import { compactRunSnapshots, type ActivityEvent } from '@truecourse/shared/activity-stream';
import { foldConversation, latestRunRecord } from '@/components/sessions/conversation-model';
import type { ConversationLine } from '@/components/sessions/conversation-model';
import type { PublicSessionRun } from '@/lib/api';

const read = <T,>(name: string): T =>
  JSON.parse(readFileSync(path.join(process.cwd(), 'tests/fixtures/sessions', name), 'utf8')) as T;

const SETUP_RUN = read<PublicSessionRun>('guard-setup-run.json');
const SETUP_JOURNAL = read<ActivityEvent[]>('guard-setup-journal.json');

it('renders the same conversation after discarding superseded snapshots', () => {
  const compact = compactRunSnapshots(SETUP_JOURNAL);
  expect(compact.filter(e => e.kind === 'run')).toHaveLength(1);
  expect(compact.length).toBeLessThan(SETUP_JOURNAL.length);
  expect(foldConversation(SETUP_RUN, compact)).toEqual(foldConversation(SETUP_RUN, SETUP_JOURNAL));
});

const RECIPE = '26356f92-1e71-46fe-a74a-d1eba5d1c020';
const PREPARATIONS = 'f8c000b1-3a51-4da0-a1a6-1ce664249e73';

const eventsOf = (sessionId: string): SessionEvent[] =>
  SETUP_JOURNAL.filter(
    (e): e is Extract<ActivityEvent, { kind: 'session-event' }> =>
      e.kind === 'session-event' && e.sessionId === sessionId,
  ).map((e) => e.event);

const spent = { turns: 0, tokens: 0, costUsd: 0 };
const usage = {
  inputTokens: 12,
  outputTokens: 3,
  cacheReadTokens: 400,
  cacheCreateTokens: 0,
  costUsd: 0.0021,
  costSource: 'model-priced' as const,
};

let seq = 0;
const at = (n: number): string =>
  new Date(Date.parse('2026-09-09T10:00:00.000Z') + n * 1000).toISOString();
const ev = (body: Omit<SessionEvent, 'seq' | 'ts'>): SessionEvent =>
  ({ ...body, seq: seq++, ts: at(seq) }) as SessionEvent;

function journal(...groups: { sessionId: string; events: SessionEvent[] }[]): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  let cursor = 0;
  for (const group of groups) {
    for (const event of group.events) {
      out.push({ cursor: cursor++, kind: 'session-event', sessionId: group.sessionId, event });
    }
  }
  return out;
}

function run(over: Partial<PublicSessionRun> = {}): PublicSessionRun {
  return {
    command: 'guard-generate',
    runId: 'run-1',
    gitRef: 'abc',
    startedAt: at(0),
    status: 'completed',
    sessions: [],
    ...over,
  } as PublicSessionRun;
}

const entry = (over: Record<string, unknown> = {}) =>
  ({
    sessionId: 'ses-a',
    kind: 'guard-setup.seed',
    workItem: 'seed',
    status: 'completed',
    spent: { ...spent },
    ...over,
  }) as PublicSessionRun['sessions'][number];

// ---------------------------------------------------------------------------
// the real setup conversation
// ---------------------------------------------------------------------------

describe('a real guard setup, folded', () => {
  const conversation = foldConversation(SETUP_RUN, SETUP_JOURNAL);
  const recipe = conversation.steps[1].sessions[0];

  it('is the run’s own steps, in the run’s own order, with their own labels', () => {
    expect(conversation.steps.map((s) => s.key)).toEqual([
      'clone',
      'recipe',
      'detect',
      'catalog',
      'interfaces',
      'seed',
      'preparations',
      'auth',
    ]);
    expect(conversation.steps[1].label).toBe('Deriving the recipe');
    expect(conversation.steps[1].detail).toBe(
      'wrote .truecourse/scenarios/recipe.json (llm) · default /api/expenses → 200',
    );
    expect(conversation.error).toBeUndefined();
  });

  it('groups paragraphs by the kinds a step claims, in first-cursor order', () => {
    expect(conversation.steps.map((s) => [s.key, s.sessions.map((p) => p.sessionId)])).toEqual([
      ['clone', []],
      ['recipe', [RECIPE]],
      ['detect', []],
      ['catalog', ['0737fe88-5438-409d-bf2c-c88177855a29']],
      // The step claims a kind this run never opened.
      ['interfaces', []],
      ['seed', ['c53ac079-8a47-451c-b630-bff4aff9891b']],
      ['preparations', [PREPARATIONS]],
      ['auth', []],
    ]);
  });

  it('heads a paragraph with the index entry’s own data', () => {
    expect(recipe.kind).toBe('guard-setup.recipe-repair');
    expect(recipe.workItem).toBe('recipe-repair');
    expect(recipe.status).toBe('completed');
    expect(recipe.spent).toEqual({ turns: 6, tokens: 49158, costUsd: 0.11007600000000001 });
    expect(recipe.live).toBeUndefined();
  });

  it('is one line per event, in seq order, and drops none of them', () => {
    const own = eventsOf(RECIPE);
    expect(recipe.lines.map((l) => l.seq)).toEqual(own.map((e) => e.seq));
    expect(recipe.lines.map((l) => l.kind)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
      'outcome',
    ]);
  });

  it('carries the system prompt, the model and the tool names as they were recorded', () => {
    const line = recipe.lines[0] as Extract<ConversationLine, { kind: 'system' }>;
    const start = eventsOf(RECIPE)[0] as Extract<SessionEvent, { type: 'session-start' }>;
    expect(line.systemPrompt).toBe(start.systemPrompt);
    expect(line.systemPrompt).toContain('You repair RECIPE PROPOSALS');
    expect(line.llm).toEqual(start.llm);
    expect(line.toolNames).toEqual(start.toolNames);
  });

  it('carries the briefing whole, exactly as it was sent', () => {
    const line = recipe.lines[1] as Extract<ConversationLine, { kind: 'user' }>;
    const sent = eventsOf(RECIPE)[1] as Extract<SessionEvent, { type: 'user-message' }>;
    expect(line.content).toBe(sent.content);
    expect(line.actor).toBeUndefined();
  });

  it('carries every tool call with its arguments as JSON, and every result whole', () => {
    const calls = recipe.lines.filter((l) => l.kind === 'assistant');
    expect(calls.map((l) => (l as { toolCall?: { name: string } }).toolCall?.name)).toEqual([
      'search_repo',
      'read_file',
      'read_file',
      'check_recipe',
      'verify_recipe',
      'outcome',
    ]);
    const first = calls[0] as Extract<ConversationLine, { kind: 'assistant' }>;
    expect(first.toolCall?.args).toBe(
      JSON.stringify((eventsOf(RECIPE)[2] as { toolCall: { args: unknown } }).toolCall.args, null, 2),
    );
    expect(first.usage).toEqual((eventsOf(RECIPE)[2] as { usage: unknown }).usage);

    const results = recipe.lines.filter((l) => l.kind === 'tool');
    expect(results.map((l) => (l as { toolName: string }).toolName)).toEqual([
      'search_repo',
      'read_file',
      'read_file',
      'check_recipe',
      'verify_recipe',
    ]);
    expect((results[1] as { content: string }).content).toBe(
      (eventsOf(RECIPE)[5] as { content: string }).content,
    );
    expect(results.every((l) => (l as { isError: boolean }).isError === false)).toBe(true);
  });

  it('carries the outcome value as JSON in full, and nothing derived from it', () => {
    const line = recipe.lines[recipe.lines.length - 1] as Extract<ConversationLine, { kind: 'outcome' }>;
    const outcome = eventsOf(RECIPE).at(-1) as Extract<SessionEvent, { type: 'outcome' }>;
    expect(line.value).toBe(JSON.stringify(outcome.value, null, 2));
    expect(line.value).toContain('"install": "corepack pnpm install --frozen-lockfile"');
    expect(line.findings).toEqual([]);
  });

  it('gives an event that is only fields a data line of exactly those fields', () => {
    const prep = foldConversation(SETUP_RUN, SETUP_JOURNAL).steps[6].sessions[0];
    const reAsk = prep.lines.find((l) => l.kind === 'data' && l.label === 're-ask');
    expect(reAsk).toBeDefined();
    expect((reAsk as { fields: { label: string }[] }).fields.map((f) => f.label)).toEqual([
      'invalid',
      'reason',
    ]);
    const retry = prep.lines.find((l) => l.kind === 'data' && l.label === 'provider-retry');
    expect((retry as { fields: { label: string; value: string }[] }).fields).toEqual([
      { label: 'attempt', value: '1' },
      { label: 'message', value: 'Cannot connect to API: read ECONNRESET' },
      { label: 'delayMs', value: '2452' },
      { label: 'model', value: 'gpt-5.6-sol' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// what the real run has no example of
// ---------------------------------------------------------------------------

describe('the shapes one run cannot show', () => {
  it('is the error and nothing else when a gate stopped the work', () => {
    const conversation = foldConversation(
      run({
        status: 'failed',
        error: { message: '56 open spec conflicts must be resolved before guard generate' },
      }),
      [],
    );
    expect(conversation.error).toBe('56 open spec conflicts must be resolved before guard generate');
    expect(conversation.steps).toEqual([]);
  });

  it('keeps every loop intervention as its own user message', () => {
    seq = 0;
    const events = journal({
      sessionId: 'ses-a',
      events: [
        ev({ type: 'session-start', kind: 'guard-setup.seed', workItem: 'seed', systemPrompt: 'S', toolNames: ['read_file'] }),
        ev({ type: 'user-message', content: 'Author the ONE seed script.' }),
        ev({ type: 'user-message', content: '[budget] 2 turns left before I stop you.' }),
        ev({ type: 'user-message', content: 'use the staging database', actor: 'sam@spiderhands.dev' }),
      ],
    });
    const lines = foldConversation(run({ command: 'guard-setup', sessions: [entry()] }), events)
      .steps[0].sessions[0].lines;
    expect(lines.map((l) => l.kind)).toEqual(['system', 'user', 'user', 'user']);
    expect(lines.slice(1).map((l) => (l as { content: string }).content)).toEqual([
      'Author the ONE seed script.',
      '[budget] 2 turns left before I stop you.',
      'use the staging database',
    ]);
    expect((lines[3] as { actor?: string }).actor).toBe('sam@spiderhands.dev');
  });

  it('states a failure as its own fields, and a tool error as an error', () => {
    seq = 0;
    const events = journal({
      sessionId: 'ses-a',
      events: [
        ev({ type: 'session-start', kind: 'guard-setup.seed', workItem: 'seed', systemPrompt: 'S', toolNames: [] }),
        ev({ type: 'tool-result', toolName: 'run_seed_draft', content: 'ECONNREFUSED', isError: true }),
        ev({
          type: 'failure',
          failure: { kind: 'transport', class: 'provider', detail: 'usage limit reached', retryability: 'blocked' },
        }),
      ],
    });
    const lines = foldConversation(
      run({ command: 'guard-setup', sessions: [entry({ status: 'failed' })] }),
      events,
    ).steps[0].sessions[0].lines;
    expect(lines[1]).toMatchObject({ kind: 'tool', toolName: 'run_seed_draft', isError: true });
    expect(lines[2]).toMatchObject({
      kind: 'failure',
      // In the order the record wrote them: the fold reorders nothing.
      fields: [
        { label: 'kind', value: 'transport' },
        { label: 'class', value: 'provider' },
        { label: 'detail', value: 'usage limit reached' },
        { label: 'retryability', value: 'blocked' },
      ],
    });
  });

  it('places a worker’s paragraph right under the one that started it, and names it', () => {
    seq = 0;
    const parent = 'ses-flow';
    const child = 'ses-fidelity';
    const events = journal(
      {
        sessionId: parent,
        events: [
          ev({ type: 'session-start', kind: 'guard-generate.flow-worker', workItem: 'flow:delete-a-document:api', systemPrompt: 'S', toolNames: [] }),
          ev({
            type: 'child-session',
            phase: 'started',
            child: { sessionId: child, kind: 'guard-generate.fidelity', workItem: 'flow:delete-a-document:api' },
          }),
          ev({ type: 'assistant-turn', text: 'done', usage: { ...usage } }),
        ],
      },
      {
        sessionId: child,
        events: [
          ev({ type: 'session-start', kind: 'guard-generate.fidelity', workItem: 'flow:delete-a-document:api', systemPrompt: 'S', toolNames: [] }),
        ],
      },
      {
        sessionId: 'ses-flow-2',
        events: [
          ev({ type: 'session-start', kind: 'guard-generate.flow-worker', workItem: 'flow:add-a-document:api', systemPrompt: 'S', toolNames: [] }),
        ],
      },
    );
    const record = run({
      status: 'running',
      display: {
        blocks: [
          {
            kind: 'checklist',
            items: [{ key: 'flows', label: 'Authoring scenarios', status: 'active', sessionKinds: ['guard-generate.flow-worker'] }],
          },
        ],
      },
      sessions: [
        entry({ sessionId: parent, kind: 'guard-generate.flow-worker', workItem: 'flow:delete-a-document:api', status: 'running' }),
        entry({ sessionId: child, kind: 'guard-generate.fidelity', workItem: 'flow:delete-a-document:api' }),
        entry({ sessionId: 'ses-flow-2', kind: 'guard-generate.flow-worker', workItem: 'flow:add-a-document:api', status: 'running' }),
      ],
    });

    const { steps } = foldConversation(record, events);
    expect(steps[0].sessions.map((p) => p.sessionId)).toEqual([parent, child, 'ses-flow-2']);
    expect(steps[0].sessions[1].parentSessionId).toBe(parent);
    expect(steps[0].sessions[0].lines[1]).toMatchObject({
      kind: 'child',
      phase: 'started',
      child: { sessionId: child, kind: 'guard-generate.fidelity', workItem: 'flow:delete-a-document:api' },
    });
  });

  it('heads a kind no step claims with the kind id itself', () => {
    seq = 0;
    const events = journal(
      { sessionId: 'ses-a', events: [ev({ type: 'session-start', kind: 'spec-scan.curate-doc', workItem: 'doc:MANIFEST.md', systemPrompt: 'S', toolNames: [] })] },
      { sessionId: 'ses-b', events: [ev({ type: 'session-start', kind: 'spec-scan.overlap', workItem: 'area:core:1', systemPrompt: 'S', toolNames: [] })] },
    );
    const { steps } = foldConversation(
      run({
        command: 'spec-scan',
        display: {
          blocks: [
            { kind: 'checklist', items: [{ key: 'tag', label: 'Tagging doc areas', status: 'done', sessionKinds: ['spec-scan.curate-doc'] }] },
          ],
        },
        sessions: [
          entry({ sessionId: 'ses-a', kind: 'spec-scan.curate-doc', workItem: 'doc:MANIFEST.md' }),
          entry({ sessionId: 'ses-b', kind: 'spec-scan.overlap', workItem: 'area:core:1' }),
        ],
      }),
      events,
    );
    expect(steps.map((s) => [s.key, s.label])).toEqual([
      ['tag', 'Tagging doc areas'],
      ['kind:spec-scan.overlap', 'spec-scan.overlap'],
    ]);
  });

  it('reads a run that declared no checklist as one heading per kind id', () => {
    seq = 0;
    const events = journal({
      sessionId: 'ses-a',
      events: [ev({ type: 'session-start', kind: 'guard-setup.seed', workItem: 'seed', systemPrompt: 'S', toolNames: [] })],
    });
    const { steps } = foldConversation(
      run({ command: 'guard-setup', sessions: [entry({ status: 'running' })] }),
      events,
    );
    expect(steps.map((s) => [s.key, s.label, s.status])).toEqual([
      ['kind:guard-setup.seed', 'guard-setup.seed', 'active'],
    ]);
  });

  it('still shows work the record has not caught up with', () => {
    seq = 0;
    const events = journal({
      sessionId: 'ses-new',
      events: [ev({ type: 'session-start', kind: 'spec-scan.curate-doc', workItem: 'doc:README.md', systemPrompt: 'S', toolNames: [] })],
    });
    const { steps } = foldConversation(run({ command: 'spec-scan', status: 'running' }), events);
    expect(steps[0].sessions.map((p) => [p.kind, p.workItem, p.status, p.spent])).toEqual([
      ['spec-scan.curate-doc', 'doc:README.md', 'running', undefined],
    ]);
  });

  it('renders only the finding blocks of an outcome, never a summary of the value', () => {
    seq = 0;
    const events = journal({
      sessionId: 'ses-a',
      events: [
        ev({ type: 'session-start', kind: 'spec-scan.overlap', workItem: 'area:billing', systemPrompt: 'S', toolNames: [] }),
        ev({
          type: 'outcome',
          value: { uncheckedPairs: 2 },
          display: {
            blocks: [
              { kind: 'text', text: 'Two docs disagree about the refund window.' },
              { kind: 'facts', lines: ['2 pairs compared'] },
              { kind: 'finding', claim: 'The refund window disagrees', quotes: [{ doc: 'a.md', quote: '24 hours' }] },
              { kind: 'budget', spentUsd: 1.4 },
            ],
          },
        } as unknown as Omit<SessionEvent, 'seq' | 'ts'>),
      ],
    });
    const line = foldConversation(
      run({ command: 'spec-scan', sessions: [entry({ kind: 'spec-scan.overlap', workItem: 'area:billing' })] }),
      events,
    ).steps[0].sessions[0].lines[1] as Extract<ConversationLine, { kind: 'outcome' }>;
    expect(line.value).toBe('{\n  "uncheckedPairs": 2\n}');
    expect(line.findings.map((f) => f.claim)).toEqual(['The refund window disagrees']);
  });

  it('says what is happening right now only when the stream says it', () => {
    seq = 0;
    const events = journal({
      sessionId: 'ses-a',
      events: [ev({ type: 'session-start', kind: 'guard-setup.seed', workItem: 'seed', systemPrompt: 'S', toolNames: [] })],
    });
    const record = run({ command: 'guard-setup', status: 'running', sessions: [entry({ status: 'running' })] });
    expect(foldConversation(record, events).steps[0].sessions[0].live).toBeUndefined();
    expect(
      foldConversation(record, events, {
        'ses-a': { kind: 'text', turnId: 't1', text: 'Booting the app' },
      }).steps[0].sessions[0].live,
    ).toBe('Booting the app');
    expect(
      foldConversation(record, events, {
        'ses-a': { kind: 'tool', turnId: 't1', toolName: 'run_seed_draft', elapsedSeconds: 12.6 },
      }).steps[0].sessions[0].live,
    ).toBe('run_seed_draft · 12s');
  });

  it('takes the freshest record out of the journal itself', () => {
    const stale = run({ status: 'running' });
    const fresh = run({ status: 'completed', error: { message: 'it ended badly' } });
    const events = [
      { cursor: 0, kind: 'run', run: stale },
      { cursor: 1, kind: 'run', run: fresh },
    ] as ActivityEvent[];
    expect(latestRunRecord(stale, events).status).toBe('completed');
    expect(foldConversation(stale, events).error).toBe('it ended badly');
  });

  it('folds a journal it has not read yet into the steps and the work they name', () => {
    const { steps } = foldConversation(SETUP_RUN, []);
    expect(steps).toHaveLength(8);
    expect(steps.flatMap((s) => s.sessions.map((p) => p.kind))).toEqual([
      'guard-setup.recipe-repair',
      'guard-setup.dependency-catalog',
      'guard-setup.seed',
      'guard-setup.preparations',
    ]);
    expect(steps.flatMap((s) => s.sessions.flatMap((p) => p.lines))).toEqual([]);
  });
  it('carries what the engine recorded about a step, and a session’s own title', () => {
    seq = 0;
    const events = journal({
      sessionId: 'ses-a',
      events: [
        ev({ type: 'session-start', kind: 'guard-generate.fidelity', workItem: 'flow:x:cli', systemPrompt: '', toolNames: [], display: { title: 'Fidelity check' } as never }),
      ],
    });
    const record = run({
      command: 'guard-generate',
      display: {
        blocks: [
          {
            kind: 'checklist',
            items: [
              { key: 'index', label: 'Indexing sections', status: 'done', detail: '0 of 18 sections changed', facts: ['README.md: 6 sections unchanged', 'docs/app.md: 12 sections unchanged'] } as never,
              { key: 'author', label: 'Working flows', status: 'done', sessionKinds: ['guard-generate.fidelity'] },
            ],
          },
        ],
      },
      sessions: [{ sessionId: 'ses-a', kind: 'guard-generate.fidelity', workItem: 'flow:x:cli', status: 'completed', spent: { ...spent } }],
    });
    const { steps } = foldConversation(record, events);
    expect(steps[0].facts).toEqual(['README.md: 6 sections unchanged', 'docs/app.md: 12 sections unchanged']);
    expect(steps[1].facts).toEqual([]);
    expect(steps[1].sessions[0].title).toBe('Fidelity check');
  });
});
