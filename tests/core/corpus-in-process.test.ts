/**
 * The corpus-path driver behind `spec scan`: `curateInProcess` writes
 * corpus.json over a SCRIPTED SessionDriver, proving the wiring end-to-end,
 * including the pre-flight estimate phase that sits in front of it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { curateInProcess, CURATE_STEPS } from '../../packages/core/src/commands/spec-in-process.js';
import { StepTracker, estimateStepPhase, type AnalysisStep } from '../../packages/core/src/progress.js';
import { readCorpus } from '../../packages/spec-consolidator/src/index.js';
import type { DecisionsFile } from '../../packages/spec-consolidator/src/index.js';
import { docPathOf, outcome, stubDriver, toolResult } from './spec-scan-session-stub';

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-corpus-inproc-'));
  const docs = path.join(repo, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'users.md'), '# Users\nStatus: shipped\nThe user entity has an id and email.');
  fs.writeFileSync(path.join(docs, 'auth.md'), '# Auth\nStatus: shipped\nSessions authenticate users.');
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

/**
 * Scope verdicts covering the whole universe, so the scan spends zero
 * orchestrator sessions and these cases are about the curation wiring alone.
 */
const DECISIONS: DecisionsFile = {
  version: 2,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
  conflictResolutions: [],
  instructions: [],
  scopeVerdicts: ['.', 'docs'].map((p) => ({
    path: p,
    verdict: 'keep' as const,
    reason: 'covered by the test',
    decidedAt: '2026-01-01T00:00:00.000Z',
    resolvedBy: 'user' as const,
  })),
};

/** Keep every doc, tagged by path; the two docs carry two concerns, so the
 *  settle barrier opens — answer it with an empty settlement. */
const scanDriver = (keep: (docPath: string) => boolean = () => true) =>
  stubDriver(async (call) => {
    if (call.kind === 'spec-scan.settle-areas') {
      await call.emit(toolResult('check_settlement', 'valid'));
      return outcome({ concernMerges: {}, productMerges: {}, productVerdicts: [], subdivisions: [] });
    }
    const p = docPathOf(call.briefing);
    return outcome(
      keep(p)
        ? {
            keep: true,
            reason: 'ok',
            subject: 'this-product',
            areas: [{ product: 'core', concern: p.includes('auth') ? 'auth' : 'users' }],
            status: 'shipped',
          }
        : {
            keep: false,
            reason: 'not a spec',
            subject: 'this-product',
            category: 'scratch',
            areas: [],
            status: null,
          },
    );
  }).driver;

/** The scan options every case shares. */
const scanOptions = (driver = scanDriver()) => ({
  driver,
  decisions: DECISIONS,
  repoIdentity: null,
  disableOverlapDetection: true,
  skipGit: true,
});
describe('curateInProcess', () => {
  it('curates the repo docs into corpus.json', async () => {
    const { curate } = await curateInProcess(repo, scanOptions());
    expect(curate.stats.docsKept).toBe(2);
    expect(curate.stats.areaCount).toBe(2);
    const corpus = readCorpus(repo);
    expect(corpus).not.toBeNull();
    expect(corpus!.areas.map((a) => a.id).sort()).toEqual(['core/auth', 'core/users-entity']);
  });

  it('persists relevance-dropped docs as skippedDocs (for the dashboard force-include UI)', async () => {
    // Drop auth.md; keep users.md.
    const { curate } = await curateInProcess(
      repo,
      scanOptions(scanDriver((p) => !p.includes('auth'))),
    );
    expect(curate.skippedDocs.some((s) => s.path.includes('auth'))).toBe(true);
    // …and it round-trips through corpus.json so the dashboard can read it.
    const corpus = readCorpus(repo);
    expect(corpus!.skippedDocs.some((s) => s.ref.includes('auth') && s.reason === 'not a spec')).toBe(true);
  });

  // The estimate reads every doc before the gate opens; without a surface of its
  // own the CLI/dashboard sat silent for seconds on a large corpus. That surface
  // is the caller's `onEstimatePhase` — NOT the run checklist, which must stay the
  // run's own steps (the terminal renderer repaints it in place).
  it('reports the pre-flight estimate through its own phase, off the run checklist', async () => {
    const frames: AnalysisStep[][] = [];
    const tracker = new StepTracker(
      (payload) => frames.push((payload.steps ?? []).map((s) => ({ ...s }))),
      [...CURATE_STEPS],
    );
    const phase: string[] = [];
    let framesWhenGateOpened = -1;

    await curateInProcess(repo, {
      tracker,
      onEstimatePhase: {
        start: () => phase.push('start'),
        done: (subject) => phase.push(`done:${subject}`),
        error: (message) => phase.push(`error:${message}`),
      },
      onLlmEstimate: async () => {
        framesWhenGateOpened = frames.length;
        return true;
      },
      ...scanOptions(),
    });

    // Started and completed — with the estimate's own subject — before the confirm.
    expect(phase).toEqual(['start', 'done:2 docs']);
    // The checklist hadn't painted at all when the gate opened: its first frame is
    // the run's first step, so a surface that repaints in place paints it once.
    expect(framesWhenGateOpened).toBe(0);
    expect(frames[0][0]).toMatchObject({ key: 'discover', status: 'active' });
    expect(frames.every((f) => f.every((s) => s.key !== 'estimate'))).toBe(true);
  });

  // The dashboard popup replaces in place, so it opts INTO the estimate as a
  // leading checklist step via the adapter.
  it('estimateStepPhase adapts the estimate onto the tracker as a leading step', async () => {
    const frames: AnalysisStep[][] = [];
    const tracker = new StepTracker(
      (payload) => frames.push((payload.steps ?? []).map((s) => ({ ...s }))),
      [...CURATE_STEPS],
    );
    let doneWhenGateOpened: string | undefined;

    await curateInProcess(repo, {
      tracker,
      onEstimatePhase: estimateStepPhase(tracker),
      onLlmEstimate: async () => {
        doneWhenGateOpened = frames[frames.length - 1].find((s) => s.key === 'estimate')?.status;
        return true;
      },
      ...scanOptions(),
    });

    expect(doneWhenGateOpened).toBe('done');
    const final = frames[frames.length - 1];
    expect(final[0]).toMatchObject({ key: 'estimate', label: 'Estimating cost', detail: '2 docs' });
    const activeAt = (key: string): number =>
      frames.findIndex((f) => f.find((s) => s.key === key)?.status === 'active');
    expect(activeAt('estimate')).toBeGreaterThanOrEqual(0);
    expect(activeAt('estimate')).toBeLessThan(activeAt('discover'));
  });

  // The confirm can wait on a human for minutes, and disconnecting the repo
  // aborts the scan while it waits — the wait must observe the signal, or the
  // cancel times out and the poisoned scan dies later, when someone confirms.
  it('a cancel reaches a scan parked at the estimate confirm — it ends now, aborted', async () => {
    const controller = new AbortController();
    let confirmOpened!: () => void;
    const opened = new Promise<void>((resolve) => (confirmOpened = resolve));

    const scan = curateInProcess(repo, {
      signal: controller.signal,
      // A confirm nobody ever answers — the estimate modal sitting open.
      onLlmEstimate: () =>
        new Promise<boolean>(() => {
          confirmOpened();
        }),
      ...scanOptions(),
    });
    scan.catch(() => {}); // asserted below; don't let the rejection go unhandled first

    await opened;
    controller.abort();

    await expect(scan).rejects.toThrow('the spec scan was cancelled');
    // The gate sits before the run record, so the aborted scan left none —
    // and no corpus.
    expect(fs.existsSync(path.join(repo, '.truecourse', 'sessions'))).toBe(false);
    expect(readCorpus(repo)).toBeNull();
  });

  it('reports no estimate phase when the caller does not gate on one', async () => {
    const frames: AnalysisStep[][] = [];
    const tracker = new StepTracker(
      (payload) => frames.push((payload.steps ?? []).map((s) => ({ ...s }))),
      [...CURATE_STEPS],
    );
    const phase: string[] = [];
    await curateInProcess(repo, {
      tracker,
      onEstimatePhase: {
        start: () => phase.push('start'),
        done: () => phase.push('done'),
        error: () => phase.push('error'),
      },
      ...scanOptions(),
    });
    expect(phase).toEqual([]);
    expect(frames[frames.length - 1].some((s) => s.key === 'estimate')).toBe(false);
  });
});
