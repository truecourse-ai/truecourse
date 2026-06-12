import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LlmTraceInput } from '@truecourse/shared';

// Mock the LOCAL model builder (always inlined, so vitest intercepts it — the
// externalized `ai` package isn't resolvable/mockable from the centralized test
// dir). buildModel returns a minimal LanguageModelV3 stub; the REAL generateText
// runs against it fully offline.
const { buildModelMock } = vi.hoisted(() => ({ buildModelMock: vi.fn() }));
vi.mock('../../ee/packages/llm/src/model.js', () => ({ buildModel: buildModelMock }));

import { createAiSdkTransport, runWithTrace } from '../../ee/packages/llm/src/index';

const cfg = {
  provider: 'anthropic' as const,
  model: 'primary-model',
  fallbackModel: 'fallback-model',
  apiKey: 'test',
};

type Usage = { input: number; output: number };

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
          inputTokens: { total: u.input, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
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

describe('createAiSdkTransport — tracing', () => {
  it('records a successful call with usage, latency and ambient context', async () => {
    buildModelMock.mockReturnValue(stubModel({ text: 'OUTPUT' }));
    const rec = recorderSpy();
    const transport = createAiSdkTransport(cfg, { recorder: rec });

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
    const transport = createAiSdkTransport(noFallback, { recorder: rec });

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
    const transport = createAiSdkTransport(cfg, { recorder: rec });

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
    const transport = createAiSdkTransport(cfg, { recorder: badRecorder });
    await expect(transport({ id: 'a:b', stage: 'a', system: 'S', user: 'U' })).resolves.toBe('OK');
  });

  it('records nothing when no recorder is supplied (e.g. the config probe)', async () => {
    buildModelMock.mockReturnValue(stubModel({ text: 'OK' }));
    const transport = createAiSdkTransport(cfg);
    await expect(transport({ id: 'a:b', stage: 'a', system: 'S', user: 'U' })).resolves.toBe('OK');
  });
});
