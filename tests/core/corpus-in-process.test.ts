/**
 * The flag-gated corpus-path drivers shared by `spec scan --corpus` and
 * `contracts generate --corpus`: curateInProcess writes corpus.json, then
 * generateFromCorpusInProcess reads it and emits .tc — all with stub runners
 * (no Claude subprocesses), proving the wiring end-to-end alongside the claims path.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import {
  curateInProcess,
  generateFromCorpusInProcess,
  readGeneratedSummary,
  CURATE_STEPS,
} from '../../packages/core/src/commands/spec-in-process.js';
import { StepTracker, estimateStepPhase, type AnalysisStep } from '../../packages/core/src/progress.js';
import { readCorpus } from '../../packages/spec-consolidator/src/index.js';
import type { Fragment } from '../../packages/contract-extractor/src/index.js';

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

const includeAll = async ({ doc }: { doc: { path: string } }) => ({ path: doc.path, include: true, reason: 'ok' });
// The two docs carry two concerns, so the vocab stage makes a real call. Stub it to
// a no-op mapping — unstubbed it reaches the transport, and a stage that loses every
// call aborts the scan.
const noVocabDrift = async () => ({ products: {}, concerns: {} });
const tagByPath = async ({ doc }: { doc: { path: string } }) => ({
  tags: [{ product: 'core', concern: doc.path.includes('auth') ? 'auth' : 'users' }],
  status: 'shipped' as const,
});
function entityFragment(src: string, identity: string): Fragment {
  return {
    kind: 'Entity',
    identity,
    tcSource: `entity ${identity} {\n  origin "${src}" "${identity}" 1..2\n  field id: string immutable\n}`,
    origin: { source: src, section: identity, lines: [1, 2] },
    obligationKeys: [],
  };
}

describe('curateInProcess', () => {
  it('curates the repo docs into corpus.json', async () => {
    const { curate } = await curateInProcess(repo, {
      relevanceRunner: includeAll,
      areaTagRunner: tagByPath,
      vocabRunner: noVocabDrift,
      disableOverlapDetection: true,
      skipGit: true,
    });
    expect(curate.stats.docsKept).toBe(2);
    expect(curate.stats.areaCount).toBe(2);
    const corpus = readCorpus(repo);
    expect(corpus).not.toBeNull();
    expect(corpus!.areas.map((a) => a.id).sort()).toEqual(['core/auth', 'core/users-entity']);
  });

  it('persists relevance-dropped docs as skippedDocs (for the dashboard force-include UI)', async () => {
    const { curate } = await curateInProcess(repo, {
      // Drop auth.md; keep users.md.
      relevanceRunner: async ({ doc }: { doc: { path: string } }) => ({
        path: doc.path,
        include: !doc.path.includes('auth'),
        reason: doc.path.includes('auth') ? 'not a spec' : 'ok',
      }),
      areaTagRunner: tagByPath,
      vocabRunner: noVocabDrift,
      disableOverlapDetection: true,
      skipGit: true,
    });
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
      relevanceRunner: includeAll,
      areaTagRunner: tagByPath,
      vocabRunner: noVocabDrift,
      disableOverlapDetection: true,
      skipGit: true,
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
      relevanceRunner: includeAll,
      areaTagRunner: tagByPath,
      vocabRunner: noVocabDrift,
      disableOverlapDetection: true,
      skipGit: true,
    });

    expect(doneWhenGateOpened).toBe('done');
    const final = frames[frames.length - 1];
    expect(final[0]).toMatchObject({ key: 'estimate', label: 'Estimating cost', detail: '2 docs' });
    const activeAt = (key: string): number =>
      frames.findIndex((f) => f.find((s) => s.key === key)?.status === 'active');
    expect(activeAt('estimate')).toBeGreaterThanOrEqual(0);
    expect(activeAt('estimate')).toBeLessThan(activeAt('discover'));
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
      relevanceRunner: includeAll,
      areaTagRunner: tagByPath,
      vocabRunner: noVocabDrift,
      disableOverlapDetection: true,
      skipGit: true,
    });
    expect(phase).toEqual([]);
    expect(frames[frames.length - 1].some((s) => s.key === 'estimate')).toBe(false);
  });
});

describe('generateFromCorpusInProcess', () => {
  it('skips when no corpus.json exists', async () => {
    const { corpus } = await generateFromCorpusInProcess(repo, { disableRepair: true });
    expect(corpus.kind).toBe('skipped');
  });

  it('generates .tc from corpus.json after a curate', async () => {
    await curateInProcess(repo, {
      relevanceRunner: includeAll,
      areaTagRunner: tagByPath,
      vocabRunner: noVocabDrift,
      disableOverlapDetection: true,
      skipGit: true,
    });

    const { corpus } = await generateFromCorpusInProcess(repo, {
      enumerateRunner: async ({ area }) => [
        { kind: 'Entity', identity: area.concern === 'auth' ? 'Session' : 'User' },
      ],
      generateRunner: async ({ area, targets }) => ({
        fragments: targets.map((t) => entityFragment(area.docs[0].ref, t.identity)),
      }),
      disableRepair: true,
    });

    expect(corpus.kind).toBe('generated');
    if (corpus.kind === 'generated') {
      expect(corpus.result.resolverHard).toBe(false);
      expect(corpus.result.gaps).toEqual([]);
      expect(corpus.result.write.written.length).toBeGreaterThan(0);
      expect(corpus.result.artifactsToWrite.map((a) => a.identity).sort()).toEqual(['Session', 'User']);
    }
    // The .tc tree landed on disk.
    expect(fs.existsSync(path.join(repo, '.truecourse', 'contracts'))).toBe(true);
  });

  it('dry run writes nothing and does not stamp the generated marker', async () => {
    await curateInProcess(repo, {
      relevanceRunner: includeAll,
      areaTagRunner: tagByPath,
      vocabRunner: noVocabDrift,
      disableOverlapDetection: true,
      skipGit: true,
    });
    const { corpus } = await generateFromCorpusInProcess(repo, {
      dryRun: true,
      enumerateRunner: async () => [{ kind: 'Entity', identity: 'User' }],
      generateRunner: async ({ area, targets }) => ({
        fragments: targets.map((t) => entityFragment(area.docs[0].ref, t.identity)),
      }),
      disableRepair: true,
    });
    expect(corpus.kind).toBe('generated');
    if (corpus.kind === 'generated') {
      expect(corpus.result.write.written).toEqual([]);
      expect(corpus.result.write.proposed.length).toBeGreaterThan(0);
    }
    expect(fs.existsSync(path.join(repo, '.truecourse', 'contracts'))).toBe(false);
    expect(fs.existsSync(path.join(repo, '.truecourse', 'contracts', 'result.json'))).toBe(false);
  });

  it('persists the run summary (written + gaps) so it survives a reload', async () => {
    await curateInProcess(repo, {
      relevanceRunner: includeAll,
      areaTagRunner: tagByPath,
      vocabRunner: noVocabDrift,
      disableOverlapDetection: true,
      skipGit: true,
    });
    // Enumerate a target the generate runner never emits → a coverage gap.
    const { corpus } = await generateFromCorpusInProcess(repo, {
      enumerateRunner: async ({ area }) =>
        area.concern === 'auth'
          ? [{ kind: 'Entity', identity: 'Session' }]
          : [
              { kind: 'Entity', identity: 'User' },
              { kind: 'Entity', identity: 'Ghost' },
            ],
      generateRunner: async ({ area, targets }) => ({
        fragments: targets
          .filter((t) => t.identity !== 'Ghost')
          .map((t) => entityFragment(area.docs[0].ref, t.identity)),
      }),
      disableRepair: true,
      disableGapJudge: true, // test raw gap persistence, not the judge
    });
    expect(corpus.kind).toBe('generated');

    const summary = readGeneratedSummary(repo);
    expect(summary).not.toBeNull();
    expect(summary!.written).toBeGreaterThan(0);
    expect(summary!.gaps).toContainEqual({
      areaId: 'core/users-entity',
      kind: 'Entity',
      identity: 'Ghost',
    });
    // What the run returned and what we persisted agree.
    if (corpus.kind === 'generated') {
      expect(summary!.written).toBe(corpus.result.write.written.length);
      expect(summary!.gaps).toEqual(corpus.result.gaps);
    }
  });
});
