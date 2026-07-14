/**
 * The shared pre-flight TOKEN estimator (token-estimator) + the scan/generate
 * estimators that feed it. Token math is offline; a price table is optional and
 * adds a ceiling cost.
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
import {
  estimateScanTokens,
  estimateGenerateTokens,
} from '../../packages/core/src/services/llm/spec-estimate.js';
import { priceForModel, type PriceTable } from '../../packages/core/src/services/llm/model-prices.js';
import {
  generateContractsFromCorpus,
  type EnumerateRunner,
  type GenerateBatchRunner,
} from '../../packages/contract-extractor/src/index.js';
import {
  discoverDocs,
  filterByRelevance,
  tagDocs,
  curate,
} from '../../packages/spec-consolidator/src/index.js';

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
      { stage: 'relation', model: 'sonnet', calls: 0, avgInputTokens: 50, avgOutputTokens: 10 },
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

describe('estimateScanTokens / estimateGenerateTokens (fixture)', () => {
  let repo: string;
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-estimate-'));
  });
  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('scan estimate: per-stage breakdown over the discovered docs', async () => {
    const docs = path.join(repo, 'docs');
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, 'a.md'), '# A\n' + 'spec content. '.repeat(200));
    fs.writeFileSync(path.join(docs, 'b.md'), '# B\n' + 'more spec. '.repeat(200));

    const est = await estimateScanTokens(repo);
    expect(est.totalEstimatedTokens).toBeGreaterThan(0);
    const stageNames = est.stages!.map((s) => s.stage);
    expect(stageNames).toContain('relevance');
    expect(stageNames).toContain('areaTag');
    expect(est.subjectLabel).toMatch(/docs?$/);
    // cold cache: relevance runs once per doc that survives the prefilter.
    expect(est.stages!.find((s) => s.stage === 'relevance')!.calls).toBe(2);
  });

  it('scan estimate honors spec.include and agrees with discovery', async () => {
    // In-scope + out-of-scope markdown, plus a config that scopes to docs/**.
    const docsDir = path.join(repo, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'a.md'), '# A\n' + 'spec content. '.repeat(200));
    fs.writeFileSync(path.join(docsDir, 'b.md'), '# B\n' + 'more spec. '.repeat(200));
    fs.mkdirSync(path.join(repo, 'reference'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'reference', 'out.md'), '# Out\n' + 'ignored. '.repeat(200));
    fs.mkdirSync(path.join(repo, '.truecourse'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, '.truecourse', 'config.json'),
      JSON.stringify({ spec: { include: ['docs/**'] } }),
    );

    // The scan's discovery sees only the two in-scope docs...
    const discovered = discoverDocs(repo).map((d) => d.path).sort();
    expect(discovered).toEqual(['docs/a.md', 'docs/b.md']);

    // ...and the estimate, sharing that discovery, counts exactly the same docs.
    const est = await estimateScanTokens(repo);
    expect(est.stages!.find((s) => s.stage === 'relevance')!.calls).toBe(2);
    expect(est.subjectLabel).toMatch(/2 docs?$/);
  });

  it('scan estimate is cache-aware: unchanged docs are skipped', async () => {
    const docsDir = path.join(repo, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'a.md'), '# A\n' + 'spec content. '.repeat(200));
    fs.writeFileSync(path.join(docsDir, 'b.md'), '# B\n' + 'more spec. '.repeat(200));

    // Warm the relevance + area-tag caches with stub runners (no LLM).
    const discovered = discoverDocs(repo);
    const kept = await filterByRelevance(repo, discovered, {
      runner: async ({ doc }) => ({ path: doc.path, include: true, reason: 'stub' }),
    });
    await tagDocs(repo, kept.included, {
      runner: async () => ({ tags: [{ product: 'core', concern: 'x' }] }),
    });

    const est = await estimateScanTokens(repo);
    expect(est.subjectLabel).toBe('all 2 docs cached');
    expect(est.stages).toEqual([]); // every doc cached → no LLM work
    expect(est.totalEstimatedTokens).toBe(0);
  });

  function writeDecisions(d: Record<string, unknown>): void {
    const dir = path.join(repo, '.truecourse', 'specs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'decisions.json'),
      JSON.stringify({ version: 1, manualIncludes: [], manualExcludes: [], relations: [], manualAreas: [], ...d }),
    );
  }

  // How many relevance + area-tag LLM calls a real curate() would make.
  async function runtimeCalls(decisions?: unknown): Promise<{ rel: number; tag: number }> {
    let rel = 0;
    let tag = 0;
    await curate(repo, {
      skipGit: true,
      skipCorpusWrite: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      decisions: decisions as any,
      disableVocabNormalization: true,
      disableOverlapDetection: true,
      disableLlmRelationDetection: true,
      relevanceRunner: async ({ doc }) => {
        rel++;
        return { path: doc.path, include: doc.path === 'docs/keep.md', reason: 'stub' };
      },
      areaTagRunner: async () => {
        tag++;
        return { tags: [{ product: 'core', concern: 'x' }] };
      },
    });
    return { rel, tag };
  }

  // The live 2026-07-07 silent-spend bug: the estimate reported "all cached" (no
  // gate) while the scan cache-missed and spent. It happened because the estimate
  // never loaded decisions.json — so a force-INCLUDED doc the relevance filter had
  // dropped (cached include:false) was absent from the estimate's kept set, yet
  // the run keeps it and area-tags it (a real LLM call). Estimate and run now
  // share `planRelevanceWork` over the same decisions, so the gate can't be skipped.
  it('scan estimate: a force-included dropped doc still gates (no silent spend)', async () => {
    const docsDir = path.join(repo, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'keep.md'), '# Keep\n' + 'Endpoint requires auth. '.repeat(50));
    fs.writeFileSync(path.join(docsDir, 'vendor.md'), '# Vendor research\n' + 'ServiceTitan third-party. '.repeat(50));

    // Warm caches as a prior scan would: keep -> included+tagged, vendor -> DROPPED.
    const discovered = discoverDocs(repo, { skipGit: true });
    await filterByRelevance(repo, discovered, {
      runner: async ({ doc }) => ({ path: doc.path, include: doc.path === 'docs/keep.md', reason: 's' }),
    });
    await tagDocs(repo, discovered.filter((d) => d.path === 'docs/keep.md'), {
      runner: async () => ({ tags: [{ product: 'core', concern: 'x' }] }),
    });

    // User force-includes the dropped doc.
    const decisions = { manualIncludes: ['docs/vendor.md'] };
    writeDecisions(decisions);

    // The estimate is the pre-flight gate — measured BEFORE the run. It MUST
    // surface at least one stage for the force-included doc's area-tag call.
    const est = await estimateScanTokens(repo);
    expect((est.stages ?? []).length).toBeGreaterThan(0);
    expect(est.stages!.some((s) => s.stage === 'areaTag' && s.calls >= 1)).toBe(true);

    // ...and the run really would make that call (guardrail direction).
    const rt = await runtimeCalls(decisions);
    expect(rt.tag).toBeGreaterThanOrEqual(1);
  });

  // Regression guardrail: whenever the runtime would make >=1 relevance/area
  // call, the estimate has >=1 stage. Exercised across the states that broke it
  // (force-include a dropped doc; a manual-include that changes the dedup pool so
  // a near-duplicate the estimate would drop gets classified at runtime).
  it('scan estimate: runtime would call => estimate has a stage (guardrail)', async () => {
    const docsDir = path.join(repo, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    // keep.md is the only doc the stub keeps; make a near-duplicate pair to move
    // the dedup pool when full.md is force-included.
    const body = Array.from({ length: 30 }, (_, i) => `Line ${i}: invariant ${i} holds.`).join('\n');
    fs.writeFileSync(path.join(docsDir, 'keep.md'), '# Full\n' + body + '\nunique tail line');
    fs.writeFileSync(path.join(docsDir, 'copy.md'), '# Copy\n' + body);

    // Warm caches WITHOUT the include, so the near-dup copy is deduped away and
    // never cached — exactly the stale state a prior scan leaves.
    const discovered = discoverDocs(repo, { skipGit: true });
    const kept = await filterByRelevance(repo, discovered, {
      runner: async ({ doc }) => ({ path: doc.path, include: true, reason: 's' }),
    });
    await tagDocs(repo, kept.included, { runner: async () => ({ tags: [{ product: 'core', concern: 'x' }] }) });

    const decisions = { manualIncludes: ['docs/keep.md'] };
    writeDecisions(decisions);

    // Estimate first (the pre-flight gate), then confirm the run would call.
    const est = await estimateScanTokens(repo);
    const rt = await runtimeCalls(decisions);
    if (rt.rel + rt.tag > 0) {
      expect((est.stages ?? []).length).toBeGreaterThan(0);
    }
  });

  function writeCorpusFixture(): void {
    const specs = path.join(repo, '.truecourse', 'specs');
    fs.mkdirSync(specs, { recursive: true });
    fs.writeFileSync(
      path.join(specs, 'corpus.json'),
      JSON.stringify({
        version: 3,
        generatedAt: '2026-01-01T00:00:00Z',
        docs: [{ ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'] }],
        areas: [{ id: 'booking/appointments', product: 'booking', concern: 'appointments', docRefs: ['docs/v1.md'], overlaps: [] }],
        relations: [],
      }),
    );
    const d = path.join(repo, 'docs');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'v1.md'), '# Booking\n' + 'Each endpoint requires auth. '.repeat(400));
  }

  it('generate estimate: extract dominates and carries a range', async () => {
    writeCorpusFixture();
    const est = await estimateGenerateTokens(repo);
    expect(est.totalEstimatedTokens).toBeGreaterThan(0);
    const extract = est.stages!.find((s) => s.stage === 'extract')!;
    expect(extract).toBeTruthy();
    expect(extract.model).toBe('opus'); // default extract model
    expect(extract.callsRange).toBeTruthy();
    expect(est.subjectLabel).toBe('1 area');
  });

  it('generate estimate: no corpus → empty', async () => {
    const est = await estimateGenerateTokens(repo);
    expect(est.totalEstimatedTokens).toBe(0);
    expect(est.stages).toEqual([]);
  });

  it('generate estimate is cache-aware: an unchanged area is skipped', async () => {
    writeCorpusFixture();
    // A real generate (stubbed runners) writes the committed manifest, so the
    // area counts as "unchanged" on the next estimate.
    const enumerateRunner: EnumerateRunner = async () => [{ kind: 'Entity', identity: 'Appointment' }];
    const generateRunner: GenerateBatchRunner = async ({ area, targets }) => ({
      fragments: targets.map((t) => ({
        kind: 'Entity',
        identity: t.identity,
        tcSource: `entity ${t.identity} {\n  origin "${area.docs[0].ref}" "${t.identity}" 1..2\n  field id: string immutable\n}`,
        origin: { source: area.docs[0].ref, section: t.identity, lines: [1, 2] as [number, number] },
        obligationKeys: [],
      })),
    });
    await generateContractsFromCorpus({
      repoRoot: repo,
      enumerateRunner,
      generateRunner,
      disableRepair: true,
      disableTargetReconciliation: true,
      disableGapJudge: true,
    });

    const est = await estimateGenerateTokens(repo);
    expect(est.subjectLabel).toBe('all 1 area cached');
    expect(est.stages).toEqual([]); // nothing to do — every area is cached
    expect(est.totalEstimatedTokens).toBe(0);
  });
});
