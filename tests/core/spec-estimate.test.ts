/**
 * The shared pre-flight TOKEN estimator (token-estimator) + the scan estimator
 * that feeds it. Token math is offline; a price table is optional and adds a
 * ceiling cost.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  estimateStageTokens,
  tokensFromChars,
  formatCostUsd,
} from '../../packages/core/src/services/llm/token-estimator.js';
import { estimateScanTokens } from '../../packages/core/src/services/llm/spec-estimate.js';
import { curateInProcess } from '../../packages/core/src/commands/spec-in-process.js';
import { priceForModel, type PriceTable } from '../../packages/core/src/services/llm/model-prices.js';
import { discoverDocs, sourceDocRef, writeDecisions } from '../../packages/spec-consolidator/src/index.js';
import type { DecisionsFile, RepoIdentity, ScopeVerdict } from '../../packages/spec-consolidator/src/index.js';
import { seedSource } from '../spec-consolidator/sources-fixture.js';
import { resetKvCacheStore } from '@truecourse/llm';
import { runSpecScanSessions } from '../../packages/core/src/services/spec-scan/run.js';
import {
  CURATE_DOC_BUDGET,
  CURATE_DOC_SESSION_KIND,
} from '../../packages/core/src/services/spec-scan/curate-doc.js';
import {
  SETTLE_AREAS_BUDGET,
  SETTLE_AREAS_SESSION_KIND,
} from '../../packages/core/src/services/spec-scan/settle-areas.js';
import {
  OVERLAP_SESSION_BUDGET,
  OVERLAP_SESSION_KIND,
} from '../../packages/core/src/services/spec-scan/overlap.js';
import { SPEC_SCAN_ORCHESTRATE_SESSION_KIND } from '../../packages/core/src/services/spec-scan/orchestrate.js';
import { writeGlobalConfig } from '../../packages/core/src/config/global-config.js';
import type {
  DriverResult,
  SessionDriver,
  SessionEvent,
  SessionIndexEntry,
  SessionPersistence,
  SessionRunInput,
} from '../../packages/agent-loop/src/index.js';

// A fixed price table so cost assertions are deterministic (no network).
const PRICES: PriceTable = {
  tiers: {
    opus: { input: 15 / 1e6, output: 75 / 1e6 },
    sonnet: { input: 3 / 1e6, output: 15 / 1e6 },
    haiku: { input: 1 / 1e6, output: 5 / 1e6 },
  },
  byId: { 'anthropic/claude-opus-4-8': { input: 99 / 1e6, output: 99 / 1e6 } },
  fetchedAt: 1,
  source: 'live',
};

describe('estimateStageTokens', () => {
  it('rolls per-stage (calls × per-call tokens) into a token-only estimate', () => {
    const est = estimateStageTokens(
      [
        { stage: 'relevance', model: 'haiku', calls: 10, avgInputTokens: 100, avgOutputTokens: 20 },
        { stage: 'extract', model: 'opus', calls: 5, avgInputTokens: 1000, avgOutputTokens: 500, minCalls: 5, maxCalls: 15 },
      ],
      '10 docs',
    );
    // per-call adds PROMPT_OVERHEAD_TOKENS (500): relevance 620×10, extract 2000×5
    expect(est.totalEstimatedTokens).toBe(620 * 10 + 2000 * 5);
    expect(est.tiers).toEqual([]); // token-only: no rule tiers
    expect(est.subjectLabel).toBe('10 docs');
    const extract = est.stages!.find((s) => s.stage === 'extract')!;
    expect(extract.estimatedTokens).toBe(2000 * 5);
    expect(extract.callsRange).toEqual({ low: 5, high: 15 });
  });

  it('drops zero-call stages', () => {
    const est = estimateStageTokens([
      { stage: 'vocab', model: 'sonnet', calls: 0, avgInputTokens: 50, avgOutputTokens: 10 },
    ]);
    expect(est.stages).toEqual([]);
    expect(est.totalEstimatedTokens).toBe(0);
  });

  it('tokensFromChars divides chars by 4', () => {
    expect(tokensFromChars(40, 40)).toBe(20);
  });

  it('adds a ceiling cost per stage when a price table is supplied', () => {
    const est = estimateStageTokens(
      [
        { stage: 'extract', model: 'opus', calls: 4, avgInputTokens: 1000, avgOutputTokens: 500, maxCalls: 8 },
      ],
      undefined,
      PRICES,
    );
    const extract = est.stages!.find((s) => s.stage === 'extract')!;
    // Cost prices the HIGH end (maxCalls=8): in=(1000+500 overhead)*8, out=500*8.
    const inputTokens = 8 * (1000 + 500);
    const outputTokens = 8 * 500;
    const expected = inputTokens * (15 / 1e6) + outputTokens * (75 / 1e6);
    expect(extract.estimatedCostUsd).toBeCloseTo(expected, 10);
    expect(est.estimatedCostUsd).toBeCloseTo(expected, 10);
    expect(est.costSource).toBe('live');
  });

  it('prices an expected cost alongside the ceiling for a stage carrying expectedCalls', () => {
    const est = estimateStageTokens(
      [
        // Plain stage (known-upfront calls): no expected fields.
        { stage: 'overlap', model: 'opus', calls: 20, avgInputTokens: 1000, avgOutputTokens: 100, minCalls: 0, maxCalls: 40 },
        // Verify-like: ceiling maxCalls=20, realistic expectedCalls=3.
        { stage: 'verifyOverlap', model: 'opus', calls: 3, expectedCalls: 3, avgInputTokens: 1000, avgOutputTokens: 100, minCalls: 0, maxCalls: 20 },
      ],
      undefined,
      PRICES,
    );
    const priceCalls = (n: number) => n * (1000 + 500) * (15 / 1e6) + n * 100 * (75 / 1e6);

    const overlap = est.stages!.find((s) => s.stage === 'overlap')!;
    // A plain stage keeps ceiling-only cost — no expected fields.
    expect(overlap.expectedCalls).toBeUndefined();
    expect(overlap.expectedCostUsd).toBeUndefined();
    expect(overlap.estimatedCostUsd).toBeCloseTo(priceCalls(40), 10);

    const verify = est.stages!.find((s) => s.stage === 'verifyOverlap')!;
    expect(verify.expectedCalls).toBe(3);
    expect(verify.estimatedCostUsd).toBeCloseTo(priceCalls(20), 10); // ceiling prices maxCalls
    expect(verify.expectedCostUsd).toBeCloseTo(priceCalls(3), 10); // expected prices expectedCalls

    // Total ceiling prices every stage's maxCalls; total expected prices each
    // stage's realistic count (expectedCalls ?? calls).
    expect(est.estimatedCostUsd).toBeCloseTo(priceCalls(40) + priceCalls(20), 10);
    expect(est.expectedCostUsd).toBeCloseTo(priceCalls(20) + priceCalls(3), 10);
  });

  it('omits the total expected cost when no stage carries expectedCalls (ceiling-only)', () => {
    const est = estimateStageTokens(
      [{ stage: 'extract', model: 'opus', calls: 4, avgInputTokens: 1000, avgOutputTokens: 500, maxCalls: 8 }],
      undefined,
      PRICES,
    );
    expect(est.expectedCostUsd).toBeUndefined();
    expect(est.stages![0].expectedCostUsd).toBeUndefined();
  });

  it('is token-only (no cost fields) when no price table is given', () => {
    const est = estimateStageTokens([
      { stage: 'relevance', model: 'haiku', calls: 3, avgInputTokens: 100, avgOutputTokens: 20 },
    ]);
    expect(est.estimatedCostUsd).toBeUndefined();
    expect(est.stages![0].estimatedCostUsd).toBeUndefined();
  });

  it('flags costPartial when a stage model cannot be priced', () => {
    const est = estimateStageTokens(
      [
        { stage: 'extract', model: 'opus', calls: 2, avgInputTokens: 100, avgOutputTokens: 50 },
        { stage: 'mystery', model: 'gpt-4o', calls: 2, avgInputTokens: 100, avgOutputTokens: 50 },
      ],
      undefined,
      PRICES,
    );
    expect(est.costPartial).toBe(true);
    expect(est.stages!.find((s) => s.stage === 'mystery')!.estimatedCostUsd).toBeUndefined();
  });
});

describe('priceForModel / formatCostUsd', () => {
  it('matches exact OpenRouter ids before tier fallback', () => {
    expect(priceForModel('anthropic/claude-opus-4-8', PRICES)).toEqual({ input: 99 / 1e6, output: 99 / 1e6 });
    expect(priceForModel('claude-opus-4-8', PRICES)).toEqual({ input: 99 / 1e6, output: 99 / 1e6 });
  });
  it('falls back to the tier ceiling by substring for aliases + full ids', () => {
    expect(priceForModel('opus', PRICES)).toEqual(PRICES.tiers.opus);
    expect(priceForModel('claude-sonnet-4-6', PRICES)).toEqual(PRICES.tiers.sonnet);
    expect(priceForModel('haiku', PRICES)).toEqual(PRICES.tiers.haiku);
  });
  it('returns null for unpriceable models', () => {
    expect(priceForModel('gpt-4o', PRICES)).toBeNull();
  });
  it('formats USD with a <$0.01 floor', () => {
    expect(formatCostUsd(0.004)).toBe('<$0.01');
    expect(formatCostUsd(0.42)).toBe('$0.42');
    expect(formatCostUsd(3.1)).toBe('$3.10');
    expect(formatCostUsd(0)).toBe('$0.00');
  });
});


// ---------------------------------------------------------------------------
// The SCAN estimate models SESSIONS (plan 02 step 7)
//
// The headline contract is AGREEMENT: the estimate probes the run's own cache
// names with the run's own exported key builders, so a warmed repo estimates to
// nothing (and `curateInProcess` skips the confirm prompt) while any input the
// run would re-key — a doc edit, a standing instruction, a different identity —
// shows up here as work. Everything below drives the REAL run through a
// scripted session driver to warm those caches; nothing stubs the estimate.
// ---------------------------------------------------------------------------

/** A driver that answers every scan kind trivially and counts the sessions. */
function warmDriver(): { driver: SessionDriver; kinds: string[] } {
  const kinds: string[] = [];
  const driver: SessionDriver = {
    capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
    attribution: { provider: 'test', model: 'scripted' },
    runSession(input) {
      kinds.push(input.def.kind);
      for (const content of input.initialMessages) input.onEvent({ type: 'user-message', content });
      const done = (async (): Promise<DriverResult> => {
        await new Promise((r) => setTimeout(r, 0));
        switch (input.def.kind) {
          case SPEC_SCAN_ORCHESTRATE_SESSION_KIND:
            return { kind: 'outcome', value: { scopeVerdicts: [], instructions: [] } };
          case CURATE_DOC_SESSION_KIND:
            return {
              kind: 'outcome',
              value: { keep: true, reason: 'spec', areas: [{ product: 'core', concern: 'misc' }] },
            };
          case SETTLE_AREAS_SESSION_KIND:
            return {
              kind: 'outcome',
              value: { concernMerges: {}, productMerges: {}, productVerdicts: [], subdivisions: [] },
            };
          case OVERLAP_SESSION_KIND:
            input.onEvent({
              type: 'tool-result',
              toolName: 'check_findings',
              content: 'valid',
              isError: false,
            });
            return { kind: 'outcome', value: { overlaps: [], notReached: [] } };
          default:
            throw new Error(`unscripted kind ${input.def.kind}`);
        }
      })();
      return { done, status: () => 'running' as const, steer: () => {}, interrupt: async () => {} };
    },
  };
  return { driver, kinds };
}

function memoryPersistence(): SessionPersistence {
  const events = new Map<string, SessionEvent[]>();
  const index = new Map<string, SessionIndexEntry>();
  return {
    appendEvent(sessionId, event) {
      const list = events.get(sessionId) ?? [];
      list.push(event);
      events.set(sessionId, list);
    },
    updateIndex(entry) {
      index.set(entry.sessionId, entry);
    },
    readEvents(sessionId) {
      return events.get(sessionId) ?? [];
    },
  };
}

const verdictRow = (p: string, v: 'keep' | 'exclude' = 'keep'): ScopeVerdict => ({
  path: p,
  verdict: v,
  reason: 'fixture',
  decidedAt: '2026-01-01T00:00:00Z',
  resolvedBy: 'user',
});

const decisionsFile = (over: Partial<DecisionsFile> = {}): DecisionsFile => ({
  version: 2,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
  conflictResolutions: [],
  scopeVerdicts: [],
  instructions: [],
  ...over,
});

describe('estimateScanTokens — sessions, not calls', () => {
  let repo: string;
  const stage = (est: Awaited<ReturnType<typeof estimateScanTokens>>, kind: string) =>
    (est.stages ?? []).find((s) => s.stage === kind);
  /** A stage's LOW bound — one session per cache-missing item. */
  const items = (est: Awaited<ReturnType<typeof estimateScanTokens>>, kind: string): number | undefined =>
    stage(est, kind)?.callsRange?.low;

  /** Run the real scan on the scripted driver, warming every session cache. */
  async function warmScan(
    opts: { identity?: RepoIdentity | null; disableOverlapDetection?: boolean } = {},
  ): Promise<string[]> {
    const { driver, kinds } = warmDriver();
    await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => driver,
      persistence: memoryPersistence(),
      skipGit: true,
      ...(opts.identity !== undefined ? { repoIdentity: opts.identity } : {}),
      ...(opts.disableOverlapDetection ? { disableOverlapDetection: true } : {}),
    });
    return kinds;
  }

  function writeDocs(files: Record<string, string>): void {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(repo, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  }

  const AUTH = '# Auth\n\n## Tokens\n\nAccess tokens expire after 15 minutes.\n';
  const SESSION_DOC = '# Session\n\n## Tokens\n\nAccess tokens expire after 60 minutes.\n';

  beforeEach(() => {
    resetKvCacheStore();
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-estimate-'));
  });
  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  // -- the headline: estimate and run agree on the keys ----------------------

  it('a cold repo estimates one curate-doc session per doc; a warmed one estimates NOTHING', async () => {
    writeDocs({ 'docs/auth.md': AUTH, 'docs/session.md': SESSION_DOC });
    writeDecisions(repo, decisionsFile({ scopeVerdicts: [verdictRow('.'), verdictRow('docs')] }));

    const cold = await estimateScanTokens(repo);
    expect(items(cold, CURATE_DOC_SESSION_KIND)).toBe(2);
    expect((cold.stages ?? []).length).toBeGreaterThan(0);

    await warmScan();

    const warm = await estimateScanTokens(repo);
    // The exact gate `curateInProcess` uses to skip the confirm prompt.
    expect((warm.stages?.length ?? 0) === 0).toBe(true);
    expect(warm.totalEstimatedTokens).toBe(0);
    expect(warm.subjectLabel).toBe('all 2 docs cached');
  });

  it('an UNCOVERED universe keeps exactly one stage — the scope orchestrator — even with warm doc caches', async () => {
    writeDocs({ 'docs/auth.md': AUTH, 'docs/session.md': SESSION_DOC });
    writeDecisions(repo, decisionsFile({ scopeVerdicts: [verdictRow('.'), verdictRow('docs')] }));
    await warmScan();

    // Drop the coverage: the universe is unchanged, but no verdict covers it.
    writeDecisions(repo, decisionsFile());
    const est = await estimateScanTokens(repo);
    expect((est.stages ?? []).map((s) => s.stage)).toEqual([SPEC_SCAN_ORCHESTRATE_SESSION_KIND]);
    expect(items(est, SPEC_SCAN_ORCHESTRATE_SESSION_KIND)).toBe(1);
  });

  it('one added instruction re-keys every doc — the estimate says so before the run pays', async () => {
    writeDocs({ 'docs/auth.md': AUTH, 'docs/session.md': SESSION_DOC });
    writeDecisions(repo, decisionsFile({ scopeVerdicts: [verdictRow('.'), verdictRow('docs')] }));
    await warmScan();
    expect((await estimateScanTokens(repo)).stages ?? []).toEqual([]);

    writeDecisions(
      repo,
      decisionsFile({
        scopeVerdicts: [verdictRow('.'), verdictRow('docs')],
        instructions: ['docs under handbook/ are process, not product'],
      }),
    );
    const est = await estimateScanTokens(repo);
    expect(items(est, CURATE_DOC_SESSION_KIND)).toBe(2);
    expect(est.subjectLabel).toBe('2 docs');
  });

  // -- the session math ------------------------------------------------------

  it('turns items into calls with the budget ceiling and the per-kind expected turns', async () => {
    writeDocs({ 'docs/auth.md': AUTH, 'docs/session.md': SESSION_DOC });
    writeDecisions(repo, decisionsFile({ scopeVerdicts: [verdictRow('.'), verdictRow('docs')] }));

    const est = await estimateScanTokens(repo);
    const K = 2;
    const curate = stage(est, CURATE_DOC_SESSION_KIND)!;
    expect(curate.callsRange).toEqual({
      low: K,
      high: K * (CURATE_DOC_BUDGET.maxResumes + 1) * CURATE_DOC_BUDGET.turns,
    });
    expect(curate.expectedCalls).toBe(K * 2); // EXPECTED_TURNS['spec-scan.curate-doc']

    // With docs unknown, the settlement is a 0..1 range, expected 1.
    const settle = stage(est, SETTLE_AREAS_SESSION_KIND)!;
    expect(settle.callsRange).toEqual({
      low: 0,
      high: (SETTLE_AREAS_BUDGET.maxResumes + 1) * SETTLE_AREAS_BUDGET.turns,
    });
    expect(settle.expectedCalls).toBe(4); // EXPECTED_TURNS['spec-scan.settle-areas']
  });

  it('prices the overlap kind at items × the budget ceiling', async () => {
    writeDocs({ 'docs/auth.md': AUTH, 'docs/session.md': SESSION_DOC });
    writeDecisions(repo, decisionsFile({ scopeVerdicts: [verdictRow('.'), verdictRow('docs')] }));
    const est = await estimateScanTokens(repo);
    const overlap = stage(est, OVERLAP_SESSION_KIND)!;
    const ceiling = (OVERLAP_SESSION_BUDGET.maxResumes + 1) * OVERLAP_SESSION_BUDGET.turns;
    const areas = overlap.callsRange!.high / ceiling;
    expect(Number.isInteger(areas)).toBe(true);
    expect(areas).toBeGreaterThan(0);
    // The point estimate is the same item count × the kind's EXPECTED turns (8).
    expect(overlap.expectedCalls).toBe(overlap.calls);
    expect(overlap.calls % 8).toBe(0);
  });

  // -- one model (§3.4) ------------------------------------------------------

  it('runs every scan stage on ONE model — the claude-code tier by default', async () => {
    writeDocs({ 'docs/auth.md': AUTH, 'docs/session.md': SESSION_DOC });
    const est = await estimateScanTokens(repo);
    const models = new Set((est.stages ?? []).map((s) => s.model));
    expect(models.size).toBe(1);
    expect([...models]).toEqual(['opus']);
  });

  it('follows the run transport: an api-mode estimate quotes the configured model', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-estimate-home-'));
    const saved = process.env.TRUECOURSE_HOME;
    process.env.TRUECOURSE_HOME = home;
    try {
      writeGlobalConfig({
        llm: { transport: 'api', api: { provider: 'openai', model: 'gpt-5.5', apiKey: 'sk-test' } },
      });
      writeDocs({ 'docs/auth.md': AUTH, 'docs/session.md': SESSION_DOC });
      const est = await estimateScanTokens(repo, undefined, { mode: 'api' });
      const models = new Set((est.stages ?? []).map((s) => s.model));
      expect([...models]).toEqual(['gpt-5.5']);
      // …and a run forced onto `cli` still quotes the pinned session tier.
      const cli = await estimateScanTokens(repo, undefined, { mode: 'claude-code' });
      expect([...new Set((cli.stages ?? []).map((s) => s.model))]).toEqual(['opus']);
    } finally {
      if (saved === undefined) delete process.env.TRUECOURSE_HOME;
      else process.env.TRUECOURSE_HOME = saved;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  // -- the honesty of the bounds --------------------------------------------

  it('degrades the overlap bound to a RANGE while any doc verdict is unknown', async () => {
    writeDocs({ 'docs/auth.md': AUTH, 'docs/session.md': SESSION_DOC });
    writeDecisions(repo, decisionsFile({ scopeVerdicts: [verdictRow('.'), verdictRow('docs')] }));

    const cold = await estimateScanTokens(repo);
    expect(stage(cold, OVERLAP_SESSION_KIND)!.bound).toMatch(
      /^~\d+ of ~\d+ areas? changed \(changed docs may reshape areas\)$/,
    );

    // One changed doc is enough to re-open the question: its verdict can move a
    // label, and a moved label reshapes the areas.
    await warmScan();
    writeDocs({ 'docs/session.md': `${SESSION_DOC}\nTokens are opaque.\n` });
    expect(stage(await estimateScanTokens(repo), OVERLAP_SESSION_KIND)!.bound).toContain('~');
  });

  it('states an EXACT `N of M areas changed` once every doc verdict is settled', async () => {
    writeDocs({ 'docs/auth.md': AUTH, 'docs/session.md': SESSION_DOC });
    writeDecisions(repo, decisionsFile({ scopeVerdicts: [verdictRow('.'), verdictRow('docs')] }));
    // The workspace-sync shape: curate + settle warmed, overlap never run. Every
    // doc verdict is cached, so the areas ARE knowable and the count is exact.
    await warmScan({ disableOverlapDetection: true });

    const est = await estimateScanTokens(repo);
    const overlap = stage(est, OVERLAP_SESSION_KIND)!;
    expect(overlap.bound).toMatch(/^\d+ of \d+ areas? changed$/);
    expect(overlap.bound).not.toContain('~');
    // Exact means the LOW bound is the real cache-miss count, not a heuristic.
    expect(overlap.callsRange!.low).toBe(1);
    expect(est.subjectLabel).toBe('all 2 docs cached');
  });

  it('never quotes a doc an EXCLUDE verdict drops — not in a stage, not in the subject', async () => {
    writeDocs({ 'docs/keep.md': AUTH, 'vendor/mirror/drop.md': SESSION_DOC });
    writeDecisions(
      repo,
      decisionsFile({ scopeVerdicts: [verdictRow('docs'), verdictRow('vendor', 'exclude')] }),
    );
    const est = await estimateScanTokens(repo);
    expect(items(est, CURATE_DOC_SESSION_KIND)).toBe(1);
    expect(est.subjectLabel).toBe('1 doc');
  });

  it('agrees with discovery under spec.include', async () => {
    writeDocs({
      'docs/a.md': AUTH,
      'docs/b.md': SESSION_DOC,
      'reference/out.md': '# Out\nignored\n',
      '.truecourse/config.json': JSON.stringify({ spec: { include: ['docs/**'] } }),
    });
    writeDecisions(repo, decisionsFile({ scopeVerdicts: [verdictRow('docs')] }));
    expect(discoverDocs(repo).map((d) => d.path).sort()).toEqual(['docs/a.md', 'docs/b.md']);
    const est = await estimateScanTokens(repo);
    expect(items(est, CURATE_DOC_SESSION_KIND)).toBe(2);
    expect(est.subjectLabel).toBe('2 docs');
  });

  it('prices a registered web source exactly as the run discovers it', async () => {
    writeDocs({ 'docs/a.md': AUTH });
    writeDecisions(repo, decisionsFile({ scopeVerdicts: [verdictRow('.'), verdictRow('docs')] }));
    const repoOnly = await estimateScanTokens(repo, undefined, { identity: null });
    expect(items(repoOnly, CURATE_DOC_SESSION_KIND)).toBe(1);

    const source = seedSource(repo);
    const discovered = discoverDocs(repo, { skipGit: true });
    expect(discovered.map((d) => d.path)).toEqual([
      'docs/a.md',
      ...source.docs.map((d) => sourceDocRef(source.id, d.path)).sort(),
    ]);
    // The source is a NEW subtree, so scope re-opens; cover it and the snapshots
    // are priced exactly like repo docs.
    writeDecisions(
      repo,
      decisionsFile({ scopeVerdicts: [verdictRow('.'), verdictRow('docs'), verdictRow(source.id)] }),
    );
    const est = await estimateScanTokens(repo, undefined, { identity: null });
    expect(items(est, CURATE_DOC_SESSION_KIND)).toBe(discovered.length);
    expect(est.subjectLabel).toBe(`${discovered.length} docs`);
    expect(est.totalEstimatedTokens).toBeGreaterThan(repoOnly.totalEstimatedTokens);
  });

  /**
   * The 2026-07-07 silent-spend class, in its surviving form. A doc the
   * deterministic PREFILTER drops never reaches a session — until the user
   * force-includes it, at which point the run spends one. The estimate runs the
   * SAME `prefilterDocs` over the SAME decisions, so the gate cannot be skipped.
   *
   * (The old relevance-verdict form of this bug is structurally gone: curation
   * judges relevance and areas in ONE session, so a force-include over a cached
   * `keep: false` verdict costs no second call.)
   */
  it('gates on a force-included PREFILTERED doc (no silent spend)', async () => {
    writeDocs({ 'docs/keep.md': AUTH, 'docs/archive/old.md': SESSION_DOC });
    writeDecisions(repo, decisionsFile({ scopeVerdicts: [verdictRow('.'), verdictRow('docs')] }));
    await warmScan();
    // The archived doc never cost a session, and the warm repo estimates nothing.
    expect((await estimateScanTokens(repo)).stages ?? []).toEqual([]);

    writeDecisions(
      repo,
      decisionsFile({
        scopeVerdicts: [verdictRow('.'), verdictRow('docs')],
        manualIncludes: ['docs/archive/old.md'],
      }),
    );
    const est = await estimateScanTokens(repo);
    // The pre-flight gate names exactly the one newly-reachable doc…
    expect(items(est, CURATE_DOC_SESSION_KIND)).toBe(1);

    // …and the run really does spend that session.
    const { driver, kinds } = warmDriver();
    await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => driver,
      persistence: memoryPersistence(),
      skipGit: true,
    });
    expect(kinds.filter((k) => k === CURATE_DOC_SESSION_KIND)).toHaveLength(1);
  });

  // -- the no-changes contract the CLI/dashboard gate on ---------------------

  it('curateInProcess skips the confirm prompt (and every session) on a fully warmed repo', async () => {
    writeDocs({ 'docs/auth.md': AUTH, 'docs/session.md': SESSION_DOC });
    writeDecisions(repo, decisionsFile({ scopeVerdicts: [verdictRow('.'), verdictRow('docs')] }));
    await warmScan();

    let prompted = false;
    const result = await curateInProcess(repo, {
      skipGit: true,
      onLlmEstimate: async () => {
        prompted = true;
        return true;
      },
      driver: {
        capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
        attribution: { provider: 'test', model: 'never-used' },
        runSession() {
          throw new Error('a fully warmed re-scan must start no session');
        },
      },
    });
    expect(prompted).toBe(false);
    expect(result.noChanges).toBe(true);
  });
});

/**
 * The estimate and the run must resolve the SAME repo identity. Identity is part
 * of the curate-doc cache key, so if the two disagree the estimate reads a cache
 * the run will never hit: it reports "all cached", the confirm prompt is skipped,
 * and the run silently spends the whole corpus. This is the exact failure class
 * `spec-estimate.ts` documents, which is why `identity` is required-and-nullable
 * rather than an optional parameter everywhere it touches the key.
 */
describe('scan estimate — identity is part of the cache key', () => {
  let repo: string;
  beforeEach(() => {
    resetKvCacheStore();
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-est-identity-'));
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'docs', 'api.md'), '# API\n' + 'Endpoint requires auth. '.repeat(50));
    writeDecisions(repo, decisionsFile({ scopeVerdicts: [verdictRow('.'), verdictRow('docs')] }));
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  const IDENTITY_A: RepoIdentity = { name: 'alpha', aliases: ['Alpha'], sources: ['git-remote'] };
  const IDENTITY_B: RepoIdentity = { name: 'beta', aliases: ['Betaa'], sources: ['git-remote'] };

  async function scanAs(identity: RepoIdentity): Promise<void> {
    const { driver } = warmDriver();
    await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => driver,
      persistence: memoryPersistence(),
      skipGit: true,
      repoIdentity: identity,
    });
  }

  const curateCalls = async (identity: RepoIdentity): Promise<number> => {
    const est = await estimateScanTokens(repo, undefined, { identity });
    return (est.stages ?? []).find((s) => s.stage === CURATE_DOC_SESSION_KIND)?.callsRange?.low ?? 0;
  };

  it('a run with the estimated identity leaves nothing to re-estimate', async () => {
    expect(await curateCalls(IDENTITY_A)).toBe(1);
    await scanAs(IDENTITY_A);
    expect(await curateCalls(IDENTITY_A)).toBe(0);
  });

  it('a run under a DIFFERENT identity does not satisfy the estimate', async () => {
    await scanAs(IDENTITY_B);
    expect(await curateCalls(IDENTITY_A)).toBe(1);
  });
});
