/**
 * Corpus generate orchestrator (spec-scan redesign, Phase 2) — the corpus-path
 * counterpart to `generateContracts()`. Per area:
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
 * survivors are written to `.truecourse/contracts/`. Runs ALONGSIDE the claims
 * path (`generateContracts`) during the migration.
 */

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
import { readCorpusForGenerate, type AreaDoc, type AreaGenInput, type CorpusReadOptions } from './corpus-reader.js';
import { reconcileTargets, type ReconcileRunner } from './target-reconciler.js';
import { assembleArtifacts } from './assemble.js';
import { sliceHash } from './claims-reader.js';
import { writeContracts, type WriteResult } from './writer.js';
import { defaultConcurrency } from './claude-runner.js';
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
  /** Forwarded as `--fallback-model` to every stage. */
  fallback?: string;
}

export interface CoverageGap {
  areaId: string;
  kind: string;
  identity: string;
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
  dryRun?: boolean;
  /** Inject the per-area inputs instead of reading the corpus (tests / EE). */
  corpusInput?: AreaGenInput[];
  /** Options forwarded to `readCorpusForGenerate` when `corpusInput` is absent. */
  readOptions?: CorpusReadOptions;
  // --- progress hooks ---
  onAreasReady?: (count: number) => void;
  onAreaEnumerated?: (areaId: string, targetCount: number) => void;
  onAreaDone?: (coverage: AreaCoverage) => void;
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
}

export function defaultGenerateBatch(): number {
  const env = process.env.TRUECOURSE_GENERATE_BATCH;
  if (env) {
    const parsed = parseInt(env, 10);
    if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  }
  return 12;
}

/**
 * Generate the `.tc` corpus from the curated corpus.
 */
export async function generateContractsFromCorpus(
  opts: CorpusGenerateOptions,
): Promise<CorpusGenerateResult> {
  const areas = opts.corpusInput ?? readCorpusForGenerate(opts.repoRoot, opts.readOptions);
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
      const targets = await enumerateCached(opts.repoRoot, area, enumerate, limit);
      opts.onAreaEnumerated?.(area.areaId, targets.length);
      return { area, targets };
    }),
  );

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
      }),
    ),
  );

  const ranked = perArea.flatMap((a) => a.fragments.map((fragment) => ({ fragment, rank: 0 })));
  const slices = perArea.map((a) => a.slice);
  const coverage = perArea.map((a) => a.coverage);
  const gaps = coverage.flatMap((c) => c.gaps);

  const assembled = await assembleArtifacts(ranked, slices, {
    transport: opts.transport,
    models: { extract: models.extract, repair: models.repair, fallback: models.fallback },
    disableRepair: opts.dryRun || opts.disableRepair,
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
    };
  }

  const write = writeContracts(opts.repoRoot, assembled.artifactsToWrite, {
    dryRun: opts.dryRun,
    prune: !opts.dryRun,
  });

  return {
    ran: ranked.length > 0,
    write,
    resolverHard: false,
    artifactsToWrite: assembled.artifactsToWrite,
    validationIssues: assembled.validationIssues,
    mergeDiagnostics: assembled.mergeDiagnostics,
    areas: coverage,
    gaps,
  };
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
}

interface AreaRunResult {
  fragments: Fragment[];
  slice: SpecSlice;
  coverage: AreaCoverage;
}

async function generateAreaTargets(area: AreaGenInput, targets: TargetSpec[], ctx: AreaRunContext): Promise<AreaRunResult> {
  const fragments: Fragment[] = [];
  const emitted = new Set<string>();
  const emit = (res: ExtractionResult): void => {
    for (const f of res.fragments) {
      const key = coverageKey(f.kind, f.identity);
      if (emitted.has(key)) continue;
      emitted.add(key);
      fragments.push(f);
    }
  };
  const missing = (): TargetSpec[] => targets.filter((t) => !emitted.has(coverageKey(t.kind, t.identity)));

  // Round 0: generate every target in batches. Rounds 1..max: re-prompt the
  // misses in focused calls until covered or no progress is made.
  let pending = targets;
  for (let round = 0; round <= ctx.maxRounds && pending.length > 0; round++) {
    const batches = chunk(pending, ctx.batchSize);
    const results = await Promise.all(
      batches.map((batch) =>
        ctx.limit(() => ctx.generate({ area, targets: batch })).catch(() => ({ fragments: [] }) as ExtractionResult),
      ),
    );
    for (const res of results) emit(res);
    const next = missing();
    if (next.length === pending.length) break; // no progress this round — stop retrying
    pending = next;
  }

  const gaps: CoverageGap[] = missing().map((t) => ({ areaId: area.areaId, kind: t.kind, identity: t.identity }));
  const coverage: AreaCoverage = { areaId: area.areaId, targets: targets.length, emitted: fragments.length, gaps };
  ctx.onAreaDone?.(coverage);
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
): Promise<TargetSpec[]> {
  const key = enumerateCacheKey(area);
  const cached = await getCacheEntry(scope, ENUMERATE_CACHE_NAME, key);
  if (cached) {
    const parsed = EnumerateResultSchema.safeParse(cached);
    if (parsed.success) return parsed.data.targets;
  }
  // Enumerate every heading-chunk view of the area and UNION the target lists
  // (de-duped by coverage key) — exhaustive over big docs, and tolerant of the
  // enumerator listing the same target twice.
  const seen = new Set<string>();
  const targets: TargetSpec[] = [];
  for (const view of enumerateViews(area)) {
    let part: TargetSpec[];
    try {
      part = await limit(() => runner({ area: view }));
    } catch {
      continue; // a failed chunk contributes nothing rather than aborting the area
    }
    for (const t of part) {
      const k = coverageKey(t.kind, t.identity);
      if (seen.has(k)) continue;
      seen.add(k);
      targets.push(t);
    }
  }
  await setCacheEntry(scope, ENUMERATE_CACHE_NAME, key, { targets });
  return targets;
}

// ---------------------------------------------------------------------------
// Default spawn runners
// ---------------------------------------------------------------------------

function spawnEnumerateRunner(
  opts: { transport?: LlmTransport; bin?: string; timeoutMs?: number; model?: string; fallbackModel?: string } = {},
): EnumerateRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  const timeoutMs = opts.timeoutMs ?? 180_000;
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
