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
import { cliTransport, jsonSchemaHint, stripCodeFences, type LlmTransport } from '@truecourse/shared/llm';
import { parserOhm } from '@truecourse/contract-verifier';
import { ExtractionResultSchema, type ExtractionResult, type Fragment, type SpecSlice } from './types.js';
import { SYSTEM_PROMPT, KIND_CAPABILITIES } from './prompt.js';
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

/** Corrective context for a re-ask after an enumerate view returned a target
 *  whose kind isn't in the catalog. Carried on the runner input, alongside
 *  `priorTargets`, so every runner (spawn + injected) can surface it. */
export interface EnumerateCorrection {
  /** The offending kinds the previous response used that aren't in the catalog. */
  invalidKinds: string[];
}

export type EnumerateRunner = (input: {
  area: AreaGenInput;
  priorTargets?: PriorTarget[];
  correction?: EnumerateCorrection;
}) => Promise<TargetSpec[]>;
export type GenerateBatchRunner = (input: {
  area: AreaGenInput;
  targets: TargetSpec[];
  priorBodies?: (string | undefined)[];
  /** Per-target parser error from a prior round's unparseable fragment (parallel
   *  to `targets`) — attached to that target's line so the model fixes the syntax. */
  errorHints?: (string | undefined)[];
  /** The global reconciled (kind, identity) list — the identities a cross-ref
   *  may legally point at. Without it the model invents identities for shared
   *  artifacts defined in other areas, producing unresolvable references. */
  referenceable?: { kind: string; identity: string }[];
}) => Promise<ExtractionResult>;

/** A previously-generated artifact's identity — anchors the enumerate step so it
 *  reuses the exact spelling instead of re-slugging/re-wording it. */
export interface PriorTarget {
  kind: string;
  identity: string;
}

/** The existing contracts a regeneration anchors to (Phase 4), so unchanged areas
 *  reproduce their prior output instead of drifting run-to-run. Best-effort: the
 *  spec is still the source of truth — a target the spec dropped is not resurrected. */
export interface PriorContracts {
  /** Existing artifact identities — anchor the enumerate step. */
  targets: PriorTarget[];
  /** `coverageKey(kind, identity)` → existing `.tc` body — anchors the extract step. */
  bodyByKey: Map<string, string>;
}

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
  /**
   * Existing contracts to anchor this regeneration to (Phase 4): an area whose
   * spec is unchanged reproduces its prior contracts instead of drifting. Passed
   * to the enumerate + extract prompts only — never folded into a cache key, so
   * it biases the LLM on a cache MISS without re-busting unchanged areas.
   */
  prior?: PriorContracts;
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
      const { targets: rawTargets, failed } = await enumerateCached(opts.repoRoot, area, enumerate, limit, opts.prior?.targets);
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
  const reconciled = await reconcileTargets(opts.repoRoot, enumerated, {
    runner: opts.reconcileRunner,
    enabled: opts.disableTargetReconciliation !== true,
    transport: opts.transport,
    model: models.reconcile,
    fallbackModel: models.fallback,
    // Anchor duplicate-merging to the prior artifacts: a reviewed identity is
    // forced canonical instead of being re-judged (and possibly flipped) by the LLM.
    priorTargets: opts.prior?.targets,
  });
  const planned = reconciled.byArea;

  // The global reconciled identity list — what a cross-ref may point at. Every
  // area's extractor gets it, so refs to shared artifacts use REAL identities
  // instead of invented ones. Sorted for a deterministic prompt + cache key.
  const referenceable = [...new Map(
    planned.flatMap((p) => p.targets.map((t) => [coverageKey(t.kind, t.identity), { kind: t.kind, identity: t.identity }] as const)),
  ).values()].sort((a, b) => coverageKey(a.kind, a.identity).localeCompare(coverageKey(b.kind, b.identity)));

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
        prior: opts.prior,
        referenceable,
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
    // Rewrite any cross-reference pointing at a merged (non-canonical) identity
    // onto its canonical spelling, so references stay stable when reconcile picks
    // a canonical — cached/anchored fragments included.
    referenceMerges: reconciled.merges,
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
  /** Existing contracts to anchor extraction (Phase 4); undefined = no anchor. */
  prior?: PriorContracts;
  /** Global reconciled identities cross-refs may point at (sorted). Part of the
   *  extract cache key: an area's correct refs depend on which shared identities
   *  exist, so a change here must re-extract. */
  referenceable: { kind: string; identity: string }[];
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
  const cacheKey = ctx.cacheEnabled ? extractCacheKey(area, targets, ctx.maxRounds, ctx.referenceable) : null;
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
  const emitted = new Set<string>(); // targets with a PARSING fragment in `fragments`
  const parseErrors = new Map<string, string>(); // coverageKey → last parser error (fed into the next round's prompt)
  const lastFailed = new Map<string, Fragment>(); // coverageKey → last unparseable fragment (flushed if never recovered)
  // A fragment counts as produced only if its tcSource parses under the strict
  // grammar (the same oracle repair uses). A failing fragment is NOT counted:
  // its target stays in missing() and is re-requested with the parser error, so
  // the model can fix the syntax before the fragment travels the whole pipeline.
  const emit = (res: ExtractionResult): void => {
    for (const raw of res.fragments) {
      const f = canonFragment(raw);
      const key = coverageKey(f.kind, f.identity);
      if (emitted.has(key)) continue;
      const check = parseFragmentTc(f.kind, f.identity, f.tcSource);
      if (check.ok) {
        emitted.add(key);
        fragments.push(f);
        parseErrors.delete(key);
        lastFailed.delete(key);
      } else {
        parseErrors.set(key, truncateParseError(check.error ?? 'parse failed'));
        lastFailed.set(key, f);
      }
    }
  };
  const missing = (): TargetSpec[] => targets.filter((t) => !emitted.has(coverageKey(t.kind, t.identity)));

  // Progress signature for the no-progress early-break: parsing-fragment count
  // plus each still-pending target's current parser error. A round that only
  // produced UNPARSEABLE fragments still changes this (new errors to feed back
  // next round), so it is not mistaken for progress-less; a round that reproduced
  // the identical failing output leaves it unchanged and breaks — no infinite loop.
  const signature = (pending: TargetSpec[]): string =>
    `${emitted.size}#` +
    pending
      .map((t) => {
        const k = coverageKey(t.kind, t.identity);
        return `${k}=${parseErrors.get(k) ?? ''}`;
      })
      .sort()
      .join('|');

  // Round 0: generate every target in batches. Rounds 1..max: re-prompt the
  // misses (unparseable or never-returned) in focused calls, attaching each
  // target's parser error, until covered or the round makes no change. Each
  // batch emits as it resolves (not after the whole round) so the running
  // contract count climbs continuously — emit() is synchronous, so the shared
  // `emitted` set is never touched concurrently.
  let pending = targets;
  let prevSig = signature(targets);
  for (let round = 0; round <= ctx.maxRounds && pending.length > 0; round++) {
    const batches = chunk(pending, ctx.batchSize);
    await Promise.all(
      batches.map((batch) =>
        ctx
          .limit(() =>
            ctx.generate({
              area,
              targets: batch,
              priorBodies: ctx.prior
                ? batch.map((t) => ctx.prior!.bodyByKey.get(coverageKey(t.kind, t.identity)))
                : undefined,
              errorHints: batch.map((t) => parseErrors.get(coverageKey(t.kind, t.identity))),
              referenceable: ctx.referenceable,
            }),
          )
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
    const sig = signature(next);
    if (sig === prevSig) break; // no parsing progress and no new error to feed back — stop retrying
    prevSig = sig;
    pending = next;
  }

  // Yield floor: any target we never got a PARSING fragment for keeps its last
  // unparseable version, so downstream repair (pass 0) can still attempt it —
  // the parse gate adds earlier feedback and must never reduce yield versus
  // emitting blindly.
  let flushed = 0;
  for (const [key, frag] of lastFailed) {
    if (emitted.has(key)) continue;
    fragments.push(frag);
    flushed += 1;
  }
  if (flushed > 0) ctx.onContractsEmitted?.(flushed);

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

/** Parse-check a fragment's tcSource under the strict grammar (the same oracle
 *  repair uses). A body that produces zero statements is a failure. */
function parseFragmentTc(kind: string, identity: string, tcSource: string): { ok: boolean; error?: string } {
  try {
    const node = parserOhm.parseTcFile(`<llm:${kind}:${identity}>`, tcSource);
    return node.statements.length > 0 ? { ok: true } : { ok: false, error: 'tcSource produced zero statements' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Collapse a parser error to one short line so a re-prompt hint stays compact. */
function truncateParseError(msg: string): string {
  const oneLine = msg.replace(/\s+/g, ' ').trim();
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
}

/**
 * The catalog kinds an enumerate target may use — every `- <Kind> — …` line in
 * the shared capability sheet EXCEPT `UnenforceableObligation` (emit-only during
 * generation, never enumerated as a target). Deriving from KIND_CAPABILITIES
 * keeps one source of truth: a kind added to the catalog is accepted with no
 * change here. Lower-cased for tolerant matching (the enumerate prompt asks for
 * exact casing, but a case slip must not fail an otherwise-valid target).
 */
const VALID_ENUMERATE_KINDS: ReadonlySet<string> = deriveValidEnumerateKinds();

function deriveValidEnumerateKinds(): Set<string> {
  const kinds = new Set<string>();
  for (const line of KIND_CAPABILITIES.split('\n')) {
    const m = /^\s*-\s+([A-Za-z][A-Za-z0-9]*)\s+[—–-]/.exec(line);
    if (!m || m[1] === 'UnenforceableObligation') continue;
    kinds.add(m[1].toLowerCase());
  }
  return kinds;
}

function isValidEnumerateKind(kind: string): boolean {
  return VALID_ENUMERATE_KINDS.has(kind.trim().toLowerCase());
}

function extractCacheKey(
  area: AreaGenInput,
  targets: TargetSpec[],
  maxRounds: number,
  referenceable: { kind: string; identity: string }[],
): string {
  const docMaterial = area.docs
    .map((d) => `${d.ref}:${createHash('sha256').update(d.content).digest('hex')}`)
    .join('|');
  // Reconciled identities decide what we generate; sorted so batch ordering
  // doesn't perturb the key. maxRounds affects how completely gaps get retried.
  const targetMaterial = targets.map((t) => coverageKey(t.kind, t.identity)).sort().join('|');
  // Cross-refs point at the GLOBAL identity list, so an area's correct output
  // depends on it: when a shared identity appears/disappears, re-extract.
  const refMaterial = referenceable.map((r) => coverageKey(r.kind, r.identity)).join('|');
  return createHash('sha256')
    .update(`${EXTRACT_PROMPT_FINGERPRINT}::r${maxRounds}::${area.areaId}::${docMaterial}::${targetMaterial}::${refMaterial}`)
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

/**
 * Estimate support: the CACHED enumerate result for an area, or null when cold.
 * Same cache read as {@link enumerateCached} and the same canonicalIdentity
 * mapping the run applies — so a pre-flight estimate can ground itself in the
 * exact target list a warm run will use. No LLM, no cache writes.
 */
export async function readCachedEnumerateTargets(
  repoRoot: string,
  area: AreaGenInput,
): Promise<TargetSpec[] | null> {
  const cached = await getCacheEntry(repoRoot, ENUMERATE_CACHE_NAME, enumerateCacheKey(area));
  if (!cached) return null;
  const parsed = EnumerateResultSchema.safeParse(cached);
  if (!parsed.success) return null;
  return parsed.data.targets.map((t) => ({ ...t, identity: canonicalIdentity(t.kind, t.identity) }));
}

async function enumerateCached(
  scope: string,
  area: AreaGenInput,
  runner: EnumerateRunner,
  limit: <T>(fn: () => Promise<T>) => Promise<T>,
  priorTargets?: PriorTarget[],
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
    // Run the view, retrying ONCE on failure (timeout / transport error) before
    // giving up on it — enumerate is otherwise the only single-attempt stage.
    const part = await runViewWithRetry(view, runner, limit, priorTargets);
    if (part === null) {
      // Both attempts failed — this area's target list is now incomplete. Keep
      // going for the other views, but remember it failed (so it isn't cached).
      failed = true;
      continue;
    }
    // Validate the returned kinds against the closed catalog; one corrective
    // re-ask on any invalid kind, then drop whatever is still invalid.
    const validated = await validateEnumerateKinds(part, view, runner, limit, priorTargets);
    for (const t of validated) {
      const k = coverageKey(t.kind, t.identity);
      if (seen.has(k)) continue;
      seen.add(k);
      targets.push(t);
    }
  }
  // Only cache a COMPLETE, validated enumeration. Caching after a failed view
  // would poison the cache: a re-run would return the partial/empty list as a
  // hit and never retry, silently dropping the area's contracts forever.
  if (!failed) await setCacheEntry(scope, ENUMERATE_CACHE_NAME, key, { targets });
  return { targets, failed };
}

/** Run one enumerate view, retrying once on failure. Returns null only when
 *  both attempts fail — the view is then a loss for this run. */
async function runViewWithRetry(
  view: AreaGenInput,
  runner: EnumerateRunner,
  limit: <T>(fn: () => Promise<T>) => Promise<T>,
  priorTargets?: PriorTarget[],
): Promise<TargetSpec[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await limit(() => runner({ area: view, priorTargets }));
    } catch {
      // fall through — retry once, then give up after the last attempt
    }
  }
  return null;
}

/**
 * Validate a view's targets against the closed kind catalog. If any target's
 * kind isn't in the catalog, re-ask ONCE with the offending kinds listed, then
 * drop whatever is STILL invalid — the valid targets are always kept, so an
 * invented kind never fails the whole area. Returns only valid targets.
 */
async function validateEnumerateKinds(
  part: TargetSpec[],
  view: AreaGenInput,
  runner: EnumerateRunner,
  limit: <T>(fn: () => Promise<T>) => Promise<T>,
  priorTargets?: PriorTarget[],
): Promise<TargetSpec[]> {
  const valid = part.filter((t) => isValidEnumerateKind(t.kind));
  const invalid = part.filter((t) => !isValidEnumerateKind(t.kind));
  if (invalid.length === 0) return valid;
  const invalidKinds = [...new Set(invalid.map((t) => t.kind))];
  let corrected: TargetSpec[];
  try {
    corrected = await limit(() => runner({ area: view, priorTargets, correction: { invalidKinds } }));
  } catch {
    // The corrective re-ask itself failed — keep the valid targets already in hand.
    return valid;
  }
  // Union the originally-valid targets with the re-ask's valid targets (the
  // caller de-dups by coverage key); still-invalid kinds are never resurrected.
  return [...valid, ...corrected.filter((t) => isValidEnumerateKind(t.kind))];
}

// ---------------------------------------------------------------------------
// Default spawn runners
// ---------------------------------------------------------------------------

/** The response schemas sent on the requests — the API transport enforces them
 *  via structured output; the cli transport ignores them. */
const ENUMERATE_RESPONSE_SCHEMA = jsonSchemaHint(EnumerateResultSchema);
const EXTRACT_RESPONSE_SCHEMA = jsonSchemaHint(ExtractionResultSchema);

function spawnEnumerateRunner(
  opts: { transport?: LlmTransport; bin?: string; timeoutMs?: number; model?: string; fallbackModel?: string } = {},
): EnumerateRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  // Enumerate is meant to be a quick "list the targets" call, but a slow
  // model/proxy can run an enumerate prompt in 140–180s+ (observed on gpt-5.5 via
  // a proxy), which blew past the old 180s ceiling — so 300s.
  const timeoutMs = opts.timeoutMs ?? 300_000;
  return async ({ area, priorTargets, correction }) => {
    const raw = await transport({
      id: `contract.enumerate:${area.areaId}`,
      stage: 'contract.enumerate',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: ENUMERATE_SYSTEM_PROMPT,
      user: buildEnumerateUserPrompt(area, priorTargets, correction),
      responseFormat: 'json',
      schema: ENUMERATE_RESPONSE_SCHEMA,
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
  return async ({ area, targets, priorBodies, errorHints, referenceable }) => {
    const raw = await transport({
      id: `contract.extract:corpus:${area.areaId}:${targets.map((t) => t.identity).join(',').slice(0, 80)}`,
      stage: 'contract.extract',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: SYSTEM_PROMPT,
      user: buildCorpusGenerateUserPrompt(area, targets, priorBodies, errorHints, referenceable),
      responseFormat: 'json',
      schema: EXTRACT_RESPONSE_SCHEMA,
      timeoutMs,
    });
    const inner = JSON.parse(stripCodeFences(raw));
    return ExtractionResultSchema.parse(inner);
  };
}
