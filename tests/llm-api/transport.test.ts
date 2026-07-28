import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LlmTraceInput } from '@truecourse/shared';
// The dist entry the transport records into — the source copy would be a
// separate module instance with its own usage table.
import { getStageUsage, resetStageUsage } from '@truecourse/shared/llm';

// Mock the LOCAL model builder (always inlined, so vitest intercepts it — the
// externalized `ai` package isn't resolvable/mockable from the centralized test
// dir). buildModel returns a minimal LanguageModelV3 stub; the REAL generateText
// runs against it fully offline.
const { buildModelMock } = vi.hoisted(() => ({ buildModelMock: vi.fn() }));
vi.mock('../../packages/llm-api/src/model.js', () => ({ buildModel: buildModelMock }));

import {
  createApiTransport,
  createAiSdkTransport,
  runWithTrace,
} from '../../packages/llm-api/src/index';

const cfg = {
  provider: 'anthropic' as const,
  model: 'primary-model',
  fallbackModel: 'fallback-model',
  apiKey: 'test',
};

type Usage = {
  input: number;
  output: number;
  noCache?: number;
  cacheRead?: number;
  cacheWrite?: number;
};

/** A minimal LanguageModelV3 the real `generateText` can drive offline. */
function stubModel(opts: { text?: string; throws?: Error; usage?: Usage }) {
  const u = opts.usage ?? { input: 10, output: 5 };
  return {
    specificationVersion: 'v3',
    provider: 'mock',
    modelId: 'mock-model',
    supportedUrls: {},
    async doGenerate() {
      if (opts.throws) throw opts.throws;
      return {
        content: [{ type: 'text', text: opts.text ?? '' }],
        finishReason: 'stop',
        // Provider-level usage is nested ({ inputTokens: { total } }); generateText
        // flattens it to the result's inputTokens/outputTokens/totalTokens.
        usage: {
          inputTokens: {
            total: u.input,
            noCache: u.noCache,
            cacheRead: u.cacheRead,
            cacheWrite: u.cacheWrite,
          },
          outputTokens: { total: u.output, text: undefined, reasoning: undefined },
        },
        warnings: [],
      };
    },
    async doStream() {
      throw new Error('doStream not used in these tests');
    },
  };
}

function recorderSpy() {
  const calls: LlmTraceInput[] = [];
  return { calls, record: async (i: LlmTraceInput) => void calls.push(i) };
}

beforeEach(() => buildModelMock.mockReset());

describe('createApiTransport — tracing', () => {
  it('records a successful call with usage, latency and ambient context', async () => {
    buildModelMock.mockReturnValue(stubModel({ text: 'OUTPUT' }));
    const rec = recorderSpy();
    const transport = createApiTransport(cfg, { recorder: rec });

    const out = await runWithTrace(
      {
        org: 'org_1',
        traceId: 'trace_1',
        jobId: 'job_1',
        repoFullName: 'acme/api',
        commitSha: 'sha1',
        parentId: null,
      },
      () =>
        transport({
          id: 'contract.extract:slice_42',
          stage: 'contract.extract',
          system: 'S',
          user: 'U',
          responseFormat: 'json',
        }),
    );

    expect(out).toBe('OUTPUT');
    expect(rec.calls).toHaveLength(1);
    const t = rec.calls[0]!;
    expect(t.status).toBe('ok');
    expect(t.workspaceOrgId).toBe('org_1');
    expect(t.traceId).toBe('trace_1');
    expect(t.stage).toBe('contract.extract');
    expect(t.sliceId).toBe('slice_42');
    expect(t.model).toBe('primary-model');
    expect(t.usedFallback).toBe(false);
    expect(t.output).toBe('OUTPUT');
    expect(t.promptTokens).toBe(10);
    expect(t.completionTokens).toBe(5);
    expect(t.totalTokens).toBe(15);
    expect(t.latencyMs).toBeGreaterThanOrEqual(0);
    expect(t.metadata).toMatchObject({
      provider: 'anthropic',
      jobId: 'job_1',
      repoFullName: 'acme/api',
      commitSha: 'sha1',
    });
  });

  it('records an error trace and rethrows (no fallback configured)', async () => {
    const noFallback = { provider: 'anthropic' as const, model: 'primary-model', apiKey: 'test' };
    buildModelMock.mockReturnValue(stubModel({ throws: new Error('boom') }));
    const rec = recorderSpy();
    const transport = createApiTransport(noFallback, { recorder: rec });

    await expect(
      transport({ id: 'spec.claim:blk', stage: 'spec.claim', system: 'S', user: 'U' }),
    ).rejects.toThrow('boom');
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]!.status).toBe('error');
    expect(rec.calls[0]!.errorMessage).toContain('boom');
    expect(rec.calls[0]!.output).toBeNull();
  });

  it('retries on the fallback model and flags usedFallback', async () => {
    buildModelMock
      .mockReturnValueOnce(stubModel({ throws: new Error('primary down') })) // primary
      .mockReturnValueOnce(stubModel({ text: 'FB', usage: { input: 1, output: 2 } })); // fallback
    const rec = recorderSpy();
    const transport = createApiTransport(cfg, { recorder: rec });

    const out = await transport({ id: 'x:y', stage: 'x', system: 'S', user: 'U' });
    expect(out).toBe('FB');
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]!.usedFallback).toBe(true);
    expect(rec.calls[0]!.model).toBe('fallback-model');
  });

  it('never lets a recorder failure break the call', async () => {
    buildModelMock.mockReturnValue(stubModel({ text: 'OK' }));
    const badRecorder = {
      record: async () => {
        throw new Error('db down');
      },
    };
    const transport = createApiTransport(cfg, { recorder: badRecorder });
    await expect(transport({ id: 'a:b', stage: 'a', system: 'S', user: 'U' })).resolves.toBe('OK');
  });

  it('records nothing when no recorder is supplied (e.g. the config probe)', async () => {
    buildModelMock.mockReturnValue(stubModel({ text: 'OK' }));
    const transport = createApiTransport(cfg);
    await expect(transport({ id: 'a:b', stage: 'a', system: 'S', user: 'U' })).resolves.toBe('OK');
  });

  // Regression: the analyze LLM rules pack everything into `user` and pass
  // system: ''. Forwarding that to the model emits an empty system text block,
  // which Anthropic rejects ("text content blocks must be non-empty"). It must
  // be omitted instead.
  function capturingModel() {
    let prompt: unknown;
    const model = {
      ...stubModel({ text: 'OK' }),
      async doGenerate(opts: { prompt: unknown }) {
        prompt = opts.prompt;
        return {
          content: [{ type: 'text', text: 'OK' }],
          finishReason: 'stop',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        };
      },
    };
    return { model, getPrompt: () => prompt };
  }

  it('omits an empty system prompt (no empty system block reaches the model)', async () => {
    const { model, getPrompt } = capturingModel();
    buildModelMock.mockReturnValue(model);
    await createApiTransport(cfg)({ id: 'a:b', stage: 'a', system: '', user: 'U' });
    expect(JSON.stringify(getPrompt())).not.toMatch(/"role":\s*"system"/);
  });

  it('forwards a non-empty system prompt', async () => {
    const { model, getPrompt } = capturingModel();
    buildModelMock.mockReturnValue(model);
    await createApiTransport(cfg)({ id: 'a:b', stage: 'a', system: 'REAL SYSTEM', user: 'U' });
    expect(JSON.stringify(getPrompt())).toContain('REAL SYSTEM');
  });

  // Structured output: a JSON-schema request must go through generateObject and
  // come back as a schema-valid object (no prose/markdown to strip), so analyze's
  // strict JSON.parse succeeds where free-text generateText fails.
  it('enforces the schema via structured output and returns the validated object', async () => {
    buildModelMock.mockReturnValue(stubModel({ text: '{"answer":"42"}' }));
    const out = await createApiTransport(cfg)({
      id: 'analyze.code:slice_1',
      stage: 'analyze.code',
      system: '',
      user: 'U',
      responseFormat: 'json',
      schema:
        '{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"],"additionalProperties":false}',
    });
    expect(JSON.parse(out)).toEqual({ answer: '42' });
  });

  // A schema with an open `{}` sub-schema (z.unknown() — e.g. a claim's free-form
  // `content`) can't be strict-enforced by the provider, so it falls back to JSON
  // mode: still valid JSON, polymorphic content preserved, Zod validates after.
  it('uses JSON mode for an open `{}` schema and returns the JSON', async () => {
    buildModelMock.mockReturnValue(stubModel({ text: '{"claims":[{"content":{"x":1}}]}' }));
    const out = await createApiTransport(cfg)({
      id: 'spec.relevance:blk',
      stage: 'spec.relevance',
      system: '',
      user: 'U',
      responseFormat: 'json',
      schema:
        '{"type":"object","properties":{"claims":{"type":"array","items":{"type":"object","properties":{"content":{}},"required":["content"]}}},"required":["claims"]}',
    });
    expect(JSON.parse(out)).toEqual({ claims: [{ content: { x: 1 } }] });
  });
});

// Which of the three request shapes the transport builds — strict structured
// output (schema handed to the provider), JSON mode (json response format, no
// schema), or plain text — read off what actually reaches the model.
describe('createApiTransport — schema dispatch', () => {
  /** Captures the call options `generateText`/`generateObject` send the model. */
  function formatCapturingModel(text: string) {
    let responseFormat: { type?: string; schema?: unknown } | undefined;
    const model = {
      ...stubModel({ text }),
      async doGenerate(opts: { responseFormat?: { type?: string; schema?: unknown } }) {
        responseFormat = opts.responseFormat;
        return {
          content: [{ type: 'text', text }],
          finishReason: 'stop',
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        };
      },
    };
    return { model, getFormat: () => responseFormat };
  }

  async function callWith(schema: string | undefined, text: string) {
    const { model, getFormat } = formatCapturingModel(text);
    buildModelMock.mockReturnValue(model);
    const out = await createApiTransport(cfg)({
      id: 'a:b',
      stage: 'a',
      system: 'S',
      user: 'U',
      responseFormat: 'json',
      schema,
    });
    return { out, format: getFormat() };
  }

  const OBJECT_ROOT =
    '{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"],"additionalProperties":false}';
  const ARRAY_ROOT =
    '{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"],"additionalProperties":false}}';
  const OPEN_ANY =
    '{"type":"object","properties":{"content":{}},"required":["content"],"additionalProperties":false}';

  it('hands a strict object-rooted schema to the provider', async () => {
    const { out, format } = await callWith(OBJECT_ROOT, '{"answer":"42"}');
    expect(format?.type).toBe('json');
    expect(format?.schema).toMatchObject({ type: 'object' });
    expect(JSON.parse(out)).toEqual({ answer: '42' });
  });

  // Provider strict structured output requires an object root, so an array-rooted
  // schema uses JSON mode instead of erroring.
  it('falls back to JSON mode for an array-rooted schema', async () => {
    const { out, format } = await callWith(ARRAY_ROOT, '[{"id":"a"}]');
    expect(format?.type).toBe('json');
    expect(format?.schema).toBeUndefined();
    expect(JSON.parse(out)).toEqual([{ id: 'a' }]);
  });

  it('falls back to JSON mode for a scalar-rooted schema', async () => {
    const { format } = await callWith('{"type":"string"}', '"hello"');
    expect(format?.type).toBe('json');
    expect(format?.schema).toBeUndefined();
  });

  it('falls back to JSON mode for a union-rooted schema (no root `type`)', async () => {
    const { format } = await callWith(
      '{"anyOf":[{"type":"object","properties":{"a":{"type":"string"}},"required":["a"]},{"type":"object","properties":{"b":{"type":"string"}},"required":["b"]}]}',
      '{"a":"x"}',
    );
    expect(format?.type).toBe('json');
    expect(format?.schema).toBeUndefined();
  });

  it('falls back to JSON mode for an open `{}` sub-schema', async () => {
    const { format } = await callWith(OPEN_ANY, '{"content":{"x":1}}');
    expect(format?.type).toBe('json');
    expect(format?.schema).toBeUndefined();
  });

  it('sends no response format at all when the request carries no schema', async () => {
    const { out, format } = await callWith(undefined, 'free text');
    expect(format).toBeUndefined();
    expect(out).toBe('free text');
  });
});

// Per-stage token/cost accounting: the API transport feeds the same shared
// table the cli backend fills from its `claude -p` envelope, so the CLI's
// per-stage ` · model · tokens · $cost` tags work in both modes.
describe('createApiTransport — stage usage', () => {
  beforeEach(() => resetStageUsage());

  it('records tokens, model and call count for a successful call', async () => {
    buildModelMock.mockReturnValue(stubModel({ text: 'OK', usage: { input: 120, output: 30 } }));
    await createApiTransport(cfg)({ id: 'spec.vocab:a', stage: 'spec.vocab', system: 'S', user: 'U' });

    const usage = getStageUsage().get('spec.vocab')!;
    expect(usage).toMatchObject({
      stage: 'spec.vocab',
      model: 'primary-model',
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      costUsd: 0,
      calls: 1,
    });
  });

  it('splits cached tokens into their own buckets (no double counting)', async () => {
    buildModelMock.mockReturnValue(
      stubModel({
        text: 'OK',
        usage: { input: 100, output: 10, noCache: 40, cacheRead: 50, cacheWrite: 10 },
      }),
    );
    await createApiTransport(cfg)({ id: 'a:b', stage: 'cached', system: 'S', user: 'U' });

    expect(getStageUsage().get('cached')).toMatchObject({
      inputTokens: 40,
      cacheReadTokens: 50,
      cacheCreateTokens: 10,
      outputTokens: 10,
    });
  });

  it('accumulates across calls and attributes the fallback model', async () => {
    buildModelMock
      .mockReturnValueOnce(stubModel({ throws: new Error('primary down') }))
      .mockReturnValueOnce(stubModel({ text: 'FB', usage: { input: 1, output: 2 } }));
    await createApiTransport(cfg)({ id: 'x:y', stage: 'x', system: 'S', user: 'U' });

    expect(getStageUsage().get('x')).toMatchObject({ model: 'fallback-model', calls: 1 });
  });

  it('prices the call with the pricing hook', async () => {
    buildModelMock.mockReturnValue(stubModel({ text: 'OK', usage: { input: 1000, output: 100 } }));
    const pricing = vi.fn().mockReturnValue(0.0125);
    await createApiTransport(cfg, { pricing })({
      id: 'a:b',
      stage: 'priced',
      system: 'S',
      user: 'U',
    });

    expect(pricing).toHaveBeenCalledWith('primary-model', {
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    });
    expect(getStageUsage().get('priced')!.costUsd).toBe(0.0125);
  });

  it('keeps the tokens when pricing throws or returns nothing usable', async () => {
    buildModelMock.mockReturnValue(stubModel({ text: 'OK', usage: { input: 7, output: 3 } }));
    const boom = () => {
      throw new Error('price table exploded');
    };
    await createApiTransport(cfg, { pricing: boom })({
      id: 'a:b',
      stage: 'unpriced',
      system: 'S',
      user: 'U',
    });

    expect(getStageUsage().get('unpriced')).toMatchObject({
      inputTokens: 7,
      outputTokens: 3,
      costUsd: 0,
      calls: 1,
    });
  });

  it('records nothing for a failed call', async () => {
    const noFallback = { provider: 'anthropic' as const, model: 'primary-model', apiKey: 'test' };
    buildModelMock.mockReturnValue(stubModel({ throws: new Error('boom') }));
    await expect(
      createApiTransport(noFallback)({ id: 'a:b', stage: 'failing', system: 'S', user: 'U' }),
    ).rejects.toThrow('boom');
    expect(getStageUsage().get('failing')).toBeUndefined();
  });
});

// Per-stage model overrides (`TRUECOURSE_MODEL_<STAGE>` / `llm.stages`) reach the
// transport as `req.model`; the OSS CLI opts in so those overrides stay alive.
describe('createApiTransport — honorRequestModel', () => {
  beforeEach(() => resetStageUsage());

  it('ignores the request model by default', async () => {
    buildModelMock.mockReturnValue(stubModel({ text: 'OK' }));
    await createApiTransport(cfg)({
      id: 'a:b',
      stage: 'stage',
      system: 'S',
      user: 'U',
      model: 'per-stage-model',
    });
    expect(getStageUsage().get('stage')!.model).toBe('primary-model');
    expect(buildModelMock.mock.calls.map((c) => c[1])).toEqual(['primary-model', 'fallback-model']);
  });

  it('runs the request model when opted in', async () => {
    buildModelMock.mockReturnValue(stubModel({ text: 'OK' }));
    await createApiTransport(cfg, { honorRequestModel: true })({
      id: 'a:b',
      stage: 'stage',
      system: 'S',
      user: 'U',
      model: 'per-stage-model',
    });
    expect(getStageUsage().get('stage')!.model).toBe('per-stage-model');
    expect(buildModelMock).toHaveBeenCalledWith(cfg, 'per-stage-model');
  });

  it('falls back to the configured model when the request carries none', async () => {
    buildModelMock.mockReturnValue(stubModel({ text: 'OK' }));
    await createApiTransport(cfg, { honorRequestModel: true })({
      id: 'a:b',
      stage: 'stage',
      system: 'S',
      user: 'U',
    });
    expect(getStageUsage().get('stage')!.model).toBe('primary-model');
  });

  it('retries on the request fallback model', async () => {
    buildModelMock
      .mockReturnValueOnce(stubModel({ text: 'unused' })) // cfg.model, built up front
      .mockReturnValueOnce(stubModel({ text: 'unused' })) // cfg.fallbackModel, built up front
      .mockReturnValueOnce(stubModel({ throws: new Error('down') })) // req.model
      .mockReturnValueOnce(stubModel({ text: 'FB' })); // req.fallbackModel
    const out = await createApiTransport(cfg, { honorRequestModel: true })({
      id: 'a:b',
      stage: 'stage',
      system: 'S',
      user: 'U',
      model: 'req-primary',
      fallbackModel: 'req-fallback',
    });
    expect(out).toBe('FB');
    expect(getStageUsage().get('stage')!.model).toBe('req-fallback');
  });
});

describe('createAiSdkTransport alias', () => {
  it('is the same factory as createApiTransport (ee imports keep working)', () => {
    expect(createAiSdkTransport).toBe(createApiTransport);
  });
});
