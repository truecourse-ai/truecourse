/**
 * Progress model display.
 *
 * The mechanism: a progress step's detail carries the models its stages actually
 * called; when no real usage was recorded (a full cache) OSS falls back to the
 * per-stage RESOLVED model, and EE — which runs one model for every stage and
 * records no per-stage usage — suppresses that fallback
 * (`setShowResolvedStageModel(false)`), because otherwise progress would show a
 * misleading OSS tier ("sonnet, haiku") that EE never called.
 *
 * SPEC SCAN NO LONGER PARTICIPATES (plan 02 steps 3–7). Its stages are agent
 * SESSIONS on ONE model (§3.4): there are no per-stage tiers left to display, and
 * `curateInProcess` details are session counts. So the mechanism is pinned
 * directly on `stageUsageTag` (still live for `guard`), and the scan is pinned on
 * the successor contract — its progress names no model at all.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import {
  curateInProcess,
  setShowResolvedStageModel,
  stageUsageTag,
  CURATE_STEPS,
} from '../../packages/core/src/commands/spec-in-process';
import { StepTracker } from '../../packages/core/src/progress';
import type { DriverResult, SessionDriver } from '../../packages/agent-loop/src/index';

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

describe('stageUsageTag — the model fallback and its EE suppression', () => {
  // No usage was recorded for these stages in this process, so both cases take
  // the fallback path — the state a full cache (or EE) leaves behind.
  it('OSS (default): falls back to the resolved per-stage model', () => {
    const tag = stageUsageTag(['guard.extract', 'guard.flows'], repo);
    expect(MODEL_TIER.test(tag)).toBe(true);
  });

  it('EE (suppressed): names no model', () => {
    setShowResolvedStageModel(false);
    expect(stageUsageTag(['guard.extract', 'guard.flows'], repo)).toBe('');
  });

  it('is empty for a step that maps to no stage', () => {
    expect(stageUsageTag([], repo)).toBe('');
  });
});

describe('spec scan progress — one model, so no tier is displayed', () => {
  it('names no model tier in any step detail', async () => {
    const details: string[] = [];
    const tracker = new StepTracker((payload) => {
      for (const s of payload.steps ?? []) if (s.detail) details.push(s.detail);
    }, [...CURATE_STEPS]);

    const driver: SessionDriver = {
      capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
      attribution: { provider: 'test', model: 'scripted' },
      runSession(input) {
        for (const content of input.initialMessages) input.onEvent({ type: 'user-message', content });
        const done = (async (): Promise<DriverResult> => {
          await new Promise((r) => setTimeout(r, 0));
          switch (input.def.kind) {
            case 'spec-scan.orchestrate':
              return {
                kind: 'outcome',
                value: {
                  scopeVerdicts: [{ path: 'docs', verdict: 'keep', reason: 'specs' }],
                  instructions: [],
                },
              };
            case 'spec-scan.curate-doc':
              return {
                kind: 'outcome',
                value: { keep: true, reason: 'spec', areas: [{ product: 'core', concern: 'orders' }] },
              };
            case 'spec-scan.settle-areas':
              return {
                kind: 'outcome',
                value: { concernMerges: {}, productMerges: {}, productVerdicts: [], subdivisions: [] },
              };
            case 'spec-scan.overlap':
              input.onEvent({ type: 'tool-result', toolName: 'check_findings', content: 'ok', isError: false });
              return { kind: 'outcome', value: { overlaps: [], notReached: [] } };
            default:
              throw new Error(`unscripted kind ${input.def.kind}`);
          }
        })();
        return { done, status: () => 'running' as const, steer: () => {}, interrupt: async () => {} };
      },
    };

    await curateInProcess(repo, { tracker, driver, skipGit: true, skipCorpusWrite: true });

    expect(details.length).toBeGreaterThan(0);
    expect(details.some((d) => MODEL_TIER.test(d))).toBe(false);
    // What the details DO carry: the session counts the run is spending.
    expect(details.some((d) => /\d+ docs?/.test(d))).toBe(true);
  });
});
