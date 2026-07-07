/**
 * Pre-flight TOKEN estimates for `spec scan` (curate) and `contracts generate`.
 * Lives in core (which already depends on both the consolidator and extractor —
 * the leaf packages would be circular). Both feed the shared
 * {@link estimateStageTokens}, so the calculation lives in one place and the CLI
 * + dashboard render identical numbers.
 *
 * Deterministic, no LLM, no transport:
 *  - SCAN is accurate in CALL COUNT (discovery + the same deterministic prefilter
 *    the real run uses); token sizes are heuristic.
 *  - GENERATE grounds itself in the caches where they're warm: a warm enumerate
 *    cache gives the EXACT target list a run will use (same key, same
 *    canonicalization) → exact extract batches, zero enumerate calls for that
 *    area; when every area is warm the reconcile stage is exact too (the same
 *    cluster + per-cluster cache check the run makes). Cold areas fall back to
 *    the size heuristics, surfaced as ranges.
 *
 * Per-stage system-prompt sizes are the REAL prompt constants (imported from the
 * packages that send them), so they can't drift from what a run actually pays.
 * The body sizes (doc/area chars) are real and dominate.
 */

import {
  discoverDocs,
  prefilterDocs,
  readRelevanceCache,
  isAreaTagCached,
  RELEVANCE_SYSTEM_PROMPT,
  AREA_TAGGER_SYSTEM_PROMPT,
  VOCAB_NORMALIZER_SYSTEM_PROMPT,
  CHAIN_DETECTION_SYSTEM_PROMPT,
  OVERLAP_DETECTOR_SYSTEM_PROMPT,
} from '@truecourse/spec-consolidator';
import {
  readCorpusForGenerate,
  defaultGenerateBatch,
  classifyAreas,
  readManifest,
  readCachedEnumerateTargets,
  planReconcileCalls,
  ENUMERATE_SYSTEM_PROMPT,
  RECONCILE_SYSTEM_PROMPT,
  EXTRACT_SYSTEM_PROMPT,
  REPAIR_FIX_SYSTEM_PROMPT,
  GAP_JUDGE_SYSTEM_PROMPT,
  type AreaGenInput,
  type TargetSpec,
} from '@truecourse/contract-extractor';
import {
  planGuardWork,
  collectWorkDocs,
  countExtractViews,
  countUncachedExtractViews,
  EXTRACT_SYSTEM_PROMPT as GUARD_EXTRACT_SYSTEM_PROMPT,
  GENERATE_SYSTEM_PROMPT,
  RECIPE_SYSTEM_PROMPT,
} from '@truecourse/guard-generator';
import type { LlmEstimate } from '../../commands/analyze-core.js';
import { resolveModel } from '../../config/llm-models.js';
import { estimateStageTokens, tokensFromChars, type StageCallEstimate } from './token-estimator.js';
import type { PriceTable } from './model-prices.js';

// Heuristic assumptions, surfaced as ranges where they bite.
const KEEP_RATE = 0.9; // fraction of prefiltered docs the relevance LLM keeps
const AVG_AREA_SIZE = 4; // docs per area (drives overlap pair count)
const OVERLAP_CAP = 60; // overlap-detector caps pairs per area
const TARGET_DENSITY_PER_KB = 0.6; // heuristic enumerated targets per KB of area text
const RETRY_AMP = 1.3; // extract retry-round amplification (1 + up to maxRetryRounds)
const GAP_AREA_FRACTION = 0.4; // rough fraction of areas that end up with gaps to judge
const MALFORMED_RATE = 0.15; // rough fraction of extract calls whose output needs parse-repair
const PARSE_REPAIR_ATTEMPTS = 3; // retries per malformed artifact (matches repair.ts)

// Human-readable labels for the confirm UI — users don't know the internal stage ids.
const STAGE_LABELS: Record<string, string> = {
  // scan
  relevance: 'Filtering docs',
  areaTag: 'Tagging areas',
  vocab: 'Normalizing vocabulary',
  relation: 'Detecting relations',
  overlap: 'Flagging overlaps',
  // generate
  enumerate: 'Planning contracts',
  reconcile: 'De-duplicating targets',
  extract: 'Generating contracts',
  gapJudge: 'Reviewing gaps',
  repairParse: 'Fixing syntax',
  // guard generate
  guardRecipe: 'Discovering recipe',
  guardExtract: 'Extracting claims',
  guardAuthor: 'Authoring scenarios',
};
const withLabels = (stages: StageCallEstimate[]): StageCallEstimate[] =>
  stages.map((s) => ({ ...s, label: STAGE_LABELS[s.stage] ?? s.stage }));

function previewChars(): number {
  // A discovery preview is ~60 lines; assume ~50 chars/line.
  return 60 * 50;
}

/**
 * Pre-flight token estimate for `spec scan` (curate). Pass `prices` to add a
 * ceiling cost.
 *
 * Cache-aware (exact — no proxy): relevance + area-tags are cached per doc,
 * content-keyed, and each cache directly gates its own LLM call. So a re-scan
 * only pays for docs whose content changed; we read the real caches up front and
 * count only the misses. The global stages (vocab/relation/overlap) re-run only
 * when the kept set changed. When nothing changed the estimate has no stages and
 * the confirm prompt is skipped.
 */
export async function estimateScanTokens(repoRoot: string, prices?: PriceTable): Promise<LlmEstimate> {
  const docs = discoverDocs(repoRoot);
  const { toClassify } = prefilterDocs(docs); // manualIncludes not loaded here — upper bound on skips
  const nClassify = toClassify.length;

  // Relevance: one LLM call per doc whose verdict isn't cached. Cached verdicts
  // also tell us which docs are kept (feed area-tagging).
  const relevance = await Promise.all(toClassify.map((d) => readRelevanceCache(repoRoot, d)));
  const relevanceMissDocs = toClassify.filter((_, i) => relevance[i] === null);
  const cachedKeptDocs = toClassify.filter((_, i) => relevance[i]?.include === true);

  // Area-tag: cached-kept docs that still lack tags + the kept share of changed
  // docs (whose tags are necessarily uncached — same content key).
  const cachedKeptTagged = await Promise.all(cachedKeptDocs.map((d) => isAreaTagCached(repoRoot, d)));
  const cachedKeptTagMisses = cachedKeptTagged.filter((cached) => !cached).length;
  const estChangedKept = Math.round(relevanceMissDocs.length * KEEP_RATE);

  const nRelevanceCalls = relevanceMissDocs.length;
  const nAreaTagCalls = cachedKeptTagMisses + estChangedKept;
  const nKept = cachedKeptDocs.length + estChangedKept;
  const changedDocs = relevanceMissDocs.length + cachedKeptTagMisses;
  const hasWork = changedDocs > 0;

  const avgDocChars = docs.length
    ? Math.round(docs.reduce((n, d) => n + d.size, 0) / docs.length)
    : 0;

  // Overlap pairs: area sizes are mid-run only → estimate from kept docs grouped
  // into mean-sized areas, capped per area. Reported as a range. Only when the
  // kept set actually changed (otherwise overlap is a cache hit).
  const areaCount = Math.max(1, Math.ceil(nKept / AVG_AREA_SIZE));
  const pairsPerArea = Math.min(OVERLAP_CAP, (AVG_AREA_SIZE * (AVG_AREA_SIZE - 1)) / 2);
  const overlapCalls = hasWork && nKept >= 2 ? areaCount * pairsPerArea : 0;

  const stages: StageCallEstimate[] = [
    {
      // Exact: one call per doc whose relevance verdict isn't cached.
      stage: 'relevance',
      model: resolveModel('spec.relevance', undefined, repoRoot),
      calls: nRelevanceCalls,
      avgInputTokens: tokensFromChars(RELEVANCE_SYSTEM_PROMPT.length, previewChars()),
      avgOutputTokens: 40,
    },
    {
      // The cached-kept misses are exact; how many CHANGED docs end up kept (and
      // thus tagged) is the only unknown → range out to +all changed docs.
      stage: 'areaTag',
      model: resolveModel('spec.areaTag', undefined, repoRoot),
      calls: nAreaTagCalls,
      minCalls: cachedKeptTagMisses,
      maxCalls: cachedKeptTagMisses + nRelevanceCalls,
      avgInputTokens: tokensFromChars(AREA_TAGGER_SYSTEM_PROMPT.length, avgDocChars),
      avgOutputTokens: 80,
    },
    {
      stage: 'vocab',
      model: resolveModel('spec.vocab', undefined, repoRoot),
      calls: hasWork && nKept > 0 ? 1 : 0,
      avgInputTokens: tokensFromChars(VOCAB_NORMALIZER_SYSTEM_PROMPT.length, 2000),
      avgOutputTokens: 200,
    },
    {
      stage: 'relation',
      model: resolveModel('spec.relation', undefined, repoRoot),
      calls: hasWork && nKept >= 2 ? 1 : 0,
      avgInputTokens: tokensFromChars(CHAIN_DETECTION_SYSTEM_PROMPT.length, nKept * 200),
      avgOutputTokens: 200,
    },
    {
      stage: 'overlap',
      model: resolveModel('spec.overlap', undefined, repoRoot),
      calls: overlapCalls,
      minCalls: 0,
      maxCalls: overlapCalls * 2,
      avgInputTokens: tokensFromChars(OVERLAP_DETECTOR_SYSTEM_PROMPT.length, avgDocChars * 2),
      avgOutputTokens: 120,
    },
  ];

  return estimateStageTokens(withLabels(stages), changedSubject(nClassify, changedDocs, 'doc'), prices);
}

function areaChars(area: AreaGenInput): number {
  return area.docs.reduce((n, d) => n + d.content.length, 0);
}

/**
 * Pre-flight token estimate for `contracts generate` (heuristic). Pass `prices`
 * to add a ceiling cost.
 *
 * Change-aware via the committed manifest: only areas whose specs changed since
 * the last generate (or are new) cost anything; unchanged areas are reused from
 * the committed `.tc`. Deterministic and clone-safe — the manifest is tracked, so
 * the estimate matches what generate will actually do (no first-run skew).
 */
export async function estimateGenerateTokens(repoRoot: string, prices?: PriceTable): Promise<LlmEstimate> {
  const allAreas = readCorpusForGenerate(repoRoot);
  const changed = new Set(classifyAreas(allAreas, readManifest(repoRoot)).changed);
  const areas = allAreas.filter((a) => changed.has(a.areaId));
  const batchSize = defaultGenerateBatch();

  // Ground in the enumerate cache where warm: the cached list is EXACTLY what a
  // run will use (same key, same canonicalization), so that area's enumerate
  // calls drop to 0 and its extract batches stop being guesses.
  const cachedTargets = new Map<string, TargetSpec[]>();
  await Promise.all(
    allAreas.map(async (a) => {
      const t = await readCachedEnumerateTargets(repoRoot, a);
      if (t) cachedTargets.set(a.areaId, t);
    }),
  );

  let enumerateCalls = 0;
  let extractCalls = 0;
  let extractInputCharsTotal = 0;
  let changedTargetsTotal = 0;
  for (const area of areas) {
    const chars = areaChars(area);
    const known = cachedTargets.get(area.areaId);
    // Warm enumerate cache → the run reads it back, zero enumerate calls.
    if (!known) enumerateCalls += Math.max(1, Math.ceil(chars / 48_000)); // mirrors ENUMERATE_AREA_BUDGET
    // Exact target count when warm; density heuristic when cold.
    const targets = known ? known.length : Math.max(1, Math.round((chars / 1024) * TARGET_DENSITY_PER_KB));
    changedTargetsTotal += targets;
    const batches = Math.ceil(targets / batchSize);
    extractCalls += batches;
    extractInputCharsTotal += batches * Math.min(chars, 60_000); // area docs re-sent per batch
  }
  const extractCallsPoint = Math.round(extractCalls * RETRY_AMP);
  const avgExtractBodyChars = extractCalls > 0 ? extractInputCharsTotal / extractCalls : 0;

  // Reconcile runs over the GLOBAL target list (all areas), one call per
  // cluster whose per-cluster cache misses. With every area's enumerate cache
  // warm we can replay that exactly. Otherwise: bounds from the cluster
  // structure — each LLM'd cluster has >=2 members, so calls <= distinct/2.
  let reconcile: Pick<StageCallEstimate, 'calls' | 'minCalls' | 'maxCalls'>;
  if (areas.length === 0) {
    reconcile = { calls: 0 };
  } else if (allAreas.every((a) => cachedTargets.has(a.areaId))) {
    const plan = await planReconcileCalls(
      repoRoot,
      allAreas.map((a) => ({ area: a, targets: cachedTargets.get(a.areaId)! })),
    );
    reconcile = { calls: plan.misses };
  } else {
    const knownTotal = [...cachedTargets.values()].reduce((n, t) => n + t.length, 0);
    const distinctCap = Math.ceil((knownTotal + changedTargetsTotal) / 2);
    reconcile = { calls: Math.min(areas.length, distinctCap), minCalls: 0, maxCalls: distinctCap };
  }

  const stages: StageCallEstimate[] = [
    {
      stage: 'enumerate',
      model: resolveModel('contract.enumerate', undefined, repoRoot),
      calls: enumerateCalls,
      avgInputTokens: tokensFromChars(ENUMERATE_SYSTEM_PROMPT.length, 48_000),
      avgOutputTokens: 400,
    },
    {
      stage: 'reconcile',
      model: resolveModel('contract.reconcile', undefined, repoRoot),
      ...reconcile,
      avgInputTokens: tokensFromChars(RECONCILE_SYSTEM_PROMPT.length, areas.length * 300),
      avgOutputTokens: 300,
    },
    {
      stage: 'extract',
      model: resolveModel('contract.extract', undefined, repoRoot),
      calls: extractCallsPoint,
      minCalls: extractCalls,
      maxCalls: Math.round(extractCalls * (1 + 2)), // up to maxRetryRounds=2 extra rounds
      avgInputTokens: tokensFromChars(EXTRACT_SYSTEM_PROMPT.length, avgExtractBodyChars),
      avgOutputTokens: batchSize * 250,
    },
    {
      // One sonnet call per area that ends up with gaps (count unknown pre-run).
      stage: 'gapJudge',
      model: resolveModel('contract.gapJudge', undefined, repoRoot),
      calls: Math.ceil(areas.length * GAP_AREA_FRACTION),
      minCalls: 0,
      maxCalls: areas.length,
      avgInputTokens: tokensFromChars(GAP_JUDGE_SYSTEM_PROMPT.length, avgExtractBodyChars / 2),
      avgOutputTokens: 200,
    },
    {
      // Parse-repair: only the rare malformed artifact, retried (mostly sonnet).
      // Repair sends the FULL extract system prompt plus its fix preamble.
      stage: 'repairParse',
      model: resolveModel('contract.repairParse', undefined, repoRoot),
      calls: Math.ceil(extractCallsPoint * MALFORMED_RATE),
      minCalls: 0,
      maxCalls: Math.ceil(extractCallsPoint * MALFORMED_RATE) * PARSE_REPAIR_ATTEMPTS,
      avgInputTokens: tokensFromChars(EXTRACT_SYSTEM_PROMPT.length + REPAIR_FIX_SYSTEM_PROMPT.length, avgExtractBodyChars),
      avgOutputTokens: 400,
    },
  ];

  return estimateStageTokens(withLabels(stages), changedSubject(allAreas.length, areas.length, 'area'), prices);
}

// Guard heuristics (claims/section grounded in real extractions: whole-document
// reads average ~2 cli claims per changed section, with dense sections higher).
const GUARD_CLI_CLAIMS_PER_SECTION = 2.0; // rough cli claims a changed section yields (point)
const GUARD_CLI_CLAIMS_PER_SECTION_MAX = 3.5; // upper bound (multi-claim sections)
const GUARD_AUTHOR_DOC_BUDGET = 48_000; // matches the generator's per-batch context cap
const GUARD_EXTRACT_OUTPUT_TOKENS = 1500; // ~claims + notes per document view
const GUARD_AUTHOR_OUTPUT_TOKENS = 300; // ~one scenario of YAML per claim
// Grounded authoring injects real empty-sandbox probe transcripts into each batch
// prompt (zero extra LLM CALLS — it just enlarges the authoring input). A
// representative block: a handful of probes, each a short command's output.
const GUARD_GROUND_TRANSCRIPT_CHARS = 4000;

/**
 * Pre-flight token estimate for `guard generate`. Pass `prices` to add a ceiling
 * cost. Same convention as scan/generate: cache-aware, "N of M sections changed",
 * no stages ⇒ confirm skipped.
 *
 * Change-aware via the committed scenarios manifest (the deterministic work plan).
 * Extraction is EXACT in call count — one call per uncached document view across
 * the work documents (read straight from the per-view extract cache). Authoring is
 * a heuristic on the changed sections (claims aren't known until extraction runs),
 * surfaced as a range: batches of ~0.8–1.5 cli claims per changed section.
 */
export async function estimateGuardTokens(repoRoot: string, prices?: PriceTable): Promise<LlmEstimate> {
  const plan = planGuardWork(repoRoot);
  const work = plan.work;
  const batchSize = defaultGenerateBatch();

  // Extraction: one call per uncached view across the documents with changed
  // sections. The per-view extract cache makes this exact.
  const workDocs = collectWorkDocs(repoRoot, plan);
  let extractCalls = 0;
  let totalViews = 0;
  let workDocChars = 0;
  for (const doc of workDocs) {
    totalViews += countExtractViews(doc);
    extractCalls += await countUncachedExtractViews(repoRoot, doc);
    workDocChars += doc.content.length;
  }
  const avgViewChars = totalViews > 0 ? Math.round(Math.min(GUARD_AUTHOR_DOC_BUDGET, workDocChars / totalViews)) : 0;

  // Authoring: batches of cli claims from the changed sections. Claim counts are
  // unknown until extraction runs, so range around the per-section heuristic.
  const claimsPoint = Math.round(work.length * GUARD_CLI_CLAIMS_PER_SECTION);
  const claimsMax = Math.ceil(work.length * GUARD_CLI_CLAIMS_PER_SECTION_MAX);
  const authorPoint = Math.ceil(claimsPoint / batchSize);
  const authorMax = Math.ceil(claimsMax / batchSize);
  const avgOwnChars = work.length ? Math.round(work.reduce((n, s) => n + s.ownText.length, 0) / work.length) : 0;
  const docContextChars = Math.min(GUARD_AUTHOR_DOC_BUDGET, avgViewChars);

  const stages: StageCallEstimate[] = [
    {
      stage: 'guardRecipe',
      model: resolveModel('guard.recipe', undefined, repoRoot),
      // One discovery call only when no recipe.json exists yet.
      calls: plan.recipeMissing ? 1 : 0,
      avgInputTokens: tokensFromChars(RECIPE_SYSTEM_PROMPT.length, 2000),
      avgOutputTokens: 120,
    },
    {
      stage: 'guardExtract',
      model: resolveModel('guard.extract', undefined, repoRoot),
      calls: extractCalls,
      avgInputTokens: tokensFromChars(GUARD_EXTRACT_SYSTEM_PROMPT.length, avgViewChars),
      avgOutputTokens: GUARD_EXTRACT_OUTPUT_TOKENS,
    },
    {
      stage: 'guardAuthor',
      model: resolveModel('guard.generate', undefined, repoRoot),
      calls: authorPoint,
      minCalls: 0,
      maxCalls: authorMax,
      // A batch carries the system prompt + the doc context + ~batchSize claims'
      // own text + the injected grounding transcripts.
      avgInputTokens: tokensFromChars(
        GENERATE_SYSTEM_PROMPT.length,
        docContextChars + batchSize * avgOwnChars + GUARD_GROUND_TRANSCRIPT_CHARS,
      ),
      avgOutputTokens: GUARD_AUTHOR_OUTPUT_TOKENS * batchSize,
    },
  ];

  return estimateStageTokens(withLabels(stages), changedSubject(plan.sections.length, work.length, 'section'), prices);
}

/** Confirm-copy subject surfacing how many of `total` units are changed vs cached. */
function changedSubject(total: number, changed: number, noun: string): string {
  const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  if (total === 0) return `0 ${noun}s`;
  if (changed >= total) return plural(total);
  if (changed === 0) return `all ${plural(total)} cached`;
  return `${changed} of ${plural(total)} changed`;
}
