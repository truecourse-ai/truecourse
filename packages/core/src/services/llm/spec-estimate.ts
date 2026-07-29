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
  readCorpusDecisions,
  isAreaTagCached,
  RELEVANCE_SYSTEM_PROMPT,
  relevanceUserPromptChars,
  resolveRepoIdentity,
  readRepoIdentityInput,
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
  proposeRecipe,
  collectWorkDocs,
  countExtractViews,
  countUncachedExtractViews,
  docExtractionCached,
  extractDocClaims,
  readCorpusAreaTags,
  buildFlowAreas,
  buildSurfaceCatalogs,
  planFlowSynthesis,
  readCachedMatch,
  readFlowsFile,
  sectionInputsKey,
  flowGenerationInputsHash,
  flowAreaIdForDoc,
  EXTRACT_SYSTEM_PROMPT as GUARD_EXTRACT_SYSTEM_PROMPT,
  GENERATE_SYSTEM_PROMPT,
  RECIPE_SYSTEM_PROMPT,
  SEED_SYSTEM_PROMPT,
  FIDELITY_SYSTEM_PROMPT,
  FLOWS_SYSTEM_PROMPT as GUARD_FLOWS_SYSTEM_PROMPT,
  MATCH_SYSTEM_PROMPT as GUARD_MATCH_SYSTEM_PROMPT,
  type FlowAreaDocInput,
  type GuardWorkPlan,
  type SurfaceCatalog,
} from '@truecourse/guard-generator';
import {
  loadSpecScope,
  isRunnableDriver,
  runnableDriverIds,
  violatesSettleInvariant,
  type GuardDriverId,
  type GuardFlow,
} from '@truecourse/shared';
import {
  loadRecipe,
  readJourneyCatalog,
  readManifest as readGuardManifest,
  recipePath,
} from '@truecourse/guard-runner';
import type { RepoIdentity } from '@truecourse/spec-consolidator';
import { missingDataBlockedFlows } from '../../commands/guard-seed.js';
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
  guardSeed: 'Drafting seed script',
  guardExtract: 'Extracting claims',
  guardFlows: 'Synthesizing flows',
  guardMatch: 'Matching flows',
  guardAuthor: 'Authoring scenarios',
  guardRetry: 'Re-authoring on evidence',
  guardFidelity: 'Reviewing fidelity',
};
const withLabels = (stages: StageCallEstimate[]): StageCallEstimate[] =>
  stages.map((s) => ({ ...s, label: STAGE_LABELS[s.stage] ?? s.stage }));

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
  opts: { skipGit?: boolean; identity?: RepoIdentity | null } = {},
): Promise<LlmEstimate> {
  // Load the user's decisions so the estimate probes the SAME doc set the run
  // classifies. Without the manualIncludes the prefilter (dedup pool) and the
  // kept set diverge from the runtime — the estimate would report "all cached"
  // while the run cache-misses and spends (silent-spend bug).
  const decisions = readCorpusDecisions(repoRoot);
  const manualIncludes = decisions.manualIncludes ?? [];
  const manualExcludes = new Set(decisions.manualExcludes ?? []);

  // Scope-aware, exactly as `curate` discovers: `spec.include` narrows the
  // universe before anything else runs, and the estimate must see the same doc
  // set the run will. It also has to, now that identity is part of the relevance
  // cache key — a different doc set can resolve a different identity, and then
  // the estimate reads a cache the run never hits.
  const docs = discoverDocs(repoRoot, { skipGit: opts.skipGit, scope: loadSpecScope(repoRoot) });
  // Resolved AFTER discovery (corpus name expansion reads the docs) and folded
  // into the relevance cache key. The estimate and the run must resolve the same
  // identity or they key differently and the estimate under-reports — the
  // silent-re-spend class this module already documents. An explicit `null` from
  // the caller (EE) is honored; only `undefined` falls back to resolving here.
  const identity =
    opts.identity !== undefined
      ? opts.identity
      : resolveRepoIdentity({ ...readRepoIdentityInput(repoRoot), docs });
  // Exact same planner `filterByRelevance` runs: one LLM call per doc whose
  // verdict isn't cached (manual-includes never call). Its `known` verdicts also
  // tell us which docs are kept (feed area-tagging).
  const plan = await planRelevanceWork(repoRoot, docs, { manualIncludes, identity });
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

  // Overlap pairs: area sizes are mid-run only → estimate from kept docs grouped
  // into mean-sized areas, every pair judged (no cap). Reported as a range. Only
  // when the kept set actually changed (otherwise overlap is a cache hit).
  const areaCount = Math.max(1, Math.ceil(nKept / AVG_AREA_SIZE));
  const pairsPerArea = (AVG_AREA_SIZE * (AVG_AREA_SIZE - 1)) / 2;
  const overlapPairs = hasWork && nKept >= 2 ? areaCount * pairsPerArea : 0;
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
      avgInputTokens: tokensFromChars(RELEVANCE_SYSTEM_PROMPT.length, relevanceUserPromptChars(identity)),
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

// Guard heuristics (grounded in real extractions: whole-document reads average ~2
// runnable claims per section, with dense sections higher). Claims are no longer
// the generation unit — they bound the FLOW count, which is a synthesis output and
// therefore unknowable before the run (milestones partition claims in the worst
// case, so flows <= runnable claims).
const GUARD_CLI_CLAIMS_PER_SECTION_MAX = 3.5; // upper bound (multi-claim sections)
const GUARD_VIEW_CHARS_CAP = 48_000; // per-view sizing cap for the extraction estimate
const GUARD_EXTRACT_OUTPUT_TOKENS = 1500; // ~claims + notes per document view
const GUARD_AUTHOR_OUTPUT_TOKENS = 700; // ~one flow scenario's YAML (several steps)
const GUARD_FIDELITY_OUTPUT_TOKENS = 60; // ~a verdict + a one-sentence mismatch
const GUARD_SCENARIO_YAML_CHARS = 2400; // ~one flow scenario's YAML body (the review input)
// Seed drafting (item 66): the prompt carries the parsed schema + the blocked
// claims, and the reply is a whole script file — the largest single output of any
// guard stage.
const GUARD_SEED_BODY_CHARS = 6000;
const GUARD_SEED_OUTPUT_TOKENS = 3000;
// Grounded authoring injects real empty-sandbox probe transcripts into each
// authoring prompt (zero extra LLM CALLS — it just enlarges the input).
const GUARD_GROUND_TRANSCRIPT_CHARS = 4000;
// Flow synthesis reads one area's claims + outlines (no document text at all), so
// its input is small; the cold-cache fallback assumes a mid-sized area.
const GUARD_FLOWS_AREA_CHARS = 6000;
const GUARD_FLOWS_OUTPUT_TOKENS = 1200; // ~an area's flows + no-flow reasons
// Matching reads one flow's milestones + one surface's catalog DIGEST (ids, entries,
// step summaries — never code); a digest line is short by construction.
const GUARD_JOURNEY_DIGEST_CHARS = 220; // ~one journey's digest block
const GUARD_MATCH_CATALOG_CHARS = 12_000; // cold-cache fallback for a catalog digest
const GUARD_MATCH_OUTPUT_TOKENS = 300; // ~a plan over a handful of milestones
// A flow's authoring prompt carries every milestone's section text once; sections
// average this much when the corpus isn't readable offline.
const GUARD_MILESTONES_PER_FLOW = 3; // rough milestones a synthesized flow carries

/** The flow-synthesis stage's planned work — see {@link planGuardFlowStage}. */
interface GuardFlowStagePlan {
  /** Per-area synthesis calls (exact when `exact`, one per changed area otherwise). */
  areaCalls: number;
  /** Epic-pass ceiling: 1 when more than one area can yield flows, else 0. */
  epicCalls: number;
  /** Average input chars one synthesis call carries. */
  areaChars: number;
  /** Runnable claims — the honest upper bound on synthesized flows (0 when unknown). */
  maxFlows: number;
  /** True when the claim inventory was known offline and the REAL flows cache was probed. */
  exact: boolean;
}

/**
 * Plan the `guard.flows` stage. Exact whenever the extract cache is warm for every
 * document: the claim inventory is then known offline, so this groups the SAME
 * areas the run synthesizes and probes the SAME `.cache/guard/flows` entries it
 * reads — an area whose claims are unchanged costs nothing and the estimate says so.
 * Cold (a document not yet extracted) falls back to one call per area with a
 * changed section, which is what a cold run pays.
 */
async function planGuardFlowStage(repoRoot: string, plan: GuardWorkPlan): Promise<GuardFlowStagePlan> {
  // A generate with no changed section returns before any stage runs, so zero
  // synthesis calls is exact — not an under-count.
  if (plan.work.length === 0) {
    return { areaCalls: 0, epicCalls: 0, areaChars: 0, maxFlows: 0, exact: true };
  }
  const areaTags = readCorpusAreaTags(repoRoot);
  // An area's synthesis reads ALL its claims, so the estimate needs every document
  // of the universe — not only the ones with a changed section.
  const docs = collectWorkDocs(repoRoot, { ...plan, work: plan.sections });
  const inputs: FlowAreaDocInput[] = [];
  let exact = true;
  for (const doc of docs) {
    if (!(await docExtractionCached(repoRoot, doc))) {
      exact = false;
      break;
    }
    const extraction = await extractDocClaims(repoRoot, doc, async () => {
      throw new Error('estimate: extraction cache miss');
    });
    if (!extraction.ok || !extraction.complete) {
      exact = false;
      break;
    }
    inputs.push({
      doc: doc.doc,
      areaTags: areaTags.get(doc.doc) ?? [],
      outline: doc.sections.map((s) => ({ anchor: s.anchor, headingText: s.headingText, level: s.level })),
      untestable: extraction.data.untestable.map((u) => ({ anchor: u.sectionAnchor, reason: u.reason })),
      claims: extraction.data.claims.map((c) => ({
        doc: doc.doc,
        anchor: c.sectionAnchor,
        title: c.claim,
        driver: c.driver,
      })),
    });
  }

  if (exact) {
    const areas = buildFlowAreas(inputs);
    const flowPlan = await planFlowSynthesis(repoRoot, areas);
    const chars = areas.map(
      (a) =>
        a.claims.reduce((n, c) => n + c.doc.length + c.anchor.length + c.title.length + 40, 0) +
        a.docs.reduce((n, d) => n + d.outline.reduce((m, e) => m + e.anchor.length + e.headingText.length + 6, 0), 0),
    );
    return {
      areaCalls: flowPlan.areaCalls,
      epicCalls: flowPlan.epicCalls,
      areaChars: chars.length ? Math.round(chars.reduce((n, c) => n + c, 0) / chars.length) : 0,
      maxFlows: flowPlan.maxFlows,
      exact: true,
    };
  }

  const areaOf = (doc: string) => flowAreaIdForDoc(doc, areaTags.get(doc) ?? []);
  const changedAreas = new Set(plan.work.map((s) => areaOf(s.doc)));
  const allAreas = new Set(plan.sections.map((s) => areaOf(s.doc)));
  return {
    areaCalls: changedAreas.size,
    epicCalls: allAreas.size > 1 ? 1 : 0,
    areaChars: GUARD_FLOWS_AREA_CHARS,
    maxFlows: 0,
    exact: false,
  };
}

/** The realization stages' planned work — see {@link planGuardRealizationStages}. */
interface GuardRealizationPlan {
  /** Matching calls (exact cache misses when `exact`, the ceiling otherwise). */
  matchCalls: number;
  /** Authoring calls: one per (changed flow, surface with a plan). */
  authorCalls: number;
  /** The ceiling both stages are priced at: every flow re-authored on every surface. */
  maxPairs: number;
  /** Flows the run will consider (known offline, else the claim-derived bound). */
  flows: number;
  /** Surfaces a flow can be realized on: runnable drivers the recipe prepares. */
  surfaces: number;
  /** Chars one surface's catalog digest carries. */
  catalogChars: number;
  /** True when the flow set AND the journey catalog were known offline. */
  exact: boolean;
}

/**
 * Plan `guard.match` + `guard.generate` — the two stages whose work count is an
 * earlier stage's OUTPUT. Exact whenever the flow corpus is settled (every area's
 * synthesis cached, so `scenarios/flows.json` IS what the run will use) AND the
 * journey snapshot exists: matching then probes the SAME `.cache/guard/match`
 * entries the run reads, and authoring counts the flows whose composition moved
 * since the manifest. Otherwise both fall back to the honest ceiling — flows ≤
 * runnable claims, one authoring call per (flow, surface).
 *
 * The ceiling is what the COST is priced at either way (`maxCalls`), so a prompt
 * change (which re-authors every flow) can never exceed the quoted bill.
 */
async function planGuardRealizationStages(
  repoRoot: string,
  plan: GuardWorkPlan,
  flowStage: GuardFlowStagePlan,
): Promise<GuardRealizationPlan> {
  const surfaces = preparedSurfaces(repoRoot);
  const catalog = readJourneyCatalog(repoRoot);
  const catalogs = catalog ? buildSurfaceCatalogs(catalog.journeys) : null;
  // Only surfaces with journeys reach the matcher; without a snapshot we cannot
  // know which do, so every prepared surface counts (a ceiling, never a shortfall).
  const matchable: SurfaceCatalog[] = catalogs
    ? surfaces.map((s) => catalogs.get(s)).filter((c): c is SurfaceCatalog => c !== undefined && c.journeys.length > 0)
    : [];
  const catalogChars = catalogs
    ? Math.max(
        ...[...catalogs.values()].map((c) => c.journeys.length * GUARD_JOURNEY_DIGEST_CHARS),
        0,
      )
    : GUARD_MATCH_CATALOG_CHARS;

  const committed = readFlowsFile(repoRoot);
  const settled = flowStage.exact && flowStage.areaCalls === 0 && committed !== null;
  if (settled && catalogs) {
    const flows: GuardFlow[] = committed.flows;
    const sectionKeyOf = new Map(
      plan.sections.map((s) => [`${s.doc} ${s.anchor}`, sectionInputsKey(s)]),
    );
    const priorByFlow = new Map((readGuardManifest(repoRoot)?.flows ?? []).map((f) => [f.flowId, f]));
    let matchCalls = 0;
    let authorCalls = 0;
    for (const flow of flows) {
      // Reconstruct the flow's realization from the SAME match cache the run reads:
      // the journeys it grounds on are what its inputs hash folds, so an uncached
      // pair is the only unknown — and it is counted as both a match and an author call.
      const journeyFingerprints: string[] = [];
      let plannedPairs = 0;
      let unknown = false;
      for (const catalog of matchable) {
        const cached = await readCachedMatch(repoRoot, flow, catalog);
        if (!cached) {
          matchCalls++;
          unknown = true;
          continue;
        }
        if (!cached.plan) continue; // an `unrealizable` surface authors nothing
        plannedPairs++;
        journeyFingerprints.push(...cached.plan.journeys.map((j) => j.fingerprint));
      }
      const inputsHash = flowGenerationInputsHash({
        flowFingerprint: flow.fingerprint,
        sectionKeys: flow.bindings.map((b) => sectionKeyOf.get(`${b.doc} ${b.anchor}`) ?? b.fingerprint),
        journeyFingerprints,
        recipeFingerprint: plan.recipeFingerprint,
      });
      const prior = priorByFlow.get(flow.id);
      // Same work selection the run makes: a settled entry that leaves a planned
      // surface unaccounted for is WORK, whatever its hash says.
      const changed =
        unknown || !prior || prior.generationInputsHash !== inputsHash || violatesSettleInvariant(prior);
      if (changed) authorCalls += unknown ? Math.max(matchable.length, 1) : plannedPairs;
    }
    const pairs = Math.max(matchable.length, 1);
    // Nothing to match and nothing to author is a KNOWN no-op — the ceiling drops to
    // zero so the stages vanish and the confirm prompt is skipped, exactly as the
    // run does nothing. Otherwise the ceiling is every flow on every surface.
    const idle = matchCalls === 0 && authorCalls === 0;
    return {
      matchCalls,
      authorCalls,
      maxPairs: idle ? 0 : flows.length * pairs,
      flows: flows.length,
      surfaces: pairs,
      catalogChars: catalogChars || GUARD_MATCH_CATALOG_CHARS,
      exact: true,
    };
  }

  // Cold: the flow count is a synthesis output. Bound it by the runnable claims
  // (milestones partition claims in the worst case) — exact when the extract cache
  // gave us the inventory, else the per-section heuristic over the whole corpus.
  const boundFlows =
    flowStage.maxFlows > 0
      ? flowStage.maxFlows
      : Math.ceil(plan.sections.length * GUARD_CLI_CLAIMS_PER_SECTION_MAX);
  const perFlow = Math.max(surfaces.length, 1);
  return {
    matchCalls: boundFlows * perFlow,
    authorCalls: boundFlows * perFlow,
    maxPairs: boundFlows * perFlow,
    flows: boundFlows,
    surfaces: perFlow,
    catalogChars: catalogChars || GUARD_MATCH_CATALOG_CHARS,
    exact: false,
  };
}

/**
 * The runnable surfaces the recipe prepares — where a scenario can exist at all.
 *
 * With no (or an unreadable) `recipe.json` the run will DISCOVER one, so the
 * estimate asks the same deterministic proposer discovery's first pass asks: it is
 * pure over the working tree (manifests, lockfiles, scripts — no LLM, no analysis
 * pass, no process), so it costs nothing here and predicts the recipe the run will
 * most likely write. The route surface is deliberately NOT supplied: deriving it
 * means a full journey-mapping pass, and it only ranks the health path — never
 * which surfaces exist. When the proposer refuses to decide, the model could
 * propose either surface, so the estimate quotes EVERY runnable one — the ceiling
 * convention the whole realization plan is priced at (never a shortfall).
 */
function preparedSurfaces(repoRoot: string): GuardDriverId[] {
  let recipe;
  try {
    recipe = loadRecipe(repoRoot, recipePath(repoRoot))?.recipe;
  } catch {
    recipe = undefined;
  }
  if (!recipe) {
    const derived = proposeRecipe(repoRoot);
    if (!derived.ok) return runnableDriverIds.filter(isRunnableDriver);
    recipe = derived.recipe;
  }
  const prepared = recipe;
  return runnableDriverIds.filter(
    (id) =>
      isRunnableDriver(id) &&
      (id === 'cli' ? prepared.entry !== undefined : id === 'api' ? prepared.api !== undefined : false),
  );
}

/**
 * Pre-flight token estimate for `guard generate`. Pass `prices` to add a ceiling
 * cost. Same convention as scan/generate: cache-aware, "N of M sections changed",
 * no stages ⇒ confirm skipped.
 *
 * Every stage reads the SAME planner the run does, so the estimate can never
 * promise work the run skips (or hide work it pays for):
 *  - EXTRACTION is exact — one call per uncached document view, across the whole
 *    universe (a flow's area needs the complete claim inventory, and an unchanged
 *    document is a cache hit that costs nothing).
 *  - SYNTHESIS shares `planFlowSynthesis` (one call per area whose claim inventory
 *    isn't already synthesized, plus at most one epic pass).
 *  - MATCHING shares `planFlowMatching` whenever the flow corpus is settled and the
 *    journey snapshot exists; otherwise it quotes the claim-derived flow bound.
 *  - AUTHORING is one call per (changed flow, surface), priced at the ceiling of
 *    every flow on every prepared surface — the bill a prompt change would produce.
 *  - FIDELITY reviews one scenario per authoring call; the evidence RETRY is at most
 *    one re-author per authored scenario, so it ranges 0..authoring.
 */
export async function estimateGuardTokens(repoRoot: string, prices?: PriceTable): Promise<LlmEstimate> {
  const plan = planGuardWork(repoRoot);
  const work = plan.work;

  // Extraction: one call per uncached view across EVERY document of the universe —
  // synthesis reads a whole area's claims, so the run extracts them all (cached).
  const docs = collectWorkDocs(repoRoot, { ...plan, work: plan.sections });
  let extractCalls = 0;
  let totalViews = 0;
  let docChars = 0;
  for (const doc of docs) {
    totalViews += countExtractViews(doc);
    extractCalls += await countUncachedExtractViews(repoRoot, doc);
    docChars += doc.content.length;
  }
  const avgViewChars = totalViews > 0 ? Math.round(Math.min(GUARD_VIEW_CHARS_CAP, docChars / totalViews)) : 0;

  const avgSectionChars = plan.sections.length
    ? Math.round(plan.sections.reduce((n, s) => n + (s.fullText || s.ownText).length, 0) / plan.sections.length)
    : 0;

  // Flow synthesis and the realization stages both share the runtime's planners, so
  // their call counts agree with what a run makes.
  const flowStage = await planGuardFlowStage(repoRoot, plan);
  const realization = await planGuardRealizationStages(repoRoot, plan, flowStage);
  // An authoring prompt carries every milestone's section text once, plus the
  // realization plan and (cli) the grounding transcripts.
  const authorBodyChars = GUARD_MILESTONES_PER_FLOW * avgSectionChars + GUARD_GROUND_TRANSCRIPT_CHARS;

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
      // Flow synthesis: one call per area whose claim inventory changed, plus at
      // most one cross-area epic pass. The flow COUNT is a synthesis output — never
      // knowable pre-run — so the stage quotes the claim-derived bound instead of
      // guessing (`bound` below); the CALL count here is exact whenever the extract
      // cache is warm, because it probes the same flows cache the run reads.
      stage: 'guardFlows',
      model: resolveModel('guard.flows', undefined, repoRoot),
      calls: flowStage.areaCalls + flowStage.epicCalls,
      minCalls: flowStage.areaCalls,
      maxCalls: flowStage.areaCalls + flowStage.epicCalls,
      avgInputTokens: tokensFromChars(GUARD_FLOWS_SYSTEM_PROMPT.length, flowStage.areaChars),
      avgOutputTokens: GUARD_FLOWS_OUTPUT_TOKENS,
      bound: flowStage.exact
        ? `flows ≤ runnable claims (${flowStage.maxFlows} today) — flow count is a synthesis output`
        : 'flows ≤ runnable claims — flow count is a synthesis output',
    },
    {
      // Matching: one call per (flow, surface with journeys). Exact when the flow
      // corpus is settled and the journey snapshot exists — it probes the same
      // match cache the run reads; otherwise the claim-derived ceiling.
      stage: 'guardMatch',
      model: resolveModel('guard.match', undefined, repoRoot),
      calls: realization.matchCalls,
      minCalls: 0,
      maxCalls: realization.maxPairs,
      avgInputTokens: tokensFromChars(GUARD_MATCH_SYSTEM_PROMPT.length, realization.catalogChars),
      avgOutputTokens: GUARD_MATCH_OUTPUT_TOKENS,
      bound: realization.exact
        ? `≤ ${realization.flows} flows × ${realization.surfaces} surface${realization.surfaces === 1 ? '' : 's'}`
        : `≤ flows × ${realization.surfaces} surface${realization.surfaces === 1 ? '' : 's'}, flows ≤ runnable claims`,
    },
    {
      // Authoring: ONE call per (flow, surface with a realization plan) — the flow
      // is the unit, so a composite flow costs one call, not one per claim.
      stage: 'guardAuthor',
      model: resolveModel('guard.generate', undefined, repoRoot),
      calls: realization.authorCalls,
      minCalls: 0,
      maxCalls: realization.maxPairs,
      avgInputTokens: tokensFromChars(GENERATE_SYSTEM_PROMPT.length, authorBodyChars),
      avgOutputTokens: GUARD_AUTHOR_OUTPUT_TOKENS,
      bound: realization.exact
        ? `≤ ${realization.flows} flows × ${realization.surfaces} surface${realization.surfaces === 1 ? '' : 's'}`
        : `≤ flows × ${realization.surfaces} surface${realization.surfaces === 1 ? '' : 's'}, flows ≤ runnable claims`,
    },
    {
      // The evidence retry: at most ONE re-author per authored scenario, and only
      // for the ones that fail birth — so it ranges 0..authoring.
      stage: 'guardRetry',
      model: resolveModel('guard.retry', undefined, repoRoot),
      calls: 0,
      minCalls: 0,
      maxCalls: realization.maxPairs,
      avgInputTokens: tokensFromChars(GENERATE_SYSTEM_PROMPT.length, authorBodyChars + GUARD_SCENARIO_YAML_CHARS),
      avgOutputTokens: GUARD_AUTHOR_OUTPUT_TOKENS,
      bound: 'one re-author per scenario that fails birth',
    },
    {
      // Seed drafting (item 66): ONE call, and only when the last generate left
      // flows blocked on missing data while the recipe has an `api` block and no
      // `api.seed` yet. Deliberately NOT probed for the database (gate (b)) or the
      // cache: both need the working-tree ANALYSIS pass, which an estimate must not
      // pay for — so this over-counts by at most one call on a repo with no
      // datastore, which is exactly what a CEILING estimate is allowed to do.
      stage: 'guardSeed',
      model: resolveModel('guard.seed', undefined, repoRoot),
      calls: seedDraftCalls(repoRoot),
      minCalls: 0,
      maxCalls: seedDraftCalls(repoRoot),
      avgInputTokens: tokensFromChars(SEED_SYSTEM_PROMPT.length, GUARD_SEED_BODY_CHARS),
      avgOutputTokens: GUARD_SEED_OUTPUT_TOKENS,
      bound: 'one draft (plus at most one evidence retry) when flows are blocked on missing data',
    },
    {
      stage: 'guardFidelity',
      model: resolveModel('guard.fidelity', undefined, repoRoot),
      // One review per green scenario — at most one per authoring call. Not
      // cache-aware: scenario content is unknown until authoring + birth run.
      calls: realization.authorCalls,
      minCalls: 0,
      maxCalls: realization.maxPairs,
      // A review carries the system prompt + every milestone's section text + one YAML.
      avgInputTokens: tokensFromChars(
        FIDELITY_SYSTEM_PROMPT.length,
        GUARD_MILESTONES_PER_FLOW * avgSectionChars + GUARD_SCENARIO_YAML_CHARS,
      ),
      avgOutputTokens: GUARD_FIDELITY_OUTPUT_TOKENS,
    },
  ];

  return estimateStageTokens(withLabels(stages), changedSubject(plan.sections.length, work.length, 'section'), prices);
}

/**
 * Will `guard generate` draft a seed (item 66)? The cheap half of the gate: the
 * LAST generate's missing-data gaps, an `api` block, and no `api.seed` yet. The
 * gaps are an authoring OUTPUT, so this run's own count is unknowable pre-flight —
 * the previous run's is the honest proxy, and it is exactly the count the CLI's
 * `guard seed` view shows.
 */
function seedDraftCalls(repoRoot: string): number {
  try {
    const recipe = loadRecipe(repoRoot, recipePath(repoRoot))?.recipe;
    if (!recipe?.api || recipe.api.seed) return 0;
    return missingDataBlockedFlows(repoRoot).length > 0 ? 1 : 0;
  } catch {
    return 0; // a broken recipe fails the run before any stage spends
  }
}

/** Confirm-copy subject surfacing how many of `total` units are changed vs cached. */
function changedSubject(total: number, changed: number, noun: string): string {
  const plural = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  if (total === 0) return `0 ${noun}s`;
  if (changed >= total) return plural(total);
  if (changed === 0) return `all ${plural(total)} cached`;
  return `${changed} of ${plural(total)} changed`;
}
