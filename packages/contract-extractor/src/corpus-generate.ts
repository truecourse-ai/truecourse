/**
 * Corpus generate orchestrator — turns the curated corpus into `.tc` contracts.
 * Per area:
 *
 *   1. ENUMERATE the area's targets (cheap, cached) — the work plan + the
 *      completeness checklist.
 *   2. GENERATE in small batches of ~10–20 targets per call (the output-volume
 *      cut from the experiments) over the area's docs in precedence order.
 *   3. COMPLETENESS GATE: diff emitted contracts against the checklist and retry
 *      the misses in focused calls; report the residue as gaps.
 *
 * All areas' fragments then flow through the shared `assembleArtifacts` tail
 * (merge dedups identities across areas, normalize/repair/validate), and the
 * survivors are written to `.truecourse/contracts/`.
 */

import os from 'node:os';
import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
import { getCacheEntry, setCacheEntry } from '@truecourse/llm';
import { cliTransport, stripCodeFences, type LlmTransport } from '@truecourse/shared/llm';
import { ExtractionResultSchema, type ExtractionResult, type Fragment, type SpecSlice } from './types.js';
import { SYSTEM_PROMPT } from './prompt.js';
import {
  ENUMERATE_SYSTEM_PROMPT,
  EnumerateResultSchema,
  buildEnumerateUserPrompt,
  buildCorpusGenerateUserPrompt,
  chunkByHeading,
  coverageKey,
  type TargetSpec,
} from './corpus-prompt.js';
import { canonicalIdentity } from './identity.js';
import { readCorpusForGenerate, type AreaDoc, type AreaGenInput, type CorpusReadOptions } from './corpus-reader.js';
import { reconcileTargets, type ReconcileRunner } from './target-reconciler.js';
import { assembleArtifacts } from './assemble.js';
import type { RepairProgress } from './repair.js';
import { judgeGaps, type GapJudgeRunner } from './judge-gaps.js';
import { classifyAreas, readManifest, writeManifest, buildManifest } from './manifest.js';
import { sliceHash } from './hash.js';
import { writeContracts, type WriteResult } from './writer.js';
import type { MergedArtifact, MergeDiagnostic } from './merger.js';
import type { ValidationIssue } from './validator.js';

// ---------------------------------------------------------------------------
// Runners (injectable; production spawns the LLM, tests stub)
// ---------------------------------------------------------------------------

export type EnumerateRunner = (input: { area: AreaGenInput }) => Promise<TargetSpec[]>;
export type GenerateBatchRunner = (input: { area: AreaGenInput; targets: TargetSpec[] }) => Promise<ExtractionResult>;

export interface CorpusGenerateModels {
  enumerate?: string;
  reconcile?: string;
  extract?: string;
  repair?: string;
  repairParse?: string;
  gapJudge?: string;
  /** Forwarded as `--fallback-model` to every stage. */
  fallback?: string;
}

export interface CoverageGap {
  areaId: string;
  kind: string;
  identity: string;
  /** The enumerator's one-line hint for this target (context for the gap judge). */
  hint?: string;
  /** Set by the gap judge: false = a genuine miss kept after judging. */
  justified?: boolean;
  /** The gap judge's reason for keeping it (genuine miss) — shown in the UI. */
  reason?: string;
  /** When the judge closed it as "covered elsewhere", the artifact that covers it. */
  coveredBy?: { kind: string; identity: string };
}

export interface AreaCoverage {
  areaId: string;
  /** Targets the enumerator listed. */
  targets: number;
  /** Distinct contracts emitted for those targets. */
  emitted: number;
  /** Targets never covered, even after retries. */
  gaps: CoverageGap[];
}

export interface CorpusGenerateOptions {
  repoRoot: string;
  transport?: LlmTransport;
  enumerateRunner?: EnumerateRunner;
  reconcileRunner?: ReconcileRunner;
  generateRunner?: GenerateBatchRunner;
  /** Skip the LLM target-reconciliation pass (deterministic cross-area de-dup still runs). */
  disableTargetReconciliation?: boolean;
  models?: CorpusGenerateModels;
  /** Targets per generate call. Default `TRUECOURSE_GENERATE_BATCH` env, else 12. */
  batchSize?: number;
  /** Completeness-gate retry rounds after the initial pass. Default 2. */
  maxRetryRounds?: number;
  /** Max concurrent LLM calls across all areas. Default {@link defaultConcurrency}. */
  concurrency?: number;
  disableRepair?: boolean;
  /** Skip the LLM gap-judge pass (gaps reported raw, none auto-closed). */
  disableGapJudge?: boolean;
  gapJudge?: GapJudgeRunner;
  /**
   * Skip the per-area extract cache (always re-generate). The cache is on by
   * default so re-runs only regenerate areas whose docs/targets changed; tests
   * that assert call counts disable it.
   */
  disableExtractCache?: boolean;
  /**
   * Skip the committed-manifest no-op short-circuit (always run the pipeline).
   * On by default so an unchanged corpus is a 0-LLM no-op (clone-safe); tests
   * that want to force a run despite an existing manifest set this.
   */
  disableManifest?: boolean;
  dryRun?: boolean;
  /** Inject the per-area inputs instead of reading the corpus (tests / EE). */
  corpusInput?: AreaGenInput[];
  /** Options forwarded to `readCorpusForGenerate` when `corpusInput` is absent. */
  readOptions?: CorpusReadOptions;
  // --- progress hooks ---
  onAreasReady?: (count: number) => void;
  onAreaEnumerated?: (areaId: string, targetCount: number) => void;
  onAreaDone?: (coverage: AreaCoverage) => void;
  /** Fired per generate batch with the number of NEW unique contracts emitted. */
  onContractsEmitted?: (delta: number) => void;
  /** Forwarded from the repair pass (one re-prompt at a time). */
  onRepairProgress?: (e: RepairProgress) => void;
}

export interface CorpusGenerateResult {
  ran: boolean;
  write: WriteResult;
  resolverHard: boolean;
  artifactsToWrite: MergedArtifact[];
  validationIssues: ValidationIssue[];
  mergeDiagnostics: MergeDiagnostic[];
  /** Per-area coverage stats. */
  areas: AreaCoverage[];
  /** All residual gaps across areas (enumerated but never generated). */
  gaps: CoverageGap[];
  /**
   * Area ids whose enumeration hit a failed view (e.g. an LLM timeout), so their
   * target list — and therefore their contracts — may be incomplete. Distinct
   * from `gaps` (which only covers *enumerated* targets that weren't generated):
   * a fully-failed enumeration produces zero targets and zero gaps, so this is
   * the only signal that an area silently dropped out. Non-empty ⇒ re-run.
   */
  enumerateFailures?: string[];
  /**
   * True when the manifest showed an unchanged corpus and generation was skipped
   * entirely (0 LLM, committed contracts reused). Lets the CLI/dashboard say
   * "nothing changed" instead of running.
   */
  noChanges?: boolean;
}

export function defaultGenerateBatch(): number {
  const env = process.env.TRUECOURSE_GENERATE_BATCH;
  if (env) {
    const parsed = parseInt(env, 10);
    if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  }
  return 12;
}

/** Default cap on concurrent generate LLM calls — `TRUECOURSE_MAX_CONCURRENCY` or `min(cpus, 4)`. */
export function defaultConcurrency(): number {
  const env = process.env.TRUECOURSE_MAX_CONCURRENCY;
  if (env) {
    const parsed = parseInt(env, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Math.min(os.cpus().length, 4);
}

/**
 * Generate the `.tc` corpus from the curated corpus.
 */
export async function generateContractsFromCorpus(
  opts: CorpusGenerateOptions,
): Promise<CorpusGenerateResult> {
  const areas = opts.corpusInput ?? readCorpusForGenerate(opts.repoRoot, opts.readOptions);

  // Committed-manifest no-op: if every area's specs hash-match the manifest (and
  // none were deleted), the committed `.tc` corpus is already current — skip the
  // whole pipeline (0 LLM, no repair). Clone-safe: the manifest is tracked, so a
  // teammate who clones with unchanged specs gets the same skip. dryRun never
  // reuses (it must produce its proposal); tests can force a run via disableManifest.
  if (!opts.dryRun && !opts.disableManifest && classifyAreas(areas, readManifest(opts.repoRoot)).allUnchanged) {
    return {
      ran: false,
      write: { written: [], proposed: [] },
      resolverHard: false,
      artifactsToWrite: [],
      validationIssues: [],
      mergeDiagnostics: [],
      areas: [],
      gaps: [],
      noChanges: true,
    };
  }

  opts.onAreasReady?.(areas.length);

  const models = opts.models ?? {};
  const batchSize = Math.max(1, opts.batchSize ?? defaultGenerateBatch());
  const maxRounds = Math.max(0, opts.maxRetryRounds ?? 2);
  const concurrency = Math.max(1, opts.concurrency ?? defaultConcurrency());
  const limit = pLimit(concurrency);

  const enumerate =
    opts.enumerateRunner ??
    spawnEnumerateRunner({ transport: opts.transport, model: models.enumerate, fallbackModel: models.fallback });
  const generate =
    opts.generateRunner ??
    spawnGenerateRunner({ transport: opts.transport, model: models.extract, fallbackModel: models.fallback });

  // Phase 1 — enumerate every area (cached). Every LLM call goes through the
  // shared limit; the area task itself is not a slot, avoiding a nested-limit deadlock.
  const enumerated = await Promise.all(
    areas.map(async (area) => {
      const { targets: rawTargets, failed } = await enumerateCached(opts.repoRoot, area, enumerate, limit);
      // Canonicalize identities at the parse boundary so every downstream use
      // (reconcile, extract cache key, filenames) sees one stable identity.
      const targets = rawTargets.map((t) => ({ ...t, identity: canonicalIdentity(t.kind, t.identity) }));
      opts.onAreaEnumerated?.(area.areaId, targets.length);
      return { area, targets, failed };
    }),
  );
  // Areas whose enumeration hit a failed view (e.g. an LLM timeout) — their target
  // list is incomplete, so their contracts may be partial or missing. Surfaced on
  // the result (and NOT cached above) so the caller can warn and a re-run retries.
  const enumerateFailures = enumerated.filter((e) => e.failed).map((e) => e.area.areaId);

  // Phase 2 — reconcile the GLOBAL target list: de-dup across areas + collapse
  // semantic duplicates (different identities, same artifact) so each artifact is
  // generated exactly once, with a stable identity (kills cross-area over-generation).
  const planned = await reconcileTargets(opts.repoRoot, enumerated, {
    runner: opts.reconcileRunner,
    enabled: opts.disableTargetReconciliation !== true,
    transport: opts.transport,
    model: models.reconcile,
    fallbackModel: models.fallback,
  });

  // Phase 3 — generate each area's reconciled targets (batch + completeness gate).
  const perArea = await Promise.all(
    planned.map((p) =>
      generateAreaTargets(p.area, p.targets, {
        generate,
        batchSize,
        maxRounds,
        limit,
        onAreaDone: opts.onAreaDone,
        onContractsEmitted: opts.onContractsEmitted,
        scope: opts.repoRoot,
        cacheEnabled: opts.disableExtractCache !== true,
      }),
    ),
  );

  const ranked = perArea.flatMap((a) => a.fragments.map((fragment) => ({ fragment, rank: 0 })));
  const slices = perArea.map((a) => a.slice);
  const coverage = perArea.map((a) => a.coverage);
  const gaps = coverage.flatMap((c) => c.gaps);

  const assembled = await assembleArtifacts(ranked, slices, {
    transport: opts.transport,
    models: { extract: models.extract, repair: models.repair, repairParse: models.repairParse, fallback: models.fallback },
    disableRepair: opts.dryRun || opts.disableRepair,
    onRepairProgress: opts.onRepairProgress,
  });

  if (assembled.resolverHard) {
    return {
      ran: ranked.length > 0,
      write: { written: [], proposed: [] },
      resolverHard: true,
      artifactsToWrite: assembled.artifactsToWrite,
      validationIssues: assembled.validationIssues,
      mergeDiagnostics: assembled.mergeDiagnostics,
      areas: coverage,
      gaps,
      enumerateFailures,
    };
  }

  const write = writeContracts(opts.repoRoot, assembled.artifactsToWrite, {
    dryRun: opts.dryRun,
    prune: !opts.dryRun,
  });

  // Record the spec hashes we just generated from, so the next unchanged run (or
  // a teammate's clone) is a deterministic no-op. Only on a real (written) run —
  // and EXCLUDE any area whose enumeration failed, so its incomplete contracts
  // aren't recorded as "done": leaving it out of the manifest makes the next run
  // treat it as changed and re-attempt it, instead of no-opping past it forever.
  if (!opts.dryRun) {
    const complete = enumerateFailures.length
      ? areas.filter((a) => !enumerateFailures.includes(a.areaId))
      : areas;
    writeManifest(opts.repoRoot, buildManifest(complete));
  }

  // Gap auto-close: judge each area's gaps against its docs + the full written
  // corpus, drop the justified ones, keep genuine misses (with a reason). Only on
  // the resolved/written path (the corpus is meaningless when resolverHard).
  const judgedGaps = await closeJustifiedGaps(opts, planned, coverage, gaps, assembled.artifactsToWrite);

  return {
    ran: ranked.length > 0,
    write,
    resolverHard: false,
    artifactsToWrite: assembled.artifactsToWrite,
    validationIssues: assembled.validationIssues,
    mergeDiagnostics: assembled.mergeDiagnostics,
    areas: coverage,
    gaps: judgedGaps,
    enumerateFailures,
  };
}

/**
 * Run the per-area gap judge (one call per area-with-gaps; skipped when disabled
 * or zero gaps). Mutates `coverage[].gaps` so `result.areas` agrees with the
 * returned flat list. Best-effort: a judge failure keeps that area's gaps.
 */
async function closeJustifiedGaps(
  opts: CorpusGenerateOptions,
  planned: { area: AreaGenInput; targets: TargetSpec[] }[],
  coverage: AreaCoverage[],
  gaps: CoverageGap[],
  written: MergedArtifact[],
): Promise<CoverageGap[]> {
  if (opts.disableGapJudge === true || gaps.length === 0) return gaps;

  const byArea = new Map<string, CoverageGap[]>();
  for (const g of gaps) {
    const list = byArea.get(g.areaId);
    if (list) list.push(g);
    else byArea.set(g.areaId, [g]);
  }
  const areaById = new Map(planned.map((p) => [p.area.areaId, p.area]));
  const corpusIds = written.map((a) => ({ kind: a.kind, identity: a.identity }));

  const judged = await Promise.all(
    [...byArea.entries()].map(([areaId, areaGaps]) => {
      const area = areaById.get(areaId);
      if (!area) return Promise.resolve(areaGaps);
      return judgeGaps(opts.repoRoot, area, areaGaps, corpusIds, {
        runner: opts.gapJudge,
        transport: opts.transport,
        model: opts.models?.gapJudge,
        fallbackModel: opts.models?.fallback,
      });
    }),
  );
  const kept = judged.flat();

  // Reflect the kept set back into per-area coverage.
  const keptByArea = new Map<string, CoverageGap[]>();
  for (const g of kept) {
    const list = keptByArea.get(g.areaId);
    if (list) list.push(g);
    else keptByArea.set(g.areaId, [g]);
  }
  for (const cov of coverage) cov.gaps = keptByArea.get(cov.areaId) ?? [];

  return kept;
}

// ---------------------------------------------------------------------------
// Per-area: batch generate the (reconciled) targets → completeness gate
// ---------------------------------------------------------------------------

interface AreaRunContext {
  generate: GenerateBatchRunner;
  batchSize: number;
  maxRounds: number;
  limit: <T>(fn: () => Promise<T>) => Promise<T>;
  onAreaDone?: (coverage: AreaCoverage) => void;
  onContractsEmitted?: (delta: number) => void;
  /** Repo root — the KV cache scope. */
  scope: string;
  /** When false, always re-generate (skip the per-area extract cache). */
  cacheEnabled: boolean;
}

interface AreaRunResult {
  fragments: Fragment[];
  slice: SpecSlice;
  coverage: AreaCoverage;
}

/** Coverage stats for an area from its targets + the fragments emitted for them. */
function coverageFor(area: AreaGenInput, targets: TargetSpec[], fragments: Fragment[]): AreaCoverage {
  const have = new Set(fragments.map((f) => coverageKey(f.kind, f.identity)));
  const gaps: CoverageGap[] = targets
    .filter((t) => !have.has(coverageKey(t.kind, t.identity)))
    .map((t) => ({ areaId: area.areaId, kind: t.kind, identity: t.identity, hint: t.hint }));
  return { areaId: area.areaId, targets: targets.length, emitted: fragments.length, gaps };
}

async function generateAreaTargets(area: AreaGenInput, targets: TargetSpec[], ctx: AreaRunContext): Promise<AreaRunResult> {
  // Incremental extract cache: an area whose docs + reconciled targets + prompt
  // are unchanged returns its prior fragments without any LLM call. Progress
  // still advances so the UI reflects the cached contracts immediately.
  const cacheKey = ctx.cacheEnabled ? extractCacheKey(area, targets, ctx.maxRounds) : null;
  if (cacheKey) {
    const cached = await getCacheEntry(ctx.scope, EXTRACT_CACHE_NAME, cacheKey);
    if (cached) {
      const parsed = ExtractionResultSchema.safeParse(cached);
      if (parsed.success) {
        const fragments = parsed.data.fragments.map(canonFragment);
        if (fragments.length > 0) ctx.onContractsEmitted?.(fragments.length);
        const coverage = coverageFor(area, targets, fragments);
        ctx.onAreaDone?.(coverage);
        return { fragments, slice: synthesizeAreaSlice(area), coverage };
      }
    }
  }

  const fragments: Fragment[] = [];
  const emitted = new Set<string>();
  const emit = (res: ExtractionResult): void => {
    for (const raw of res.fragments) {
      const f = canonFragment(raw);
      const key = coverageKey(f.kind, f.identity);
      if (emitted.has(key)) continue;
      emitted.add(key);
      fragments.push(f);
    }
  };
  const missing = (): TargetSpec[] => targets.filter((t) => !emitted.has(coverageKey(t.kind, t.identity)));

  // Round 0: generate every target in batches. Rounds 1..max: re-prompt the
  // misses in focused calls until covered or no progress is made. Each batch
  // emits as it resolves (not after the whole round) so the running contract
  // count climbs continuously — emit() is synchronous, so the shared `emitted`
  // set is never touched concurrently.
  let pending = targets;
  for (let round = 0; round <= ctx.maxRounds && pending.length > 0; round++) {
    const batches = chunk(pending, ctx.batchSize);
    await Promise.all(
      batches.map((batch) =>
        ctx
          .limit(() => ctx.generate({ area, targets: batch }))
          .then((res) => {
            const before = fragments.length;
            emit(res);
            const delta = fragments.length - before;
            if (delta > 0) ctx.onContractsEmitted?.(delta);
          })
          .catch(() => {}),
      ),
    );
    const next = missing();
    if (next.length === pending.length) break; // no progress this round — stop retrying
    pending = next;
  }

  const coverage = coverageFor(area, targets, fragments);
  ctx.onAreaDone?.(coverage);
  // Cache the final fragments so the next unchanged run skips every LLM call for
  // this area. We cache even partial coverage (gaps) — re-running won't recover
  // misses unless the docs/targets change, which busts the key anyway.
  if (cacheKey) await setCacheEntry(ctx.scope, EXTRACT_CACHE_NAME, cacheKey, { fragments });
  return { fragments, slice: synthesizeAreaSlice(area), coverage };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * A synthetic slice per area carrying the area's doc text — context for the
 * shared tail's cross-cutting tag propagation + repair re-prompts. Never
 * persisted (the corpus path keeps no slice cache).
 */
function synthesizeAreaSlice(area: AreaGenInput): SpecSlice {
  const specPath = `.truecourse/specs/corpus.json#${area.areaId}`;
  const headingPath = [area.areaId];
  const text =
    `# ${area.areaId}\n\n` +
    area.docs.map((d) => `<!-- ${d.ref} -->\n${d.content}`).join('\n\n');
  return {
    id: sliceHash(specPath, headingPath, text),
    specPath,
    headingPath,
    lineRange: [1, Math.max(1, text.split('\n').length)],
    text,
    headingLevel: 1,
  };
}

// ---------------------------------------------------------------------------
// Enumerate (cached by area content via the KV seam)
// ---------------------------------------------------------------------------

const ENUMERATE_CACHE_NAME = 'contract/enumerate';
const ENUMERATE_PROMPT_FINGERPRINT = createHash('sha256').update(ENUMERATE_SYSTEM_PROMPT).digest('hex').slice(0, 16);

// Per-area extract cache — the incremental seam. Unchanged docs + targets +
// prompt → the same key → a cache hit that skips the (expensive) generate calls.
const EXTRACT_CACHE_NAME = 'contract/extract';
const EXTRACT_PROMPT_FINGERPRINT = createHash('sha256').update(SYSTEM_PROMPT).digest('hex').slice(0, 16);

/** Canonicalize a freshly-parsed fragment's identity so it matches its merge
 *  key and the filename it will be written to (see identity.ts). */
function canonFragment(f: Fragment): Fragment {
  return { ...f, identity: canonicalIdentity(f.kind, f.identity) };
}

function extractCacheKey(area: AreaGenInput, targets: TargetSpec[], maxRounds: number): string {
  const docMaterial = area.docs
    .map((d) => `${d.ref}:${createHash('sha256').update(d.content).digest('hex')}`)
    .join('|');
  // Reconciled identities decide what we generate; sorted so batch ordering
  // doesn't perturb the key. maxRounds affects how completely gaps get retried.
  const targetMaterial = targets.map((t) => coverageKey(t.kind, t.identity)).sort().join('|');
  return createHash('sha256')
    .update(`${EXTRACT_PROMPT_FINGERPRINT}::r${maxRounds}::${area.areaId}::${docMaterial}::${targetMaterial}`)
    .digest('hex');
}

function enumerateCacheKey(area: AreaGenInput): string {
  const material = area.docs.map((d) => `${d.ref}:${createHash('sha256').update(d.content).digest('hex')}`).join('|');
  return createHash('sha256').update(`${ENUMERATE_PROMPT_FINGERPRINT}::${area.areaId}::${material}`).digest('hex');
}

/** Char budget per enumerate call — big docs are chunked by heading under it. */
const ENUMERATE_AREA_BUDGET = 48_000;

/**
 * Split an area into one-or-more enumerate "views" each within the char budget,
 * chunking big docs by heading. The enumerator reads EVERY view, so a 3,500-line
 * doc is enumerated in full rather than silently truncated.
 */
function enumerateViews(area: AreaGenInput): AreaGenInput[] {
  const total = area.docs.reduce((n, d) => n + d.content.length, 0);
  if (total <= ENUMERATE_AREA_BUDGET) return [area];
  const views: AreaGenInput[] = [];
  let cur: AreaDoc[] = [];
  let curLen = 0;
  const flush = (): void => {
    if (cur.length > 0) views.push({ ...area, docs: cur });
    cur = [];
    curLen = 0;
  };
  for (const d of area.docs) {
    for (const chunk of chunkByHeading(d.content, ENUMERATE_AREA_BUDGET)) {
      if (curLen > 0 && curLen + chunk.length > ENUMERATE_AREA_BUDGET) flush();
      cur.push({ ...d, content: chunk });
      curLen += chunk.length;
    }
  }
  flush();
  return views.length > 0 ? views : [area];
}

async function enumerateCached(
  scope: string,
  area: AreaGenInput,
  runner: EnumerateRunner,
  limit: <T>(fn: () => Promise<T>) => Promise<T>,
): Promise<{ targets: TargetSpec[]; failed: boolean }> {
  const key = enumerateCacheKey(area);
  const cached = await getCacheEntry(scope, ENUMERATE_CACHE_NAME, key);
  if (cached) {
    const parsed = EnumerateResultSchema.safeParse(cached);
    if (parsed.success) return { targets: parsed.data.targets, failed: false };
  }
  // Enumerate every heading-chunk view of the area and UNION the target lists
  // (de-duped by coverage key) — exhaustive over big docs, and tolerant of the
  // enumerator listing the same target twice.
  const seen = new Set<string>();
  const targets: TargetSpec[] = [];
  let failed = false;
  for (const view of enumerateViews(area)) {
    let part: TargetSpec[];
    try {
      part = await limit(() => runner({ area: view }));
    } catch {
      // A view failed (e.g. a 180s timeout) — this area's target list is now
      // incomplete. Keep going for the other views, but remember it failed.
      failed = true;
      continue;
    }
    for (const t of part) {
      const k = coverageKey(t.kind, t.identity);
      if (seen.has(k)) continue;
      seen.add(k);
      targets.push(t);
    }
  }
  // Only cache a COMPLETE enumeration. Caching after a failed view would poison
  // the cache: a re-run would return the partial/empty list as a hit and never
  // retry, silently dropping the area's contracts forever.
  if (!failed) await setCacheEntry(scope, ENUMERATE_CACHE_NAME, key, { targets });
  return { targets, failed };
}

// ---------------------------------------------------------------------------
// Default spawn runners
// ---------------------------------------------------------------------------

function spawnEnumerateRunner(
  opts: { transport?: LlmTransport; bin?: string; timeoutMs?: number; model?: string; fallbackModel?: string } = {},
): EnumerateRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  // Enumerate is meant to be a quick "list the targets" call, but a slow
  // model/proxy can run an enumerate prompt in 140–180s+ (observed on gpt-5.5 via
  // a proxy), which blew past the old 180s ceiling — so 300s.
  const timeoutMs = opts.timeoutMs ?? 300_000;
  return async ({ area }) => {
    const raw = await transport({
      id: `contract.enumerate:${area.areaId}`,
      stage: 'contract.enumerate',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: ENUMERATE_SYSTEM_PROMPT,
      user: buildEnumerateUserPrompt(area),
      responseFormat: 'json',
      timeoutMs,
    });
    const inner = JSON.parse(stripCodeFences(raw));
    return EnumerateResultSchema.parse(inner).targets;
  };
}

function spawnGenerateRunner(
  opts: { transport?: LlmTransport; bin?: string; timeoutMs?: number; model?: string; fallbackModel?: string } = {},
): GenerateBatchRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  const timeoutMs = opts.timeoutMs ?? 600_000;
  return async ({ area, targets }) => {
    const raw = await transport({
      id: `contract.extract:corpus:${area.areaId}:${targets.map((t) => t.identity).join(',').slice(0, 80)}`,
      stage: 'contract.extract',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: SYSTEM_PROMPT,
      user: buildCorpusGenerateUserPrompt(area, targets),
      responseFormat: 'json',
      timeoutMs,
    });
    const inner = JSON.parse(stripCodeFences(raw));
    return ExtractionResultSchema.parse(inner);
  };
}
