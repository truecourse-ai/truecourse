/**
 * The Agent SDK session driver (AGENTIC_PIPELINE_PLAN §3.3): streaming-input
 * `query()`, one subprocess per session, tools as in-process MCP handlers,
 * the native json-schema outcome, and the HARDCODED isolation invariants.
 * The SDK itself is faked through the driver's lazy-import seam; the fake
 * scripts `query()` messages and invokes MCP tool handlers the way the real
 * subprocess pipeline would.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  createClaudeAgentSessionDriver,
  SESSION_MCP_SERVER_NAME,
} from '../../packages/llm-claude-agent/src/index';
import type {
  SdkMessage,
  SdkModule,
  SdkQueryOptions,
  SdkUserMessage,
  SdkMcpToolResult,
} from '../../packages/llm-claude-agent/src/sdk-types';
import type { SessionDef, SessionEventBody, SessionRunInput } from '@truecourse/shared/llm';
import { defineSessionTool } from '@truecourse/shared/llm';

// ---------------------------------------------------------------------------
// fake SDK
// ---------------------------------------------------------------------------

interface FakeTool {
  name: string;
  description: string;
  handler: (args: unknown, extra: unknown) => Promise<SdkMcpToolResult>;
}

interface FakeCtx {
  options: SdkQueryOptions;
  /** User messages the driver pushed, in order, as they arrive. */
  received: SdkUserMessage[];
  /** Await the next pushed user message. */
  nextUserMessage(): Promise<SdkUserMessage | undefined>;
  /** Registered in-process MCP tools, by bare name. */
  tools: Map<string, FakeTool>;
  interrupted(): boolean;
}

/** Build a fake SdkModule whose query() runs `script` against the driver. */
function fakeSdk(script: (ctx: FakeCtx) => AsyncGenerator<SdkMessage, void>) {
  const captured: { options?: SdkQueryOptions; received: SdkUserMessage[] } = { received: [] };
  const tools = new Map<string, FakeTool>();
  const sdk: SdkModule = {
    tool(name, description, _shape, handler) {
      const t: FakeTool = { name, description, handler };
      tools.set(name, t);
      return t;
    },
    createSdkMcpServer(options) {
      return { type: 'sdk', name: options.name, instance: { tools: options.tools } };
    },
    query({ prompt, options }) {
      captured.options = options ?? {};
      let interrupted = false;
      const iterator = prompt[Symbol.asyncIterator]();
      const ctx: FakeCtx = {
        options: options ?? {},
        received: captured.received,
        async nextUserMessage() {
          const next = await iterator.next();
          if (next.done) return undefined;
          captured.received.push(next.value);
          return next.value;
        },
        tools,
        interrupted: () => interrupted,
      };
      const generator = script(ctx);
      return Object.assign(generator, {
        interrupt: async () => {
          interrupted = true;
        },
      });
    },
  };
  return { sdk, captured, tools };
}

// message constructors
const init = (over?: Record<string, unknown>): SdkMessage => ({
  type: 'system',
  subtype: 'init',
  session_id: 'prov-1',
  apiKeySource: 'none',
  tools: [],
  mcp_servers: [{ name: SESSION_MCP_SERVER_NAME, status: 'connected' }],
  ...over,
});
const assistant = (
  content: Array<Record<string, unknown>>,
  usage = { input_tokens: 40, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 },
): SdkMessage => ({
  type: 'assistant',
  parent_tool_use_id: null,
  session_id: 'prov-1',
  message: { content: content as never, usage },
});
const success = (structured_output?: unknown): SdkMessage => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  session_id: 'prov-1',
  ...(structured_output !== undefined ? { structured_output } : {}),
});

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
    return { content: `probed:${args.value}` };
  },
});

function makeDef(overrides?: Partial<SessionDef>): SessionDef {
  return {
    kind: 'spec-scan.curation',
    systemPrompt: 'you curate docs',
    tools: [probeTool],
    outcomeSchema,
    budget: { turns: 10, maxResumes: 1, tokenCeiling: 1_000_000 },
    ...overrides,
  };
}

function runSession(sdk: SdkModule, overrides?: Partial<SessionRunInput>) {
  const events: SessionEventBody[] = [];
  const driver = createClaudeAgentSessionDriver({ sdk, pathToClaudeCodeExecutable: '/bin/claude' });
  const handle = driver.runSession({
    def: makeDef(),
    initialMessages: ['go'],
    onEvent: (e) => events.push(e),
    signal: new AbortController().signal,
    ...overrides,
  });
  return { driver, handle, events };
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe('claude agent session driver', () => {
  it('declares live steering, native structured outcome, and resume-at-message', () => {
    const { sdk } = fakeSdk(async function* () {});
    const driver = createClaudeAgentSessionDriver({ sdk });
    expect(driver.capabilities).toEqual({
      steering: 'live',
      structuredOutcome: 'native',
      resumeAtMessage: true,
    });
  });

  it('runs an episode to a structured outcome, executing tools in-process', async () => {
    const { sdk, captured } = fakeSdk(async function* (ctx) {
      await ctx.nextUserMessage();
      yield init();
      yield assistant([{ type: 'text', text: 'let me probe' }]);
      const toolUse = {
        type: 'tool_use',
        id: 'tu-1',
        name: `mcp__${SESSION_MCP_SERVER_NAME}__probe`,
        input: { value: 'hi' },
      };
      yield assistant([toolUse]);
      // The real subprocess pipeline invokes the in-process handler; the
      // fake does the same.
      const tool = ctx.tools.get('probe');
      if (!tool) throw new Error('probe not registered as an MCP tool');
      const result = await tool.handler({ value: 'hi' }, {});
      expect(result).toEqual({ content: [{ type: 'text', text: 'probed:hi' }] });
      yield success({ verdict: 'keep' });
    });

    const { handle, events } = runSession(sdk);
    const result = await handle.done;

    expect(result).toMatchObject({
      kind: 'outcome',
      value: { verdict: 'keep' },
      resumeCursor: { providerSessionId: 'prov-1' },
    });
    expect(events.map((e) => e.type)).toEqual([
      'user-message',
      'assistant-turn',
      'assistant-turn',
      'tool-result',
    ]);
    // Tool names in the transcript are the BARE session names, not the
    // mcp__-qualified wire names.
    expect(events[2]).toMatchObject({ toolCall: { name: 'probe', args: { value: 'hi' } } });
    expect(events[3]).toMatchObject({ toolName: 'probe', content: 'probed:hi' });
    // Usage lands in the four buckets from the provider fields.
    expect(events[1]).toMatchObject({
      usage: { inputTokens: 40, outputTokens: 20, cacheReadTokens: 50, cacheCreateTokens: 10 },
    });
    expect(captured.received[0]?.message.content).toBe('go');
    expect(handle.status()).toBe('completed');
  });

  it('hardcodes the §3.3 isolation invariants on every query', async () => {
    process.env.TC_TEST_ISOLATION_MARKER = 'inherited';
    const { sdk, captured } = fakeSdk(async function* (ctx) {
      await ctx.nextUserMessage();
      yield init();
      yield success({ verdict: 'keep' });
    });
    await runSession(sdk).handle.done;
    const o = captured.options;
    if (!o) throw new Error('query never invoked');

    expect(o.tools).toEqual([]);
    expect(o.disallowedTools).toContain('ToolSearch');
    expect(o.settingSources).toEqual([]);
    expect(o.systemPrompt).toBe('you curate docs');
    expect(o.strictMcpConfig).toBe(true);
    expect(o.settings).toMatchObject({ autoCompactEnabled: false });
    // env spreads the parent's (replacing it wholesale breaks credential
    // lookup) and disables auto-memory.
    expect(o.env?.TC_TEST_ISOLATION_MARKER).toBe('inherited');
    expect(o.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('1');
    expect(o.permissionMode).toBe('dontAsk');
    expect(o.allowedTools).toEqual([`mcp__${SESSION_MCP_SERVER_NAME}__probe`]);
    expect(o.outputFormat).toMatchObject({ type: 'json_schema' });
    expect(o.pathToClaudeCodeExecutable).toBe('/bin/claude');
    // The SDK's own turn limit is a DISTANT backstop, far above the budget.
    expect(o.maxTurns).toBeGreaterThan(10 * (1 + 1));
    delete process.env.TC_TEST_ISOLATION_MARKER;
  });

  it('a success result missing structured_output is a malformed failure', async () => {
    const { sdk } = fakeSdk(async function* (ctx) {
      await ctx.nextUserMessage();
      yield init();
      yield assistant([{ type: 'text', text: 'done, i think' }]);
      yield success();
    });
    const { handle } = runSession(sdk);
    const result = await handle.done;
    expect(result).toMatchObject({
      kind: 'failure',
      failure: { kind: 'malformed', detail: expect.stringContaining('structured output') },
      resumeCursor: { providerSessionId: 'prov-1' },
    });
  });

  it('maps structured-output retry exhaustion to malformed and execution errors to transient transport', async () => {
    for (const [subtype, expected] of [
      ['error_max_structured_output_retries', { kind: 'malformed' }],
      ['error_during_execution', { kind: 'transport', retryability: 'transient' }],
    ] as const) {
      const { sdk } = fakeSdk(async function* (ctx) {
        await ctx.nextUserMessage();
        yield init();
        yield {
          type: 'result',
          subtype,
          is_error: true,
          session_id: 'prov-1',
          errors: ['boom'],
        } as SdkMessage;
      });
      const { handle } = runSession(sdk);
      const result = await handle.done;
      expect(result.kind).toBe('failure');
      if (result.kind !== 'failure') throw new Error('unreachable');
      expect(result.failure).toMatchObject(expected);
    }
  });

  it('survives the iterator throwing after an error result (spike rule)', async () => {
    const { sdk } = fakeSdk(async function* (ctx) {
      await ctx.nextUserMessage();
      yield init();
      yield {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        session_id: 'prov-1',
        errors: ['exploded'],
      } as SdkMessage;
      throw new Error('iterator throws after error results');
    });
    const { handle } = runSession(sdk);
    const result = await handle.done;
    expect(result).toMatchObject({
      kind: 'failure',
      failure: { kind: 'transport', retryability: 'transient' },
    });
  });

  it('steers join the live episode and are recorded on ingestion', async () => {
    const { sdk, captured } = fakeSdk(async function* (ctx) {
      await ctx.nextUserMessage();
      yield init();
      yield assistant([{ type: 'text', text: 'working' }]);
      // The steer arrives mid-episode; the fake ingests it live.
      const steer = await ctx.nextUserMessage();
      expect(steer?.message.content).toBe('skip the archive');
      yield success({ verdict: 'keep' });
    });
    const events: SessionEventBody[] = [];
    const driver = createClaudeAgentSessionDriver({ sdk });
    const handle = driver.runSession({
      def: makeDef(),
      initialMessages: ['go'],
      onEvent: (e) => {
        events.push(e);
        if (e.type === 'assistant-turn') handle.steer('skip the archive');
      },
      signal: new AbortController().signal,
    });
    const result = await handle.done;
    expect(result.kind).toBe('outcome');
    expect(captured.received.map((m) => m.message.content)).toEqual(['go', 'skip the archive']);
    expect(
      events.filter((e) => e.type === 'user-message').map((e) => (e as { content: string }).content),
    ).toEqual(['go', 'skip the archive']);
  });

  it('resumes by cursor, nudging when no new observation is given', async () => {
    const { sdk, captured } = fakeSdk(async function* (ctx) {
      const nudge = await ctx.nextUserMessage();
      expect(nudge?.message.content).toContain('Continue');
      yield init({ session_id: 'prov-2' });
      yield success({ verdict: 'resumed' });
    });
    const { handle } = runSession(sdk, {
      initialMessages: [],
      resume: {
        cursor: { providerSessionId: 'prov-1', resumeSessionAt: 'uuid-7' },
        events: [],
      },
    });
    const result = await handle.done;
    expect(result).toMatchObject({ kind: 'outcome', value: { verdict: 'resumed' } });
    expect(captured.options?.resume).toBe('prov-1');
    expect(captured.options?.resumeSessionAt).toBe('uuid-7');
  });

  it('interrupt ends the episode without an outcome', async () => {
    const { sdk } = fakeSdk(async function* (ctx) {
      await ctx.nextUserMessage();
      yield init();
      for (let i = 0; i < 20 && !ctx.interrupted(); i++) {
        yield assistant([{ type: 'text', text: `turn ${i}` }]);
      }
      yield {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        session_id: 'prov-1',
        errors: ['aborted by interrupt'],
      } as SdkMessage;
    });
    const events: SessionEventBody[] = [];
    const driver = createClaudeAgentSessionDriver({ sdk });
    const handle = driver.runSession({
      def: makeDef(),
      initialMessages: ['go'],
      onEvent: (e) => {
        events.push(e);
        if (e.type === 'assistant-turn') void handle.interrupt();
      },
      signal: new AbortController().signal,
    });
    const result = await handle.done;
    // The shell asked for the stop; the driver reports ended-without-outcome
    // (malformed) for the shell to rewrite into the semantic failure.
    expect(result).toMatchObject({ kind: 'failure', failure: { kind: 'malformed' } });
    expect(events.filter((e) => e.type === 'assistant-turn').length).toBeLessThan(20);
  });

  it('records user messages only when the subprocess actually ingests them', async () => {
    // The query dies at spawn, before ever pulling from the input stream: no
    // user-message event may be recorded (the shell's retry probe relies on
    // ingestion-time recording to know it must replay the initial messages).
    const { sdk } = fakeSdk(async function* () {
      throw new Error('spawn ENOENT');
    });
    const { handle, events } = runSession(sdk);
    const result = await handle.done;
    expect(result).toMatchObject({ kind: 'failure', failure: { kind: 'transport' } });
    expect(events.filter((e) => e.type === 'user-message')).toHaveLength(0);
  });

  it('drops (and never records) a steer that races session end', async () => {
    const { sdk } = fakeSdk(async function* (ctx) {
      await ctx.nextUserMessage();
      yield init();
      yield success({ verdict: 'keep' });
    });
    const { handle, events } = runSession(sdk);
    await handle.done;
    handle.steer('too late');
    await new Promise((r) => setTimeout(r, 0));
    expect(
      events.some((e) => e.type === 'user-message' && e.content === 'too late'),
    ).toBe(false);
  });

  it('fails BLOCKED when the init lists no session MCP server at all', async () => {
    const { sdk } = fakeSdk(async function* (ctx) {
      await ctx.nextUserMessage();
      yield init({ mcp_servers: [] });
      yield assistant([{ type: 'text', text: 'should never be reached' }]);
    });
    const { handle, events } = runSession(sdk);
    const result = await handle.done;
    expect(result).toMatchObject({
      kind: 'failure',
      failure: { kind: 'transport', retryability: 'blocked' },
    });
    expect(events.some((e) => e.type === 'assistant-turn')).toBe(false);
  });

  it('fails BLOCKED when the init preflight finds the MCP server missing', async () => {
    const { sdk } = fakeSdk(async function* (ctx) {
      await ctx.nextUserMessage();
      yield init({ mcp_servers: [{ name: SESSION_MCP_SERVER_NAME, status: 'failed' }] });
      yield assistant([{ type: 'text', text: 'should never be reached' }]);
    });
    const { handle, events } = runSession(sdk);
    const result = await handle.done;
    expect(result).toMatchObject({
      kind: 'failure',
      failure: { kind: 'transport', retryability: 'blocked' },
    });
    expect(events.some((e) => e.type === 'assistant-turn')).toBe(false);
  });

  it('merges assistant messages sharing one message.id into a single turn', async () => {
    // The real CLI splits one API assistant turn into several SDK assistant
    // messages (per content block) sharing message.id and REPEATING its
    // usage — observed live 2026-08-17. One API turn must stay one budget
    // turn with its usage counted once.
    const { sdk } = fakeSdk(async function* (ctx) {
      await ctx.nextUserMessage();
      yield init();
      const usage = { input_tokens: 1046, output_tokens: 4, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      yield {
        type: 'assistant',
        parent_tool_use_id: null,
        session_id: 'prov-1',
        message: { id: 'msg-1', content: [{ type: 'text', text: 'let me look' }], usage },
      } as SdkMessage;
      yield {
        type: 'assistant',
        parent_tool_use_id: null,
        session_id: 'prov-1',
        message: {
          id: 'msg-1',
          content: [
            {
              type: 'tool_use',
              id: 'tu-1',
              name: `mcp__${SESSION_MCP_SERVER_NAME}__probe`,
              input: { value: 'hi' },
            },
          ],
          usage,
        },
      } as SdkMessage;
      // The pipeline runs the handler after delivering the tool_use part.
      const tool = ctx.tools.get('probe');
      if (!tool) throw new Error('probe not registered');
      await tool.handler({ value: 'hi' }, {});
      yield success({ verdict: 'keep' });
    });
    const { handle, events } = runSession(sdk);
    const result = await handle.done;

    expect(result.kind).toBe('outcome');
    const turns = events.filter((e) => e.type === 'assistant-turn');
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      text: 'let me look',
      toolCall: { name: 'probe', args: { value: 'hi' } },
      usage: { inputTokens: 1046, outputTokens: 4 },
    });
    // The merged turn is flushed BEFORE its own tool's result event.
    const types = events.map((e) => e.type);
    expect(types.indexOf('assistant-turn')).toBeLessThan(types.indexOf('tool-result'));
  });

  it('ignores subagent-attributed assistant messages', async () => {
    const { sdk } = fakeSdk(async function* (ctx) {
      await ctx.nextUserMessage();
      yield init();
      yield {
        type: 'assistant',
        parent_tool_use_id: 'tu-parent',
        session_id: 'prov-1',
        message: { content: [{ type: 'text', text: 'subagent chatter' }] },
      } as SdkMessage;
      yield success({ verdict: 'keep' });
    });
    const { handle, events } = runSession(sdk);
    await handle.done;
    expect(events.some((e) => e.type === 'assistant-turn')).toBe(false);
  });
});
