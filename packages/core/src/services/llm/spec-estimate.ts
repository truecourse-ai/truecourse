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
 *  - GENERATE is heuristic: extract (the dominant Opus stage) scales with the
 *    enumerated TARGET count, which isn't known until enumerate runs — so we
 *    approximate it from area/doc sizes and widen the range. A precise,
 *    enumerate-grounded estimate is a follow-up.
 *
 * Per-stage system-prompt sizes are coarse constants (documented below); the
 * body sizes (doc/area chars) are real and dominate, which is what matters for a
 * "is this a big run?" confirm gate.
 */

import { discoverDocs, prefilterDocs, readRelevanceCache, isAreaTagCached } from '@truecourse/spec-consolidator';
import {
  readCorpusForGenerate,
  defaultGenerateBatch,
  isAreaEnumerateCached,
  type AreaGenInput,
} from '@truecourse/contract-extractor';
import type { LlmEstimate } from '../../commands/analyze-core.js';
import { resolveModel } from '../../config/llm-models.js';
import { estimateStageTokens, tokensFromChars, type StageCallEstimate } from './token-estimator.js';
import type { PriceTable } from './model-prices.js';

// Coarse per-stage system-prompt token sizes (the body dominates; these only
// need to be the right order of magnitude for a confirm gate).
const SYS = {
  relevance: 350,
  areaTag: 550,
  vocab: 300,
  relation: 800,
  overlap: 500,
  enumerate: 600,
  reconcile: 500,
  extract: 4000, // the generate system prompt is large
  repair: 4000,
  gapJudge: 700,
} as const;

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
      avgInputTokens: tokensFromChars(SYS.relevance * 4, previewChars()),
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
      avgInputTokens: tokensFromChars(SYS.areaTag * 4, avgDocChars),
      avgOutputTokens: 80,
    },
    {
      stage: 'vocab',
      model: resolveModel('spec.vocab', undefined, repoRoot),
      calls: hasWork && nKept > 0 ? 1 : 0,
      avgInputTokens: tokensFromChars(SYS.vocab * 4, 2000),
      avgOutputTokens: 200,
    },
    {
      stage: 'relation',
      model: resolveModel('spec.relation', undefined, repoRoot),
      calls: hasWork && nKept >= 2 ? 1 : 0,
      avgInputTokens: tokensFromChars(SYS.relation * 4, nKept * 200),
      avgOutputTokens: 200,
    },
    {
      stage: 'overlap',
      model: resolveModel('spec.overlap', undefined, repoRoot),
      calls: overlapCalls,
      minCalls: 0,
      maxCalls: overlapCalls * 2,
      avgInputTokens: tokensFromChars(SYS.overlap * 4, avgDocChars * 2),
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
 * Cache-aware: areas whose docs are unchanged are already generated (extract
 * cache hit), so a re-run only pays for the CHANGED areas. We exclude the cached
 * ones up front and label how many of the total are in play.
 *
 * Known limitation: the cache signal is the ENUMERATE cache used as a proxy for
 * "this area's extract is cached". On the very first run after the extract cache
 * was introduced the enumerate cache can already be warm while the extract cache
 * is still empty, so this estimate can UNDER-count that one run; estimate and
 * reality agree from the next run on. (We deliberately don't add a separate
 * marker to paper over this — it's a one-time transition, not a standing bug.)
 */
export async function estimateGenerateTokens(repoRoot: string, prices?: PriceTable): Promise<LlmEstimate> {
  const allAreas = readCorpusForGenerate(repoRoot);
  const cachedFlags = await Promise.all(allAreas.map((a) => isAreaEnumerateCached(repoRoot, a)));
  const areas = allAreas.filter((_, i) => !cachedFlags[i]);
  const batchSize = defaultGenerateBatch();

  let enumerateCalls = 0;
  let extractCalls = 0;
  let extractInputCharsTotal = 0;
  for (const area of areas) {
    const chars = areaChars(area);
    const views = Math.max(1, Math.ceil(chars / 48_000)); // mirrors ENUMERATE_AREA_BUDGET
    enumerateCalls += views;
    // Heuristic target count for the area → extract batches × retry amplification.
    const targets = Math.max(1, Math.round((chars / 1024) * TARGET_DENSITY_PER_KB));
    const batches = Math.ceil(targets / batchSize);
    extractCalls += batches;
    extractInputCharsTotal += batches * Math.min(chars, 60_000); // area docs re-sent per batch
  }
  const extractCallsPoint = Math.round(extractCalls * RETRY_AMP);
  const avgExtractBodyChars = extractCalls > 0 ? extractInputCharsTotal / extractCalls : 0;

  const stages: StageCallEstimate[] = [
    {
      stage: 'enumerate',
      model: resolveModel('contract.enumerate', undefined, repoRoot),
      calls: enumerateCalls,
      avgInputTokens: tokensFromChars(SYS.enumerate * 4, 48_000),
      avgOutputTokens: 400,
    },
    {
      stage: 'reconcile',
      model: resolveModel('contract.reconcile', undefined, repoRoot),
      calls: areas.length > 0 ? 1 : 0,
      avgInputTokens: tokensFromChars(SYS.reconcile * 4, areas.length * 300),
      avgOutputTokens: 300,
    },
    {
      stage: 'extract',
      model: resolveModel('contract.extract', undefined, repoRoot),
      calls: extractCallsPoint,
      minCalls: extractCalls,
      maxCalls: Math.round(extractCalls * (1 + 2)), // up to maxRetryRounds=2 extra rounds
      avgInputTokens: tokensFromChars(SYS.extract * 4, avgExtractBodyChars),
      avgOutputTokens: batchSize * 250,
    },
    {
      // One sonnet call per area that ends up with gaps (count unknown pre-run).
      stage: 'gapJudge',
      model: resolveModel('contract.gapJudge', undefined, repoRoot),
      calls: Math.ceil(areas.length * GAP_AREA_FRACTION),
      minCalls: 0,
      maxCalls: areas.length,
      avgInputTokens: tokensFromChars(SYS.gapJudge * 4, avgExtractBodyChars / 2),
      avgOutputTokens: 200,
    },
    {
      // Parse-repair: only the rare malformed artifact, retried (mostly sonnet).
      stage: 'repairParse',
      model: resolveModel('contract.repairParse', undefined, repoRoot),
      calls: Math.ceil(extractCallsPoint * MALFORMED_RATE),
      minCalls: 0,
      maxCalls: Math.ceil(extractCallsPoint * MALFORMED_RATE) * PARSE_REPAIR_ATTEMPTS,
      avgInputTokens: tokensFromChars(SYS.repair * 4, avgExtractBodyChars),
      avgOutputTokens: 400,
    },
  ];

  return estimateStageTokens(withLabels(stages), changedSubject(allAreas.length, areas.length, 'area'), prices);
}

/** Confirm-copy subject surfacing how many of `total` units are changed vs cached. */
function changedSubject(total: number, changed: number, noun: string): string {
  const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  if (total === 0) return `0 ${noun}s`;
  if (changed >= total) return plural(total);
  if (changed === 0) return `all ${plural(total)} cached`;
  return `${changed} of ${plural(total)} changed`;
}
