/**
 * The api session driver (AGENTIC_PIPELINE_PLAN §3.3): our own per-turn loop
 * on `generateText` — tools without `execute`, one step per turn, full-history
 * resend, cache breakpoints, per-turn fallback retry, and the malformed
 * mapping. The REAL `generateText` runs against a scripted LanguageModelV3
 * stub (the `buildModel` mock seam the transport tests use).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const { buildModelMock } = vi.hoisted(() => ({ buildModelMock: vi.fn() }));
vi.mock('../../packages/llm-api/src/model.js', () => ({ buildModel: buildModelMock }));

import { createApiSessionDriver, OUTCOME_TOOL_NAME } from '../../packages/llm-api/src/index';
import type {
  DriverResult,
  SessionDef,
  SessionEventBody,
  SessionRunInput,
} from '../../packages/agent-loop/src/index';
import { defineSessionTool, SessionToolArgsError } from '../../packages/agent-loop/src/index';

const cfg = {
  provider: 'anthropic' as const,
  model: 'primary-model',
  fallbackModel: 'fallback-model',
  apiKey: 'test',
};

// ---------------------------------------------------------------------------
// scripted provider stub
// ---------------------------------------------------------------------------

type StubContent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: string };

type StubTurn = { content: StubContent[] } | { throws: unknown };

/** A LanguageModelV3 that plays scripted turns and records every prompt. */
function scriptedModel(turns: StubTurn[]) {
  const calls: Array<{
    prompt: unknown[];
    tools: unknown[] | undefined;
    providerOptions?: Record<string, Record<string, unknown>>;
  }> = [];
  return {
    calls,
    model: {
      specificationVersion: 'v3',
      provider: 'mock',
      modelId: 'mock-model',
      supportedUrls: {},
      async doGenerate(options: {
        prompt: unknown[];
        tools?: unknown[];
        providerOptions?: Record<string, Record<string, unknown>>;
      }) {
        calls.push({
          prompt: options.prompt,
          tools: options.tools,
          providerOptions: options.providerOptions,
        });
        const turn = turns.shift();
        if (!turn) throw new Error('scripted model ran out of turns');
        if ('throws' in turn) throw turn.throws;
        return {
          content: turn.content,
          finishReason: turn.content.some((c) => c.type === 'tool-call') ? 'tool-calls' : 'stop',
          usage: {
            inputTokens: { total: 100, noCache: 40, cacheRead: 50, cacheWrite: 10 },
            outputTokens: { total: 20, text: 20, reasoning: undefined },
          },
          warnings: [],
        };
      },
      async doStream() {
        throw new Error('doStream not used');
      },
    },
  };
}

const text = (t: string): StubContent => ({ type: 'text', text: t });
const call = (toolName: string, input: unknown, id = 'c1'): StubContent => ({
  type: 'tool-call',
  toolCallId: id,
  toolName,
  input: typeof input === 'string' ? input : JSON.stringify(input),
});
const outcomeCall = (value: unknown, id = 'c-outcome'): StubContent =>
  call(OUTCOME_TOOL_NAME, value, id);

// ---------------------------------------------------------------------------
// session harness
// ---------------------------------------------------------------------------

const outcomeSchema = z.object({ verdict: z.string() });

const probeTool = defineSessionTool({
  name: 'probe',
  description: 'probe a value',
  kind: 'probe',
  readOnly: true,
  destructive: false,
  inputSchema: z.object({ value: z.string() }),
  async execute(args) {
    if (args.value === 'boom') throw new SessionToolArgsError('probe', 'value rejected');
    return { content: `probed:${args.value}` };
  },
});

function makeDef(overrides?: Partial<SessionDef>): SessionDef {
  return {
    kind: 'spec-scan.curation',
    systemPrompt: 'you curate docs',
    tools: [probeTool],
    outcomeSchema,
    budget: { turns: 10, maxResumes: 0, tokenCeiling: 1_000_000 },
    ...overrides,
  };
}

function runSession(
  driver: ReturnType<typeof createApiSessionDriver>,
  overrides?: Partial<SessionRunInput>,
) {
  const events: SessionEventBody[] = [];
  const handle = driver.runSession({
    def: makeDef(),
    initialMessages: ['go'],
    onEvent: (e) => events.push(e),
    signal: new AbortController().signal,
    ...overrides,
  });
  return { handle, events };
}

/** Flatten a provider-level prompt into `role:text-ish` strings for asserts. */
function promptSummary(prompt: unknown[]): string[] {
  return (prompt as Array<{ role: string; content: unknown }>).map((m) => {
    const content =
      typeof m.content === 'string'
        ? m.content
        : (m.content as Array<Record<string, unknown>>)
            .map((p) => (p.type === 'text' ? String(p.text) : `${p.type}:${p.toolName ?? ''}`))
            .join(',');
    return `${m.role}=${content}`;
  });
}

beforeEach(() => buildModelMock.mockReset());

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe('api session driver', () => {
  it('declares turn-boundary steering and a tool-based outcome', () => {
    buildModelMock.mockReturnValue(scriptedModel([]).model);
    const driver = createApiSessionDriver(cfg);
    expect(driver.capabilities).toEqual({
      steering: 'turn-boundary',
      structuredOutcome: 'tool',
      resumeAtMessage: false,
    });
  });

  it('reaches an outcome through a tool round-trip, emitting the full transcript', async () => {
    const scripted = scriptedModel([
      { content: [text('let me probe'), call('probe', { value: 'hi' })] },
      { content: [outcomeCall({ verdict: 'keep' })] },
    ]);
    buildModelMock.mockReturnValue(scripted.model);
    const { handle, events } = runSession(createApiSessionDriver(cfg));
    const result = await handle.done;

    expect(result).toMatchObject({ kind: 'outcome', value: { verdict: 'keep' } });
    expect(events.map((e) => e.type)).toEqual([
      'user-message',
      'assistant-turn',
      'tool-result',
      'assistant-turn',
    ]);
    expect(events[1]).toMatchObject({
      text: 'let me probe',
      toolCall: { name: 'probe', args: { value: 'hi' } },
    });
    expect(events[1]).toMatchObject({
      usage: {
        inputTokens: 40,
        outputTokens: 20,
        cacheReadTokens: 50,
        cacheCreateTokens: 10,
        costSource: 'unpriced',
      },
    });
    expect(events[2]).toMatchObject({ toolName: 'probe', content: 'probed:hi' });

    // Second call resends the FULL history: initial message, the assistant
    // tool call, and the tool result.
    const secondPrompt = promptSummary(scripted.calls[1].prompt);
    expect(secondPrompt[0]).toMatch(/^system=/);
    expect(secondPrompt).toEqual(
      expect.arrayContaining([
        expect.stringContaining('user=go'),
        expect.stringContaining('tool-call:probe'),
        expect.stringContaining('tool-result:probe'),
      ]),
    );
    // Both def tools and the outcome tool are declared to the provider.
    const toolNames = (scripted.calls[0].tools as Array<{ name: string }>).map((t) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining(['probe', OUTCOME_TOOL_NAME]));
    expect(handle.status()).toBe('completed');
  });

  it('places cache breakpoints on the system prompt and the moving tail', async () => {
    const scripted = scriptedModel([{ content: [outcomeCall({ verdict: 'keep' })] }]);
    buildModelMock.mockReturnValue(scripted.model);
    const { handle } = runSession(createApiSessionDriver(cfg));
    await handle.done;

    const prompt = scripted.calls[0].prompt as Array<{
      role: string;
      providerOptions?: { anthropic?: { cacheControl?: { type: string } } };
    }>;
    expect(prompt[0].role).toBe('system');
    expect(prompt[0].providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' });
    expect(prompt.at(-1)?.providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' });
  });

  it('treats a text-only turn as legal deliberation and nudges the next turn', async () => {
    const scripted = scriptedModel([
      { content: [text('thinking it over')] },
      { content: [outcomeCall({ verdict: 'keep' })] },
    ]);
    buildModelMock.mockReturnValue(scripted.model);
    const { handle, events } = runSession(createApiSessionDriver(cfg));
    const result = await handle.done;

    expect(result.kind).toBe('outcome');
    // No re-ask anywhere; the deliberation is an assistant-turn, and the
    // nudge that keeps the conversation alternating is a recorded message.
    expect(events.some((e) => e.type === 're-ask')).toBe(false);
    expect(events.filter((e) => e.type === 'assistant-turn')).toHaveLength(2);
    const nudge = events.filter((e) => e.type === 'user-message').at(-1);
    expect(nudge).toMatchObject({ content: expect.stringContaining('outcome') });
  });

  it('re-asks an unknown tool call and answers its call id with an error result', async () => {
    const scripted = scriptedModel([
      { content: [call('no-such-tool', { x: 1 }, 'c-bad')] },
      { content: [outcomeCall({ verdict: 'keep' })] },
    ]);
    buildModelMock.mockReturnValue(scripted.model);
    const { handle, events } = runSession(createApiSessionDriver(cfg));
    const result = await handle.done;

    expect(result.kind).toBe('outcome');
    const reAsk = events.find((e) => e.type === 're-ask');
    expect(reAsk).toBeDefined();
    // The provider protocol still gets a (error) result for the call id, so
    // the next request is well-formed.
    const secondPrompt = promptSummary(scripted.calls[1].prompt);
    expect(secondPrompt.join('|')).toContain('tool-result');
  });

  it('maps schema-failing args (SessionToolArgsError) into the re-ask path', async () => {
    const scripted = scriptedModel([
      { content: [call('probe', { value: 'boom' })] },
      { content: [outcomeCall({ verdict: 'keep' })] },
    ]);
    buildModelMock.mockReturnValue(scripted.model);
    const { handle, events } = runSession(createApiSessionDriver(cfg));
    const result = await handle.done;

    expect(result.kind).toBe('outcome');
    expect(events.find((e) => e.type === 're-ask')).toMatchObject({
      reason: expect.stringContaining('value rejected'),
    });
    // Never a tool-result event for the rejected call.
    expect(events.some((e) => e.type === 'tool-result')).toBe(false);
  });

  it('retries the turn on the fallback model, then classifies a double failure', async () => {
    // Primary always throws; fallback answers.
    const primary = scriptedModel([{ throws: Object.assign(new Error('529'), { statusCode: 529 }) }]);
    const fallback = scriptedModel([{ content: [outcomeCall({ verdict: 'keep' })] }]);
    buildModelMock.mockImplementation((_cfg: unknown, modelId: string) =>
      modelId === 'primary-model' ? primary.model : fallback.model,
    );
    const { handle } = runSession(createApiSessionDriver(cfg));
    expect((await handle.done).kind).toBe('outcome');
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(1);
  });

  it('classifies auth failures as blocked and 5xx as transient', async () => {
    for (const [statusCode, retryability, cls] of [
      [401, 'blocked', 'permission'],
      [503, 'transient', 'provider'],
    ] as const) {
      const err = Object.assign(new Error(`http ${statusCode}`), { statusCode });
      const primary = scriptedModel([{ throws: err }]);
      const fallback = scriptedModel([{ throws: err }]);
      buildModelMock.mockImplementation((_cfg: unknown, modelId: string) =>
        modelId === 'primary-model' ? primary.model : fallback.model,
      );
      const { handle } = runSession(createApiSessionDriver(cfg));
      const result = await handle.done;
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('unreachable');
      expect(result.failure).toMatchObject({ kind: 'transport', retryability, class: cls });
    }
  });

  it('interrupt stops at the turn boundary with an ended-without-outcome failure', async () => {
    const endless: StubTurn[] = Array.from({ length: 50 }, (_, i) => ({
      content: [text(`turn ${i}`)],
    }));
    const scripted = scriptedModel(endless);
    buildModelMock.mockReturnValue(scripted.model);
    const events: SessionEventBody[] = [];
    const driver = createApiSessionDriver(cfg);
    const handle = driver.runSession({
      def: makeDef(),
      initialMessages: ['go'],
      onEvent: (e) => {
        events.push(e);
        if (e.type === 'assistant-turn') void handle.interrupt();
      },
      signal: new AbortController().signal,
    });
    const result: DriverResult = await handle.done;

    expect(result).toMatchObject({
      kind: 'failure',
      failure: { kind: 'malformed', detail: expect.stringContaining('without outcome') },
    });
    expect(events.filter((e) => e.type === 'assistant-turn')).toHaveLength(1);
    expect(handle.status()).toBe('failed');
  });

  it('delivers steers at the next turn boundary and records them on ingestion', async () => {
    const scripted = scriptedModel([
      { content: [text('working')] },
      { content: [outcomeCall({ verdict: 'keep' })] },
    ]);
    buildModelMock.mockReturnValue(scripted.model);
    const events: SessionEventBody[] = [];
    const driver = createApiSessionDriver(cfg);
    const handle = driver.runSession({
      def: makeDef(),
      initialMessages: ['go'],
      onEvent: (e) => {
        events.push(e);
        if (e.type === 'assistant-turn') handle.steer('skip the archive');
      },
      signal: new AbortController().signal,
    });
    await handle.done;

    const steer = events.filter((e) => e.type === 'user-message').find(
      (e) => e.type === 'user-message' && e.content === 'skip the archive',
    );
    expect(steer).toBeDefined();
    const secondPrompt = promptSummary(scripted.calls[1].prompt).join('|');
    expect(secondPrompt).toContain('skip the archive');
  });

  it('discourages parallel tool use but executes every call a turn does carry', async () => {
    const scripted = scriptedModel([
      {
        content: [
          call('probe', { value: 'one' }, 'c-1'),
          call('probe', { value: 'two' }, 'c-2'),
        ],
      },
      { content: [outcomeCall({ verdict: 'keep' })] },
    ]);
    buildModelMock.mockReturnValue(scripted.model);
    const { handle, events } = runSession(createApiSessionDriver(cfg));
    const result = await handle.done;

    expect(result.kind).toBe('outcome');
    // The provider is asked not to parallel-call (anthropic honors it;
    // others ignore the namespaced option).
    expect(scripted.calls[0].providerOptions?.anthropic?.disableParallelToolUse).toBe(true);
    // When a turn still carries several calls, all execute (the provider
    // protocol needs every call id answered) and every result is recorded;
    // the single-toolCall event carries the first, the raw payload the rest.
    const toolResults = events.filter((e) => e.type === 'tool-result');
    expect(toolResults.map((e) => (e as { content: string }).content)).toEqual([
      'probed:one',
      'probed:two',
    ]);
    expect(events.filter((e) => e.type === 'assistant-turn')[0]).toMatchObject({
      toolCall: { name: 'probe', args: { value: 'one' } },
    });
  });

  it('rebuild keeps an orphan second-call result as a labeled user message', async () => {
    const scripted = scriptedModel([{ content: [outcomeCall({ verdict: 'resumed' })] }]);
    buildModelMock.mockReturnValue(scripted.model);
    const usage = {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      costUsd: 0,
      costSource: 'unpriced' as const,
    };
    const { handle } = runSession(createApiSessionDriver(cfg), {
      initialMessages: [],
      resume: {
        events: [
          { type: 'user-message' as const, content: 'go', seq: 0, ts: 't' },
          {
            type: 'assistant-turn' as const,
            toolCall: { name: 'probe', args: { value: 'one' } },
            usage,
            seq: 1,
            ts: 't',
          },
          { type: 'tool-result' as const, toolName: 'probe', content: 'probed:one', seq: 2, ts: 't' },
          // The parallel second call's result — no recorded call to pair with.
          { type: 'tool-result' as const, toolName: 'probe', content: 'probed:two', seq: 3, ts: 't' },
        ],
      },
    });
    const result = await handle.done;

    expect(result.kind).toBe('outcome');
    const prompt = promptSummary(scripted.calls[0].prompt).join('|');
    expect(prompt).toContain('tool-result:probe');
    // Not silently dropped: it re-enters as an explicitly labeled user
    // message rather than a fabricated tool-call pair.
    expect(prompt).toContain('probed:two');
  });

  it('rebuilds the message history from a resumed transcript', async () => {
    const scripted = scriptedModel([{ content: [outcomeCall({ verdict: 'resumed' })] }]);
    buildModelMock.mockReturnValue(scripted.model);
    const priorEvents = [
      {
        type: 'session-start' as const,
        kind: 'spec-scan.curation',
        workItem: 'w',
        systemPrompt: 's',
        toolNames: ['probe'],
        seq: 0,
        ts: 't',
      },
      { type: 'user-message' as const, content: 'go', seq: 1, ts: 't' },
      {
        type: 'assistant-turn' as const,
        toolCall: { name: 'probe', args: { value: 'hi' } },
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreateTokens: 0,
          costUsd: 0,
          costSource: 'unpriced' as const,
        },
        seq: 2,
        ts: 't',
      },
      { type: 'tool-result' as const, toolName: 'probe', content: 'probed:hi', seq: 3, ts: 't' },
    ];
    const { handle } = runSession(createApiSessionDriver(cfg), {
      initialMessages: ['and one new observation'],
      resume: { events: priorEvents },
    });
    const result = await handle.done;

    expect(result.kind).toBe('outcome');
    const prompt = promptSummary(scripted.calls[0].prompt).join('|');
    expect(prompt).toContain('user=go');
    expect(prompt).toContain('tool-call:probe');
    expect(prompt).toContain('tool-result:probe');
    // New observations append AFTER the rebuilt history.
    expect(prompt).toContain('and one new observation');
  });
});
