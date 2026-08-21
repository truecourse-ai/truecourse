import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  defineSessionTool,
  resumeGrantMessage,
  runAgentLoop,
  SessionToolArgsError,
  WRAP_UP_TURNS,
  wrapUpMessage,
  type DriverCapabilities,
  type DriverResult,
  type RawPayload,
  type SessionDef,
  type SessionDriver,
  type SessionEvent,
  type SessionEventBody,
  type SessionIndexEntry,
  type SessionPersistence,
  type SessionRunInput,
  type ToolContext,
  type TurnUsage,
} from '../../packages/agent-loop/src/index';

// ---------------------------------------------------------------------------
// harness: a scripted fake driver + an in-memory persistence
// ---------------------------------------------------------------------------

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

interface FakeScriptCtx {
  input: SessionRunInput;
  /** Emit one event body and yield so the shell reacts before the next step. */
  emit(body: SessionEventBody & { raw?: RawPayload }): Promise<void>;
  /** True once the shell called interrupt() on the handle. */
  interrupted(): boolean;
  steers: string[];
}

/** A driver whose whole session is a scripted async function. */
function fakeDriver(
  script: (ctx: FakeScriptCtx) => Promise<DriverResult>,
  capabilities?: Partial<DriverCapabilities>,
) {
  const runs: SessionRunInput[] = [];
  const driver: SessionDriver = {
    capabilities: {
      steering: 'turn-boundary',
      structuredOutcome: 'tool',
      resumeAtMessage: false,
      ...capabilities,
    },
    attribution: { provider: 'test', model: 'scripted', endpoint: 'https://example.test' },
    runSession(input) {
      runs.push(input);
      let interrupted = false;
      const steers: string[] = [];
      const done = (async () => {
        await tick(); // let runSession return the handle first
        return script({
          input,
          emit: async (body) => {
            input.onEvent(body);
            await tick();
          },
          interrupted: () => interrupted,
          steers,
        });
      })();
      return {
        done,
        status: () => 'running' as const,
        steer: (m: string) => steers.push(m),
        interrupt: async () => {
          interrupted = true;
        },
      };
    },
  };
  return { driver, runs };
}

/** What a driver returns when interrupted before any valid outcome. */
const endedWithoutOutcome = (): DriverResult => ({
  kind: 'failure',
  failure: { kind: 'malformed', detail: 'session ended without outcome', retryability: 'none' },
});

function memoryPersistence() {
  const events = new Map<string, SessionEvent[]>();
  const index = new Map<string, SessionIndexEntry>();
  const persistence: SessionPersistence = {
    appendEvent(sessionId, event) {
      const list = events.get(sessionId) ?? [];
      list.push(event);
      events.set(sessionId, list);
    },
    updateIndex(entry) {
      index.set(entry.sessionId, entry);
    },
    readEvents(sessionId) {
      return events.get(sessionId) ?? [];
    },
  };
  return { persistence, events, index };
}

function usage(inputTokens: number, outputTokens = 0): TurnUsage {
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    costUsd: 0,
    costSource: 'unpriced',
  };
}

const outcomeSchema = z.object({ verdict: z.string() });
type Outcome = z.infer<typeof outcomeSchema>;

function makeDef(overrides?: Partial<SessionDef<Outcome>>): SessionDef<Outcome> {
  return {
    kind: 'spec-scan.curation',
    systemPrompt: 'you curate docs',
    tools: [],
    outcomeSchema,
    budget: { turns: 10, maxResumes: 0, tokenCeiling: 1_000_000 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// completion
// ---------------------------------------------------------------------------

describe('runAgentLoop completion', () => {
  it('completes when the driver reaches a schema-valid outcome', async () => {
    const { driver } = fakeDriver(async ({ emit }) => {
      await emit({ type: 'user-message', content: 'go' });
      await emit({ type: 'assistant-turn', toolCall: { name: 'probe', args: {} }, usage: usage(100) });
      await emit({ type: 'tool-result', toolName: 'probe', content: 'ok' });
      await emit({ type: 'assistant-turn', text: 'settled', usage: usage(40, 10) });
      return { kind: 'outcome', value: { verdict: 'keep' } };
    });
    const { persistence, index } = memoryPersistence();

    const handle = runAgentLoop({
      def: makeDef(),
      workItem: 'docs/a.md',
      initialMessages: ['go'],
      driver,
      persistence,
      sessionId: 's1',
    });
    const outcome = await handle.outcome;

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('unreachable');
    expect(outcome.output).toEqual({ verdict: 'keep' });
    expect(outcome.spent).toEqual({ turns: 2, tokens: 150, costUsd: 0 });
    expect(outcome.pendingQuestions).toEqual([]);

    const events = persistence.readEvents('s1');
    expect(events[0]).toMatchObject({
      type: 'session-start',
      kind: 'spec-scan.curation',
      workItem: 'docs/a.md',
      toolNames: [],
    });
    expect(events.at(-1)).toMatchObject({ type: 'outcome', value: { verdict: 'keep' } });
    // seq is monotonic from 0 and every event carries a ts.
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    for (const e of events) expect(typeof e.ts).toBe('string');

    expect(index.get('s1')).toMatchObject({
      sessionId: 's1',
      kind: 'spec-scan.curation',
      workItem: 'docs/a.md',
      status: 'completed',
      spent: { turns: 2, tokens: 150, costUsd: 0 },
    });
    expect(handle.status()).toBe('completed');
  });

  it('preserves a driver raw payload on the persisted event', async () => {
    const { driver } = fakeDriver(async ({ emit }) => {
      await emit({
        type: 'assistant-turn',
        text: 'hi',
        usage: usage(1),
        raw: { source: 'fake.wire', payload: { native: true } },
      });
      return { kind: 'outcome', value: { verdict: 'keep' } };
    });
    const { persistence } = memoryPersistence();
    await runAgentLoop({
      def: makeDef(),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;
    const turn = persistence.readEvents('s1').find((e) => e.type === 'assistant-turn');
    expect(turn?.raw).toEqual({ source: 'fake.wire', payload: { native: true } });
  });

  it('budget-exhausts when the turn budget binds on the only grant', async () => {
    // The driver would happily keep going; the shell demands the outcome
    // (the wrap-up window), then interrupts when the window also runs out.
    let seenSteers: string[] = [];
    const { driver } = fakeDriver(async ({ emit, interrupted, steers }) => {
      for (let i = 0; i < 20 && !interrupted(); i++) {
        await emit({ type: 'assistant-turn', text: `turn ${i}`, usage: usage(10) });
      }
      seenSteers = steers;
      return endedWithoutOutcome();
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: makeDef({ budget: { turns: 2, maxResumes: 0, tokenCeiling: 1_000_000 } }),
      workItem: 'docs/a.md',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') throw new Error('unreachable');
    expect(outcome.failure).toEqual({
      kind: 'budget-exhausted',
      notReached: 'docs/a.md',
      retryability: 'none',
    });
    expect(outcome.resumable).toBe(true);
    // The wrap-up demand was steered when the budget bound, and the window's
    // turns are recorded honestly: hard limit = turns + WRAP_UP_TURNS.
    expect(seenSteers).toEqual([wrapUpMessage()]);
    expect(outcome.spent.turns).toBe(2 + WRAP_UP_TURNS);
    expect(persistence.readEvents('s1').at(-1)).toMatchObject({
      type: 'failure',
      failure: { kind: 'budget-exhausted' },
    });
  });

  it('an outcome delivered inside the wrap-up window completes the session', async () => {
    const { driver } = fakeDriver(async ({ emit, steers, interrupted }) => {
      // Reads until the shell demands the outcome, then delivers it.
      for (let i = 0; i < 20 && steers.length === 0 && !interrupted(); i++) {
        await emit({ type: 'assistant-turn', text: `reading ${i}`, usage: usage(10) });
      }
      await emit({ type: 'assistant-turn', text: 'wrapping up', usage: usage(10) });
      return { kind: 'outcome', value: { verdict: 'partial-but-real' } };
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: makeDef({ budget: { turns: 2, maxResumes: 0, tokenCeiling: 1_000_000 } }),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('unreachable');
    expect(outcome.output).toEqual({ verdict: 'partial-but-real' });
    expect(outcome.spent.turns).toBe(3); // 2 budget + 1 wrap-up turn
  });

  it('the wrap-up demand names the outcome-precondition tool', async () => {
    let seenSteers: string[] = [];
    const { driver } = fakeDriver(async ({ emit, interrupted, steers }) => {
      for (let i = 0; i < 20 && !interrupted(); i++) {
        await emit({ type: 'assistant-turn', text: `turn ${i}`, usage: usage(10) });
      }
      seenSteers = steers;
      return endedWithoutOutcome();
    });
    const { persistence } = memoryPersistence();
    await runAgentLoop({
      def: makeDef({
        budget: { turns: 1, maxResumes: 0, tokenCeiling: 1_000_000 },
        outcomePrecondition: { tool: 'check_findings', message: 'run it' },
      }),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;
    expect(seenSteers).toEqual([wrapUpMessage('check_findings')]);
    expect(seenSteers[0]).toContain('check_findings');
  });

  it('grants a fresh budget automatically up to maxResumes, without interrupting', async () => {
    let seenSteers: string[] = [];
    const { driver } = fakeDriver(async ({ emit, interrupted, steers }) => {
      for (let i = 0; i < 3; i++) {
        await emit({ type: 'assistant-turn', text: `turn ${i}`, usage: usage(10) });
        if (interrupted()) return endedWithoutOutcome();
      }
      seenSteers = steers;
      return { kind: 'outcome', value: { verdict: 'keep' } };
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: makeDef({ budget: { turns: 2, maxResumes: 1, tokenCeiling: 1_000_000 } }),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('unreachable');
    expect(outcome.spent.turns).toBe(3);
    const grants = persistence.readEvents('s1').filter((e) => e.type === 'resume-grant');
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ grant: 1, of: 1 });
    // The grant lands right after the exhausting second turn.
    const types = persistence.readEvents('s1').map((e) => e.type);
    expect(types.indexOf('resume-grant')).toBe(types.lastIndexOf('assistant-turn') - 1);
    // The grant is ANNOUNCED — and grant 1 of 1 says it is the last.
    expect(seenSteers).toEqual([resumeGrantMessage(1, 1, 2)]);
    expect(seenSteers[0]).toContain('LAST grant');
  });

  it('budget-exhausts only when the LAST grant binds', async () => {
    const { driver } = fakeDriver(async ({ emit, interrupted }) => {
      for (let i = 0; i < 20 && !interrupted(); i++) {
        await emit({ type: 'assistant-turn', text: `turn ${i}`, usage: usage(10) });
      }
      return endedWithoutOutcome();
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: makeDef({ budget: { turns: 1, maxResumes: 1, tokenCeiling: 1_000_000 } }),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') throw new Error('unreachable');
    expect(outcome.failure.kind).toBe('budget-exhausted');
    // Hard limit = (maxResumes + 1) × turns + the wrap-up window.
    expect(outcome.spent.turns).toBe(2 + WRAP_UP_TURNS);
    expect(persistence.readEvents('s1').filter((e) => e.type === 'resume-grant')).toHaveLength(1);
  });

  it('context-exhausts pre-emptively at the token ceiling, recording the overshoot', async () => {
    // Context is a LEVEL, not a sum: each turn's usage envelope approximates
    // occupancy (input + cache reads + output). The ceiling binds when a
    // turn's level crosses it — before the provider's wall does.
    const { driver } = fakeDriver(async ({ emit, interrupted }) => {
      await emit({ type: 'assistant-turn', text: 'small', usage: usage(400) });
      for (let i = 0; i < 20 && !interrupted(); i++) {
        await emit({ type: 'assistant-turn', text: 'big', usage: usage(1100) });
      }
      return endedWithoutOutcome();
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: makeDef({ budget: { turns: 100, maxResumes: 3, tokenCeiling: 1000 } }),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') throw new Error('unreachable');
    expect(outcome.failure.kind).toBe('context-exhausted');
    expect(outcome.resumable).toBe(true);
    // The turn that crossed the ceiling is recorded, never hidden: two turns
    // ran, and the rollup keeps the full 400 + 1100.
    expect(outcome.spent).toMatchObject({ turns: 2, tokens: 1500 });
    // The ceiling is not a budget: no resume grant softens it.
    expect(persistence.readEvents('s1').filter((e) => e.type === 'resume-grant')).toHaveLength(0);
  });

  it('ends the session malformed after two consecutive re-asked turns', async () => {
    const { driver } = fakeDriver(async ({ emit, interrupted }) => {
      for (let i = 0; i < 20 && !interrupted(); i++) {
        await emit({
          type: 'assistant-turn',
          toolCall: { name: 'nope', args: {} },
          usage: usage(10),
        });
        await emit({ type: 're-ask', invalid: '{"tool":"nope"}', reason: 'unknown tool' });
      }
      return endedWithoutOutcome();
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: makeDef(),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') throw new Error('unreachable');
    expect(outcome.failure).toMatchObject({ kind: 'malformed' });
    // Two malformed turns, no third: the shell interrupted at the boundary.
    expect(persistence.readEvents('s1').filter((e) => e.type === 're-ask')).toHaveLength(2);
  });

  it('one turn with several re-asked calls counts as ONE malformed turn', async () => {
    // A model may emit two parallel tool calls that both fail their schemas:
    // that is one malformed TURN, not two — the session gets its second
    // chance (§3.3 counts consecutive malformed turns).
    const { driver } = fakeDriver(async ({ emit, interrupted }) => {
      await emit({ type: 'assistant-turn', toolCall: { name: 'a', args: 1 }, usage: usage(10) });
      await emit({ type: 're-ask', invalid: '1', reason: 'bad args for a' });
      await emit({ type: 're-ask', invalid: '2', reason: 'bad args for b' });
      expect(interrupted()).toBe(false);
      // The next turn is valid — streak broken.
      await emit({ type: 'assistant-turn', toolCall: { name: 'a', args: {} }, usage: usage(10) });
      await emit({ type: 'tool-result', toolName: 'a', content: 'ok' });
      return { kind: 'outcome', value: { verdict: 'keep' } };
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: makeDef(),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;
    expect(outcome.status).toBe('completed');
  });

  it('a valid observation or a legal text turn resets the malformed streak', async () => {
    const { driver } = fakeDriver(async ({ emit, interrupted }) => {
      // bad → re-ask, then a VALID tool round, then bad → re-ask, then a
      // legal text turn, then bad → re-ask. Never two consecutive.
      await emit({ type: 'assistant-turn', toolCall: { name: 'probe', args: 1 }, usage: usage(10) });
      await emit({ type: 're-ask', invalid: '1', reason: 'schema-failing arguments' });
      await emit({ type: 'assistant-turn', toolCall: { name: 'probe', args: {} }, usage: usage(10) });
      await emit({ type: 'tool-result', toolName: 'probe', content: 'ok' });
      await emit({ type: 'assistant-turn', toolCall: { name: 'probe', args: 1 }, usage: usage(10) });
      await emit({ type: 're-ask', invalid: '1', reason: 'schema-failing arguments' });
      await emit({ type: 'assistant-turn', text: 'thinking out loud', usage: usage(10) });
      await emit({ type: 'assistant-turn', toolCall: { name: 'probe', args: 1 }, usage: usage(10) });
      await emit({ type: 're-ask', invalid: '1', reason: 'schema-failing arguments' });
      expect(interrupted()).toBe(false);
      return { kind: 'outcome', value: { verdict: 'keep' } };
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: makeDef(),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;
    expect(outcome.status).toBe('completed');
  });

  it('fails malformed when the outcome does not satisfy the outcome schema', async () => {
    const { driver } = fakeDriver(async () => ({ kind: 'outcome', value: { wrong: 1 } }));
    const { persistence, index } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: makeDef(),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') throw new Error('unreachable');
    expect(outcome.failure.kind).toBe('malformed');
    expect(outcome.resumable).toBe(true);
    expect(index.get('s1')?.status).toBe('failed');
    expect(persistence.readEvents('s1').at(-1)?.type).toBe('failure');
  });
});

// ---------------------------------------------------------------------------
// attribution + provider retries
// ---------------------------------------------------------------------------

describe('runAgentLoop attribution', () => {
  it('stamps the driver\'s declared model onto session-start', async () => {
    const { driver } = fakeDriver(async () => ({ kind: 'outcome', value: { verdict: 'keep' } }));
    const { persistence } = memoryPersistence();

    await runAgentLoop({
      def: makeDef(),
      workItem: 'docs/a.md',
      initialMessages: ['go'],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    // Declared DATA the shell reads — never an `if` on which driver this is.
    expect(persistence.readEvents('s1')[0]).toMatchObject({
      type: 'session-start',
      llm: { provider: 'test', model: 'scripted', endpoint: 'https://example.test' },
    });
  });

  it('records provider retries without charging them to the budget', async () => {
    const { driver } = fakeDriver(async ({ emit }) => {
      await emit({ type: 'assistant-turn', text: 'one', usage: usage(100) });
      await emit({
        type: 'provider-retry',
        attempt: 1,
        status: 529,
        message: 'overloaded',
        delayMs: 2000,
        model: 'scripted',
      });
      await emit({
        type: 'provider-retry',
        attempt: 2,
        message: 'socket hang up',
        delayMs: 4000,
        model: 'scripted',
      });
      await emit({ type: 'assistant-turn', text: 'two', usage: usage(100) });
      return { kind: 'outcome', value: { verdict: 'keep' } };
    });
    const { persistence } = memoryPersistence();

    const outcome = await runAgentLoop({
      def: makeDef({ budget: { turns: 3, maxResumes: 0, tokenCeiling: 1_000_000 } }),
      workItem: 'docs/a.md',
      initialMessages: ['go'],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    // A retry is a wait, not a turn: two turns spent, and no resume grant.
    expect(outcome.status).toBe('completed');
    expect(outcome.spent).toEqual({ turns: 2, tokens: 200, costUsd: 0 });
    const events = persistence.readEvents('s1');
    expect(events.filter((e) => e.type === 'resume-grant')).toHaveLength(0);
    // Recorded in place, in order, so the gap in the timestamps is explained.
    expect(events.map((e) => e.type)).toEqual([
      'session-start',
      'assistant-turn',
      'provider-retry',
      'provider-retry',
      'assistant-turn',
      'outcome',
    ]);
  });
});

// ---------------------------------------------------------------------------
// tool wrapping
// ---------------------------------------------------------------------------

describe('runAgentLoop tool wrapping', () => {
  const echoTool = defineSessionTool({
    name: 'echo',
    description: 'echo a value',
    kind: 'echo',
    readOnly: true,
    destructive: false,
    inputSchema: z.object({ value: z.string() }),
    async execute(args, ctx) {
      return { content: `${ctx.workItem}:${args.value}` };
    },
  });

  it('validates args against the input schema before execute and injects ToolContext', async () => {
    const { driver, runs } = fakeDriver(async ({ input }) => {
      const tool = input.def.tools.find((t) => t.name === 'echo');
      if (!tool) throw new Error('tool missing from wrapped def');
      // Valid args reach execute with the shell's ToolContext.
      const ok = await tool.execute({ value: 'hi' }, dummyToolCtx());
      expect(ok).toEqual({ content: 'docs/a.md:hi' });
      // Schema-failing args are §3.3-malformed: the wrapper throws for the
      // driver's re-ask mechanics; the tool body never runs.
      await expect(tool.execute({ value: 7 }, dummyToolCtx())).rejects.toBeInstanceOf(
        SessionToolArgsError,
      );
      return { kind: 'outcome', value: { verdict: 'keep' } };
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: makeDef({ tools: [echoTool] }),
      workItem: 'docs/a.md',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;
    expect(outcome.status).toBe('completed');
    expect(runs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// sub-sessions (§3.7 dispatch, §3.3 depth 1)
// ---------------------------------------------------------------------------

describe('runAgentLoop sub-sessions', () => {
  const childDef = makeDef({ kind: 'spec-scan.overlap' });

  const delegate = defineSessionTool({
    name: 'delegate',
    description: 'run the overlap child',
    kind: 'dispatch',
    readOnly: true,
    destructive: false,
    inputSchema: z.object({}),
    async execute(_args, ctx) {
      const out = await ctx.dispatchChild(childDef, ['child go']);
      return { content: JSON.stringify(out) };
    },
  });

  it('runs a child on its own transcript and links it from the parent', async () => {
    const { driver, runs } = fakeDriver(async ({ input, emit }) => {
      if (input.def.kind === 'spec-scan.overlap') {
        await emit({ type: 'assistant-turn', text: 'child work', usage: usage(5) });
        return { kind: 'outcome', value: { verdict: 'child-done' } };
      }
      await emit({ type: 'assistant-turn', toolCall: { name: 'delegate', args: {} }, usage: usage(10) });
      const res = await input.def.tools[0].execute({}, dummyToolCtx());
      await emit({ type: 'tool-result', toolName: 'delegate', content: res.content });
      return { kind: 'outcome', value: { verdict: 'parent-done' } };
    });
    const { persistence, index } = memoryPersistence();
    let n = 0;
    const outcome = await runAgentLoop({
      def: makeDef({ tools: [delegate] }),
      workItem: 'docs/a.md',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 'parent',
      mintSessionId: () => `child-${++n}`,
    }).outcome;

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('unreachable');
    expect(outcome.output).toEqual({ verdict: 'parent-done' });
    // The child ran through the same driver, on its own transcript.
    expect(runs).toHaveLength(2);
    const childEvents = persistence.readEvents('child-1');
    expect(childEvents[0]).toMatchObject({ type: 'session-start', kind: 'spec-scan.overlap' });
    expect(childEvents.at(-1)).toMatchObject({ type: 'outcome', value: { verdict: 'child-done' } });
    expect(index.get('child-1')?.status).toBe('completed');
    // Parent transcript carries full linkage on BOTH child events (§3.9:
    // stream folding must be order-robust).
    const linkage = { sessionId: 'child-1', kind: 'spec-scan.overlap', workItem: 'docs/a.md' };
    const childRefs = persistence.readEvents('parent').filter((e) => e.type === 'child-session');
    expect(childRefs).toHaveLength(2);
    expect(childRefs[0]).toMatchObject({ phase: 'started', child: linkage });
    expect(childRefs[1]).toMatchObject({
      phase: 'completed',
      child: linkage,
      status: 'completed',
      spent: { turns: 1, tokens: 5, costUsd: 0 },
    });
    // The child's budget is its own: the parent's rollup counts parent turns only.
    expect(outcome.spent.turns).toBe(1);
  });

  it('a child dispatching its own child gets a structured failure, not a session', async () => {
    const deeper = defineSessionTool({
      name: 'deeper',
      description: 'illegally dispatch a grandchild',
      kind: 'dispatch',
      readOnly: true,
      destructive: false,
      inputSchema: z.object({}),
      async execute(_args, ctx) {
        const out = await ctx.dispatchChild(makeDef({ kind: 'grandchild' }), []);
        return { content: JSON.stringify(out) };
      },
    });
    const nestedChildDef = makeDef({ kind: 'spec-scan.overlap', tools: [deeper] });
    const delegateNested = defineSessionTool({
      ...delegate,
      async execute(_args, ctx) {
        const out = await ctx.dispatchChild(nestedChildDef, []);
        return { content: JSON.stringify(out) };
      },
    });

    const { driver, runs } = fakeDriver(async ({ input, emit }) => {
      if (input.def.kind === 'spec-scan.overlap') {
        const res = await input.def.tools[0].execute({}, dummyToolCtx());
        const grandchild = JSON.parse(res.content);
        expect(grandchild).toMatchObject({
          status: 'failed',
          failure: { kind: 'transport', class: 'validation' },
        });
        await emit({ type: 'tool-result', toolName: 'deeper', content: res.content });
        return { kind: 'outcome', value: { verdict: 'child-done' } };
      }
      const res = await input.def.tools[0].execute({}, dummyToolCtx());
      await emit({ type: 'tool-result', toolName: 'delegate', content: res.content });
      return { kind: 'outcome', value: { verdict: 'parent-done' } };
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: makeDef({ tools: [delegateNested] }),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 'parent',
    }).outcome;

    expect(outcome.status).toBe('completed');
    // Parent + child sessions only — the grandchild never became a session.
    expect(runs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// resume + transient retry
// ---------------------------------------------------------------------------

describe('runAgentLoop resume', () => {
  it('hands the driver the prior transcript and cursor, starting a fresh transcript', async () => {
    const { persistence } = memoryPersistence();
    // A prior session's persisted transcript — audit truth for the driver.
    persistence.appendEvent('s1', {
      type: 'assistant-turn',
      text: 'old work',
      usage: usage(10),
      seq: 0,
      ts: '2026-08-17T00:00:00.000Z',
    });

    const { driver, runs } = fakeDriver(async () => ({
      kind: 'outcome',
      value: { verdict: 'resumed' },
    }));
    const outcome = await runAgentLoop({
      def: makeDef(),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's2',
      resume: { of: 's1', cursor: { providerSessionId: 'p-1' } },
    }).outcome;

    expect(outcome.status).toBe('completed');
    expect(runs[0].resume).toEqual({
      cursor: { providerSessionId: 'p-1' },
      events: [expect.objectContaining({ type: 'assistant-turn', text: 'old work' })],
    });
    const events = persistence.readEvents('s2');
    expect(events[0]).toMatchObject({ type: 'session-start', resumeOf: 's1', seq: 0 });
  });

  it('retries a transient failure once, resuming over the transcript so far', async () => {
    let attempt = 0;
    const { driver, runs } = fakeDriver(async ({ input, emit }) => {
      attempt += 1;
      if (attempt === 1) {
        for (const m of input.initialMessages) await emit({ type: 'user-message', content: m });
        await emit({ type: 'assistant-turn', text: 'before the drop', usage: usage(10) });
        return {
          kind: 'failure',
          failure: { kind: 'transport', detail: 'ECONNRESET', class: 'transport', retryability: 'transient' },
          resumeCursor: { providerSessionId: 'p-9' },
        };
      }
      return { kind: 'outcome', value: { verdict: 'recovered' } };
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: makeDef(),
      workItem: 'w',
      initialMessages: ['go'],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('unreachable');
    expect(outcome.output).toEqual({ verdict: 'recovered' });
    expect(runs).toHaveLength(2);
    // The retry resumes over what the transcript already holds, with the
    // driver's cursor — and does NOT replay the initial messages the
    // transcript already carries (drivers rebuild them from the events).
    expect(runs[1].resume?.cursor).toEqual({ providerSessionId: 'p-9' });
    expect(runs[1].resume?.events.some((e) => e.type === 'assistant-turn')).toBe(true);
    expect(runs[1].initialMessages).toEqual([]);
    // The transient failure is recorded honestly, then the session goes on.
    const types = persistence.readEvents('s1').map((e) => e.type);
    expect(types).toContain('failure');
    expect(types.at(-1)).toBe('outcome');
  });

  it('a transient retry after a cross-process resume keeps the PRIOR transcript', async () => {
    const { persistence } = memoryPersistence();
    persistence.appendEvent('s1', {
      type: 'user-message',
      content: 'the original task',
      seq: 0,
      ts: '2026-08-17T00:00:00.000Z',
    });

    let attempt = 0;
    const { driver, runs } = fakeDriver(async ({ emit }) => {
      attempt += 1;
      if (attempt === 1) {
        await emit({ type: 'assistant-turn', text: 'resumed work', usage: usage(10) });
        // Dies before producing a fresh cursor.
        return {
          kind: 'failure',
          failure: { kind: 'transport', detail: 'ECONNRESET', class: 'transport', retryability: 'transient' },
        };
      }
      return { kind: 'outcome', value: { verdict: 'recovered' } };
    });
    const outcome = await runAgentLoop({
      def: makeDef(),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's2',
      resume: { of: 's1', cursor: { providerSessionId: 'p-1' } },
    }).outcome;

    expect(outcome.status).toBe('completed');
    expect(runs).toHaveLength(2);
    // The retry still holds the ORIGINAL task (prior session's transcript)
    // ahead of what s2 recorded before the drop…
    const retryEvents = runs[1].resume?.events ?? [];
    expect(retryEvents.some((e) => e.type === 'user-message' && e.content === 'the original task')).toBe(true);
    expect(retryEvents.some((e) => e.type === 'assistant-turn' && e.text === 'resumed work')).toBe(true);
    // …and keeps the original cursor when the failed run minted none.
    expect(runs[1].resume?.cursor).toEqual({ providerSessionId: 'p-1' });
  });

  it('surfaces the failure when the one transient retry also fails', async () => {
    const { driver, runs } = fakeDriver(async () => ({
      kind: 'failure',
      failure: { kind: 'transport', detail: '503', class: 'provider', retryability: 'transient' },
    }));
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: makeDef(),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') throw new Error('unreachable');
    expect(outcome.failure).toMatchObject({ kind: 'transport', detail: '503' });
    expect(runs).toHaveLength(2);
  });

  it('parks a blocked failure instead of hammering it', async () => {
    const { driver, runs } = fakeDriver(async () => ({
      kind: 'failure',
      failure: { kind: 'transport', detail: 'invalid api key', class: 'permission', retryability: 'blocked' },
    }));
    const { persistence, index } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: makeDef(),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') throw new Error('unreachable');
    expect(outcome.resumable).toBe(true);
    expect(runs).toHaveLength(1); // never retried
    expect(index.get('s1')?.status).toBe('parked');
  });
});

describe('runAgentLoop abort', () => {
  it('an external abort interrupts the driver and fails the session honestly', async () => {
    let driverSignal: AbortSignal | undefined;
    const { driver } = fakeDriver(async ({ input, emit, interrupted }) => {
      driverSignal = input.signal;
      for (let i = 0; i < 20 && !interrupted(); i++) {
        await emit({ type: 'assistant-turn', text: `turn ${i}`, usage: usage(1) });
      }
      return endedWithoutOutcome();
    });
    const { persistence } = memoryPersistence();
    const controller = new AbortController();
    const handle = runAgentLoop({
      def: makeDef(),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
      signal: controller.signal,
    });
    await tick();
    controller.abort();
    const outcome = await handle.outcome;

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') throw new Error('unreachable');
    expect(outcome.failure).toMatchObject({ kind: 'transport', detail: 'aborted by caller' });
    expect(outcome.resumable).toBe(true);
    // The shell's internal signal (which tools also see) is aborted too.
    expect(driverSignal?.aborted).toBe(true);
    // It stopped well before the driver's own 20-turn script ran out.
    expect(outcome.spent.turns).toBeLessThan(20);
  });
});

// ---------------------------------------------------------------------------
// questions + steering
// ---------------------------------------------------------------------------

describe('runAgentLoop questions and steering', () => {
  it('reports unresolved questions as pending on the completed outcome', async () => {
    const q = (id: string) => ({
      id,
      header: 'Scope',
      question: `keep ${id}?`,
      options: [{ label: 'yes' }, { label: 'no' }],
      multiSelect: false,
    });
    const { driver } = fakeDriver(async ({ emit }) => {
      await emit({ type: 'question-asked', question: q('q1') });
      await emit({ type: 'question-asked', question: q('q2') });
      await emit({ type: 'question-resolved', questionId: 'q1', answer: 'yes', resolvedBy: 'policy' });
      return { kind: 'outcome', value: { verdict: 'keep' } };
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: makeDef(),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('unreachable');
    expect(outcome.pendingQuestions.map((p) => p.id)).toEqual(['q2']);
  });

  it('forwards steers to the live driver handle', async () => {
    let seenSteers: string[] = [];
    const { driver } = fakeDriver(async ({ emit, steers }) => {
      await emit({ type: 'assistant-turn', text: 'working', usage: usage(1) });
      await emit({ type: 'assistant-turn', text: 'still working', usage: usage(1) });
      seenSteers = steers;
      return { kind: 'outcome', value: { verdict: 'keep' } };
    });
    const { persistence } = memoryPersistence();
    const handle = runAgentLoop({
      def: makeDef(),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    });
    handle.steer('skip the archive');
    await handle.outcome;
    expect(seenSteers).toEqual(['skip the archive']);
  });
});

// ---------------------------------------------------------------------------
// the outcome precondition (01 step 2k)
// ---------------------------------------------------------------------------

describe('runAgentLoop outcome precondition', () => {
  const PRECONDITION = {
    tool: 'check_draft',
    message: 'You have not called `check_draft` yet. Call it, then state your outcome.',
  };
  const gated = (overrides?: Partial<SessionDef<Outcome>>) =>
    makeDef({ outcomePrecondition: PRECONDITION, ...overrides });

  /** Drivers record `user-message` at the moment they ingest it. */
  const ingest = async (ctx: FakeScriptCtx) => {
    for (const m of ctx.input.initialMessages) await ctx.emit({ type: 'user-message', content: m });
  };

  it('refuses an outcome produced before the required tool ran, and takes the next one', async () => {
    let run = 0;
    const { driver, runs } = fakeDriver(async (ctx) => {
      run += 1;
      await ingest(ctx);
      if (run === 1) {
        await ctx.emit({ type: 'assistant-turn', text: 'drafting', usage: usage(10) });
        return {
          kind: 'outcome',
          value: { verdict: 'premature' },
          resumeCursor: { providerSessionId: 'p-1' },
        };
      }
      await ctx.emit({
        type: 'assistant-turn',
        toolCall: { name: 'check_draft', args: {} },
        usage: usage(10),
      });
      await ctx.emit({ type: 'tool-result', toolName: 'check_draft', content: 'ok' });
      await ctx.emit({ type: 'assistant-turn', text: 'settled', usage: usage(10) });
      return { kind: 'outcome', value: { verdict: 'checked' } };
    });
    const { persistence } = memoryPersistence();

    const outcome = await runAgentLoop({
      def: gated(),
      workItem: 'w',
      initialMessages: ['go'],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('unreachable');
    expect(outcome.output).toEqual({ verdict: 'checked' });
    // A real round trip: the message goes back, and the refused turn is still
    // charged to the budget.
    expect(runs).toHaveLength(2);
    expect(runs[1].initialMessages).toEqual([PRECONDITION.message]);
    expect(runs[1].resume?.cursor).toEqual({ providerSessionId: 'p-1' });
    expect(runs[1].resume?.events.some((e) => e.type === 'assistant-turn' && e.text === 'drafting')).toBe(true);
    expect(outcome.spent.turns).toBe(3);

    // The refused value is never an outcome event; the message follows the
    // turn that produced it.
    const events = persistence.readEvents('s1');
    expect(events.map((e) => e.type)).toEqual([
      'session-start',
      'user-message',
      'assistant-turn',
      'user-message',
      'assistant-turn',
      'tool-result',
      'assistant-turn',
      'outcome',
    ]);
    expect(events.filter((e) => e.type === 'outcome')).toEqual([
      expect.objectContaining({ value: { verdict: 'checked' } }),
    ]);
    expect(events[3]).toMatchObject({ type: 'user-message', content: PRECONDITION.message });
  });

  it('is not a malformed turn — a session that skipped a step is told, not killed', async () => {
    let run = 0;
    const { driver } = fakeDriver(async (ctx) => {
      run += 1;
      await ingest(ctx);
      if (run === 1) {
        await ctx.emit({
          type: 'assistant-turn',
          toolCall: { name: 'nope', args: {} },
          usage: usage(10),
        });
        await ctx.emit({ type: 're-ask', invalid: '{}', reason: 'unknown tool' });
        return { kind: 'outcome', value: { verdict: 'premature' } };
      }
      await ctx.emit({ type: 'tool-result', toolName: 'check_draft', content: 'ok' });
      await ctx.emit({ type: 'assistant-turn', text: 'settled', usage: usage(10) });
      return { kind: 'outcome', value: { verdict: 'checked' } };
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: gated(),
      workItem: 'w',
      initialMessages: ['go'],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('completed');
    // The two-consecutive rule saw one re-ask, and the refusal added none.
    expect(persistence.readEvents('s1').filter((e) => e.type === 're-ask')).toHaveLength(1);
    expect(persistence.readEvents('s1').some((e) => e.type === 'failure')).toBe(false);
  });

  it('fires at most once — a second outcome stands on its own merits', async () => {
    const { driver, runs } = fakeDriver(async (ctx) => {
      await ingest(ctx);
      await ctx.emit({ type: 'assistant-turn', text: 'still no check', usage: usage(10) });
      return { kind: 'outcome', value: { verdict: 'unchecked' } };
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: gated(),
      workItem: 'w',
      initialMessages: ['go'],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('unreachable');
    expect(outcome.output).toEqual({ verdict: 'unchecked' });
    expect(runs).toHaveLength(2);
  });

  it('a session that burns its budget still refusing ends budget-exhausted, not malformed', async () => {
    let run = 0;
    const { driver, runs } = fakeDriver(async (ctx) => {
      run += 1;
      await ingest(ctx);
      if (run === 1) {
        await ctx.emit({ type: 'assistant-turn', text: 'drafting', usage: usage(10) });
        return { kind: 'outcome', value: { verdict: 'premature' } };
      }
      for (let i = 0; i < 20 && !ctx.interrupted(); i++) {
        await ctx.emit({ type: 'assistant-turn', text: `turn ${i}`, usage: usage(10) });
      }
      return endedWithoutOutcome();
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: gated({ budget: { turns: 3, maxResumes: 0, tokenCeiling: 1_000_000 } }),
      workItem: 'w',
      initialMessages: ['go'],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') throw new Error('unreachable');
    expect(outcome.failure.kind).toBe('budget-exhausted');
    expect(runs).toHaveLength(2);
  });

  it('does not refuse an outcome the shell has already decided to stop for', async () => {
    // The context-ceiling interrupt fired on the very turn that produced the
    // outcome: there is no room left to comply in, so it stands on its own
    // merits. (A bound turn BUDGET no longer stops the session outright — the
    // wrap-up window gives it room, so the refusal round trip fires there.)
    const { driver, runs } = fakeDriver(async (ctx) => {
      await ingest(ctx);
      await ctx.emit({ type: 'assistant-turn', text: 'last turn', usage: usage(2000) });
      return { kind: 'outcome', value: { verdict: 'unchecked' } };
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: gated({ budget: { turns: 10, maxResumes: 0, tokenCeiling: 1000 } }),
      workItem: 'w',
      initialMessages: ['go'],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('completed');
    expect(runs).toHaveLength(1);
  });

  it('the wrap-up window leaves room for the precondition round trip', async () => {
    // Budget binds → wrap-up demand → premature outcome → refusal → required
    // tool → outcome, all inside the window: the session completes.
    let run = 0;
    const { driver, runs } = fakeDriver(async (ctx) => {
      run += 1;
      await ingest(ctx);
      if (run === 1) {
        await ctx.emit({ type: 'assistant-turn', text: 'reading to the wall', usage: usage(10) });
        // The wrap-up demand was steered; deliver an (unchecked) outcome.
        await ctx.emit({ type: 'assistant-turn', text: 'draft', usage: usage(10) });
        return { kind: 'outcome', value: { verdict: 'premature' } };
      }
      await ctx.emit({
        type: 'assistant-turn',
        toolCall: { name: 'check_draft', args: {} },
        usage: usage(10),
      });
      await ctx.emit({ type: 'tool-result', toolName: 'check_draft', content: 'ok' });
      return { kind: 'outcome', value: { verdict: 'checked' } };
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: gated({ budget: { turns: 1, maxResumes: 0, tokenCeiling: 1_000_000 } }),
      workItem: 'w',
      initialMessages: ['go'],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') throw new Error('unreachable');
    expect(outcome.output).toEqual({ verdict: 'checked' });
    expect(runs).toHaveLength(2);
    // 1 budget turn + 2 window turns (draft, then the required tool) — done
    // with a wrap-up turn to spare.
    expect(outcome.spent.turns).toBe(3);
  });

  it('counts a tool-result carried by the resumed-from transcript', async () => {
    const { persistence } = memoryPersistence();
    persistence.appendEvent('s1', {
      type: 'tool-result',
      toolName: 'check_draft',
      content: 'ok',
      seq: 0,
      ts: '2026-08-17T00:00:00.000Z',
    });
    const { driver, runs } = fakeDriver(async () => ({
      kind: 'outcome',
      value: { verdict: 'resumed' },
    }));

    const outcome = await runAgentLoop({
      def: gated(),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's2',
      resume: { of: 's1' },
    }).outcome;

    // The tool ran; this session carries that transcript as its history.
    expect(outcome.status).toBe('completed');
    expect(runs).toHaveLength(1);
  });

  it('counts an error result — what matters is that the tool ran', async () => {
    const { driver, runs } = fakeDriver(async (ctx) => {
      await ctx.emit({
        type: 'tool-result',
        toolName: 'check_draft',
        content: 'two ids collide',
        isError: true,
      });
      return { kind: 'outcome', value: { verdict: 'revised' } };
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: gated(),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('completed');
    expect(runs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// the draft checkpoint (outcomePrecondition's in-flight sibling)
// ---------------------------------------------------------------------------

describe('runAgentLoop draft checkpoint', () => {
  const CHECKPOINT = { tool: 'check_draft', afterTurn: 2, message: 'Draft something and check it NOW.' };
  const checked = (overrides?: Partial<SessionDef<Outcome>>) =>
    makeDef({ draftCheckpoint: CHECKPOINT, ...overrides });

  it('steers the nudge once when afterTurn passes with no tool-result', async () => {
    let seenSteers: string[] = [];
    const { driver } = fakeDriver(async ({ emit, steers }) => {
      for (let i = 0; i < 4; i++) {
        await emit({ type: 'assistant-turn', text: `exploring ${i}`, usage: usage(10) });
      }
      seenSteers = steers;
      return { kind: 'outcome', value: { verdict: 'late but done' } };
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: checked(),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('completed');
    // Fired exactly once, at the afterTurn boundary — turns 3 and 4 add nothing.
    expect(seenSteers).toEqual([CHECKPOINT.message]);
  });

  it('stays silent when the tool ran before afterTurn', async () => {
    let seenSteers: string[] = [];
    const { driver } = fakeDriver(async ({ emit, steers }) => {
      await emit({ type: 'assistant-turn', toolCall: { name: 'check_draft', args: {} }, usage: usage(10) });
      await emit({ type: 'tool-result', toolName: 'check_draft', content: 'ok' });
      for (let i = 0; i < 3; i++) {
        await emit({ type: 'assistant-turn', text: `refining ${i}`, usage: usage(10) });
      }
      seenSteers = steers;
      return { kind: 'outcome', value: { verdict: 'drafted early' } };
    });
    const { persistence } = memoryPersistence();
    const outcome = await runAgentLoop({
      def: checked(),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's1',
    }).outcome;

    expect(outcome.status).toBe('completed');
    expect(seenSteers).toEqual([]);
  });

  it('counts a tool-result carried by the resumed-from transcript', async () => {
    const { persistence } = memoryPersistence();
    persistence.appendEvent('s1', {
      type: 'tool-result',
      toolName: 'check_draft',
      content: 'ok',
      seq: 0,
      ts: '2026-08-21T00:00:00.000Z',
    });
    let seenSteers: string[] = [];
    const { driver } = fakeDriver(async ({ emit, steers }) => {
      for (let i = 0; i < 3; i++) {
        await emit({ type: 'assistant-turn', text: `resumed ${i}`, usage: usage(10) });
      }
      seenSteers = steers;
      return { kind: 'outcome', value: { verdict: 'resumed' } };
    });
    const outcome = await runAgentLoop({
      def: checked(),
      workItem: 'w',
      initialMessages: [],
      driver,
      persistence,
      sessionId: 's2',
      resume: { of: 's1' },
    }).outcome;

    expect(outcome.status).toBe('completed');
    expect(seenSteers).toEqual([]);
  });
});

/** Drivers pass their own ctx; the shell's wrapper must ignore it. */
function dummyToolCtx(): ToolContext {
  return {
    workItem: 'driver-should-not-see-this',
    signal: new AbortController().signal,
    dispatchChild: () => Promise.reject(new Error('driver ctx used')),
  };
}
