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
  ApiSessionDriverOptions,
  ProviderConfig,
} from '../../packages/llm-api/src/index';
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

/** The same config with nothing to fall back to — retries are all there is. */
const cfgNoFallback = { provider: 'anthropic' as const, model: 'primary-model', apiKey: 'test' };

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

/**
 * A provider error in the SHAPE the AI SDK raises (`APICallError`): the
 * status, the SDK's own retryability verdict, and the response headers. The
 * class itself is not importable here — `ai` is llm-api's dependency alone
 * (tests/architecture/ee-import-boundary) — which is also why the driver
 * classifies by shape rather than `instanceof`.
 */
function apiError(
  statusCode: number | undefined,
  isRetryable: boolean,
  responseHeaders?: Record<string, string>,
): Error {
  return Object.assign(new Error(`http ${statusCode ?? 'none'}`), {
    name: 'AI_APICallError',
    url: 'https://api.test/v1/messages',
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(responseHeaders ? { responseHeaders } : {}),
    isRetryable,
  });
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
    // The provider is asked not to parallel-call, in whatever way it takes
    // (here anthropic's own option — see the per-provider suite below).
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

// ---------------------------------------------------------------------------
// per-provider cache strategy (item 7): each provider is told to cache and to
// keep tool calls single-file in the way IT takes — never anthropic's way
// aimed at everyone and silently dropped by three of the four.
// ---------------------------------------------------------------------------

describe('api session driver provider cache strategy', () => {
  /** Run one session under `cfg` and hand back what the provider was sent. */
  async function callsFor(
    provider: ProviderConfig,
    turns: StubTurn[] = [{ content: [outcomeCall({ verdict: 'keep' })] }],
    opts?: ApiSessionDriverOptions,
  ) {
    const scripted = scriptedModel(turns);
    buildModelMock.mockReturnValue(scripted.model);
    const { handle } = runSession(createApiSessionDriver(provider, opts));
    await handle.done;
    return scripted.calls;
  }

  /** Every message-level `providerOptions` in a provider prompt, in order. */
  function messageOptions(prompt: unknown[]): Array<Record<string, unknown> | undefined> {
    return (prompt as Array<{ providerOptions?: Record<string, unknown> }>).map(
      (m) => m.providerOptions,
    );
  }

  it('anthropic: cacheControl on the system prompt and the moving tail', async () => {
    const calls = await callsFor({ provider: 'anthropic', model: 'claude-x', apiKey: 't' });
    const options = messageOptions(calls[0].prompt);

    const ephemeral = { anthropic: { cacheControl: { type: 'ephemeral' } } };
    expect(options[0]).toEqual(ephemeral);
    expect(options.at(-1)).toEqual(ephemeral);
    // Two of the four breakpoints the provider allows — the tool list renders
    // before the system prompt, so the system one already covers it.
    expect(options.filter((o) => o !== undefined)).toHaveLength(2);
    expect(calls[0].providerOptions).toEqual({ anthropic: { disableParallelToolUse: true } });
  });

  it('openai: a per-request prompt cache key and no parallel tool calls', async () => {
    const calls = await callsFor({ provider: 'openai', model: 'gpt-5', apiKey: 't' });

    // The cache is keyed per REQUEST here, so no message is marked at all.
    expect(messageOptions(calls[0].prompt).every((o) => o === undefined)).toBe(true);
    expect(calls[0].providerOptions).toEqual({
      openai: { promptCacheKey: expect.any(String), parallelToolCalls: false },
    });
    expect(calls[0].providerOptions?.openai?.promptCacheKey).not.toBe('');
  });

  it('copilot: the same two settings under its own namespace, in WIRE names', async () => {
    const calls = await callsFor({ provider: 'copilot', model: 'gpt-5', apiKey: 't' });

    expect(messageOptions(calls[0].prompt).every((o) => o === undefined)).toBe(true);
    // The openai-compatible provider forwards what it does not own verbatim
    // into the body, so camelCase here would reach the API as camelCase.
    expect(calls[0].providerOptions).toEqual({
      'github-copilot': { prompt_cache_key: expect.any(String), parallel_tool_calls: false },
    });
  });

  it('bedrock: cachePoint at the same two positions', async () => {
    const calls = await callsFor({
      provider: 'bedrock',
      model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      region: 'us-east-1',
    });
    const options = messageOptions(calls[0].prompt);

    const cachePoint = { bedrock: { cachePoint: { type: 'default' } } };
    expect(options[0]).toEqual(cachePoint);
    expect(options.at(-1)).toEqual(cachePoint);
    // Converse has no parallel-tool-use field; the hosted model's native one
    // goes through the passthrough.
    expect(calls[0].providerOptions).toEqual({
      bedrock: {
        additionalModelRequestFields: {
          tool_choice: { type: 'auto', disable_parallel_tool_use: true },
        },
      },
    });
  });

  it('bedrock: never sends the anthropic-native field to another family', async () => {
    const calls = await callsFor({
      provider: 'bedrock',
      model: 'us.amazon.nova-pro-v1:0',
      region: 'us-east-1',
    });

    // cachePoint is Converse's own, so it still rides…
    expect(messageOptions(calls[0].prompt)[0]).toEqual({
      bedrock: { cachePoint: { type: 'default' } },
    });
    // …but `tool_choice` is raw passthrough to the model, and Nova would read
    // it as a malformed request rather than ignore it.
    expect(calls[0].providerOptions).toEqual({});
  });

  it('holds the cache key steady across a session and apart between sessions', async () => {
    const twoTurns: StubTurn[] = [
      { content: [text('thinking')] },
      { content: [outcomeCall({ verdict: 'keep' })] },
    ];
    const openai: ProviderConfig = { provider: 'openai', model: 'gpt-5', apiKey: 't' };
    const first = await callsFor(openai, twoTurns);
    const second = await callsFor(openai, [{ content: [outcomeCall({ verdict: 'keep' })] }]);

    const keyOf = (call: (typeof first)[number]) => call.providerOptions?.openai?.promptCacheKey;
    expect(first).toHaveLength(2);
    expect(keyOf(first[0])).toBe(keyOf(first[1]));
    expect(keyOf(second[0])).not.toBe(keyOf(first[0]));
  });

  it('lets a caller pin the cluster key, by value or from the session id', async () => {
    const openai: ProviderConfig = { provider: 'openai', model: 'gpt-5', apiKey: 't' };
    const pinned = await callsFor(openai, undefined, { cacheKey: 'interface-author:v1' });
    expect(pinned[0].providerOptions?.openai?.promptCacheKey).toBe('interface-author:v1');

    const seen: string[] = [];
    const derived = await callsFor(openai, undefined, {
      cacheKey: (sessionId) => {
        seen.push(sessionId);
        return `author:${sessionId}`;
      },
    });
    expect(seen).toHaveLength(1);
    expect(derived[0].providerOptions?.openai?.promptCacheKey).toBe(`author:${seen[0]}`);
  });

  it('keys the cluster per session even where the key is not sent', async () => {
    // anthropic caches by prefix content, so the key never leaves the driver —
    // asking for one must not change what the provider is told.
    const calls = await callsFor(
      { provider: 'anthropic', model: 'claude-x', apiKey: 't' },
      undefined,
      { cacheKey: 'interface-author:v1' },
    );
    expect(JSON.stringify(calls[0].providerOptions)).not.toContain('interface-author');
  });
});

// ---------------------------------------------------------------------------
// attribution (item 2): what ran this, on the driver and on every turn
// ---------------------------------------------------------------------------

describe('api session driver attribution', () => {
  it('declares the configured provider, models and gateway — never the key', () => {
    buildModelMock.mockReturnValue(scriptedModel([]).model);
    const driver = createApiSessionDriver({
      ...cfg,
      baseURL: 'https://gateway.internal/v1',
      headers: { 'x-secret': 'shhh' },
    });

    expect(driver.attribution).toEqual({
      provider: 'anthropic',
      model: 'primary-model',
      fallbackModel: 'fallback-model',
      endpoint: 'https://gateway.internal/v1',
    });
    // A transcript is not a credential store.
    expect(JSON.stringify(driver.attribution)).not.toContain('test');
    expect(JSON.stringify(driver.attribution)).not.toContain('shhh');
  });

  it('omits what the config does not set', () => {
    buildModelMock.mockReturnValue(scriptedModel([]).model);
    const driver = createApiSessionDriver({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test',
    });
    expect(driver.attribution).toEqual({ provider: 'openai', model: 'gpt-5' });
  });

  it('records the model the RESPONSE reported on every turn', async () => {
    const scripted = scriptedModel([
      { content: [text('thinking')] },
      { content: [outcomeCall({ verdict: 'keep' })] },
    ]);
    buildModelMock.mockReturnValue(scripted.model);
    const { handle, events } = runSession(createApiSessionDriver(cfg));
    await handle.done;

    // The configured id is `primary-model`; what answered says `mock-model` —
    // the deployment-name / alias gap the per-turn field exists to close.
    const turns = events.filter((e) => e.type === 'assistant-turn');
    expect(turns).toHaveLength(2);
    for (const turn of turns) expect(turn).toMatchObject({ model: 'mock-model' });
    // And it rides the raw payload too, next to the wire messages.
    expect((turns[0] as { raw?: { payload?: { modelId?: string } } }).raw?.payload?.modelId).toBe(
      'mock-model',
    );
  });
});

// ---------------------------------------------------------------------------
// provider retries (item 11): the wait is transcript, not silence
// ---------------------------------------------------------------------------

describe('api session driver provider retries', () => {
  /** Drive a session with the waits captured instead of slept. */
  function retryHarness(
    turns: StubTurn[],
    retry?: Partial<{ attempts: number; baseDelayMs: number; maxDelayMs: number }>,
    fallbackTurns?: StubTurn[],
  ) {
    const primary = scriptedModel(turns);
    const fallback = scriptedModel(fallbackTurns ?? []);
    buildModelMock.mockImplementation((_cfg: unknown, modelId: string) =>
      modelId === 'primary-model' ? primary.model : fallback.model,
    );
    const slept: number[] = [];
    const driver = createApiSessionDriver(fallbackTurns ? cfg : cfgNoFallback, {
      ...(retry ? { retry } : {}),
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    return { ...runSession(driver), slept, primary, fallback };
  }

  it('retries a retryable failure with exponential backoff, recording each wait', async () => {
    const { handle, events, slept, primary } = retryHarness([
      { throws: apiError(529, true) },
      { throws: apiError(503, true) },
      { content: [outcomeCall({ verdict: 'keep' })] },
    ]);
    const result = await handle.done;

    expect(result.kind).toBe('outcome');
    expect(primary.calls).toHaveLength(3);
    expect(slept).toEqual([2000, 4000]); // 2s, doubled
    // One event per wait — attempt-numbered, and never counted as a turn.
    expect(events.filter((e) => e.type === 'provider-retry')).toEqual([
      { type: 'provider-retry', attempt: 1, status: 529, message: 'http 529', delayMs: 2000, model: 'primary-model' },
      { type: 'provider-retry', attempt: 2, status: 503, message: 'http 503', delayMs: 4000, model: 'primary-model' },
    ]);
    expect(events.filter((e) => e.type === 'assistant-turn')).toHaveLength(1);
  });

  it('honors Retry-After, clamped to the single-wait cap', async () => {
    const { handle, events, slept } = retryHarness(
      [
        { throws: apiError(429, true, { 'retry-after': '7' }) },
        { throws: apiError(429, true, { 'retry-after': '3600' }) },
        { content: [outcomeCall({ verdict: 'keep' })] },
      ],
      { maxDelayMs: 60_000 },
    );
    await handle.done;

    // 7s as asked; an hour is not a wait we honor blindly.
    expect(slept).toEqual([7000, 60_000]);
    expect(events.filter((e) => e.type === 'provider-retry').map((e) => (e as { delayMs: number }).delayMs)).toEqual([
      7000, 60_000,
    ]);
  });

  it('never retries a failure the SDK judged final', async () => {
    const { handle, events, primary } = retryHarness([{ throws: apiError(400, false) }]);
    const result = await handle.done;

    expect(primary.calls).toHaveLength(1);
    expect(events.some((e) => e.type === 'provider-retry')).toBe(false);
    expect(result).toMatchObject({
      kind: 'failure',
      failure: { kind: 'transport', class: 'validation', retryability: 'none' },
    });
  });

  it('gives up after the attempt cap and reports the last failure', async () => {
    const { handle, events, slept, primary } = retryHarness(
      [{ throws: apiError(529, true) }, { throws: apiError(529, true) }, { throws: apiError(529, true) }],
      { attempts: 3 },
    );
    const result = await handle.done;

    expect(primary.calls).toHaveLength(3);
    expect(slept).toHaveLength(2); // no wait after the last attempt
    expect(events.filter((e) => e.type === 'provider-retry')).toHaveLength(2);
    expect(result).toMatchObject({
      kind: 'failure',
      failure: { kind: 'transport', class: 'provider', retryability: 'transient' },
    });
  });

  it('records the fallback swap as a retry naming the model taking over', async () => {
    const { handle, events, primary, fallback } = retryHarness(
      [{ throws: apiError(529, true) }, { throws: apiError(529, true) }],
      { attempts: 2 },
      [{ content: [outcomeCall({ verdict: 'keep' })] }],
    );
    const result = await handle.done;

    expect(result.kind).toBe('outcome');
    expect(primary.calls).toHaveLength(2);
    expect(fallback.calls).toHaveLength(1);
    // The last event of the turn is the swap: no wait, and the model changes.
    expect(events.filter((e) => e.type === 'provider-retry').at(-1)).toMatchObject({
      attempt: 2,
      delayMs: 0,
      model: 'fallback-model',
    });
    // The turn that landed is attributed to whoever actually answered.
    expect(events.find((e) => e.type === 'assistant-turn')).toMatchObject({ model: 'mock-model' });
  });

  it('swaps to the fallback without retrying when the failure is final', async () => {
    const { handle, events, primary, fallback } = retryHarness(
      [{ throws: apiError(400, false) }],
      undefined,
      [{ content: [outcomeCall({ verdict: 'keep' })] }],
    );
    expect((await handle.done).kind).toBe('outcome');
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(1);
    expect(events.filter((e) => e.type === 'provider-retry')).toEqual([
      { type: 'provider-retry', attempt: 1, status: 400, message: 'http 400', delayMs: 0, model: 'fallback-model' },
    ]);
  });

  it('stops retrying once the shell interrupts the turn', async () => {
    const scripted = scriptedModel([
      { throws: apiError(529, true) },
      { throws: apiError(529, true) },
      { content: [outcomeCall({ verdict: 'keep' })] },
    ]);
    buildModelMock.mockReturnValue(scripted.model);
    const events: SessionEventBody[] = [];
    const driver = createApiSessionDriver(cfgNoFallback, {
      sleep: async () => {
        // The interrupt lands while the driver is waiting out the backoff.
        void handle.interrupt();
      },
    });
    const handle = driver.runSession({
      def: makeDef(),
      initialMessages: ['go'],
      onEvent: (e) => events.push(e),
      signal: new AbortController().signal,
    });
    const result = await handle.done;

    // One wait recorded, then the turn stops instead of sitting out four more.
    expect(scripted.calls).toHaveLength(1);
    expect(events.filter((e) => e.type === 'provider-retry')).toHaveLength(1);
    expect(result.kind).toBe('failure');
  });
});
