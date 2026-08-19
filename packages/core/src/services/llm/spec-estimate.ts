/**
 * Pre-flight TOKEN estimates for `spec scan` (curate) and `guard generate` /
 * `guard setup`. Lives in core (the leaf packages would be circular). All feed
 * the shared {@link estimateStageTokens}, so the calculation lives in one place
 * and the CLI + dashboard render identical numbers.
 *
 * Deterministic, no LLM, no transport. SCAN models SESSIONS (plan 02 step 7):
 * per session kind the estimate counts cache-MISSING work items by probing the
 * SAME caches with the SAME exported key builders the run uses (instructions
 * fingerprint included), then turns items into calls with per-kind expected
 * turn counts — `minCalls` = items (one turn each), `maxCalls` = items ×
 * (maxResumes+1) × turns (the budget ceiling), expected = items ×
 * EXPECTED_TURNS. One model runs every session (§3.4), so the scan estimate
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
  widenedOverlapDocs,
  type AreaTag,
  type DocAreaTags,
  type DocCandidate,
} from '@truecourse/spec-consolidator';
import { getCacheEntry } from '@truecourse/llm';
import type { z } from 'zod';
import type { SessionBudget } from '@truecourse/agent-loop';
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
  interfacesFingerprint,
  computeSeedStepFingerprint,
  authFingerprint,
  collectWorkDocs,
  snapExtraction,
  readCorpusAreaTags,
  buildFlowAreas,
  buildSurfaceCatalogs,
  readCachedMatch,
  readFlowsFile,
  sectionInputsKey,
  flowGenerationInputsHash,
  flowAreaIdForDoc,
  workerCacheKey,
  FlowSetSchema,
  RECIPE_SYSTEM_PROMPT,
  MATCH_SYSTEM_PROMPT as GUARD_MATCH_SYSTEM_PROMPT,
  type FlowAreaDocInput,
  type FlowClaimInput,
  type GuardWorkPlan,
  type SurfaceCatalog,
} from '@truecourse/guard-generator';
import {
  EXTRACT_SESSION_BUDGET,
  EXTRACT_SESSION_CACHE_NAME,
  EXTRACT_SESSION_KIND,
  EXTRACT_SESSION_SYSTEM_PROMPT,
  extractSessionBriefing,
  extractSessionCacheKey,
  FLOWS_SESSION_BUDGET,
  FLOWS_SESSION_CACHE_NAME,
  FLOWS_SESSION_KIND,
  FLOWS_SESSION_SYSTEM_PROMPT,
  flowsSessionCacheKey,
  FLOW_WORKER_BUDGET,
  FLOW_WORKER_CACHE_NAME,
  FLOW_WORKER_CLI_SYSTEM_PROMPT,
  FLOW_WORKER_SESSION_KIND,
  flowWorkerPromptFingerprint,
  CachedWorkerEntrySchema,
  FIDELITY_SESSION_BUDGET,
  FIDELITY_SESSION_KIND,
  FIDELITY_SESSION_SYSTEM_PROMPT,
} from '../guard-generate/index.js';
import {
  loadSpecScope,
  isRunnableDriver,
  runnableDriverIds,
  violatesSettleInvariant,
  dismissedClaimKey,
  ExtractOutcomeSchema,
  type GuardDriverId,
  type GuardFlow,
} from '@truecourse/shared';
import {
  computeRecipeFingerprint,
  loadDependencyCatalog,
  loadRecipe,
  readGuardDecisions,
  readAuthoredInterfaceCatalog,
  readInterfaceCatalog,
  readMergedInterfaceCatalog,
  readManifest as readGuardManifest,
  recipePath,
  staleAuthoredPlaceDiagnostics,
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
import {
  RECONCILE_INTERFACES_BUDGET,
  RECONCILE_INTERFACES_SESSION_KIND,
} from '../guard-setup/reconcile-interfaces.js';
import {
  INTERFACE_AUTHOR_BUDGET,
  INTERFACE_AUTHOR_SESSION_KIND,
  planWorkItems,
} from '../interface-author/index.js';
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
  // scan (session kinds — plan 02)
  [SPEC_SCAN_ORCHESTRATE_SESSION_KIND]: 'Settling scan scope',
  [CURATE_DOC_SESSION_KIND]: 'Curating docs',
  [SETTLE_AREAS_SESSION_KIND]: 'Settling areas',
  [OVERLAP_SESSION_KIND]: 'Flagging overlaps',
  // guard setup (session kinds — plan 03)
  [RECIPE_REPAIR_SESSION_KIND]: 'Repairing the recipe',
  [DEPENDENCY_CATALOG_SESSION_KIND]: 'Classifying dependencies',
  [RECONCILE_INTERFACES_SESSION_KIND]: 'Reconciling cli interfaces',
  [INTERFACE_AUTHOR_SESSION_KIND]: 'Authoring web tasks',
  [SEED_SESSION_KIND]: 'Preparing data + principals',
  [AUTH_PROOF_SESSION_KIND]: 'Verifying supplied auth',
  // guard generate (session kinds — plan 04; recipe + match are still one-shots)
  guardRecipe: 'Discovering recipe',
  guardMatch: 'Matching flows',
  [EXTRACT_SESSION_KIND]: 'Extracting claims',
  [FLOWS_SESSION_KIND]: 'Synthesizing flows',
  [FLOW_WORKER_SESSION_KIND]: 'Working flows',
  [FIDELITY_SESSION_KIND]: 'Reviewing fidelity',
};
const withLabels = (stages: StageCallEstimate[]): StageCallEstimate[] =>
  stages.map((s) => ({ ...s, label: STAGE_LABELS[s.stage] ?? s.stage }));

// --- Session-kind modeling constants (plan 02 step 7) ------------------------
// PROVISIONAL expected turn counts per session kind, to be re-grounded on real
// transcript data once a few scans have run. They drive the EXPECTED cost only;
// the ceiling is always the budget's hard limit.
const EXPECTED_TURNS: Record<string, number> = {
  [SPEC_SCAN_ORCHESTRATE_SESSION_KIND]: 6,
  [CURATE_DOC_SESSION_KIND]: 2,
  [SETTLE_AREAS_SESSION_KIND]: 4,
  [OVERLAP_SESSION_KIND]: 8,
  // guard setup (plan 03) — provisional, to re-ground on transcript data.
  [RECIPE_REPAIR_SESSION_KIND]: 8,
  [DEPENDENCY_CATALOG_SESSION_KIND]: 6,
  [RECONCILE_INTERFACES_SESSION_KIND]: 5,
  [INTERFACE_AUTHOR_SESSION_KIND]: 15, // measured mean of the 2026-08-18 documenso run
  [SEED_SESSION_KIND]: 12,
  [AUTH_PROOF_SESSION_KIND]: 3,
  // guard generate (plan 04 step 20) — PROVISIONAL, to re-ground on transcript
  // data once a few session-era generates have run.
  [EXTRACT_SESSION_KIND]: 3,
  [FLOWS_SESSION_KIND]: 4,
  [FLOW_WORKER_SESSION_KIND]: 8,
  [FIDELITY_SESSION_KIND]: 1,
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
  // guard setup (plan 03) — provisional.
  [RECIPE_REPAIR_SESSION_KIND]: 300,
  [DEPENDENCY_CATALOG_SESSION_KIND]: 500,
  [RECONCILE_INTERFACES_SESSION_KIND]: 300,
  [INTERFACE_AUTHOR_SESSION_KIND]: 800,
  [SEED_SESSION_KIND]: 3000, // the outcome carries the whole script (≈ GUARD_SEED_OUTPUT_TOKENS below)
  [AUTH_PROOF_SESSION_KIND]: 150,
  // guard generate (plan 04 step 20) — provisional.
  [EXTRACT_SESSION_KIND]: 1500, // the outcome carries a doc's whole claim set
  [FLOWS_SESSION_KIND]: 1200, // an area's flows + no-flow reasons
  [FLOW_WORKER_SESSION_KIND]: 700, // ~one scenario YAML per run/submit turn
  [FIDELITY_SESSION_KIND]: 60, // a verdict + a one-sentence mismatch
};
/** Cold-cache fallback for an overlap briefing's size (outlines, no bodies). */
const OVERLAP_BRIEFING_FALLBACK_CHARS = 8_000;

/** One session kind's work, rolled into the `StageCallEstimate` shape the
 *  CLI/dashboard already render. `calls` = expected TURNS (items × expected
 *  turns per session); `minCalls` = items (one turn each); `maxCalls` = the
 *  budget ceiling (items × (maxResumes+1) × turns). */
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
  const ceilingTurns = (input.budget.maxResumes + 1) * input.budget.turns;
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

/** The one model every scan session runs on (§3.4): the configured api-mode
 *  flagship, or claude-code mode's pinned tier. No per-stage tiers. */
function sessionModel(mode?: LlmTransportMode): string {
  return (mode !== undefined ? apiModeModel(mode) : apiModeModel()) ?? SESSION_MODEL_CLAUDE_CODE;
}

const mean = (ns: number[]): number =>
  ns.length === 0 ? 0 : Math.round(ns.reduce((a, b) => a + b, 0) / ns.length);

/**
 * Pre-flight token estimate for `spec scan`. Pass `prices` to add a ceiling
 * cost. Models SESSIONS (plan 02 step 7): per kind, `items` = cache-missing
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
  opts: { identity?: RepoIdentity | null; mode?: LlmTransportMode } = {},
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

  // Scope verdicts excluded BEFORE anything below — same order as the run.
  const docs = applyScopeVerdicts(docsAll, decisions.scopeVerdicts ?? [], scanScope.sources);

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

  // ---- overlap: group from cached tags, probe per-area keys -----------------
  // Exactly the run's derivation whenever everything upstream is cached (the
  // settlement applied, the same grouper, the same widened net, the same key
  // builder); with upstream misses the probed part still holds and the changed
  // docs' share is added as a range.
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
  const byPath = new Map(keptDocs.map((d) => [d.path, d]));
  const overlapItems: OverlapWorkItem[] = [];
  for (const area of grouped.areas) {
    const areaDocs = area.docRefs.map((ref) => byPath.get(ref)).filter((d): d is DocCandidate => d !== undefined);
    const widened = widenedOverlapDocs(area, keptDocs, vocabMap);
    if (areaDocs.length + widened.length < 2 || areaDocs.length === 0) continue;
    overlapItems.push({ areaId: area.id, concern: area.concern, docs: areaDocs, widened });
  }
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
  // Areas the CHANGED docs will land in — unknowable before their sessions run;
  // sized by the mean-area heuristic and carried as a range.
  const changedAreas = missCount > 0 ? Math.ceil(Math.round(missCount * KEEP_RATE) / AVG_AREA_SIZE) : 0;
  const overlapExpectedItems = overlapMissItems.length + changedAreas;
  // A fully settled upstream with zero misses is a KNOWN no-op — the ceiling
  // drops to zero so the stage vanishes and a warmed cache yields an EMPTY
  // estimate (confirm skipped). An unsettled upstream keeps the honest
  // ceiling: a fresh settlement can re-key every area.
  const overlapIdle = overlapExpectedItems === 0 && overlapExact;
  const overlapMaxItems = overlapIdle ? 0 : overlapItems.length + changedAreas;
  const areasTotal = overlapItems.length + changedAreas;

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
      briefingChars: settleItems > 0 ? settleAreasBriefing(vocab, instructions).length : 0,
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
        ? `${overlapMissItems.length} of ${Math.max(areasTotal, overlapMissItems.length)} area${areasTotal === 1 ? '' : 's'} changed`
        : `~${overlapExpectedItems} of ~${areasTotal} area${areasTotal === 1 ? '' : 's'} changed (changed docs may reshape areas)`,
    }),
  ];

  const changedDocs = missCount;
  return estimateStageTokens(
    withLabels(stages),
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
const GUARD_SCENARIO_YAML_CHARS = 2400; // ~one flow scenario's YAML body (the fidelity child's input)
// Seed drafting: the prompt carries the parsed schema + the blocked
// claims, and the reply is a whole script file — the largest single output of any
// guard stage.
const GUARD_SEED_BODY_CHARS = 6000;
const GUARD_SEED_OUTPUT_TOKENS = 3000;
// Grounded worker briefings inject real empty-sandbox probe transcripts (zero
// extra LLM calls — it just enlarges the briefing).
const GUARD_GROUND_TRANSCRIPT_CHARS = 4000;
// A flows-session briefing reads one area's claims + outlines (no document text
// at all), so its input is small; the cold-cache fallback assumes a mid-sized area.
const GUARD_FLOWS_AREA_CHARS = 6000;
// Matching reads one flow's milestones + one surface's catalog DIGEST (ids, entries,
// step summaries — never code); a digest line is short by construction.
const GUARD_INTERFACE_DIGEST_CHARS = 220; // ~one interface's digest block
const GUARD_MATCH_CATALOG_CHARS = 12_000; // cold-cache fallback for a catalog digest
const GUARD_MATCH_OUTPUT_TOKENS = 300; // ~a plan over a handful of milestones
// A worker briefing carries every milestone's section text once; sections
// average this much when the corpus isn't readable offline.
const GUARD_MILESTONES_PER_FLOW = 3; // rough milestones a synthesized flow carries
// Cold-cache fallback for an extract-session briefing (outline + first chunk).
const GUARD_EXTRACT_BRIEFING_FALLBACK_CHARS = 14_000;

/** The extract + flows SESSION stages' planned work — see {@link planGuardSessionStages}. */
interface GuardSessionWorkPlan {
  /** Cache-missing `guard-generate.extract` sessions (one per doc). Exact —
   *  probed against the run's own `guard/extract-session` keys. */
  extractItems: number;
  /** Docs in the universe (the extract pool's denominator). */
  extractDocs: number;
  /** Mean briefing chars across the extract misses (0 when none). */
  extractBriefingChars: number;
  /** Per-area `guard-generate.flows` sessions (exact when `exact`; one per
   *  changed area otherwise). */
  areaCalls: number;
  /** Epic-session ceiling: 1 when more than one area can yield flows, else 0. */
  epicCalls: number;
  /** Average briefing chars one area session carries. */
  areaChars: number;
  /** Runnable claims — the honest upper bound on synthesized flows (0 when unknown). */
  maxFlows: number;
  /** True when the claim inventory was knowable offline (every extract-session
   *  entry cached) and the REAL flows keys were probed. */
  exact: boolean;
}

/**
 * Plan the extract + flows SESSION stages (plan 04 steps 15/16, estimate per
 * step 20). Extraction is exact by construction: one session per doc, probed
 * against the run's own `guard/extract-session` cache with the run's own key
 * builder. Flow synthesis is exact whenever EVERY doc's extraction is cached:
 * the claim inventory is then known offline, so this reconstructs the SAME
 * filtered claim set the run feeds synthesis (snap → dismissals → runnable →
 * driver-prepared), groups the SAME areas, and probes the SAME `guard/flows`
 * session keys. A doc not yet extracted degrades the flows count to one call
 * per area with a changed section — what a cold run pays.
 */
async function planGuardSessionStages(repoRoot: string, plan: GuardWorkPlan): Promise<GuardSessionWorkPlan> {
  // A generate with no changed section returns before any stage runs, so zero
  // sessions is exact — not an under-count.
  if (plan.work.length === 0) {
    return { extractItems: 0, extractDocs: 0, extractBriefingChars: 0, areaCalls: 0, epicCalls: 0, areaChars: 0, maxFlows: 0, exact: true };
  }
  const areaTags = readCorpusAreaTags(repoRoot);
  // An area's synthesis reads ALL its claims, so the estimate needs every document
  // of the universe — not only the ones with a changed section.
  const docs = collectWorkDocs(repoRoot, { ...plan, work: plan.sections });

  // The run's own claim gates, reproduced so the flows keys hash the same
  // inventory: dismissed claims drop, only runnable claims on a PREPARED driver
  // enter synthesis (see the extraction fold in `generateGuards`).
  const dismissed = new Set(
    readGuardDecisions(repoRoot).dismissedClaims.map((d) => dismissedClaimKey(d.doc, d.anchor, d.title)),
  );
  const preparedSet = new Set(preparedSurfaces(repoRoot));

  let extractItems = 0;
  const missBriefingChars: number[] = [];
  const inputs: FlowAreaDocInput[] = [];
  let inventoryKnown = true;
  for (const doc of docs) {
    const cached = await probeSessionCache(
      repoRoot,
      EXTRACT_SESSION_CACHE_NAME,
      extractSessionCacheKey(doc),
      ExtractOutcomeSchema,
    );
    if (!cached) {
      extractItems++;
      missBriefingChars.push(extractSessionBriefing(doc).length);
      inventoryKnown = false;
      continue;
    }
    // The fold re-snap, exactly as the seam applies it — the cache holds the
    // raw outcome (model anchors), never a pre-snapped one.
    const snapped = snapExtraction(cached, doc.sections);
    const live: FlowClaimInput[] = [];
    for (const c of snapped.claims) {
      if (dismissed.has(dismissedClaimKey(doc.doc, c.sectionAnchor, c.claim))) continue;
      if (!isRunnableDriver(c.driver)) continue;
      if (!preparedSet.has(c.driver)) continue;
      live.push({
        doc: doc.doc,
        anchor: c.sectionAnchor,
        title: c.claim,
        driver: c.driver,
        ...(c.needs && c.needs.length > 0 ? { needs: c.needs } : {}),
      });
    }
    inputs.push({
      doc: doc.doc,
      areaTags: areaTags.get(doc.doc) ?? [],
      outline: doc.sections.map((s) => ({ anchor: s.anchor, headingText: s.headingText, level: s.level })),
      untestable: snapped.untestable.map((u) => ({ anchor: u.sectionAnchor, reason: u.reason })),
      claims: live,
    });
  }
  const extractBriefingChars =
    mean(missBriefingChars) || (extractItems > 0 ? GUARD_EXTRACT_BRIEFING_FALLBACK_CHARS : 0);

  if (inventoryKnown) {
    const areas = buildFlowAreas(inputs);
    let areaCalls = 0;
    for (const area of areas) {
      const cached = await probeSessionCache(repoRoot, FLOWS_SESSION_CACHE_NAME, flowsSessionCacheKey(area), FlowSetSchema);
      if (!cached) areaCalls++;
    }
    const areasWithClaims = areas.filter((a) => a.claims.length > 0).length;
    const chars = areas.map(
      (a) =>
        a.claims.reduce((n, c) => n + c.doc.length + c.anchor.length + c.title.length + 40, 0) +
        a.docs.reduce((n, d) => n + d.outline.reduce((m, e) => m + e.anchor.length + e.headingText.length + 6, 0), 0),
    );
    return {
      extractItems,
      extractDocs: docs.length,
      extractBriefingChars,
      areaCalls,
      // The epic key hashes the area sessions' OUTPUT digests — unknowable
      // offline — so the epic session is always quoted as its 0..1 ceiling.
      epicCalls: areasWithClaims > 1 ? 1 : 0,
      areaChars: chars.length ? Math.round(chars.reduce((n, c) => n + c, 0) / chars.length) : 0,
      maxFlows: areas.reduce((n, a) => n + a.claims.length, 0),
      exact: true,
    };
  }

  const areaOf = (doc: string) => flowAreaIdForDoc(doc, areaTags.get(doc) ?? []);
  const changedAreas = new Set(plan.work.map((s) => areaOf(s.doc)));
  const allAreas = new Set(plan.sections.map((s) => areaOf(s.doc)));
  return {
    extractItems,
    extractDocs: docs.length,
    extractBriefingChars,
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
  /** Flow-worker SESSIONS a run would start: one per (changed flow, surface with
   *  a plan) whose `guard/generate` worker-cache entry misses. */
  workerItems: number;
  /** The ceiling both stages are priced at: every flow re-worked on every surface. */
  maxPairs: number;
  /** Flows the run will consider (known offline, else the claim-derived bound). */
  flows: number;
  /** Surfaces a flow can be realized on: runnable drivers the recipe prepares. */
  surfaces: number;
  /** Chars one surface's catalog digest carries. */
  catalogChars: number;
  /** True when the flow set AND the interface catalog were known offline. */
  exact: boolean;
}

/**
 * Plan `guard.match` (still a one-shot) + the flow-worker sessions — the two
 * stages whose work count is an earlier stage's OUTPUT. Exact whenever the flow
 * corpus is settled (every area's synthesis cached, so `scenarios/flows.json`
 * IS what the run will use) AND the interface snapshot exists: matching then
 * probes the SAME `.cache/guard/match` entries the run reads, and the worker
 * count probes the SAME `guard/generate` worker-cache keys (the kept
 * `workerCacheKey` recipe under the session prompt fingerprints) for the flows
 * whose composition moved since the manifest. Otherwise both fall back to the
 * honest ceiling — flows ≤ runnable claims, one worker per (flow, surface).
 *
 * The ceiling is what the COST is priced at either way (`maxCalls`), so a prompt
 * change (which re-works every flow) can never exceed the quoted bill. A
 * TAINTED flow skips its cache read at run time — the estimate cannot read the
 * taint ledger's future, so a tainted hit is a small under-count, bounded by
 * the ceiling.
 */
async function planGuardRealizationStages(
  repoRoot: string,
  plan: GuardWorkPlan,
  flowStage: GuardSessionWorkPlan,
): Promise<GuardRealizationPlan> {
  const surfaces = preparedSurfaces(repoRoot);
  // The MERGED catalog — the matcher runs against both halves, so an estimate that
  // read the derived one alone would price no work at all for the hand-authored
  // surfaces (every web surface there is).
  const catalog = readMergedInterfaceCatalog(repoRoot);
  const catalogs = catalog ? buildSurfaceCatalogs(catalog.interfaces) : null;
  // Only surfaces with interfaces reach the matcher; without a snapshot we cannot
  // know which do, so every prepared surface counts (a ceiling, never a shortfall).
  const matchable: SurfaceCatalog[] = catalogs
    ? surfaces.map((s) => catalogs.get(s)).filter((c): c is SurfaceCatalog => c !== undefined && c.interfaces.length > 0)
    : [];
  const catalogChars = catalogs
    ? Math.max(
        ...[...catalogs.values()].map((c) => c.interfaces.length * GUARD_INTERFACE_DIGEST_CHARS),
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
    let workerItems = 0;
    for (const flow of flows) {
      // Reconstruct the flow's realization from the SAME match cache the run reads:
      // the interfaces it grounds on are what its inputs hash folds, so an uncached
      // pair is the only unknown — and it is counted as both a match call and a
      // worker session.
      const interfaceFingerprints: string[] = [];
      const plannedPairs: { surface: GuardDriverId; fingerprints: string[] }[] = [];
      let unknown = false;
      for (const catalog of matchable) {
        const cached = await readCachedMatch(repoRoot, flow, catalog);
        if (!cached) {
          matchCalls++;
          unknown = true;
          continue;
        }
        if (!cached.plan) continue; // an `unrealizable` surface starts no worker
        const fingerprints = cached.plan.interfaces.map((j) => j.fingerprint);
        plannedPairs.push({ surface: catalog.surface, fingerprints });
        interfaceFingerprints.push(...fingerprints);
      }
      const sectionKeys = flow.bindings.map((b) => sectionKeyOf.get(`${b.doc} ${b.anchor}`) ?? b.fingerprint);
      const inputsHash = flowGenerationInputsHash({
        flowFingerprint: flow.fingerprint,
        sectionKeys,
        interfaceFingerprints,
        recipeFingerprint: plan.recipeFingerprint,
      });
      const prior = priorByFlow.get(flow.id);
      // Same work selection the run makes: a settled entry that leaves a planned
      // surface unaccounted for is WORK, whatever its hash says.
      const changed =
        unknown || !prior || prior.generationInputsHash !== inputsHash || violatesSettleInvariant(prior);
      if (!changed) continue;
      if (unknown) {
        workerItems += Math.max(matchable.length, 1);
        continue;
      }
      // Cache-aware per (flow, surface): a `settled`/`blocked` worker entry is a
      // hit (a settled one still pays a deterministic confirmation run — free in
      // token terms); a miss is one session.
      for (const pair of plannedPairs) {
        const key = workerCacheKey(
          flowWorkerPromptFingerprint(pair.surface),
          flow,
          pair.surface,
          sectionKeys,
          pair.fingerprints,
          plan.recipeFingerprint,
        );
        const hit = await probeSessionCache(repoRoot, FLOW_WORKER_CACHE_NAME, key, CachedWorkerEntrySchema);
        if (!hit) workerItems++;
      }
    }
    const pairs = Math.max(matchable.length, 1);
    // Nothing to match and nothing to work is a KNOWN no-op — the ceiling drops to
    // zero so the stages vanish and the confirm prompt is skipped, exactly as the
    // run does nothing. Otherwise the ceiling is every flow on every surface.
    const idle = matchCalls === 0 && workerItems === 0;
    return {
      matchCalls,
      workerItems,
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
    workerItems: boundFlows * perFlow,
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
 * means a full interface-mapping pass, and it only ranks the health path — never
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

// --- guard setup session-modeling constants (plan 03 retirement) -------------
// PROVISIONAL prompt/briefing sizes per setup session kind. Deliberately
// constants rather than imports: most of these kinds keep their system prompts
// module-private, and the estimate only needs an order-of-magnitude input size.
// Re-ground on transcript data once a few session-era setups have run.
const SETUP_KIND_CHARS: Record<string, { system: number; briefing: number }> = {
  [RECIPE_REPAIR_SESSION_KIND]: { system: 2_600, briefing: 4_500 },
  [DEPENDENCY_CATALOG_SESSION_KIND]: { system: 3_200, briefing: 4_000 },
  [RECONCILE_INTERFACES_SESSION_KIND]: { system: 2_700, briefing: 1_500 },
  [INTERFACE_AUTHOR_SESSION_KIND]: { system: 8_000, briefing: 12_000 },
  [SEED_SESSION_KIND]: { system: 5_500, briefing: GUARD_SEED_BODY_CHARS + 9_000 },
  [AUTH_PROOF_SESSION_KIND]: { system: 1_800, briefing: 1_200 },
};

/**
 * Pre-flight estimate for `truecourse guard setup` — SESSION math (plan 03,
 * mirroring the scan estimate's rework): per session kind, `items` counts the
 * work a run would actually start, probed with the run's own machinery
 * wherever it is knowable OFFLINE:
 *
 *  - SKIP-WHEN-SETTLED is read from the real `guard/setup.json` spine
 *    (`settledFingerprints`) with the real fingerprint builders — the recipe,
 *    interfaces, seed and auth fingerprints are pure tree reads. The CATALOG
 *    fingerprint folds the detection snapshot (an analysis pass the estimate
 *    must never pay for), so that step degrades to an honest 0..1 range.
 *  - CACHES are probed with the REAL exported key builders where the key is
 *    computable offline: the repair proposal (`guard/recipe`) and the seed
 *    draft (`guard/seed`). The reconcile key folds run-time diagnostics —
 *    unknowable here, quoted as a 0..1 range with expected 0 (an agreeing
 *    union asks nothing).
 *  - The AUTHORING work list is the real `planWorkItems` over the on-disk
 *    catalog halves, stale places excluded — exactly the selection the step
 *    makes.
 *
 * ONE MODEL for every session (§3.4); expected turns are the provisional
 * per-kind constants, the ceiling is always the budget's hard limit.
 */
export async function estimateGuardSetup(
  repoRoot: string,
  prices?: PriceTable,
  opts: { refresh?: boolean; replace?: boolean; mode?: LlmTransportMode } = {},
): Promise<LlmEstimate> {
  const model = sessionModel(opts.mode);
  const refresh = opts.refresh === true;
  const replace = opts.replace === true;
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

  // ---- interfaces: reconcile + authoring, both off the on-disk halves -------
  const derivedCatalog = readInterfaceCatalog(repoRoot);
  const authoredCatalog = readAuthoredInterfaceCatalog(repoRoot);
  const interfacesSettled =
    !replace && authoredCatalog !== null && settled('interfaces') === interfacesFingerprint(repoRoot);
  const staleAuthoredIds = new Set(
    staleAuthoredPlaceDiagnostics(derivedCatalog, authoredCatalog).map((d) => d.subject),
  );
  const authorable = planWorkItems(derivedCatalog, authoredCatalog).filter(
    (item) => !staleAuthoredIds.has(item.place.id) && (replace || item.existing.length === 0),
  );
  const authorItems = interfacesSettled ? 0 : authorable.length;
  const reconcileMax = interfacesSettled ? 0 : 1;

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
      kind: RECONCILE_INTERFACES_SESSION_KIND,
      budget: RECONCILE_INTERFACES_BUDGET,
      items: 0,
      maxItems: reconcileMax,
      bound: 'runs only when the cli tree and probe derivations disagree — usually never',
    }),
    setupStage({
      kind: INTERFACE_AUTHOR_SESSION_KIND,
      budget: INTERFACE_AUTHOR_BUDGET,
      items: authorItems,
      maxItems: authorItems,
      bound: interfacesSettled
        ? 'unchanged places + an authored catalog — skipped'
        : `one session per unauthored screen (${authorable.length} today)`,
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
  return estimateStageTokens(withLabels(stages), 'preparation', prices);
}

/**
 * Pre-flight token estimate for `guard generate`. Pass `prices` to add a ceiling
 * cost. Same convention as scan/generate: cache-aware, "N of M sections changed",
 * no stages ⇒ confirm skipped.
 *
 * Every stage reads the SAME planner the run does (plan 04 — the LLM stages are
 * agent SESSIONS now, `guard.match` and recipe discovery the two remaining
 * one-shots), so the estimate can never promise work the run skips (or hide
 * work it pays for):
 *  - EXTRACTION is exact — one session per doc whose `guard/extract-session`
 *    entry misses, probed with the run's own key builder across the whole
 *    universe (a flow's area needs the complete claim inventory, and an
 *    unchanged document is a cache hit that costs nothing).
 *  - SYNTHESIS shares `planGuardSessionStages`: one session per area whose
 *    `guard/flows` session key misses, plus at most one epic session (its key
 *    hashes the area sessions' OUTPUT digests, so it is always a 0..1 range).
 *    Exact whenever every doc's extraction is cached; otherwise one call per
 *    changed area.
 *  - MATCHING shares `planGuardRealizationStages` whenever the flow corpus is
 *    settled and the interface snapshot exists; otherwise it quotes the
 *    claim-derived flow bound.
 *  - The FLOW WORKERS are one session per (changed flow, surface with a plan)
 *    whose worker-cache entry misses, priced at the ceiling of every flow on
 *    every prepared surface — the bill a prompt change would produce. Each
 *    worker authors, runs and adjudicates in one loop, subsuming the retired
 *    author/retry/triage stages.
 *  - FIDELITY is one depth-1 child per green submission — at most one per
 *    worker, so it ranges 0..workers.
 */
export async function estimateGuardTokens(
  repoRoot: string,
  prices?: PriceTable,
  opts: { mode?: LlmTransportMode } = {},
): Promise<LlmEstimate> {
  const model = sessionModel(opts.mode);
  const plan = planGuardWork(repoRoot);
  const work = plan.work;

  const avgSectionChars = plan.sections.length
    ? Math.round(plan.sections.reduce((n, s) => n + (s.fullText || s.ownText).length, 0) / plan.sections.length)
    : 0;

  // The session planners share the run's own cache names + key builders, so the
  // estimate's item counts agree with what a run starts.
  const sessions = await planGuardSessionStages(repoRoot, plan);
  const realization = await planGuardRealizationStages(repoRoot, plan, sessions);
  // A worker briefing carries every milestone's section text once, plus the
  // realization plan and (cli) the grounding transcripts.
  const workerBodyChars = GUARD_MILESTONES_PER_FLOW * avgSectionChars + GUARD_GROUND_TRANSCRIPT_CHARS;

  const pairBound = realization.exact
    ? `≤ ${realization.flows} flows × ${realization.surfaces} surface${realization.surfaces === 1 ? '' : 's'}`
    : `≤ flows × ${realization.surfaces} surface${realization.surfaces === 1 ? '' : 's'}, flows ≤ runnable claims`;

  const stages: StageCallEstimate[] = [
    {
      stage: 'guardRecipe',
      model: resolveModel('guard.recipe', undefined, repoRoot, opts.mode),
      // One discovery call only when no recipe.json exists yet.
      calls: plan.recipeMissing ? 1 : 0,
      avgInputTokens: tokensFromChars(RECIPE_SYSTEM_PROMPT.length, 2000),
      avgOutputTokens: 120,
    },
    // Claim extraction: one `guard-generate.extract` session per doc whose
    // per-doc `guard/extract-session` entry misses — exact (the run's own keys).
    sessionKindStage({
      kind: EXTRACT_SESSION_KIND,
      model,
      items: sessions.extractItems,
      budget: EXTRACT_SESSION_BUDGET,
      systemPromptChars: EXTRACT_SESSION_SYSTEM_PROMPT.length,
      briefingChars: sessions.extractBriefingChars,
      bound: `${sessions.extractItems} of ${sessions.extractDocs} doc${sessions.extractDocs === 1 ? '' : 's'} changed`,
    }),
    // Flow synthesis: one session per area whose claim inventory changed, plus
    // at most one epic session (its key hashes the areas' OUTPUT digests, so it
    // is always a 0..1 range). Exact whenever the extract-session cache is warm.
    sessionKindStage({
      kind: FLOWS_SESSION_KIND,
      model,
      items: sessions.areaCalls + sessions.epicCalls,
      minItems: sessions.areaCalls,
      maxItems: sessions.areaCalls + sessions.epicCalls,
      budget: FLOWS_SESSION_BUDGET,
      systemPromptChars: FLOWS_SESSION_SYSTEM_PROMPT.length,
      briefingChars: sessions.areaChars || (sessions.areaCalls + sessions.epicCalls > 0 ? GUARD_FLOWS_AREA_CHARS : 0),
      bound: sessions.exact
        ? `flows ≤ runnable claims (${sessions.maxFlows} today) — flow count is a synthesis output`
        : 'flows ≤ runnable claims — flow count is a synthesis output',
    }),
    {
      // Matching (still a one-shot): one call per (flow, surface with
      // interfaces). Exact when the flow corpus is settled and the interface
      // snapshot exists — it probes the same match cache the run reads;
      // otherwise the claim-derived ceiling.
      stage: 'guardMatch',
      model: resolveModel('guard.match', undefined, repoRoot, opts.mode),
      calls: realization.matchCalls,
      minCalls: 0,
      maxCalls: realization.maxPairs,
      avgInputTokens: tokensFromChars(GUARD_MATCH_SYSTEM_PROMPT.length, realization.catalogChars),
      avgOutputTokens: GUARD_MATCH_OUTPUT_TOKENS,
      bound: pairBound,
    },
    // The flow workers: ONE session per (changed flow, surface with a plan)
    // whose kept `guard/generate` worker-cache entry misses. The session
    // authors, runs and adjudicates in one loop — it subsumes the retired
    // author/retry/triage stages, which is why no separate stages for those
    // appear here any more.
    sessionKindStage({
      kind: FLOW_WORKER_SESSION_KIND,
      model,
      items: realization.workerItems,
      maxItems: realization.maxPairs,
      budget: FLOW_WORKER_BUDGET,
      systemPromptChars: FLOW_WORKER_CLI_SYSTEM_PROMPT.length,
      briefingChars: workerBodyChars,
      bound: pairBound,
    }),
    // The fidelity CHILD: one depth-1 session per green submission — at most
    // one per worker (plus in-loop revisions, covered by the ceiling). Not
    // cache-aware: scenario content is unknown until the workers run.
    sessionKindStage({
      kind: FIDELITY_SESSION_KIND,
      model,
      items: realization.workerItems,
      minItems: 0,
      maxItems: realization.maxPairs,
      budget: FIDELITY_SESSION_BUDGET,
      systemPromptChars: FIDELITY_SESSION_SYSTEM_PROMPT.length,
      briefingChars: GUARD_MILESTONES_PER_FLOW * avgSectionChars + GUARD_SCENARIO_YAML_CHARS,
      bound: 'one review per green submission',
    }),
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
