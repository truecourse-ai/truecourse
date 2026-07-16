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
  planRelevanceWork,
  readCorpus,
  readCorpusDecisions,
  isAreaTagCached,
  RELEVANCE_SYSTEM_PROMPT,
  AREA_TAGGER_SYSTEM_PROMPT,
  VOCAB_NORMALIZER_SYSTEM_PROMPT,
  OVERLAP_DETECTOR_SYSTEM_PROMPT,
  OVERLAP_WINDOW_CHARS,
  VERIFY_OVERLAP_SYSTEM_PROMPT,
  VERIFY_DOC_BUDGET_CHARS,
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
  resolveGenerateBatch,
  defaultSupportPackSize,
  EXTRACT_SYSTEM_PROMPT as GUARD_EXTRACT_SYSTEM_PROMPT,
  GENERATE_SYSTEM_PROMPT,
  RECIPE_SYSTEM_PROMPT,
  FIDELITY_SYSTEM_PROMPT,
  TRIAGE_SYSTEM_PROMPT,
  EXEMPLAR_SYSTEM_PROMPT,
  type GenerateMode,
} from '@truecourse/guard-generator';
import type { LlmEstimate } from '../../commands/analyze-core.js';
import { resolveModel } from '../../config/llm-models.js';
import { estimateStageTokens, tokensFromChars, type StageCallEstimate } from './token-estimator.js';
import type { PriceTable } from './model-prices.js';

// Heuristic assumptions, surfaced as ranges where they bite.
const KEEP_RATE = 0.9; // fraction of prefiltered docs the relevance LLM keeps
const AVG_AREA_SIZE = 4; // docs per area (drives overlap pair count)
const TARGET_DENSITY_PER_KB = 0.6; // heuristic enumerated targets per KB of area text
const RETRY_AMP = 1.3; // extract retry-round amplification (1 + up to maxRetryRounds)
const GAP_AREA_FRACTION = 0.4; // rough fraction of areas that end up with gaps to judge
const MALFORMED_RATE = 0.15; // rough fraction of extract calls whose output needs parse-repair
const FLAG_RATE = 0.15; // rough fraction of overlap PAIRS the detector flags (→ verify calls)
const PARSE_REPAIR_ATTEMPTS = 3; // retries per malformed artifact (matches repair.ts)

// Human-readable labels for the confirm UI — users don't know the internal stage ids.
const STAGE_LABELS: Record<string, string> = {
  // scan
  relevance: 'Filtering docs',
  areaTag: 'Tagging areas',
  vocab: 'Normalizing vocabulary',
  overlap: 'Flagging overlaps',
  verifyOverlap: 'Verifying conflicts',
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
  guardFidelity: 'Reviewing fidelity',
  guardTriage: 'Triaging findings',
  guardExemplars: 'Generating exemplars',
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
export async function estimateScanTokens(
  repoRoot: string,
  prices?: PriceTable,
  opts: { skipGit?: boolean } = {},
): Promise<LlmEstimate> {
  // Load the user's decisions so the estimate probes the SAME doc set the run
  // classifies. Without the manualIncludes the prefilter (dedup pool) and the
  // kept set diverge from the runtime — the estimate would report "all cached"
  // while the run cache-misses and spends (silent-spend bug).
  const decisions = readCorpusDecisions(repoRoot);
  const manualIncludes = decisions.manualIncludes ?? [];
  const manualExcludes = new Set(decisions.manualExcludes ?? []);

  const docs = discoverDocs(repoRoot, { skipGit: opts.skipGit });
  // Exact same planner `filterByRelevance` runs: one LLM call per doc whose
  // verdict isn't cached (manual-includes never call). Its `known` verdicts also
  // tell us which docs are kept (feed area-tagging).
  const plan = await planRelevanceWork(repoRoot, docs, manualIncludes);
  const nClassify = plan.toClassify.length;
  const relevanceMissDocs = plan.needsCall;
  // Kept without a call = cached-include ∪ manual-include, minus force-excludes
  // (the run drops excluded docs before tagging).
  const cachedKeptDocs = plan.toClassify.filter(
    (d) => plan.known.get(d.path)?.include === true && !manualExcludes.has(d.path),
  );

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

  // Overlap pairs (within-area): when a prior corpus is on disk, use its real area
  // structure — Σ n·(n-1)/2 over areas (n = area docRefs) — instead of the mean-area
  // heuristic. Heading-widened cross-area pairs need doc content and stay unmodeled.
  // Without a corpus, estimate from the kept docs grouped into mean-sized areas.
  // Every pair judged (no cap), reported as a range. Only when the kept set actually
  // changed (otherwise overlap is a cache hit).
  const corpus = readCorpus(repoRoot);
  const areaCount = Math.max(1, Math.ceil(nKept / AVG_AREA_SIZE));
  const pairsPerArea = (AVG_AREA_SIZE * (AVG_AREA_SIZE - 1)) / 2;
  const overlapPairs = !hasWork
    ? 0
    : corpus
      ? corpus.areas.reduce((n, a) => n + (a.docRefs.length * (a.docRefs.length - 1)) / 2, 0)
      : nKept >= 2
        ? areaCount * pairsPerArea
        : 0;
  // Each pair compares FULL docs windowed at OVERLAP_WINDOW_CHARS: the complete
  // window matrix (never truncated), so calls scale with the square of doc size.
  // This estimate IS the cost gate for that completeness — the user approves it.
  const callsPerPairFactor = Math.ceil(Math.max(1, avgDocChars) / OVERLAP_WINDOW_CHARS) ** 2;
  const overlapCalls = overlapPairs * callsPerPairFactor;

  // Verify pass: one call per FLAGGED pair (not per window call) — the detector
  // flags only a fraction of the pairs it examines, so scale by the flag rate.
  // Bounded above by every pair being flagged and verified.
  const verifyCalls = Math.round(FLAG_RATE * overlapPairs);

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
      stage: 'overlap',
      model: resolveModel('spec.overlap', undefined, repoRoot),
      calls: overlapCalls,
      minCalls: 0,
      maxCalls: overlapCalls * 2,
      avgInputTokens: tokensFromChars(OVERLAP_DETECTOR_SYSTEM_PROMPT.length, Math.min(avgDocChars, OVERLAP_WINDOW_CHARS) * 2),
      avgOutputTokens: 120,
    },
    {
      // Verify each flagged pair — a heuristic fraction of the overlap pairs (the
      // exact count isn't known until detection runs). Each call carries both
      // sides' context, each clamped to VERIFY_DOC_BUDGET_CHARS.
      stage: 'verifyOverlap',
      model: resolveModel('spec.verifyOverlap', undefined, repoRoot),
      calls: verifyCalls,
      expectedCalls: verifyCalls,
      minCalls: 0,
      maxCalls: overlapPairs,
      avgInputTokens: tokensFromChars(
        VERIFY_OVERLAP_SYSTEM_PROMPT.length,
        Math.min(avgDocChars, VERIFY_DOC_BUDGET_CHARS) * 2,
      ),
      avgOutputTokens: 80,
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
const GUARD_EXTRACT_OUTPUT_TOKENS = 1500; // ~claims + notes per document view
const GUARD_AUTHOR_OUTPUT_TOKENS = 300; // ~one scenario of YAML per claim
const GUARD_FIDELITY_OUTPUT_TOKENS = 60; // ~a verdict + a one-sentence mismatch
const GUARD_TRIAGE_OUTPUT_TOKENS = 300; // ~a verdict + confidence + brief + recommendation
const GUARD_FINDING_RATE = 0.15; // rough fraction of authored claims that birth a finding
const GUARD_SUPPORT_RATE = 0.1; // rough fraction of authored claims that are support claims
const GUARD_EXEMPLAR_TOKENS_PER = 50; // ~tokens per generated exemplar in the pack output
const GUARD_SCENARIO_YAML_CHARS = 1200; // ~one authored scenario's YAML body (the review input)
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
 * surfaced as a range: batches of ~0.8–1.5 cli claims per changed section. Fidelity
 * review (one call per green scenario, item 33) is NOT cache-aware — scenario
 * content isn't known until authoring + birth run — so it counts one review per
 * planned cli claim (the same range as authoring), honestly over-counting a claim
 * that authors several scenarios or none. Finding triage (one Opus call per
 * birth/fidelity finding) is likewise not knowable pre-run — the finding count
 * depends on birth outcomes — so it ranges 0..claimsMax with a heuristic point.
 * Support-claim exemplar generation (item 9, one call per support claim, each writing
 * a diverse input pack) is the same shape — support claims aren't known pre-run — so
 * it too ranges 0..claimsMax with a heuristic point.
 *
 * `mode` is the speed/cost dial (item 5): economical batches claims per authoring
 * call (fewer calls), fast authors one claim per call (more calls, each re-paying
 * the shared document context). It changes ONLY the authoring stage's call count
 * and per-call body; every other stage is identical. `TRUECOURSE_GENERATE_BATCH`
 * overrides both modes to a fixed batch (see `resolveGenerateBatch`).
 */
export async function estimateGuardTokens(
  repoRoot: string,
  prices?: PriceTable,
  mode: GenerateMode = 'economical',
): Promise<LlmEstimate> {
  const plan = planGuardWork(repoRoot);
  const work = plan.work;
  const batchSize = resolveGenerateBatch(mode);
  const supportPackSize = defaultSupportPackSize();

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
  // Extraction chunks losslessly at its view budget, so the per-view average IS the
  // extract call's body size.
  const avgViewChars = totalViews > 0 ? Math.round(workDocChars / totalViews) : 0;

  // Authoring: batches of cli claims from the changed sections. Claim counts are
  // unknown until extraction runs, so range around the per-section heuristic.
  const claimsPoint = Math.round(work.length * GUARD_CLI_CLAIMS_PER_SECTION);
  const claimsMax = Math.ceil(work.length * GUARD_CLI_CLAIMS_PER_SECTION_MAX);
  const authorPoint = Math.ceil(claimsPoint / batchSize);
  const authorMax = Math.ceil(claimsMax / batchSize);
  const avgOwnChars = work.length ? Math.round(work.reduce((n, s) => n + s.ownText.length, 0) / work.length) : 0;
  // Authoring always carries the FULL document as context (no thinning) — one whole
  // work document per authoring call, re-paid on every call.
  const avgDocContextChars = workDocs.length ? Math.round(workDocChars / workDocs.length) : 0;

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
      // A batch carries the system prompt + the full doc context + ~batchSize
      // claims' own text + the injected grounding transcripts.
      avgInputTokens: tokensFromChars(
        GENERATE_SYSTEM_PROMPT.length,
        avgDocContextChars + batchSize * avgOwnChars + GUARD_GROUND_TRANSCRIPT_CHARS,
      ),
      avgOutputTokens: GUARD_AUTHOR_OUTPUT_TOKENS * batchSize,
    },
    {
      stage: 'guardFidelity',
      model: resolveModel('guard.fidelity', undefined, repoRoot),
      // One review per green scenario ≈ per authored cli claim (same range as
      // authoring). Not cache-aware — scenario content is unknown pre-run.
      calls: claimsPoint,
      minCalls: 0,
      maxCalls: claimsMax,
      // A review carries the system prompt + the section's own text + one scenario YAML.
      avgInputTokens: tokensFromChars(FIDELITY_SYSTEM_PROMPT.length, avgOwnChars + GUARD_SCENARIO_YAML_CHARS),
      avgOutputTokens: GUARD_FIDELITY_OUTPUT_TOKENS,
    },
    {
      // One Opus triage call per birth/fidelity finding, after the sections settle.
      // The finding COUNT is unknowable pre-run (it depends on birth/fidelity
      // outcomes), so — following the fidelity stage's per-claim proxy convention —
      // this ranges from 0 (no findings) up to a ceiling of every planned claim's
      // scenario becoming a finding (`claimsMax`), with a heuristic point at
      // GUARD_FINDING_RATE of the planned claims. The ceiling drives the quoted cost.
      stage: 'guardTriage',
      model: resolveModel('guard.triage', undefined, repoRoot),
      calls: Math.round(claimsPoint * GUARD_FINDING_RATE),
      minCalls: 0,
      maxCalls: claimsMax,
      // A triage carries the system prompt + the section's own text + one scenario
      // YAML + the finding's grounding transcripts.
      avgInputTokens: tokensFromChars(
        TRIAGE_SYSTEM_PROMPT.length,
        avgOwnChars + GUARD_SCENARIO_YAML_CHARS + GUARD_GROUND_TRANSCRIPT_CHARS,
      ),
      avgOutputTokens: GUARD_TRIAGE_OUTPUT_TOKENS,
    },
    {
      // One exemplar-generation call per SUPPORT claim (item 9), each writing a
      // diverse pack of `supportPackSize` inputs. How many claims are support claims
      // is unknowable pre-run (extraction hasn't run), so — following the triage
      // stage's per-claim proxy — this ranges from 0 (no support claims) up to a
      // ceiling of every planned claim being a support claim (`claimsMax`), with a
      // heuristic point at GUARD_SUPPORT_RATE of the planned claims. The ceiling drives
      // the quoted cost. The output is large (the whole pack), input small (a subject).
      stage: 'guardExemplars',
      model: resolveModel('guard.exemplars', undefined, repoRoot),
      calls: Math.round(claimsPoint * GUARD_SUPPORT_RATE),
      minCalls: 0,
      maxCalls: claimsMax,
      avgInputTokens: tokensFromChars(EXEMPLAR_SYSTEM_PROMPT.length, 800),
      avgOutputTokens: supportPackSize * GUARD_EXEMPLAR_TOKENS_PER,
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
