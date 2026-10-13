/**
 * Matching's catalog must close a provider cache prefix across independent
 * flows and corrective sessions. The API cases run the real AI SDK provider
 * over a captured fetch, so a dropped cache option fails at the wire boundary.
 * The Agent SDK cases capture query options and streaming input; the installed
 * harness owns the conversion from its custom system prompt to cache blocks.
 * No test sends a request to a provider.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildMatchCatalogPrompt,
  buildMatchTaskPrompt,
  type MatchUserContext,
} from '@truecourse/guard-generator';
import { createGuardGenerateLeafSessions } from '../../packages/core/src/services/guard-generate/leaf-sessions.js';
import { createApiSessionDriver } from '../../packages/llm-api/src/session-driver.js';
import { createClaudeAgentSessionDriver } from '../../packages/llm-claude-agent/src/session-driver.js';
import type { SdkModule, SdkQueryOptions, SdkUserMessage } from '../../packages/llm-claude-agent/src/sdk-types.js';
import { memoryPersistence } from './spec-scan-session-stub.js';

const base: MatchUserContext = {
  surface: 'web',
  // At least as large as the catalog that exposed the repeated-write problem.
  interfaces: Array.from({ length: 300 }, (_, i) => ({
    id: `web:action-${i}`,
    title: `Catalog action ${i}`,
    entry: `/action/${i}`,
    context: [`catalog context ${i}`, 'requires state: anonymous'],
    steps: [`click action ${i}`, `observe ${'catalog detail '.repeat(100)}${i}`],
  })),
  flow: { id: 'flow-login', title: 'Unique login flow', goal: 'Unique account access goal' },
  milestones: [{
    order: 1,
    claim: 'Unique login obligation',
    note: 'Unique synthesis note',
  }],
};

const other: MatchUserContext = {
  ...base,
  flow: { id: 'flow-logout', title: 'Unique logout flow', goal: 'Unique session end goal' },
  milestones: [{ order: 1, claim: 'Unique logout obligation' }],
};
const correction: MatchUserContext = {
  ...base,
  issues: { unknownInterfaces: ['missing:action'], unknownMilestones: [9], uncoveredMilestones: [1], gapErrors: ['Unique invalid gap'] },
  correction: { invalidOutput: 'Unique invalid previous reply' },
};
const changed: MatchUserContext = {
  ...base,
  interfaces: base.interfaces.map((entry, i) => i === 299 ? { ...entry, entry: '/changed-last-entry' } : entry),
};
const contexts = [base, other, correction, changed];
const answer = { plan: [{ interfaceId: 'web:action-0', milestone: 1 }] };

afterEach(() => vi.unstubAllGlobals());

describe('matching catalog and task contents', () => {
  it('keeps the complete catalog exactly once, before every changing obligation', () => {
    const catalog = buildMatchCatalogPrompt(base);
    expect(catalog.length).toBeGreaterThan(411_000);
    for (const ctx of contexts) {
      const stable = buildMatchCatalogPrompt(ctx);
      const task = buildMatchTaskPrompt(ctx);
      expect(task).not.toContain('INTERFACE CATALOG');
      for (const entry of ctx.interfaces) {
        expect(stable.split(`--- id: ${entry.id}\n`)).toHaveLength(2);
        expect(stable).toContain(`title: ${entry.title}\nentry: ${entry.entry}`);
        for (const line of [...entry.context!, ...entry.steps]) expect(stable).toContain(line);
      }
    }
    expect(buildMatchCatalogPrompt(other)).toBe(catalog);
    expect(buildMatchCatalogPrompt(correction)).toBe(catalog);
    expect(buildMatchCatalogPrompt(changed)).not.toBe(catalog);
    expect(buildMatchCatalogPrompt({ ...base, surface: 'api' })).not.toBe(catalog);
    const task = buildMatchTaskPrompt(correction);
    for (const value of ['Unique login flow', 'Unique account access goal', 'Unique login obligation',
      'Unique synthesis note', 'missing:action',
      '  9', '  1', 'Unique invalid gap', 'Unique invalid previous reply']) {
      expect(task).toContain(value);
      expect(catalog).not.toContain(value);
    }
  });
});

type TextBlock = { type: string; text: string; cache_control?: { type: string } };
type ApiRequest = { system: TextBlock[]; tools: unknown[]; messages: Array<{ role: string; content: TextBlock[] }> };

/** An Anthropic SSE response ending in the driver's outcome tool. */
function response(): Response {
  const events = [
    { type: 'message_start', message: { id: 'msg-test', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool-test', name: 'outcome', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(answer) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

type OpenAiRequest = {
  prompt_cache_key?: string;
  tools: unknown[];
  input: Array<{ role: string; content: string }>;
};

/** An OpenAI Responses SSE stream ending in the driver's outcome tool. */
function openAiResponse(): Response {
  const item = { id: 'fc_test', type: 'function_call', call_id: 'call_test', name: 'outcome' };
  const args = JSON.stringify(answer);
  const events = [
    { type: 'response.created', response: { id: 'resp_test', created_at: 0, model: 'gpt-5.6-sol' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 0, item_id: item.id, delta: args },
    { type: 'response.output_item.done', output_index: 0, item: { ...item, status: 'completed', arguments: args } },
    { type: 'response.completed', response: { incomplete_details: null, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ];
  return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('matching provider boundaries', () => {
  it('sends an explicit system cache_control through the real Anthropic API driver', async () => {
    const requests: ApiRequest[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return response();
    });
    const driver = createApiSessionDriver({ provider: 'anthropic', model: 'claude-opus-5-5', apiKey: 'test' });
    const { persistence } = memoryPersistence();
    const leaves = createGuardGenerateLeafSessions({ acquire: async () => ({ driver, persistence }) });
    for (const ctx of contexts) await expect(leaves.matchRunner(ctx)).resolves.toEqual(answer);
    expect(requests).toHaveLength(4);
    for (const [i, request] of requests.entries()) {
      expect(request.system).toHaveLength(1);
      expect(request.system[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(request.system[0].text.endsWith(buildMatchCatalogPrompt(contexts[i]))).toBe(true);
      expect(request.messages).toHaveLength(1);
      expect(request.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: buildMatchTaskPrompt(contexts[i]), cache_control: { type: 'ephemeral' } }] });
      expect(request.tools).toEqual(requests[0].tools);
    }
    expect(requests[1].system).toEqual(requests[0].system);
    expect(requests[2].system).toEqual(requests[0].system);
    expect(requests[3].system).not.toEqual(requests[0].system);
  });

  // OpenAI caches a repeated prefix on its own, but only among requests that
  // carry the same prompt cache key: a key per session and no two matches read
  // the catalog back, however identical their prefix.
  it('sends every match under one prompt cache key through the real OpenAI API driver', async () => {
    const requests: OpenAiRequest[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)));
      return openAiResponse();
    });
    const driver = createApiSessionDriver({ provider: 'openai', model: 'gpt-5.6-sol', apiKey: 'test' });
    const { persistence } = memoryPersistence();
    const leaves = createGuardGenerateLeafSessions({ acquire: async () => ({ driver, persistence }) });
    for (const ctx of contexts) await expect(leaves.matchRunner(ctx)).resolves.toEqual(answer);
    expect(requests).toHaveLength(4);
    for (const [i, request] of requests.entries()) {
      expect(request.prompt_cache_key).toBe('guard-generate.match');
      // Tools, then the instructions and the catalog, lead the request; the
      // flow's own text follows them.
      expect(request.tools).toEqual(requests[0].tools);
      expect(request.input[0].content.endsWith(buildMatchCatalogPrompt(contexts[i]))).toBe(true);
      expect(JSON.stringify(request.input.slice(1))).toContain(JSON.stringify(buildMatchTaskPrompt(contexts[i])).slice(1, -1));
    }
    expect(requests[1].input[0]).toEqual(requests[0].input[0]);
    expect(requests[2].input[0]).toEqual(requests[0].input[0]);
  });

  it('passes the same full system prompt to separate Agent SDK sessions, with only the task in streaming input', async () => {
    const calls: Array<{ options: SdkQueryOptions; messages: SdkUserMessage[] }> = [];
    const sdk: SdkModule = {
      tool() { throw new Error('matching has no tools'); },
      createSdkMcpServer: options => options,
      query({ prompt, options }) {
        if (typeof prompt === 'string') throw new Error('expected streaming input');
        const call = { options: options!, messages: [] as SdkUserMessage[] };
        calls.push(call);
        return Object.assign((async function* () {
          const first = await prompt[Symbol.asyncIterator]().next();
          if (!first.done) call.messages.push(first.value);
          yield { type: 'result', subtype: 'success', session_id: `session-${calls.length}`, structured_output: answer };
        })(), { interrupt: async () => {} });
      },
    };
    const driver = createClaudeAgentSessionDriver({ sdk, pathToClaudeCodeExecutable: '/unused/claude', model: 'claude-opus-5-5' });
    const { persistence } = memoryPersistence();
    const leaves = createGuardGenerateLeafSessions({ acquire: async () => ({ driver, persistence }) });
    for (const ctx of contexts) await expect(leaves.matchRunner(ctx)).resolves.toEqual(answer);
    expect(calls).toHaveLength(4);
    for (const [i, call] of calls.entries()) {
      expect(call.options.systemPrompt!.endsWith(buildMatchCatalogPrompt(contexts[i]))).toBe(true);
      expect(call.messages).toHaveLength(1);
      expect(call.messages[0].message.content).toBe(buildMatchTaskPrompt(contexts[i]));
      expect(call.options.outputFormat).toEqual(calls[0].options.outputFormat);
      expect(call.options.tools).toEqual([]);
      expect(call.options.settingSources).toEqual([]);
      expect(call.options).not.toHaveProperty('resume');
    }
    expect(calls[1].options.systemPrompt).toBe(calls[0].options.systemPrompt);
    expect(calls[2].options.systemPrompt).toBe(calls[0].options.systemPrompt);
    expect(calls[3].options.systemPrompt).not.toBe(calls[0].options.systemPrompt);
  });
});
