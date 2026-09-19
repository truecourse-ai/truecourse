/**
 * Progress names no model.
 *
 * A step's progress detail says what the run is DOING — docs, areas, flows —
 * and never which model is doing it. There is only one model per run now, and
 * what it cost has its own place (the run record, and Settings › Usage), so a
 * tier name in a progress line would be noise at best and a guess at worst.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { curateInProcess, CURATE_STEPS } from '../../packages/core/src/commands/spec-in-process';
import { StepTracker } from '../../packages/core/src/progress';
import { installMemorySessionRuns, resetSessionRuns } from '../helpers/memory-session-runs';
import type { DriverResult, SessionDriver } from '../../packages/agent-loop/src/index';

const MODEL_TIER = /\b(haiku|sonnet|opus)\b/;

let repo: string;
beforeEach(() => {
  installMemorySessionRuns();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-progress-model-'));
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'alpha.md'), '# Orders alpha\nbody');
  fs.writeFileSync(path.join(repo, 'docs', 'beta.md'), '# Orders beta\nbody');
});
afterEach(() => {
  resetSessionRuns();
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('spec scan progress', () => {
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
