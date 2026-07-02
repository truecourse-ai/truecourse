import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createLlmCallLogger,
  summarizeLlmCalls,
} from '../../packages/core/src/lib/llm-call-log.js';
import type { LlmCallRecord } from '@truecourse/shared/llm';

function rec(over: Partial<LlmCallRecord> = {}): LlmCallRecord {
  return {
    ts: '2026-06-24T00:00:00.000Z',
    stage: 'contract.extract',
    model: 'claude-sonnet-4-6',
    id: 'contract.extract:batch:abc',
    itemCount: 10,
    ok: true,
    exitCode: 0,
    wallMs: 3000,
    claudeDurationMs: 2500,
    apiDurationMs: 2400,
    numTurns: 1,
    inputChars: 5000,
    outputChars: 2000,
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 16000,
    cacheCreateTokens: 4000,
    costUsd: 0.2,
    system: 'SYS',
    user: 'USR',
    responseText: 'OUT',
    ...over,
  };
}

describe('summarizeLlmCalls', () => {
  it('aggregates per-stage with per-item economics', () => {
    const s = summarizeLlmCalls(
      [
        rec({ stage: 'contract.extract', itemCount: 10, costUsd: 0.2 }),
        rec({ stage: 'contract.extract', itemCount: 5, costUsd: 0.1 }),
        rec({ stage: 'spec.relevance', itemCount: 1, costUsd: 0.02, model: 'claude-haiku-4-5' }),
      ],
      10_000,
    );
    expect(s.totalCalls).toBe(3);
    expect(s.totalItems).toBe(16);
    expect(s.totalCostUsd).toBeCloseTo(0.32, 5);
    // busiest stage (by cost) first
    expect(s.stages[0].stage).toBe('contract.extract');
    const extract = s.stages.find((x) => x.stage === 'contract.extract')!;
    expect(extract.calls).toBe(2);
    expect(extract.items).toBe(15);
    expect(extract.costUsd).toBeCloseTo(0.3, 5);
    expect(extract.costPerItem).toBeCloseTo(0.3 / 15, 5);
  });

  it('computes overhead fraction (cache vs fresh tokens)', () => {
    const s = summarizeLlmCalls([rec()], 1000);
    // cacheRead 16000 + cacheCreate 4000 = 20000 overhead; input 1000 + output 500 = 1500 fresh
    expect(s.overheadTokens).toBe(20000);
    expect(s.freshTokens).toBe(1500);
    expect(s.overheadFraction).toBeCloseTo(20000 / 21500, 5);
  });

  it('measures spawn overhead and effective parallelism', () => {
    const s = summarizeLlmCalls(
      [
        rec({ wallMs: 3000, claudeDurationMs: 2500 }),
        rec({ wallMs: 4000, claudeDurationMs: 3000 }),
      ],
      3500, // run wall < sum of call walls → parallelism > 1
    );
    const st = s.stages[0];
    expect(st.spawnOverheadMsSum).toBe(500 + 1000);
    expect(s.wallMsSum).toBe(7000);
    expect(s.effectiveParallelism).toBeCloseTo(2.0, 5);
  });

  it('flags multi-turn calls and failures', () => {
    const s = summarizeLlmCalls(
      [rec({ numTurns: 3 }), rec({ ok: false, error: 'boom', numTurns: 1 }), rec()],
      1000,
    );
    const st = s.stages[0];
    expect(st.multiTurnCalls).toBe(1);
    expect(st.failures).toBe(1);
    expect(s.totalFailures).toBe(1);
  });

  it('does not divide by zero when a stage has no items', () => {
    const s = summarizeLlmCalls([rec({ itemCount: 0, costUsd: 0.05 })], 1000);
    expect(Number.isFinite(s.stages[0].costPerItem)).toBe(true);
    expect(s.stages[0].costPerItem).toBeCloseTo(0.05, 5);
  });
});

describe('createLlmCallLogger', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-llmlog-'));
    delete process.env.TRUECOURSE_DEV; // deterministic: not in dev unless a test opts in
  });
  afterEach(() => {
    delete process.env.TRUECOURSE_LLM_LOG;
    delete process.env.TRUECOURSE_LLM_DUMP;
    delete process.env.TRUECOURSE_DEV;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null (no overhead) when neither env is set (production)', () => {
    expect(createLlmCallLogger(dir, 'scan')).toBeNull();
  });

  it('defaults ON with full dumps in dev (TRUECOURSE_DEV), no env vars needed', () => {
    process.env.TRUECOURSE_DEV = '1';
    const logger = createLlmCallLogger(dir, 'corpus-generate');
    expect(logger).not.toBeNull();
    logger!.sink(rec({ id: 'blk', system: 'SYS', user: 'USR', responseText: 'OUT' }));
    logger!.finish(1000);
    const logsDir = path.join(dir, '.truecourse', 'logs');
    const ioDir = fs.readdirSync(logsDir).find((f) => f.endsWith('.io'));
    expect(ioDir).toBeTruthy(); // dumps are on by default in dev
  });

  it('an explicit TRUECOURSE_LLM_DUMP=0 opts out even in dev', () => {
    process.env.TRUECOURSE_DEV = '1';
    process.env.TRUECOURSE_LLM_DUMP = '0';
    process.env.TRUECOURSE_LLM_LOG = '0';
    expect(createLlmCallLogger(dir, 'scan')).toBeNull();
  });

  it('writes a jsonl line per call + a summary on finish', () => {
    process.env.TRUECOURSE_LLM_LOG = '1';
    const logger = createLlmCallLogger(dir, 'scan');
    expect(logger).not.toBeNull();
    logger!.sink(rec({ id: 'a' }));
    logger!.sink(rec({ id: 'b', ok: false, error: 'x' }));
    logger!.finish(5000);

    const logsDir = path.join(dir, '.truecourse', 'logs');
    const files = fs.readdirSync(logsDir);
    const jsonl = files.find((f) => f.endsWith('.jsonl'))!;
    const summary = files.find((f) => f.endsWith('.summary.json'))!;
    expect(jsonl).toBeTruthy();
    expect(summary).toBeTruthy();

    const lines = fs.readFileSync(path.join(logsDir, jsonl), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    // metrics line must NOT carry the raw payloads
    const parsed = JSON.parse(lines[0]);
    expect(parsed.system).toBeUndefined();
    expect(parsed.user).toBeUndefined();
    expect(parsed.responseText).toBeUndefined();
    expect(parsed.id).toBe('a');

    const sum = JSON.parse(fs.readFileSync(path.join(logsDir, summary), 'utf-8'));
    expect(sum.totalCalls).toBe(2);
    expect(sum.totalFailures).toBe(1);
  });

  it('dumps full I/O only when TRUECOURSE_LLM_DUMP is set', () => {
    process.env.TRUECOURSE_LLM_DUMP = '1';
    const logger = createLlmCallLogger(dir, 'scan')!;
    logger.sink(rec({ id: 'blk1', system: 'THE-SYSTEM', user: 'THE-USER', responseText: 'THE-OUT' }));
    logger.finish(1000);

    const logsDir = path.join(dir, '.truecourse', 'logs');
    const ioDir = fs.readdirSync(logsDir).find((f) => f.endsWith('.io'))!;
    expect(ioDir).toBeTruthy();
    const ioFiles = fs.readdirSync(path.join(logsDir, ioDir));
    expect(ioFiles).toHaveLength(1);
    const io = JSON.parse(fs.readFileSync(path.join(logsDir, ioDir, ioFiles[0]), 'utf-8'));
    expect(io.system).toBe('THE-SYSTEM');
    expect(io.user).toBe('THE-USER');
    expect(io.response).toBe('THE-OUT');
  });
});
