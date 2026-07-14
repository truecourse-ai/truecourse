/**
 * Progress model display. OSS honors per-stage model tiers, so when no real usage
 * was recorded (cache/agent) the step detail falls back to the resolved per-stage
 * model. EE runs ONE model for every stage and records no per-stage usage, so it
 * suppresses that fallback (setShowResolvedStageModel(false)) — otherwise progress
 * would show a misleading OSS tier ("sonnet, haiku") that EE never called.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import {
  curateInProcess,
  setShowResolvedStageModel,
  CURATE_STEPS,
} from '../../packages/core/src/commands/spec-in-process';
import { StepTracker } from '../../packages/core/src/progress';
import type {
  AreaTagRunner,
  OverlapRunner,
  RelevanceRunner,
} from '../../packages/spec-consolidator/src/index.js';

const relevance: RelevanceRunner = async ({ doc }) => ({ path: doc.path, include: true, reason: 'spec' });
const areaTagger: AreaTagRunner = async () => ({ tags: [{ product: 'core', concern: 'orders' }], status: 'shipped' });
const flagAll: OverlapRunner = async ({ a, b }) => ({ overlap: true, note: `${a.path} vs ${b.path}` });

// Injected runners never reach the transport, so NO stage usage is recorded —
// exactly the state (EE / full cache) where stepUsageTag hits the model fallback.
const MODEL_TIER = /\b(haiku|sonnet|opus)\b/;

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-progress-model-'));
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'alpha.md'), '# Orders alpha\nbody');
  fs.writeFileSync(path.join(repo, 'docs', 'beta.md'), '# Orders beta\nbody');
});
afterEach(() => {
  setShowResolvedStageModel(true); // restore the OSS default
  fs.rmSync(repo, { recursive: true, force: true });
});

async function runCapturingDetails(): Promise<string[]> {
  const details: string[] = [];
  const tracker = new StepTracker((payload) => {
    for (const s of payload.steps ?? []) if (s.detail) details.push(s.detail);
  }, [...CURATE_STEPS]);
  await curateInProcess(repo, {
    tracker,
    skipGit: true,
    skipCorpusWrite: true,
    relevanceRunner: relevance,
    areaTagRunner: areaTagger,
    overlapRunner: flagAll,
    disableLlmRelationDetection: true,
  });
  return details;
}

describe('progress model display', () => {
  it('OSS (default): step details fall back to the per-stage model tier', async () => {
    const details = await runCapturingDetails();
    expect(details.some((d) => MODEL_TIER.test(d))).toBe(true);
  });

  it('EE (suppressed): step details show no model name', async () => {
    setShowResolvedStageModel(false);
    const details = await runCapturingDetails();
    expect(details.some((d) => MODEL_TIER.test(d))).toBe(false);
  });
});
