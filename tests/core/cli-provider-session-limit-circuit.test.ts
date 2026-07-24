import { describe, expect, it } from 'vitest';
import { createLLMProvider } from '../../packages/core/src/services/llm/provider.js';
import { config } from '../../packages/core/src/config/index.js';
import {
  LlmSessionLimitError,
  type LlmTransport,
} from '../../packages/shared/src/llm/transport.js';

const serviceContext = {
  architecture: 'monolith',
  services: [
    {
      id: 'service-1',
      name: 'orders',
      type: 'backend',
      framework: 'express',
      fileCount: 1,
      layers: [],
    },
  ],
  dependencies: [],
  llmRules: [],
};

describe('ClaudeCodeProvider session-limit circuit', () => {
  it('normalizes a definite Claude 429 wrapped by an installed transport before retrying', async () => {
    let calls = 0;
    let notifications = 0;
    const provider = createLLMProvider(async () => {
      calls++;
      throw new Error(
        "claude API error (api 429): You've hit your session limit · resets 7pm (Africa/Cairo)",
      );
    });
    provider.setSessionLimitHandler?.(() => { notifications++; });

    await expect(provider.generateServiceViolations(serviceContext)).rejects.toMatchObject({
      code: 'LLM_SESSION_LIMIT',
      resetHint: '7pm (Africa/Cairo)',
    });
    await expect(provider.generateServiceViolations(serviceContext)).rejects.toMatchObject({
      code: 'LLM_SESSION_LIMIT',
    });

    expect(calls).toBe(1);
    expect(notifications).toBe(1);
  });

  it('keeps bounded retries for a wrapped generic 429 from an installed transport', async () => {
    let calls = 0;
    let notifications = 0;
    const provider = createLLMProvider(async () => {
      calls++;
      throw new Error('claude API error (api 429): Rate limited. Please retry shortly.');
    });
    provider.setSessionLimitHandler?.(() => { notifications++; });

    await expect(provider.generateServiceViolations(serviceContext)).rejects.toThrow(/Rate limited/);

    expect(calls).toBe(3);
    expect(notifications).toBe(0);
  });

  it('does not start queued requests after one active call reaches the session limit', async () => {
    const concurrency = config.claudeCodeMaxConcurrency;
    const submitted = concurrency * 2;
    let calls = 0;
    let starts = 0;
    let firstWaveReady!: () => void;
    let terminalThrown!: () => void;
    let releaseActive!: () => void;
    const firstWave = new Promise<void>((resolve) => { firstWaveReady = resolve; });
    const terminal = new Promise<void>((resolve) => { terminalThrown = resolve; });
    const release = new Promise<void>((resolve) => { releaseActive = resolve; });

    const transport: LlmTransport = async () => {
      const call = ++calls;
      if (call === concurrency) firstWaveReady();
      await firstWave;
      if (call === 1) {
        terminalThrown();
        throw new LlmSessionLimitError('7pm (Africa/Cairo)');
      }
      await release;
      return JSON.stringify({ violations: [], serviceDescriptions: [] });
    };
    const provider = createLLMProvider(transport);

    const results = Promise.allSettled(
      Array.from({ length: submitted }, () =>
        provider.generateServiceViolations(serviceContext, {
          onStart: () => { starts++; },
        }),
      ),
    );

    await terminal;
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseActive();
    await results;

    expect(calls).toBe(concurrency);
    expect(starts).toBe(concurrency);
  });

  it('does not retry an active peer after another call opens the circuit', async () => {
    const concurrency = config.claudeCodeMaxConcurrency;
    let calls = 0;
    let firstWaveReady!: () => void;
    let peerFailed!: () => void;
    let releaseActive!: () => void;
    const firstWave = new Promise<void>((resolve) => { firstWaveReady = resolve; });
    const peerFailure = new Promise<void>((resolve) => { peerFailed = resolve; });
    const release = new Promise<void>((resolve) => { releaseActive = resolve; });

    const transport: LlmTransport = async () => {
      const call = ++calls;
      if (call === concurrency) firstWaveReady();
      await firstWave;
      if (call === 1) throw new LlmSessionLimitError('7pm (Africa/Cairo)');
      if (call === 2) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        peerFailed();
        throw new Error('transient peer failure');
      }
      await release;
      return JSON.stringify({ violations: [], serviceDescriptions: [] });
    };
    const provider = createLLMProvider(transport);

    const results = Promise.allSettled(
      Array.from({ length: concurrency }, () =>
        provider.generateServiceViolations(serviceContext),
      ),
    );

    await peerFailure;
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseActive();
    await results;

    expect(calls).toBe(concurrency);
  });

  it('keeps cancellation separate and does not start an external request', async () => {
    let calls = 0;
    let starts = 0;
    const transport: LlmTransport = async () => {
      calls++;
      return JSON.stringify({ violations: [], serviceDescriptions: [] });
    };
    const provider = createLLMProvider(transport);
    const controller = new AbortController();
    provider.setAbortSignal(controller.signal);
    controller.abort(new DOMException('Analysis cancelled', 'AbortError'));

    const failure = provider.generateServiceViolations(serviceContext, {
      onStart: () => { starts++; },
    });

    await expect(failure).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(0);
    expect(starts).toBe(0);
  });

  it('clears a tripped circuit when a new analysis starts', async () => {
    let calls = 0;
    let notifications = 0;
    const transport: LlmTransport = async () => {
      calls++;
      if (calls === 1) throw new LlmSessionLimitError('7pm (Africa/Cairo)');
      return JSON.stringify({ violations: [], serviceDescriptions: [] });
    };
    const provider = createLLMProvider(transport);
    provider.setSessionLimitHandler?.(() => { notifications++; });
    provider.setAnalysisId('analysis-1');

    await expect(provider.generateServiceViolations(serviceContext)).rejects.toMatchObject({
      code: 'LLM_SESSION_LIMIT',
    });
    await expect(provider.generateServiceViolations(serviceContext)).rejects.toMatchObject({
      code: 'LLM_SESSION_LIMIT',
    });
    expect(calls).toBe(1);
    expect(notifications).toBe(1);

    provider.setAnalysisId('analysis-2');
    await expect(provider.generateServiceViolations(serviceContext)).resolves.toEqual({
      violations: [],
      serviceDescriptions: [],
    });
    expect(calls).toBe(2);
    expect(notifications).toBe(1);
  });
});
