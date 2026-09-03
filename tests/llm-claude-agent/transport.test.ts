/**
 * The Agent SDK one-shot transport: one `query()` per request, the `-p`
 * isolation flags carried over as options, the result text returned raw,
 * usage and the call record reported like the spawn did, and the harness's
 * refusals (a rejected rate limit, synthetic text) surfacing as FAILED calls.
 * The SDK is faked through the transport's seam.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createClaudeAgentTransport } from '../../packages/llm-claude-agent/src/index';
import type { SdkMessage, SdkModule, SdkQueryOptions, SdkUserMessage } from '../../packages/llm-claude-agent/src/sdk-types';
// The dist entry the transport reports into — the source copy would be a
// different module instance, with its own usage table and sink slot.
import { getStageUsage, resetStageUsage, setLlmCallSink, type LlmCallRecord } from '@truecourse/shared/llm';

interface FakeCtx {
  options: SdkQueryOptions;
  prompt: string | AsyncIterable<SdkUserMessage>;
}

/** A fake SdkModule whose query() yields whatever `script` produces for the call. */
function fakeSdk(script: (ctx: FakeCtx) => AsyncGenerator<SdkMessage, void>) {
  const captured: { options?: SdkQueryOptions; prompt?: string | AsyncIterable<SdkUserMessage>; interrupted: boolean } =
    { interrupted: false };
  const sdk: SdkModule = {
    tool: () => {
      throw new Error('a one-shot registers no tools');
    },
    createSdkMcpServer: () => {
      throw new Error('a one-shot mounts no MCP server');
    },
    query({ prompt, options }) {
      captured.options = options ?? {};
      captured.prompt = prompt;
      const generator = script({ options: options ?? {}, prompt });
      return Object.assign(generator, {
        interrupt: async () => {
          captured.interrupted = true;
        },
      });
    },
  };
  return { sdk, captured };
}

const init = (): SdkMessage => ({ type: 'system', subtype: 'init', session_id: 'prov-1' });
const delta = (): SdkMessage => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '{' } },
});
const success = (text: string, over: Record<string, unknown> = {}): SdkMessage => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  session_id: 'prov-1',
  result: text,
  duration_ms: 1200,
  duration_api_ms: 900,
  num_turns: 1,
  total_cost_usd: 0.012,
  usage: { input_tokens: 40, output_tokens: 20, cache_read_input_tokens: 500, cache_creation_input_tokens: 10 },
  modelUsage: {
    'claude-sonnet-4-6': { inputTokens: 40, outputTokens: 20, cacheReadInputTokens: 500, cacheCreationInputTokens: 10, costUSD: 0.012 },
  },
  ...over,
});

const req = {
  id: 'guard.match:flow-1:api',
  stage: 'guard.match',
  model: 'sonnet',
  fallbackModel: 'opus',
  system: 'You match flows to interfaces.',
  user: 'Match this flow.',
  responseFormat: 'json' as const,
  schema: '{"type":"object"}',
};

describe('claude agent one-shot transport', () => {
  const records: LlmCallRecord[] = [];
  beforeEach(() => {
    resetStageUsage();
    records.length = 0;
    setLlmCallSink((rec) => records.push(rec));
  });
  afterEach(() => {
    setLlmCallSink(undefined);
  });

  it('runs one query with the output-only isolation the spawn had, and returns the raw text', async () => {
    const { sdk, captured } = fakeSdk(async function* () {
      yield init();
      yield delta();
      yield success('{"matched": true}');
    });
    const transport = createClaudeAgentTransport({ sdk, pathToClaudeCodeExecutable: '/opt/claude' });

    await expect(transport(req)).resolves.toBe('{"matched": true}');

    // The prompt travels as raw text — content can never read as an option.
    expect(captured.prompt).toBe('Match this flow.');
    expect(captured.options).toMatchObject({
      tools: [],
      disallowedTools: ['ToolSearch'],
      strictMcpConfig: true,
      settings: { autoCompactEnabled: false },
      permissionMode: 'dontAsk',
      systemPrompt: 'You match flows to interfaces.',
      settingSources: ['user'],
      includePartialMessages: true,
      pathToClaudeCodeExecutable: '/opt/claude',
      model: 'sonnet',
      fallbackModel: 'opus',
    });
    expect(captured.options?.mcpServers).toBeUndefined();
    expect(captured.options?.outputFormat).toBeUndefined();
    expect(captured.options?.env).toMatchObject({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
    expect(captured.options?.abortController).toBeInstanceOf(AbortController);
  });

  it('reports usage under the stage, resolving the alias to the model that served it', async () => {
    const { sdk } = fakeSdk(async function* () {
      yield init();
      yield success('{}');
    });
    await createClaudeAgentTransport({ sdk })(req);

    const usage = getStageUsage().get('guard.match');
    expect(usage).toMatchObject({
      model: 'claude-sonnet-4-6',
      inputTokens: 40,
      outputTokens: 20,
      cacheReadTokens: 500,
      cacheCreateTokens: 10,
      costUsd: 0.012,
      calls: 1,
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      ok: true,
      outcome: 'ok',
      stage: 'guard.match',
      id: 'guard.match:flow-1:api',
      model: 'claude-sonnet-4-6',
      exitCode: 0,
      eventCount: 2,
      claudeDurationMs: 1200,
      apiDurationMs: 900,
      numTurns: 1,
      responseText: '{}',
    });
  });

  it('carries an image as one streamed user message, text first, then closes the input', async () => {
    const { sdk, captured } = fakeSdk(async function* () {
      yield init();
      yield success('{"verdict":"pass"}');
    });
    await createClaudeAgentTransport({ sdk })({
      ...req,
      images: [{ mediaType: 'image/png', data: 'aGVsbG8=' }],
    });

    expect(typeof captured.prompt).not.toBe('string');
    const messages: SdkUserMessage[] = [];
    for await (const m of captured.prompt as AsyncIterable<SdkUserMessage>) messages.push(m);
    expect(messages).toHaveLength(1);
    expect(messages[0].message.content).toEqual([
      { type: 'text', text: 'Match this flow.' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
    ]);
  });

  it("a rejected rate limit with the harness's own notice is a FAILED call, never an answer", async () => {
    const { sdk } = fakeSdk(async function* () {
      yield init();
      yield {
        type: 'rate_limit_event',
        rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: Math.floor(Date.now() / 1000) + 60 },
      } as SdkMessage;
      yield {
        type: 'assistant',
        parent_tool_use_id: null,
        session_id: 'prov-1',
        message: { model: '<synthetic>', content: [{ type: 'text', text: "You've hit your session limit · resets 7:50pm" }] },
      } as SdkMessage;
      yield success("You've hit your session limit · resets 7:50pm", { modelUsage: {}, usage: {} });
    });

    await expect(createClaudeAgentTransport({ sdk })(req)).rejects.toThrow(
      /claude refused the call — rate limited \(five_hour\), resets in \d+s: You've hit your session limit/,
    );
    expect(getStageUsage().get('guard.match')).toBeUndefined();
    expect(records[0]).toMatchObject({ ok: false, outcome: 'error', exitCode: null });
  });

  it('an error-subtype result fails with its errors, even though the iterator throws after it', async () => {
    const { sdk } = fakeSdk(async function* () {
      yield init();
      yield {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        session_id: 'prov-1',
        errors: ['boom', 'and again'],
      } as SdkMessage;
      throw new Error('iterator throws after an error result');
    });

    await expect(createClaudeAgentTransport({ sdk })(req)).rejects.toThrow(
      'claude error_during_execution: boom; and again',
    );
  });

  it('a success flagged is_error is an API error, as the spawn reported it', async () => {
    const { sdk } = fakeSdk(async function* () {
      yield init();
      yield success('overloaded', { is_error: true, api_error_status: 529 });
    });

    await expect(createClaudeAgentTransport({ sdk })(req)).rejects.toThrow('claude API error (api 529): overloaded');
  });

  it('a query that never starts fails with the SDK error', async () => {
    const sdk: SdkModule = {
      tool: () => undefined,
      createSdkMcpServer: () => undefined,
      query: () => {
        throw new Error('binary not found');
      },
    };
    await expect(createClaudeAgentTransport({ sdk })(req)).rejects.toThrow(
      'claude query failed to start: binary not found',
    );
  });

  it('the wall-clock ceiling aborts a silent call as a timeout', async () => {
    const { sdk, captured } = fakeSdk(async function* (ctx) {
      // Nothing ever arrives; the ceiling's abort is what ends the call.
      await new Promise<void>((resolve) => ctx.options.abortController?.signal.addEventListener('abort', () => resolve()));
      throw new Error('aborted');
    });

    await expect(createClaudeAgentTransport({ sdk })({ ...req, timeoutMs: 50 })).rejects.toThrow(
      'claude timed out after 50ms',
    );
    expect(captured.options?.abortController?.signal.aborted).toBe(true);
    expect(records[0]).toMatchObject({ ok: false, outcome: 'timeout', timeoutMs: 50, eventCount: 0 });
  });

  it('a started-then-silent stream is killed as a stall, distinct from the ceiling', async () => {
    process.env.TRUECOURSE_LLM_STALL_TIMEOUT_MS = '40';
    try {
      const { sdk } = fakeSdk(async function* (ctx) {
        yield init();
        await new Promise<void>((resolve) => ctx.options.abortController?.signal.addEventListener('abort', () => resolve()));
        throw new Error('aborted');
      });

      await expect(createClaudeAgentTransport({ sdk })({ ...req, timeoutMs: 5_000 })).rejects.toThrow(
        'claude stalled: no stream event for 40ms',
      );
      expect(records[0]).toMatchObject({ ok: false, outcome: 'stall', stallTimeoutMs: 40, eventCount: 1 });
    } finally {
      delete process.env.TRUECOURSE_LLM_STALL_TIMEOUT_MS;
    }
  });
});
