/**
 * Pre-flight TOKEN estimates for `spec scan` (curate) and `guard generate` /
 * `guard setup`. Lives in core (the leaf packages would be circular). All feed
 * the shared {@link estimateStageTokens}, so the calculation lives in one place
 * and the CLI + dashboard render identical numbers.
 *
 * Deterministic, no LLM, no transport. SCAN models SESSIONS:
 * per session kind the estimate counts cache-MISSING work items by probing the
 * SAME caches with the SAME exported key builders the run uses (instructions
 * fingerprint included), then turns items into calls with per-kind expected
 * turn counts — `minCalls` = items (one turn each), `maxCalls` = items ×
 * (maxResumes+1) × turns (the budget ceiling), expected = items ×
 * EXPECTED_TURNS. One model runs every session, so the scan estimate
 * carries no per-stage tier labels.
 *
 * Per-kind system prompts and briefing builders are the REAL ones (imported
 * from the session modules), so sizes can't drift from what a run pays.
 */

import {
  applySubjectAttribution,
  discoverDocs,
  prefilterDocs,
  readCorpusDecisions,
  readRepoIdentityInput,
  readSourcesFile,
  resolveRepoIdentity,
  groupByArea,
  type AreaTag,
  type DocAreaTags,
  type DocCandidate,
} from '@truecourse/spec-consolidator';
import { getCacheEntry } from '@truecourse/llm';
import type { z } from 'zod';
import { WRAP_UP_TURNS, type SessionBudget } from '@truecourse/agent-loop';
import {
  CURATE_DOC_BUDGET,
  CURATE_DOC_CACHE_NAME,
  CURATE_DOC_SESSION_KIND,
  CURATE_DOC_SYSTEM_PROMPT,
  DocVerdictSchema,
  curateDocBriefing,
  curateDocCacheKey,
  type DocVerdict,
} from '../spec-scan/curate-doc.js';
import {
  AreaSettlementSchema,
  SETTLE_AREAS_BUDGET,
  SETTLE_AREAS_CACHE_NAME,
  SETTLE_AREAS_SESSION_KIND,
  SETTLE_AREAS_SYSTEM_PROMPT,
  applySettlement,
  canonicalDocTags,
  collectAreaVocab,
  settleAreasBriefing,
  settleAreasCacheKey,
  settleAreasGate,
  type AreaSettlement,
} from '../spec-scan/settle-areas.js';
import {
  OVERLAP_SESSION_BUDGET,
  OVERLAP_SESSION_CACHE_NAME,
  OVERLAP_SESSION_KIND,
  OVERLAP_SESSION_SYSTEM_PROMPT,
  OverlapOutcomeSchema,
  deriveOverlapWorkItems,
  overlapBriefing,
  overlapSessionCacheKey,
  type OverlapWorkItem,
} from '../spec-scan/overlap.js';
import {
  ORCHESTRATE_BUDGET,
  ORCHESTRATE_SYSTEM_PROMPT,
  SPEC_SCAN_ORCHESTRATE_SESSION_KIND,
  applyScopeVerdicts,
  buildScanScopeUniverse,
  orchestrateBriefing,
  scopeCoverage,
} from '../spec-scan/orchestrate.js';
import { buildScanUniverse, instructionsFingerprint } from '../spec-scan/tools.js';
import type { ScanStep } from '../spec-scan/run.js';
import { SESSION_MODEL_CLAUDE_CODE } from './session-driver.js';
import { apiModeModel } from '../../config/global-config.js';
import {
  planGuardWork,
  proposeRecipe,
  recipeCacheKey,
  RECIPE_CACHE_NAME,
  RecipeProposalSchema,
  SEED_CACHE_NAME,
  settledFingerprints,
  computeSeedStepFingerprint,
  authFingerprint,
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
  FIDELITY_SYSTEM_PROMPT,
  TRIAGE_SYSTEM_PROMPT as GUARD_TRIAGE_SYSTEM_PROMPT,
  FLOWS_SYSTEM_PROMPT as GUARD_FLOWS_SYSTEM_PROMPT,
  MATCH_SYSTEM_PROMPT as GUARD_MATCH_SYSTEM_PROMPT,
  type FlowAreaDocInput,
  type GuardSetupOnlyStep,
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
  computeRecipeFingerprint,
  loadDependencyCatalog,
  loadRecipe,
  readJourneyCatalog,
  readManifest as readGuardManifest,
  recipePath,
  type Recipe,
} from '@truecourse/guard-runner';
import {
  AUTH_PROOF_BUDGET,
  AUTH_PROOF_SESSION_KIND,
  DEPENDENCY_CATALOG_BUDGET,
  DEPENDENCY_CATALOG_SESSION_KIND,
  RECIPE_REPAIR_BUDGET,
  RECIPE_REPAIR_SESSION_KIND,
  SEED_SESSION_BUDGET,
  SEED_SESSION_KIND,
  SeedSessionOutcomeSchema,
  seedSessionCacheKey,
} from '../guard-setup/index.js';
import type { RepoIdentity } from '@truecourse/spec-consolidator';
import type { LlmEstimate } from '../../commands/analyze-core.js';
import type { LlmTransportMode } from '../../config/global-config.js';
import { resolveModel } from '../../config/llm-models.js';
import { estimateStageTokens, tokensFromChars, type StageCallEstimate } from './token-estimator.js';
import type { PriceTable } from './model-prices.js';

// Heuristic assumptions, surfaced as ranges where they bite.
const KEEP_RATE = 0.9; // fraction of curated docs a session keeps (approximation path)
const AVG_AREA_SIZE = 4; // docs per area (sizes the changed-docs share of overlap areas)

// Human-readable labels for the confirm UI — users don't know the internal stage ids.
const STAGE_LABELS: Record<string, string> = {
  // scan (session kinds)
  [SPEC_SCAN_ORCHESTRATE_SESSION_KIND]: 'Settling scan scope',
  [CURATE_DOC_SESSION_KIND]: 'Curating docs',
  [SETTLE_AREAS_SESSION_KIND]: 'Settling areas',
  [OVERLAP_SESSION_KIND]: 'Flagging overlaps',
  // guard setup (session kinds)
  [RECIPE_REPAIR_SESSION_KIND]: 'Repairing the recipe',
  [DEPENDENCY_CATALOG_SESSION_KIND]: 'Classifying dependencies',
  [SEED_SESSION_KIND]: 'Preparing data + principals',
  [AUTH_PROOF_SESSION_KIND]: 'Verifying supplied auth',
  // guard generate
  guardRecipe: 'Discovering recipe',
  guardExtract: 'Extracting claims',
  guardFlows: 'Synthesizing flows',
  guardMatch: 'Matching flows',
  guardAuthor: 'Authoring scenarios',
  guardRetry: 'Re-authoring on evidence',
  guardFidelity: 'Reviewing fidelity',
  guardTriage: 'Triaging failures',
};
const withLabels = (stages: StageCallEstimate[]): StageCallEstimate[] =>
  stages.map((s) => ({ ...s, label: STAGE_LABELS[s.stage] ?? s.stage }));

// --- Session-kind modeling constants ------------------------
// PROVISIONAL expected turn counts per session kind, to be re-grounded on real
// transcript data once a few scans have run. They drive the EXPECTED cost only;
// the ceiling is always the budget's hard limit.
const EXPECTED_TURNS: Record<string, number> = {
  [SPEC_SCAN_ORCHESTRATE_SESSION_KIND]: 6,
  [CURATE_DOC_SESSION_KIND]: 2,
  [SETTLE_AREAS_SESSION_KIND]: 4,
  [OVERLAP_SESSION_KIND]: 8,
  [RECIPE_REPAIR_SESSION_KIND]: 8,
  [DEPENDENCY_CATALOG_SESSION_KIND]: 6,
  [SEED_SESSION_KIND]: 12,
  [AUTH_PROOF_SESSION_KIND]: 3,
};
// PROVISIONAL prior-turns growth: each turn's input carries the turns before it
// (tool results, the model's own reasoning); this approximates the average
// extra chars a mid-session turn pays beyond the briefing.
const SESSION_TURN_GROWTH_CHARS = 1_500;
// Rough output tokens per TURN, per kind (tool calls are short; the outcome
// object dominates the last turn).
const SESSION_OUTPUT_TOKENS: Record<string, number> = {
  [SPEC_SCAN_ORCHESTRATE_SESSION_KIND]: 300,
  [CURATE_DOC_SESSION_KIND]: 120,
  [SETTLE_AREAS_SESSION_KIND]: 250,
  [OVERLAP_SESSION_KIND]: 400,
  [RECIPE_REPAIR_SESSION_KIND]: 300,
  [DEPENDENCY_CATALOG_SESSION_KIND]: 500,
  [SEED_SESSION_KIND]: 3000, // the outcome carries the whole script
  [AUTH_PROOF_SESSION_KIND]: 150,
};
/** Cold-cache fallback for an overlap briefing's size (outlines, no bodies). */
const OVERLAP_BRIEFING_FALLBACK_CHARS = 8_000;

/** One session kind's work, rolled into the `StageCallEstimate` shape the
 *  CLI/dashboard already render. `calls` = expected TURNS (items × expected
 *  turns per session); `minCalls` = items (one turn each); `maxCalls` = the
 *  budget's hard limit (items × ((maxResumes+1) × turns + the shell's
 *  wrap-up window)). */
function sessionKindStage(input: {
  kind: string;
  model: string;
  items: number;
  minItems?: number;
  maxItems?: number;
  budget: SessionBudget;
  systemPromptChars: number;
  briefingChars: number;
  bound?: string;
}): StageCallEstimate {
  const expectedTurns = EXPECTED_TURNS[input.kind] ?? 4;
  const ceilingTurns = (input.budget.maxResumes + 1) * input.budget.turns + WRAP_UP_TURNS;
  const stage: StageCallEstimate = {
    stage: input.kind,
    model: input.model,
    calls: input.items * expectedTurns,
    expectedCalls: input.items * expectedTurns,
    minCalls: input.minItems ?? input.items,
    maxCalls: (input.maxItems ?? input.items) * ceilingTurns,
    avgInputTokens: tokensFromChars(
      input.systemPromptChars,
      input.briefingChars + Math.round((expectedTurns / 2) * SESSION_TURN_GROWTH_CHARS),
    ),
    avgOutputTokens: SESSION_OUTPUT_TOKENS[input.kind] ?? 300,
  };
  if (input.bound) stage.bound = input.bound;
  return stage;
}

/** A schema-gated cache probe — the read half of `cachedSessionOutcome`, so the
 *  estimate counts a MISS exactly when the run would spend a session. */
async function probeSessionCache<T>(
  repoRoot: string,
  cacheName: string,
  key: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const raw = await getCacheEntry(repoRoot, cacheName, key).catch(() => null);
  if (raw === null) return null;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The one model every scan session runs on: the configured api-mode
 *  flagship, or claude-code mode's pinned tier. No per-stage tiers. */
function sessionModel(mode?: LlmTransportMode): string {
  return (mode !== undefined ? apiModeModel(mode) : apiModeModel()) ?? SESSION_MODEL_CLAUDE_CODE;
}

const mean = (ns: number[]): number =>
  ns.length === 0 ? 0 : Math.round(ns.reduce((a, b) => a + b, 0) / ns.length);

/**
 * Pre-flight token estimate for `spec scan`. Pass `prices` to add a ceiling
 * cost. Models SESSIONS: per kind, `items` = cache-missing
 * work items, probed against the run's own cache names + key builders — the
 * instructions fingerprint included, so editing a standing instruction shows
 * up here as the full re-scan it really is. A warmed cache yields an EMPTY
 * estimate (no stages) and the confirm prompt is skipped.
 *
 * Where an upstream miss makes downstream work unknowable (changed docs feed
 * the vocabulary that feeds the areas), the affected kind degrades to an
 * honest range instead of a guess dressed as a count.
 */
export async function estimateScanTokens(
  repoRoot: string,
  prices?: PriceTable,
  opts: { identity?: RepoIdentity | null; mode?: LlmTransportMode; only?: ScanStep } = {},
): Promise<LlmEstimate> {
  const model = sessionModel(opts.mode);

  // Load the user's decisions so the estimate probes the SAME doc set the run
  // classifies (manual includes/excludes, scope verdicts, instructions — all of
  // them shift what the run spends).
  const decisions = readCorpusDecisions(repoRoot);
  const manualIncludes = decisions.manualIncludes ?? [];
  const manualSet = new Set(manualIncludes);
  const manualExcludes = new Set(decisions.manualExcludes ?? []);

  // Discovery, scope-aware and gitless, exactly as before (`lastTouched` feeds
  // no estimate input and costs one `git log` per doc).
  const docsAll = discoverDocs(repoRoot, { skipGit: true, scope: loadSpecScope(repoRoot) });

  // The orchestrator pre-pass, mirrored: a covered universe spends no session;
  // an uncovered one spends exactly one (no cache for that kind — the pre-pass
  // IS its cheap path).
  const scanScope = buildScanScopeUniverse(buildScanUniverse(docsAll), readSourcesFile(repoRoot).sources);
  const coverage = scopeCoverage(scanScope, decisions.scopeVerdicts ?? []);
  const orchestrateItems = coverage.covered ? 0 : 1;

  // Scope verdicts excluded BEFORE anything below — same order (and the same
  // manual-include pins) as the run.
  const docs = applyScopeVerdicts(docsAll, decisions.scopeVerdicts ?? [], scanScope.sources, manualIncludes);

  // Identity AFTER discovery + scope, as the run resolves it; it enters every
  // curate-doc cache key, so estimate and run must agree. Explicit null (EE)
  // is honored.
  const identity =
    opts.identity !== undefined
      ? opts.identity
      : resolveRepoIdentity({ ...readRepoIdentityInput(repoRoot), docs });

  const instructions = decisions.instructions ?? [];
  const instructionParts = [instructionsFingerprint(instructions)];

  // ---- curate-doc: exact — probe the run's own per-doc cache ----------------
  const { toClassify } = prefilterDocs(docs, manualIncludes, identity);
  const curateItems = toClassify.filter((d) => !manualExcludes.has(d.path));
  const cachedVerdicts = new Map<string, DocVerdict>();
  const curateMissDocs: DocCandidate[] = [];
  for (const doc of curateItems) {
    const cached = await probeSessionCache(
      repoRoot,
      CURATE_DOC_CACHE_NAME,
      curateDocCacheKey({ identity, doc }, instructionParts),
      DocVerdictSchema,
    );
    if (cached) cachedVerdicts.set(doc.path, cached);
    else curateMissDocs.push(doc);
  }
  const missCount = curateMissDocs.length;

  // ---- The cached fold, reconstructed (det) ---------------------------------
  // The kept set from CACHED verdicts, through the same subject-attribution
  // backstop the run's fold applies. (The alias reinstatement backstop is
  // deliberately skipped here — expected ~0 hits, and it reads every doc body.)
  const keptTags = new Map<string, AreaTag[]>();
  for (const [path, v] of cachedVerdicts) {
    const attributed = applySubjectAttribution({
      path,
      subject: v.subject,
      include: v.keep,
      reason: v.reason,
      category: v.category,
    });
    if (attributed.include || manualSet.has(path)) keptTags.set(path, v.areas);
  }
  const canonicalByPath = new Map<string, AreaTag[]>(
    [...keptTags].map(([path, tags]) => [path, canonicalDocTags(tags)]),
  );
  const vocab = collectAreaVocab(canonicalByPath);

  // ---- settle-areas: gate + probe when the vocabulary is knowable -----------
  const gate = keptTags.size > 0 && settleAreasGate(vocab);
  let settlement: AreaSettlement | null = null;
  let settleItems = 0;
  let settleMin = 0;
  let settleMax = 0;
  if (missCount === 0) {
    if (gate) {
      settlement = await probeSessionCache(
        repoRoot,
        SETTLE_AREAS_CACHE_NAME,
        settleAreasCacheKey(vocab, instructionParts),
        AreaSettlementSchema,
      );
      settleItems = settlement ? 0 : 1;
      settleMin = settleItems;
      settleMax = settleItems;
    }
  } else {
    // Changed docs may move the label sets, so the settlement key is unknowable:
    // the honest answer is a 0..1 range, expected 1.
    settleItems = 1;
    settleMin = 0;
    settleMax = 1;
  }

  // ---- overlap: group from cached tags, probe per-cluster keys --------------
  // Exactly the run's derivation whenever everything upstream is cached (the
  // settlement applied, the same grouper, the same collision pairing and
  // clustering via deriveOverlapWorkItems, the same key builder); with
  // upstream misses the probed part still holds and the changed docs' share is
  // added as a range.
  const applied = settlement ? applySettlement(settlement, vocab) : null;
  const vocabMap = applied?.vocab ?? { products: {}, concerns: {} };
  if (applied) {
    for (const [ref, perDoc] of applied.reassignments) {
      const tags = canonicalByPath.get(ref);
      if (!tags) continue;
      canonicalByPath.set(
        ref,
        tags.map((tag) => (perDoc.has(tag.concern) ? { ...tag, concern: perDoc.get(tag.concern)! } : tag)),
      );
    }
  }
  const keptDocs = curateItems.filter((d) => keptTags.has(d.path));
  const groupTags = new Map<string, DocAreaTags>(
    keptDocs.map((d) => [d.path, { tags: canonicalByPath.get(d.path) ?? [] }]),
  );
  const grouped = groupByArea(keptDocs, groupTags, decisions.manualAreas ?? [], vocabMap);
  const overlapItems: OverlapWorkItem[] = deriveOverlapWorkItems(grouped.areas, keptDocs, vocabMap);
  const overlapMissItems: OverlapWorkItem[] = [];
  for (const item of overlapItems) {
    const cached = await probeSessionCache(
      repoRoot,
      OVERLAP_SESSION_CACHE_NAME,
      overlapSessionCacheKey(item, instructionParts),
      OverlapOutcomeSchema,
    );
    if (!cached) overlapMissItems.push(item);
  }
  // Exact only when the whole upstream is settled: every doc verdict cached AND
  // the settlement either cached or not needed. A pending settlement can
  // reshape the areas, so its presence downgrades the overlap count to a range.
  const overlapExact = missCount === 0 && (settlement !== null || !gate);
  // Comparison clusters the CHANGED docs will land in — unknowable before
  // their sessions run; sized by the mean-area heuristic and carried as a range.
  const changedClusters = missCount > 0 ? Math.ceil(Math.round(missCount * KEEP_RATE) / AVG_AREA_SIZE) : 0;
  const overlapExpectedItems = overlapMissItems.length + changedClusters;
  // A fully settled upstream with zero misses is a KNOWN no-op — the ceiling
  // drops to zero so the stage vanishes and a warmed cache yields an EMPTY
  // estimate (confirm skipped). An unsettled upstream keeps the honest
  // ceiling: a fresh settlement can re-key every cluster.
  const overlapIdle = overlapExpectedItems === 0 && overlapExact;
  const overlapMaxItems = overlapIdle ? 0 : overlapItems.length + changedClusters;
  const clustersTotal = overlapItems.length + changedClusters;

  // ---- roll-up ---------------------------------------------------------------
  const stages: StageCallEstimate[] = [
    sessionKindStage({
      kind: SPEC_SCAN_ORCHESTRATE_SESSION_KIND,
      model,
      items: orchestrateItems,
      budget: ORCHESTRATE_BUDGET,
      systemPromptChars: ORCHESTRATE_SYSTEM_PROMPT.length,
      briefingChars:
        orchestrateItems > 0 ? orchestrateBriefing(scanScope, decisions, coverage).length : 0,
      bound: 'its scope verdicts + instructions re-key every stage below',
    }),
    sessionKindStage({
      kind: CURATE_DOC_SESSION_KIND,
      model,
      items: missCount,
      budget: CURATE_DOC_BUDGET,
      systemPromptChars: CURATE_DOC_SYSTEM_PROMPT.length,
      briefingChars: mean(curateMissDocs.map((d) => curateDocBriefing(d, identity, instructions).length)),
      bound: 'keys fold the standing instructions — editing one re-scans every doc',
    }),
    sessionKindStage({
      kind: SETTLE_AREAS_SESSION_KIND,
      model,
      items: settleItems,
      minItems: settleMin,
      maxItems: settleMax,
      budget: SETTLE_AREAS_BUDGET,
      systemPromptChars: SETTLE_AREAS_SYSTEM_PROMPT.length,
      briefingChars:
        settleItems > 0 ? settleAreasBriefing(vocab, buildScanUniverse(docs), instructions).length : 0,
    }),
    sessionKindStage({
      kind: OVERLAP_SESSION_KIND,
      model,
      items: overlapExpectedItems,
      minItems: overlapMissItems.length,
      maxItems: overlapMaxItems,
      budget: OVERLAP_SESSION_BUDGET,
      systemPromptChars: OVERLAP_SESSION_SYSTEM_PROMPT.length,
      briefingChars:
        mean(overlapMissItems.map((i) => overlapBriefing(i, instructions).length)) ||
        (overlapExpectedItems > 0 ? OVERLAP_BRIEFING_FALLBACK_CHARS : 0),
      bound: overlapExact
        ? `${overlapMissItems.length} of ${Math.max(clustersTotal, overlapMissItems.length)} comparison${clustersTotal === 1 ? '' : 's'} changed`
        : `~${overlapExpectedItems} of ~${clustersTotal} comparison${clustersTotal === 1 ? '' : 's'} changed (changed docs may reshape clusters)`,
    }),
  ];

  const changedDocs = missCount;
  // Single-step mode prices only the chosen step — prior steps replay from
  // cache (a miss fails the run loudly, never spends), later ones don't start.
  const SCAN_STEP_KIND: Record<ScanStep, string> = {
    orchestrate: SPEC_SCAN_ORCHESTRATE_SESSION_KIND,
    curate: CURATE_DOC_SESSION_KIND,
    settle: SETTLE_AREAS_SESSION_KIND,
    overlap: OVERLAP_SESSION_KIND,
  };
  const included = opts.only ? stages.filter((s) => s.stage === SCAN_STEP_KIND[opts.only!]) : stages;
  return estimateStageTokens(
    withLabels(included),
    changedSubject(curateItems.length, changedDocs, 'doc'),
    prices,
  );
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
const GUARD_TRIAGE_OUTPUT_TOKENS = 300; // ~a verdict + confidence + brief + recommendation
const GUARD_SCENARIO_YAML_CHARS = 2400; // ~one flow scenario's YAML body (the review input)
// The seed session's briefing carries the parsed schema + the route surface —
// the largest single briefing of any setup session.
const GUARD_SEED_BODY_CHARS = 6000;
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
// --- guard setup session-modeling constants ---------------------------------
// PROVISIONAL prompt/briefing sizes per setup session kind. Deliberately
// constants rather than imports: most of these kinds keep their system prompts
// module-private, and the estimate only needs an order-of-magnitude input size.
// Re-ground on transcript data once a few session-era setups have run.
const SETUP_KIND_CHARS: Record<string, { system: number; briefing: number }> = {
  [RECIPE_REPAIR_SESSION_KIND]: { system: 2_600, briefing: 4_500 },
  [DEPENDENCY_CATALOG_SESSION_KIND]: { system: 3_200, briefing: 4_000 },
  [SEED_SESSION_KIND]: { system: 5_500, briefing: GUARD_SEED_BODY_CHARS + 9_000 },
  [AUTH_PROOF_SESSION_KIND]: { system: 1_800, briefing: 1_200 },
};

/**
 * Pre-flight estimate for `truecourse guard setup` — SESSION math, mirroring
 * the scan estimate: per session kind, `items` counts the work a run would
 * actually start, probed with the run's own machinery wherever it is knowable
 * OFFLINE:
 *
 *  - SKIP-WHEN-SETTLED is read from the real `guard/setup.json` spine
 *    (`settledFingerprints`) with the real fingerprint builders — the recipe,
 *    seed and auth fingerprints are pure tree reads. The CATALOG fingerprint
 *    folds the detection snapshot (an analysis pass the estimate must never pay
 *    for), so that step degrades to an honest 0..1 range.
 *  - CACHES are probed with the REAL exported key builders where the key is
 *    computable offline: the repair proposal (`guard/recipe`) and the seed
 *    draft (`guard/seed`).
 *
 * ONE MODEL for every session; expected turns are the provisional per-kind
 * constants, the ceiling is always the budget's hard limit.
 *
 * `only` (the `--only-<step>` flags) prices ONLY that step's kind: prior steps
 * replay from disk and later ones never start, so quoting them would ask the
 * user to approve a bill this run cannot produce.
 */
export async function estimateGuardSetup(
  repoRoot: string,
  prices?: PriceTable,
  opts: { refresh?: boolean; mode?: LlmTransportMode; only?: GuardSetupOnlyStep } = {},
): Promise<LlmEstimate> {
  const model = sessionModel(opts.mode);
  const refresh = opts.refresh === true;
  let recipe: Recipe | undefined;
  try {
    recipe = loadRecipe(repoRoot, recipePath(repoRoot))?.recipe;
  } catch {
    recipe = undefined; // a broken recipe is re-derived, so it costs the session
  }
  const settled = settledFingerprints(repoRoot, refresh);

  // ---- recipe repair: loop only on the failure path -------------------------
  // Zero whenever a recipe exists (discovery reuses it) or the settled proposal
  // is cached; when discovery WILL run, the deterministic proposer (pure over
  // the tree — the same first pass the run makes) predicts whether the model is
  // even reached, and a verify failure it cannot predict keeps the 0..1 range.
  let repairItems = 0;
  let repairMax = 0;
  if (refresh || !recipe) {
    const cached = await probeSessionCache(
      repoRoot,
      RECIPE_CACHE_NAME,
      recipeCacheKey(computeRecipeFingerprint(repoRoot)),
      RecipeProposalSchema,
    );
    repairMax = cached ? 0 : 1;
    repairItems = cached ? 0 : proposeRecipe(repoRoot).ok ? 0 : 1;
  }

  // ---- dependency catalog: fingerprint folds the detection snapshot ---------
  const catalogSettledRow = settled('catalog') !== null;
  const catalogItems = catalogSettledRow ? 0 : 1;
  // A settled row zeroes the ceiling too — same convention as the seed's cache
  // probe: a detection snapshot that moves between estimate and run is unpriced.
  const catalogMax = catalogSettledRow ? 0 : 1;

  // ---- seed: real cache key when the step will run --------------------------
  const seedGateOpen =
    !recipe || (recipe.api !== undefined && (recipe.api.seed === undefined || refresh));
  const seedSettled = recipe !== undefined && settled('seed') === computeSeedStepFingerprint(repoRoot);
  let seedItems = 0;
  let seedMax = 0;
  if (seedGateOpen && !seedSettled) {
    const cached =
      recipe !== undefined
        ? await probeSessionCache(
            repoRoot,
            SEED_CACHE_NAME,
            seedSessionCacheKey(computeSeedStepFingerprint(repoRoot)),
            SeedSessionOutcomeSchema,
          )
        : null;
    seedMax = cached ? 0 : 1;
    seedItems = cached ? 0 : 1;
  }

  // ---- auth proof: one session per supplied catalog entry (never cached) ----
  const suppliedEntries = loadDependencyCatalog(repoRoot).dependencies.filter(
    (d) => d.class === 'supplied',
  ).length;
  const authRuns =
    suppliedEntries > 0 &&
    recipe?.entry !== undefined &&
    settled('auth') !== authFingerprint(repoRoot);
  const authItems = authRuns ? suppliedEntries : 0;

  const setupStage = (input: {
    kind: string;
    budget: SessionBudget;
    items: number;
    minItems?: number;
    maxItems?: number;
    bound?: string;
  }): StageCallEstimate => {
    const chars = SETUP_KIND_CHARS[input.kind] ?? { system: 3_000, briefing: 4_000 };
    return sessionKindStage({
      kind: input.kind,
      model,
      items: input.items,
      minItems: input.minItems ?? 0,
      maxItems: input.maxItems ?? input.items,
      budget: input.budget,
      systemPromptChars: chars.system,
      briefingChars: chars.briefing,
      ...(input.bound ? { bound: input.bound } : {}),
    });
  };

  const stages: StageCallEstimate[] = [
    setupStage({
      kind: RECIPE_REPAIR_SESSION_KIND,
      budget: RECIPE_REPAIR_BUDGET,
      items: repairItems,
      maxItems: repairMax,
      bound: 'loop only on the failure path — a deterministic proposal that verifies spends nothing',
    }),
    setupStage({
      kind: DEPENDENCY_CATALOG_SESSION_KIND,
      budget: DEPENDENCY_CATALOG_BUDGET,
      items: catalogItems,
      maxItems: catalogMax,
      bound: catalogSettledRow
        ? 'settled last run; re-runs only if detection or the catalog moved (unknowable offline)'
        : 'one classification session over the whole detection',
    }),
    setupStage({
      kind: SEED_SESSION_KIND,
      budget: SEED_SESSION_BUDGET,
      items: seedItems,
      maxItems: seedMax,
      bound: 'prove-by-execution; skipped when no database schema is detected (unknowable offline)',
    }),
    setupStage({
      kind: AUTH_PROOF_SESSION_KIND,
      budget: AUTH_PROOF_BUDGET,
      items: authItems,
      maxItems: authItems,
      bound: 'one proof per supplied catalog entry; never cached (proof-class)',
    }),
  ];
  // Single-step mode prices the chosen step's kind and nothing else.
  const SETUP_STEP_KINDS: Record<GuardSetupOnlyStep, string> = {
    recipe: RECIPE_REPAIR_SESSION_KIND,
    catalog: DEPENDENCY_CATALOG_SESSION_KIND,
    seed: SEED_SESSION_KIND,
    auth: AUTH_PROOF_SESSION_KIND,
  };
  const included = opts.only ? stages.filter((s) => s.stage === SETUP_STEP_KINDS[opts.only!]) : stages;
  return estimateStageTokens(withLabels(included), 'preparation', prices);
}

export async function estimateGuardTokens(
  repoRoot: string,
  prices?: PriceTable,
  opts: { mode?: LlmTransportMode } = {},
): Promise<LlmEstimate> {
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
      model: resolveModel('guard.recipe', undefined, repoRoot, opts.mode),
      // One discovery call only when no recipe.json exists yet.
      calls: plan.recipeMissing ? 1 : 0,
      avgInputTokens: tokensFromChars(RECIPE_SYSTEM_PROMPT.length, 2000),
      avgOutputTokens: 120,
    },
    {
      stage: 'guardExtract',
      model: resolveModel('guard.extract', undefined, repoRoot, opts.mode),
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
      model: resolveModel('guard.flows', undefined, repoRoot, opts.mode),
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
      model: resolveModel('guard.match', undefined, repoRoot, opts.mode),
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
      model: resolveModel('guard.generate', undefined, repoRoot, opts.mode),
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
      model: resolveModel('guard.retry', undefined, repoRoot, opts.mode),
      calls: 0,
      minCalls: 0,
      maxCalls: realization.maxPairs,
      avgInputTokens: tokensFromChars(GENERATE_SYSTEM_PROMPT.length, authorBodyChars + GUARD_SCENARIO_YAML_CHARS),
      avgOutputTokens: GUARD_AUTHOR_OUTPUT_TOKENS,
      bound: 'one re-author per scenario that fails birth',
    },
    {
      stage: 'guardFidelity',
      model: resolveModel('guard.fidelity', undefined, repoRoot, opts.mode),
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
    {
      // Failing-test triage: one Opus judgment per test that fails birth,
      // after every round settles. The failure count is unknowable pre-run — like
      // the retry stage it ranges 0..authored pairs, and the ceiling drives the
      // quoted cost.
      stage: 'guardTriage',
      model: resolveModel('guard.triage', undefined, repoRoot, opts.mode),
      calls: 0,
      minCalls: 0,
      maxCalls: realization.maxPairs,
      // A triage carries the system prompt + the failing milestone's section text +
      // one scenario YAML + the request-surface grounding transcript.
      avgInputTokens: tokensFromChars(
        GUARD_TRIAGE_SYSTEM_PROMPT.length,
        avgSectionChars + GUARD_SCENARIO_YAML_CHARS + GUARD_GROUND_TRANSCRIPT_CHARS,
      ),
      avgOutputTokens: GUARD_TRIAGE_OUTPUT_TOKENS,
      bound: 'one triage per test that fails birth',
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
