import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStageUsage, resetStageUsage } from '@truecourse/shared/llm';

// Mock the LOCAL model builder (same pattern as transport.test.ts): the REAL
// generateText runs against a minimal LanguageModelV3 stub, fully offline.
const { buildModelMock } = vi.hoisted(() => ({ buildModelMock: vi.fn() }));
vi.mock('../../packages/llm-api/src/model.js', () => ({ buildModel: buildModelMock }));

import { createApiTransport } from '../../packages/llm-api/src/index';

const cfg = {
  provider: 'anthropic' as const,
  model: 'primary-model',
  apiKey: 'test',
};

type GenerateOpts = { prompt: unknown; tools?: unknown };

/** A stub whose doGenerate replies with a native tool call (or text). */
function stubModel(opts: {
  toolCall?: { id: string; name: string; input: string };
  text?: string;
  capture?: GenerateOpts[];
}) {
  return {
    specificationVersion: 'v3',
    provider: 'mock',
    modelId: 'mock-model',
    supportedUrls: {},
    async doGenerate(genOpts: GenerateOpts) {
      opts.capture?.push(genOpts);
      const content: unknown[] = [];
      if (opts.text) content.push({ type: 'text', text: opts.text });
      if (opts.toolCall) {
        content.push({
          type: 'tool-call',
          toolCallId: opts.toolCall.id,
          toolName: opts.toolCall.name,
          input: opts.toolCall.input,
        });
      }
      return {
        content,
        finishReason: opts.toolCall ? 'tool-calls' : 'stop',
        usage: {
          inputTokens: { total: 20, noCache: 20 },
          outputTokens: { total: 8, text: undefined, reasoning: undefined },
        },
        warnings: [],
      };
    },
    async doStream() {
      throw new Error('doStream not used');
    },
  };
}

const runScenarioTool = {
  name: 'run_scenario',
  description: 'Run a scenario.',
  schema: JSON.stringify({
    type: 'object',
    properties: { yaml: { type: 'string' } },
    required: ['yaml'],
    additionalProperties: false,
  }),
};

beforeEach(() => {
  buildModelMock.mockReset();
  resetStageUsage();
});

describe('createApiTransport turn seam (native tool calling)', () => {
  it('declares nativeTools', () => {
    buildModelMock.mockReturnValue(stubModel({ text: 'x' }));
    const transport = createApiTransport(cfg);
    expect(typeof transport.turn).toBe('function');
    expect(transport.turn!.nativeTools).toBe(true);
  });

  it('normalizes a native tool call and parses its arguments', async () => {
    buildModelMock.mockReturnValue(
      stubModel({ toolCall: { id: 'call_9', name: 'run_scenario', input: '{"yaml":"v1"}' } }),
    );
    const transport = createApiTransport(cfg);
    const reply = await transport.turn!({
      stage: 'guard.worker',
      system: 'S',
      messages: [{ role: 'user', text: 'go' }],
      tools: [runScenarioTool],
    });
    expect(reply.toolCall).toEqual({ id: 'call_9', name: 'run_scenario', arguments: { yaml: 'v1' } });
    expect(reply.text).toBe('');
    expect(reply.usage).toMatchObject({ inputTokens: 20, outputTokens: 8 });
  });

  it('replays the whole history including tool results on the tool role', async () => {
    const capture: GenerateOpts[] = [];
    buildModelMock.mockReturnValue(stubModel({ text: 'done', capture }));
    const transport = createApiTransport(cfg);
    await transport.turn!({
      stage: 'guard.worker',
      system: 'SYS',
      messages: [
        { role: 'user', text: 'go' },
        {
          role: 'assistant',
          text: '',
          toolCall: { id: 'call_1', name: 'run_scenario', arguments: { yaml: 'v1' } },
        },
        { role: 'tool', text: 'exit 0', toolCallId: 'call_1', toolName: 'run_scenario' },
      ],
      tools: [runScenarioTool],
    });
    expect(capture).toHaveLength(1);
    const prompt = capture[0]!.prompt as Array<{ role: string; content: unknown }>;
    const roles = prompt.map((m) => m.role);
    // system + user + assistant(tool-call) + tool(result)
    expect(roles).toEqual(['system', 'user', 'assistant', 'tool']);
    const toolMsg = prompt[3]!.content as Array<Record<string, unknown>>;
    expect(toolMsg[0]).toMatchObject({
      type: 'tool-result',
      toolCallId: 'call_1',
      toolName: 'run_scenario',
    });
    // The tools reached the provider as native declarations.
    expect(capture[0]!.tools).toBeTruthy();
  });

  it('returns plain text when the model answers without a tool call', async () => {
    buildModelMock.mockReturnValue(stubModel({ text: 'thinking out loud' }));
    const transport = createApiTransport(cfg);
    const reply = await transport.turn!({
      system: 'S',
      messages: [{ role: 'user', text: 'go' }],
      tools: [runScenarioTool],
    });
    expect(reply.text).toBe('thinking out loud');
    expect(reply.toolCall).toBeUndefined();
  });

  it('records turn usage under the stage', async () => {
    buildModelMock.mockReturnValue(stubModel({ text: 'ok' }));
    const transport = createApiTransport(cfg, {
      pricing: () => 0.5,
    });
    await transport.turn!({
      stage: 'guard.worker',
      system: 'S',
      messages: [{ role: 'user', text: 'go' }],
      tools: [],
    });
    const usage = getStageUsage().get('guard.worker');
    expect(usage).toBeDefined();
    expect(usage!.calls).toBe(1);
    expect(usage!.inputTokens).toBe(20);
    expect(usage!.outputTokens).toBe(8);
    expect(usage!.costUsd).toBeCloseTo(0.5);
  });

  it('falls back to the configured fallback model on a primary failure', async () => {
    const failing = stubModel({ text: 'unused' });
    failing.doGenerate = async () => {
      throw new Error('primary down');
    };
    const working = stubModel({ text: 'from fallback' });
    buildModelMock.mockImplementation((_cfg: unknown, id: string) =>
      id === 'primary-model' ? failing : working,
    );
    const transport = createApiTransport({ ...cfg, fallbackModel: 'backup-model' });
    const reply = await transport.turn!({
      system: 'S',
      messages: [{ role: 'user', text: 'go' }],
      tools: [],
    });
    expect(reply.text).toBe('from fallback');
  });
});
