/**
 * Top-level orchestrator. Wires every stage of the consolidator
 * together: discovery → slice → extract (cached) → merge → detect
 * modules → write claims.json. Plus the side-channel reads/writes for
 * `decisions.json` (Q12 batch apply) and the cache layer.
 *
 * One operating mode: `consolidate()` runs the full pipeline and writes
 * `.truecourse/specs/claims.json` — the structured snapshot every
 * downstream stage consumes. No per-section LLM render, no markdown
 * materialization. The Sonnet `section-render` round-trip is gone.
 *
 * Cache integration is via runner-wrappers, so the per-block LLM calls
 * only fire on cache misses. Same hash inputs → same outputs → no LLM
 * cost for unchanged docs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readBlockCache, writeBlockCache } from './cache.js';
import { detectModules, SHARED_MODULE, type DetectedModule } from './module-detector.js';
import { extractClaims, type ExtractResult } from './extractor.js';
import { mergeClaims, type DecidedConflict, type MergeResult } from './merger.js';
import { spawnRunner, type BlockRunner, type BlockRunResult } from './runner.js';
import type { LlmTransport } from '@truecourse/shared/llm';
import type { Block } from './slicer.js';
import {
  DecisionsFileSchema,
  type Claim,
  type Conflict,
  type ConflictCandidate,
  type DecisionsFile,
  type Topic,
} from './types.js';
import {
  ClaimsFileEntry,
  entryFromClaim,
  writeClaims,
} from './claims-store.js';
import { detectVersionChains, materializeManualChains, type VersionChain } from './version-chain.js';
import {
  existingChainPairKeys,
  runChainRecheck,
  selectRecheckPairs,
  type ChainRecheckRunner,
} from './chain-recheck.js';
import {
  explainConflicts,
  type ConflictExplainerRunner,
} from './conflict-explainer.js';
import {
  resolveConflicts,
  type ConflictResolverRunner,
} from './conflict-resolver.js';
import { filterByRelevance, type RelevanceRunner } from './relevance-filter.js';
import {
  detectVersionChainsViaLlm,
  type ChainRunner,
} from './version-chain-llm.js';
import { discoverDocs, type DocCandidate } from './discovery.js';

// Debug timing — gated behind TRUECOURSE_DEBUG_TIMING=1. Writes to
// stderr so it doesn't collide with --json stdout payloads.
function perfNow(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}
function debugLog(msg: string): void {
  if (process.env.TRUECOURSE_DEBUG_TIMING) {
    process.stderr.write(`[tc-timing] ${msg}\n`);
  }
}

/**
 * Per-stage model overrides for the consolidator. Each field is the
 * model string (`haiku` / `sonnet` / `opus` or a fully-qualified ID)
 * that the corresponding stage's spawn runner should pass to
 * `claude --model`. Undefined fields fall back to the runner's own
 * defaults — the CLI/dashboard layer resolves these via
 * `@truecourse/core/config/llm-models`.
 */
export interface ConsolidateModels {
  chainDetect?: string;
  claimExtract?: string;
  chainRecheck?: string;
  conflictExplain?: string;
  conflictResolve?: string;
  relevance?: string;
  /** Forwarded as `--fallback-model` to every stage. */
  fallback?: string;
}

export interface ConsolidateOptions {
  /**
   * Per-stage model overrides. CLI and dashboard server resolve these
   * via core's `resolveModel('spec.xxx')` and pass the result in. Only
   * applied to spawn runners we create here — explicit `*Runner`
   * overrides take precedence (tests inject stubs that way).
   */
  models?: ConsolidateModels;
  /**
   * LLM transport for the auto-created runners (block extraction, relevance,
   * chain, conflict explain/resolve). Defaults to the cli transport (spawn
   * `claude -p`). The CLI/dashboard pass an agent transport for headless runs.
   * Explicit `*Runner` overrides (test stubs) ignore this.
   */
  transport?: LlmTransport;
  /** Override block-extraction runner. Tests pass a stub. */
  blockRunner?: BlockRunner;
  /**
   * Override the LLM chain-detection runner. Tests pass a stub.
   * When omitted, an LLM-backed runner is spawned automatically. Set
   * `disableLlmChainDetection: true` to skip the LLM call entirely.
   */
  chainRunner?: ChainRunner;
  /**
   * When true, skip the LLM chain-detection step. The deterministic
   * detector still runs. Useful for tests and offline runs.
   */
  disableLlmChainDetection?: boolean;
  /**
   * Override the conflict-triggered chain re-check runner. Tests pass
   * a stub. When omitted, an LLM-backed runner is spawned automatically.
   */
  chainRecheckRunner?: ChainRecheckRunner;
  /**
   * When true, skip the conflict-triggered chain re-check. Disables
   * the second-pass LLM call that scans cross-doc PRD conflicts. The
   * deterministic + upfront-LLM chain detectors still run.
   */
  disableChainRecheck?: boolean;
  /**
   * Override the per-conflict explainer runner. Tests pass a stub.
   * When omitted, an LLM-backed runner is spawned automatically.
   */
  conflictExplainerRunner?: ConflictExplainerRunner;
  /**
   * When true, skip the per-conflict plain-English explanation LLM
   * call. Conflicts still surface but without the readable summary.
   */
  disableConflictExplanations?: boolean;
  /**
   * Override the per-conflict LLM resolver. Tests pass a stub.
   */
  conflictResolverRunner?: ConflictResolverRunner;
  /**
   * When true, skip the LLM auto-resolve pass. All open conflicts stay
   * open for the user to decide. Default is enabled.
   */
  disableConflictResolution?: boolean;
  /**
   * Override the LLM relevance-filter runner. Tests pass a stub.
   */
  relevanceRunner?: RelevanceRunner;
  /**
   * When true, skip the LLM relevance filter — every discovered doc
   * feeds claim extraction. The default is filter-enabled.
   */
  disableRelevanceFilter?: boolean;
  /**
   * Skip the git-log mtime resolution. Useful for tests; the harness
   * also passes this when the working dir isn't a git repo.
   */
  skipGit?: boolean;
  /**
   * Skip writing `.truecourse/specs/claims.json`. The orchestrator
   * still detects modules and assembles the renderable claim set;
   * callers that drive their own persistence (tests, dry runs) get the
   * data on `result.modules` / `result.claimEntries` without a write.
   */
  skipClaimsWrite?: boolean;
  /**
   * Inject the doc set instead of walking the filesystem. EE feeds in-memory
   * docs (each carrying `content`) so a workspace scan touches no local disk;
   * omitted → `discoverDocs(repoRoot)` as the OSS/repo path always has.
   */
  docSource?: () => DocCandidate[] | Promise<DocCandidate[]>;
  /**
   * Inject the decisions file instead of reading `decisions.json` from disk
   * (EE supplies it from Postgres). Omitted → `readDecisions(repoRoot)`.
   */
  decisions?: DecisionsFile;
  /** Hooks for progress UIs / logging. */
  /**
   * Fires during the discover phase as the LLM relevance filter classifies
   * each candidate doc, plus an initial `(0, total)`. Lets a progress UI show
   * "N / total docs" while "Discovering docs" runs.
   */
  onRelevanceProgress?: (done: number, total: number) => void;
  onDocStart?: (doc: import('./discovery.js').DocCandidate) => void;
  onDocDone?: (doc: import('./discovery.js').DocCandidate, blockCount: number, claimCount: number) => void;
  onBlockFailure?: (block: Block, error: string) => void;
  /** Total block count, fired once after slicing. */
  onBlocksReady?: (total: number) => void;
  /**
   * Fires whenever a single block finishes (either a cache hit or an
   * LLM subprocess returning). Pairs with `onBlocksReady(total)` so
   * progress UIs can show "N / total blocks" ticking during the long
   * extraction phase. Cache hits all fire synchronously at the start
   * of the run.
   */
  onBlockDone?: () => void;
  /** Fires just before the merge/conflict-detection phase begins. */
  onMergeStart?: () => void;
  /** Fires once before the explainer pass begins, with the total to process. */
  onExplainStart?: (total: number) => void;
  /** Fires once per conflict after the explainer completes (success or cache hit). */
  onExplainDone?: () => void;
  /** Fires once before the resolver pass begins, with the total to process. */
  onResolveStart?: (total: number) => void;
  /** Fires once per conflict after the resolver completes (success or fallback). */
  onResolveDone?: () => void;
}

export interface ConsolidateResult {
  /** Extraction stats — block count, failures, doc count. */
  extract: ExtractResult;
  /** Merge result — resolved + decided + open conflicts. */
  merge: MergeResult;
  /** Modules detected from the merged claim set. */
  modules: DetectedModule[];
  /** Entries written to (or that would be written to) `claims.json`. */
  claimEntries: ClaimsFileEntry[];
  /**
   * The version chains the run stitched into the conflict set. Returned so a
   * caller that persists derived state (e.g. workspace Knowledge) can re-run a
   * decision-only `remerge()` later without re-reading the source docs.
   */
  chains: VersionChain[];
  /**
   * Docs the LLM relevance filter marked as non-spec material and
   * excluded from extraction. Each carries a short reason for the
   * dashboard, plus the doc's repo-relative path so the user can
   * manually include it via decisions.json#manualIncludes.
   */
  skippedDocs?: Array<{ path: string; reason: string }>;
  /**
   * The decisions file the orchestrator read from disk (or the empty
   * default if none existed). Echoed in the result so callers can
   * inspect what informed the merge.
   */
  decisions: DecisionsFile;
}

/**
 * Run the consolidator against `repoRoot`.
 */
export async function consolidate(
  repoRoot: string,
  opts: ConsolidateOptions = {},
): Promise<ConsolidateResult> {
  // Decisions + docs can be injected (EE feeds them from RAM/Postgres, no disk);
  // absent → read from the filesystem exactly as the OSS/repo path always has.
  const decisions = opts.decisions ?? readDecisions(repoRoot);
  const models = opts.models ?? {};
  const fallbackModel = models.fallback;

  // ---- Discover -------------------------------------------------------
  const allDocs = opts.docSource
    ? await opts.docSource()
    : discoverDocs(repoRoot, { skipGit: opts.skipGit });

  // ---- LLM relevance filter -------------------------------------------
  // Drop docs the LLM tags as non-spec material (task lists, research
  // logs, AI agent instructions). User overrides via
  // decisions.json#manualIncludes always force-include.
  const relevance = await filterByRelevance(repoRoot, allDocs, {
    runner: opts.relevanceRunner,
    enabled: opts.disableRelevanceFilter !== true,
    manualIncludes: decisions.manualIncludes ?? [],
    transport: opts.transport,
    model: models.relevance,
    fallbackModel,
    onProgress: opts.onRelevanceProgress,
  });
  const docs = relevance.included;
  const skippedDocs = relevance.skipped.map(({ doc, reason }) => ({ path: doc.path, reason }));

  // ---- Detect version chains (deterministic + LLM-augmented) ----------
  // Deterministic detector catches filename versioning (v1/v2) — cheap,
  // free, no model call. The LLM-based detector adds chains that don't
  // follow the filename convention. Both run; results are merged with
  // deterministic findings winning on overlap so the labels we attach
  // later stay accurate.
  const deterministicChains = detectVersionChains(docs);
  const llmChains = await detectVersionChainsViaLlm(repoRoot, docs, {
    runner: opts.chainRunner,
    enabled: opts.disableLlmChainDetection !== true,
    transport: opts.transport,
    model: models.chainDetect,
    fallbackModel,
  });
  // User-marked supersessions from decisions.json#manualChains are a
  // third chain source. They merge in alongside auto-detected chains;
  // when the user manually marked something the auto-detectors also
  // found, dedupe by id and prefer the more-informative label
  // (filename > llm > manual).
  const manualChains = materializeManualChains(decisions.manualChains ?? [], docs);
  const chains = mergeChainResults(deterministicChains, llmChains, manualChains);
  const chainConflicts = chains.map(synthesizeChainConflict);
  const winnersByChain = resolveChainWinners(chainConflicts, chains, decisions);

  // ---- Extract (cache-wrapped) -----------------------------------------
  const blockRunner = wrapBlockRunner(
    repoRoot,
    opts.blockRunner ??
      spawnRunner({
        transport: opts.transport,
        onBlockDone: () => opts.onBlockDone?.(),
        model: models.claimExtract,
        fallbackModel,
      }),
    opts.onBlockDone,
  );
  const extract = await extractClaims(repoRoot, {
    docs,
    runner: blockRunner,
    skipGit: opts.skipGit,
    onDocStart: opts.onDocStart,
    onDocDone: opts.onDocDone,
    onBlockFailure: opts.onBlockFailure,
    onBlocksReady: opts.onBlocksReady,
  });

  // ---- Apply chain decisions: drop claims from superseded docs ---------
  const filteredClaims = filterByChainWinners(extract.claims, chains, winnersByChain);

  // ---- Enrich chain conflicts with per-doc stats -----------------------
  // The dashboard renders a more informative preview when each chain
  // candidate carries claim counts + topic breakdown, so the user can
  // see "v1 has 8 claims (auth, endpoints); v2 has 22 (auth,
  // endpoints, data, effects)" instead of just a 5-line snippet.
  const enrichedChainConflicts = enrichChainConflictsWithStats(chainConflicts, extract.claims);

  // ---- Merge (first pass) ----------------------------------------------
  opts.onMergeStart?.();
  let merge = mergeClaims(filteredClaims, decisions);

  // ---- Conflict-triggered chain re-check -------------------------------
  // For every open content conflict on a cross-cutting subject (auth
  // scheme, error envelope, pagination, etc.) where two+ PRDs disagree,
  // call the LLM with both docs' FULL content and ask whether one is a
  // superseded version of the other. Newly-confirmed chains feed back
  // into the chain set and trigger a second merge pass with the older
  // docs' claims filtered out.
  const existingPairs = existingChainPairKeys(chains);
  const recheckPairs = selectRecheckPairs(merge.openConflicts, docs, existingPairs);
  const recheckChains = await runChainRecheck(repoRoot, recheckPairs, {
    runner: opts.chainRecheckRunner,
    enabled: opts.disableChainRecheck !== true,
    transport: opts.transport,
    model: models.chainRecheck,
    fallbackModel,
  });
  let chainsForStitch = chains;
  let mergedChainConflicts = enrichedChainConflicts;
  if (recheckChains.length > 0) {
    chainsForStitch = mergeChainResults(deterministicChains, llmChains, [
      ...manualChains,
      ...recheckChains,
    ]);
    const reFilteredClaims = filterByChainWinners(
      extract.claims,
      chainsForStitch,
      resolveChainWinners(
        chainsForStitch.map(synthesizeChainConflict),
        chainsForStitch,
        decisions,
      ),
    );
    merge = mergeClaims(reFilteredClaims, decisions);
    mergedChainConflicts = enrichChainConflictsWithStats(
      chainsForStitch.map(synthesizeChainConflict),
      extract.claims,
    );
  }

  // ---- Stitch chain conflicts into the merge result --------------------
  // Chains without a decision surface in openConflicts; chains with one
  // surface in decidedConflicts. Either way the dashboard sees them
  // through the same shape as content conflicts.
  const stitchedMerge = stitchChainConflicts(merge, mergedChainConflicts, chainsForStitch, decisions);

  // ---- Plain-English explanations for open conflicts -------------------
  // Per-conflict LLM call (Haiku-tier) summarizing the substantive
  // disagreement so non-engineers can decide without reading raw JSON.
  // Best-effort: failures degrade silently. Cached per-conflict by
  // candidate fingerprint, so re-runs with unchanged candidates skip
  // the LLM call entirely.
  const tExplainStart = perfNow();
  await explainConflicts(repoRoot, stitchedMerge.openConflicts, {
    runner: opts.conflictExplainerRunner,
    enabled: opts.disableConflictExplanations !== true,
    transport: opts.transport,
    model: models.conflictExplain,
    fallbackModel,
    onStart: opts.onExplainStart,
    onDone: opts.onExplainDone,
  });
  debugLog(`explain phase totalMs=${(perfNow() - tExplainStart).toFixed(0)}`);

  // ---- LLM per-conflict auto-resolve (Opus) ----------------------------
  // Opus reads each open conflict and proposes a pick + self-reported
  // confidence. Only `high` confidence auto-applies — synthesized into
  // decidedConflicts with autoResolution metadata so the dashboard can
  // surface "auto-resolved" affordances. Medium / low leave the conflict
  // open with the reasoning attached so the human sees the model's
  // thinking next to the explanation. User picks always win — anything
  // already in decisions.json never reaches the resolver (it's already
  // in decidedConflicts at this point).
  const tResolveStart = perfNow();
  const autoResolved = await resolveConflicts(repoRoot, stitchedMerge.openConflicts, {
    runner: opts.conflictResolverRunner,
    enabled: opts.disableConflictResolution !== true,
    transport: opts.transport,
    model: models.conflictResolve,
    fallbackModel,
    onStart: opts.onResolveStart,
    onDone: opts.onResolveDone,
  });
  debugLog(`resolve phase (incl. cache I/O) totalMs=${(perfNow() - tResolveStart).toFixed(0)}`);
  let finalMerge = applyAutoResolutions(stitchedMerge, autoResolved);

  // ---- Late chain-filter refresh ---------------------------------------
  // The LLM resolver above can promote a version-chain conflict to
  // `decided` at high confidence. But `filterByChainWinners` already
  // ran (in two earlier passes), reading only the user's pre-existing
  // decisions.json — it had no way to see chains the resolver was
  // about to auto-decide. The result: the loser's claims survive into
  // `claims.json` and leak into the contract corpus.
  //
  // Detect chains that became decided here (and weren't already in
  // decisions.json), augment the decisions set with the synthesized
  // chain picks, and re-run filter → merge → stitch with those. Then
  // re-apply the resolver verdicts on the new merge result so
  // already-auto-resolved content conflicts stay decided.
  const preDecidedConflictIds = new Set(decisions.decisions.map((d) => d.conflictId));
  const chainIdSet = new Set(chainsForStitch.map((c) => c.id));
  const lateChainDecisions = finalMerge.decidedConflicts
    .filter((d) => chainIdSet.has(d.conflict.id) && !preDecidedConflictIds.has(d.conflict.id))
    .map((d) => d.decision);
  if (lateChainDecisions.length > 0) {
    const augmentedDecisions: DecisionsFile = {
      ...decisions,
      decisions: [...decisions.decisions, ...lateChainDecisions],
    };
    const reWinners = resolveChainWinners(
      chainsForStitch.map(synthesizeChainConflict),
      chainsForStitch,
      augmentedDecisions,
    );
    const reFiltered = filterByChainWinners(extract.claims, chainsForStitch, reWinners);
    const reMerged = mergeClaims(reFiltered, augmentedDecisions);
    const reEnriched = enrichChainConflictsWithStats(
      chainsForStitch.map(synthesizeChainConflict),
      reFiltered,
    );
    const reStitched = stitchChainConflicts(
      reMerged,
      reEnriched,
      chainsForStitch,
      augmentedDecisions,
    );
    finalMerge = applyAutoResolutions(reStitched, autoResolved);
  }

  // ---- Module detection + claims.json write ----------------------------
  // Build the renderable claim set (resolved + decided picks + synthesized
  // custom resolutions), attribute each to a module, and write the
  // structured snapshot downstream stages consume.
  const renderable = collectRenderableClaims(finalMerge);
  const detection = detectModules(renderable);
  const modules = detection.modules;
  const moduleByClaimId = new Map<string, string>();
  for (const m of modules) {
    for (const c of m.claims) moduleByClaimId.set(c.id, m.name);
  }
  const claimEntries: ClaimsFileEntry[] = renderable
    // Out-of-scope claims contribute nothing to contract generation —
    // they live on `modules[].outOfScope` as anti-spec. Strip them from
    // the positive claim set so the extractor doesn't waste cycles.
    .filter((c) => c.metadata.status !== 'out-of-scope')
    .map((c) =>
      entryFromClaim(
        c,
        moduleByClaimId.get(c.id) ?? SHARED_MODULE,
        c.id.startsWith('custom-') ? 'custom' : 'extracted',
      ),
    );

  if (!opts.skipClaimsWrite) {
    writeClaims(repoRoot, {
      modules: modules.map((m) => m.manifest),
      claims: claimEntries,
    });
  }

  return { extract, merge: finalMerge, modules, claimEntries, decisions, skippedDocs, chains: chainsForStitch };
}

// ---------------------------------------------------------------------------
// remerge — re-apply decisions to an already-extracted claim set
// ---------------------------------------------------------------------------

/** What a body-free re-merge produces — the deterministic outputs of the merge. */
export interface RemergeResult {
  merge: MergeResult;
  modules: DetectedModule[];
  claimEntries: ClaimsFileEntry[];
}

/**
 * Re-merge an already-extracted claim set against a (possibly updated) decisions
 * file — **without re-reading the source docs and without any LLM call**.
 *
 * `consolidate()` fuses extraction (needs the docs + LLM) with the deterministic
 * merge (a pure function of claims + chains + decisions). When a caller has
 * persisted the raw `claims` and detected `chains` (e.g. workspace Knowledge,
 * which never stores the bodies), applying a user decision is just re-running
 * that deterministic tail. This is the workspace equivalent of the repo
 * dashboard's "re-scan from files after a decision" — same merge math, sourced
 * from stored derived state instead of the working tree.
 *
 * The LLM auto-resolve/explain passes are intentionally skipped: the user has
 * made the decision, and any prior high-confidence auto-resolutions the caller
 * wants to keep should already be persisted as decisions in `decisions`.
 */
export function remerge(
  claims: Claim[],
  chains: VersionChain[],
  decisions: DecisionsFile,
): RemergeResult {
  const chainConflicts = chains.map(synthesizeChainConflict);
  const winners = resolveChainWinners(chainConflicts, chains, decisions);
  const filtered = filterByChainWinners(claims, chains, winners);
  const merged = mergeClaims(filtered, decisions);
  const enriched = enrichChainConflictsWithStats(chainConflicts, claims);
  const stitched = stitchChainConflicts(merged, enriched, chains, decisions);

  const renderable = collectRenderableClaims(stitched);
  const detection = detectModules(renderable);
  const moduleByClaimId = new Map<string, string>();
  for (const m of detection.modules) {
    for (const c of m.claims) moduleByClaimId.set(c.id, m.name);
  }
  const claimEntries: ClaimsFileEntry[] = renderable
    .filter((c) => c.metadata.status !== 'out-of-scope')
    .map((c) =>
      entryFromClaim(
        c,
        moduleByClaimId.get(c.id) ?? SHARED_MODULE,
        c.id.startsWith('custom-') ? 'custom' : 'extracted',
      ),
    );

  return { merge: stitched, modules: detection.modules, claimEntries };
}

// ---------------------------------------------------------------------------
// Version chain → Conflict synthesis
// ---------------------------------------------------------------------------

/**
 * Turn a detected chain into a Conflict the dashboard can display
 * with the same component as content conflicts. Each candidate is a
 * synthetic Claim representing one doc in the chain — the LLM never
 * sees these; they exist only at the merge layer for surfacing.
 */
function synthesizeChainConflict(chain: VersionChain): Conflict {
  const candidates: ConflictCandidate[] = chain.docs.map((doc, index) => ({
    index,
    weight:
      index === 0
        ? 'oldest'
        : index === chain.docs.length - 1
          ? 'newest'
          : index < chain.docs.length / 2
            ? 'older'
            : 'newer',
    claim: docToSyntheticClaim(doc, chain),
  }));
  return {
    id: chain.id,
    topic: 'overview',
    subject: `version chain: ${chain.docs.map((d) => path.basename(d.path)).join(' → ')}`,
    candidates,
    defaultPick: candidates.length - 1,
  };
}

/** How many cleaned lines to surface in chain candidate previews. */
const CHAIN_PREVIEW_LINES = 80;

function docToSyntheticClaim(doc: DocCandidate, chain: VersionChain): Claim {
  const cleaned = stripHtmlComments(doc.preview);
  const preview = cleaned.split('\n').slice(0, CHAIN_PREVIEW_LINES).join('\n');
  return {
    id: `version-chain:${chain.id}:${doc.path}`,
    topic: 'overview',
    subject: `version chain: ${chain.docs.map((d) => path.basename(d.path)).join(' → ')}`,
    content: {
      file: doc.path,
      detectedFrom: chain.detectedFrom,
      preview,
    },
    kind: 'definition',
    provenance: {
      file: doc.path,
      line: 1,
      // Same preview the UI renders — keep `quote` and `content.preview`
      // in sync so the dashboard sees one source of truth.
      quote: preview,
    },
    metadata: {
      docKind: doc.kind,
      lastTouched: doc.lastTouched,
    },
  };
}

/**
 * Merge chain sources in priority order: deterministic > llm > manual.
 * Deduplication is by chain id (sha256 of the sorted member paths).
 * On dedupe we keep the more-informative label — a `manual` chain that
 * the deterministic detector ALSO found stays labeled `filename`
 * because the user gains nothing from seeing it as manual.
 */
function mergeChainResults(
  deterministic: VersionChain[],
  llm: VersionChain[],
  manual: VersionChain[] = [],
): VersionChain[] {
  const seen = new Set(deterministic.map((c) => c.id));
  const out = [...deterministic];
  for (const chain of llm) {
    if (seen.has(chain.id)) continue;
    seen.add(chain.id);
    out.push(chain);
  }
  for (const chain of manual) {
    if (seen.has(chain.id)) continue;
    seen.add(chain.id);
    out.push(chain);
  }
  return out;
}

/**
 * Attach per-doc claim stats to each chain candidate. The candidate's
 * content gains:
 *
 *   - claimCount: how many claims this doc contributed
 *   - topics:     count of claims grouped by topic
 *   - subjects:   up to N (currently 8) representative subject strings
 *
 * These show up in the dashboard's version-chain UI as concrete
 * impact info — much more useful for the "which doc is canonical?"
 * decision than a 5-line text preview.
 */
function enrichChainConflictsWithStats(
  chainConflicts: Conflict[],
  allClaims: Claim[],
): Conflict[] {
  if (chainConflicts.length === 0) return chainConflicts;
  // Index claims by source file once.
  const claimsByFile = new Map<string, Claim[]>();
  for (const c of allClaims) {
    const list = claimsByFile.get(c.provenance.file) ?? [];
    list.push(c);
    claimsByFile.set(c.provenance.file, list);
  }
  return chainConflicts.map((conflict) => ({
    ...conflict,
    candidates: conflict.candidates.map((cand) => {
      const file = (cand.claim.content as { file?: string } | undefined)?.file
        ?? cand.claim.provenance.file;
      const docClaims = claimsByFile.get(file) ?? [];
      const topics: Record<string, number> = {};
      for (const c of docClaims) topics[c.topic] = (topics[c.topic] ?? 0) + 1;
      const subjects = docClaims
        .map((c) => c.subject)
        .filter((s, i, arr) => arr.indexOf(s) === i)
        .slice(0, 8);
      return {
        ...cand,
        claim: {
          ...cand.claim,
          content: {
            ...(cand.claim.content as Record<string, unknown>),
            claimCount: docClaims.length,
            topics,
            subjects,
          },
        },
      };
    }),
  }));
}

/**
 * Strip HTML comments before slicing a preview snippet. Without this,
 * a comment that opens before our 3/5-line cutoff but closes after it
 * leaks the open `<!--` into the rendered preview as raw text. Real
 * docs commonly carry `<!-- TODO -->` markers, fixture annotations,
 * and the like — none of which belong in a "what is this doc about"
 * snippet.
 */
function stripHtmlComments(text: string): string {
  // Drop fully-closed comments first (may span lines).
  let out = text.replace(/<!--[\s\S]*?-->/g, '');
  // Drop any trailing unclosed comment opener so a half-comment at
  // the tail of the doc doesn't leak through.
  const lastOpen = out.lastIndexOf('<!--');
  if (lastOpen !== -1 && out.indexOf('-->', lastOpen) === -1) {
    out = out.slice(0, lastOpen);
  }
  // Collapse any blank-line runs left behind by removed comments.
  return out.replace(/\n{3,}/g, '\n\n').trimStart();
}

/**
 * For each chain conflict, look up the user's decision (if any) and
 * record which doc path "won". A `pick` resolution selects one doc
 * exclusively; a `custom` resolution is interpreted as "merge both"
 * — claims from every doc in the chain pass through unfiltered.
 */
function resolveChainWinners(
  chainConflicts: Conflict[],
  chains: VersionChain[],
  decisions: DecisionsFile,
): Map<string, string | null> {
  const chainsById = new Map(chains.map((c) => [c.id, c]));
  const out = new Map<string, string | null>();
  for (const conflict of chainConflicts) {
    const decision = decisions.decisions.find((d) => d.conflictId === conflict.id);

    // Manual chains are user-marked supersessions — implicitly
    // resolved with the newer (last) doc as winner. No need for the
    // user to also write a `pick` decision; marking IS the decision.
    const chain = chainsById.get(conflict.id);
    if (!decision && chain?.detectedFrom === 'manual') {
      const winnerDoc = chain.docs[chain.docs.length - 1];
      out.set(conflict.id, winnerDoc.path);
      continue;
    }

    if (!decision) {
      out.set(conflict.id, null); // pending — surface as openConflict
      continue;
    }
    if (decision.resolution.kind === 'pick') {
      const idx = decision.resolution.candidateIndex;
      const winnerClaim = conflict.candidates[idx]?.claim;
      const winnerFile = (winnerClaim?.content as { file?: string } | undefined)?.file ?? null;
      out.set(conflict.id, winnerFile);
    } else {
      // 'custom' — treat as "merge both": no filtering.
      out.set(conflict.id, null);
    }
  }
  return out;
}

/**
 * Drop claims from docs that the user superseded. Claims from docs
 * not in any chain (or in chains with no winner decided yet) pass
 * through.
 */
function filterByChainWinners(
  claims: Claim[],
  chains: VersionChain[],
  winnersByChain: Map<string, string | null>,
): Claim[] {
  const dropFiles = new Set<string>();
  for (const chain of chains) {
    const winner = winnersByChain.get(chain.id);
    if (!winner) continue; // no decision yet OR custom (merge-both)
    for (const doc of chain.docs) {
      if (doc.path !== winner) dropFiles.add(doc.path);
    }
  }
  if (dropFiles.size === 0) return claims;
  return claims.filter((c) => !dropFiles.has(c.provenance.file));
}

/**
 * Add chain conflicts to the merge result so the dashboard sees
 * everything in one shape. Pending chains → openConflicts. Decided
 * chains → decidedConflicts.
 */
function stitchChainConflicts(
  merge: MergeResult,
  chainConflicts: Conflict[],
  chains: VersionChain[],
  decisions: DecisionsFile,
): MergeResult {
  const chainsById = new Map(chains.map((c) => [c.id, c]));
  const pending: Conflict[] = [];
  const decided: DecidedConflict[] = [];
  for (const conflict of chainConflicts) {
    const decision = decisions.decisions.find((d) => d.conflictId === conflict.id);
    if (decision) {
      decided.push({
        conflict,
        decision,
        resolvedClaim:
          decision.resolution.kind === 'pick'
            ? conflict.candidates[decision.resolution.candidateIndex]?.claim
            : undefined,
      });
      continue;
    }
    // Manual chains are implicitly decided: the user marked the
    // supersession, so synthesize a `pick` decision on the newest doc.
    const chain = chainsById.get(conflict.id);
    if (chain?.detectedFrom === 'manual') {
      const newestIdx = conflict.candidates.length - 1;
      decided.push({
        conflict,
        decision: {
          conflictId: conflict.id,
          resolution: { kind: 'pick', candidateIndex: newestIdx },
          resolvedAt: new Date().toISOString(),
          candidateFingerprint: 'manual-chain',
          note: 'Implicit decision from manual supersession.',
        },
        resolvedClaim: conflict.candidates[newestIdx]?.claim,
      });
      continue;
    }
    // Zero-claim chains: when every non-newest candidate contributed 0
    // extractable claims, there's literally nothing at stake — picking
    // the newer drops zero, keeping the older keeps zero. Auto-resolve
    // in favor of the newest so the chain stops blocking the user.
    // Still surfaced under decidedConflicts so it's inspectable.
    const newestIdx = conflict.candidates.length - 1;
    const olderClaimCounts = conflict.candidates
      .slice(0, newestIdx)
      .map((c) => ((c.claim.content as { claimCount?: number } | null)?.claimCount ?? 0));
    if (olderClaimCounts.length > 0 && olderClaimCounts.every((n) => n === 0)) {
      decided.push({
        conflict,
        decision: {
          conflictId: conflict.id,
          resolution: { kind: 'pick', candidateIndex: newestIdx },
          resolvedAt: new Date().toISOString(),
          candidateFingerprint: 'auto-zero-claim-chain',
          note: 'Auto-resolved: older candidate(s) contributed no extractable claims.',
        },
        resolvedClaim: conflict.candidates[newestIdx]?.claim,
      });
      continue;
    }
    pending.push(conflict);
  }
  return {
    resolvedClaims: merge.resolvedClaims,
    decidedConflicts: [...decided, ...merge.decidedConflicts],
    openConflicts: [...pending, ...merge.openConflicts],
  };
}

// ---------------------------------------------------------------------------
// Decisions file I/O
// ---------------------------------------------------------------------------

const EMPTY_DECISIONS: DecisionsFile = { version: 1, decisions: [], manualChains: [], manualIncludes: [] };

export function decisionsPath(repoRoot: string): string {
  return path.join(repoRoot, '.truecourse', 'specs', 'decisions.json');
}

export function specRootPath(repoRoot: string): string {
  return path.join(repoRoot, '.truecourse', 'specs');
}

/**
 * Read `decisions.json` from the repo's `.truecourse/specs/` dir.
 * Returns an empty decisions file if missing or unparseable —
 * stale/corrupt files shouldn't block a scan run.
 */
export function readDecisions(repoRoot: string): DecisionsFile {
  const file = decisionsPath(repoRoot);
  if (!fs.existsSync(file)) return EMPTY_DECISIONS;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return DecisionsFileSchema.parse(raw);
  } catch {
    return EMPTY_DECISIONS;
  }
}

/**
 * Write `decisions.json`. Used by the CLI's `spec resolve` flow and
 * the dashboard write-back endpoint.
 */
export function writeDecisions(repoRoot: string, decisions: DecisionsFile): void {
  const file = decisionsPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(decisions, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Cache-wrapping runners
// ---------------------------------------------------------------------------

function wrapBlockRunner(
  repoRoot: string,
  inner: BlockRunner,
  onBlockDone?: () => void,
): BlockRunner {
  return async (blocks) => {
    const out: BlockRunResult[] = [];
    const misses: Block[] = [];
    for (const block of blocks) {
      const cached = await readBlockCache(repoRoot, block.id);
      if (cached) {
        out.push({ block, extraction: cached, durationMs: 0 });
        // Count cache hits as "done" so the progress bar starts from
        // an accurate baseline. Misses are counted by the inner
        // runner's `onBlockDone` hook.
        onBlockDone?.();
      } else {
        misses.push(block);
      }
    }
    if (misses.length === 0) return out;
    const innerResults = await inner(misses);
    for (const r of innerResults) {
      if (r.extraction) await writeBlockCache(repoRoot, r.block.id, r.extraction);
      out.push(r);
    }
    return out;
  };
}

// ---------------------------------------------------------------------------
// Renderable claim assembly
// ---------------------------------------------------------------------------

/**
 * Apply the LLM resolver's verdicts to a merge result.
 *
 * For each `high`-confidence resolution we synthesize a `pick`
 * decision and move the conflict from `openConflicts` to
 * `decidedConflicts`, tagging it with `autoResolution` so the
 * dashboard / CLI can label it clearly and let the user revoke.
 *
 * Medium / low confidence keeps the conflict open but attaches the
 * resolver's reasoning to `conflict.explanation` (as a suffix when an
 * explanation already exists, or as the explanation itself otherwise)
 * so the human sees the model's thinking next to the structural
 * differences.
 */
function applyAutoResolutions(
  merge: MergeResult,
  resolved: import('./conflict-resolver.js').ResolvedConflict[],
): MergeResult {
  if (resolved.length === 0) return merge;
  const byId = new Map(resolved.map((r) => [r.conflict.id, r]));
  const newDecided: DecidedConflict[] = [...merge.decidedConflicts];
  const newOpen: Conflict[] = [];

  for (const conflict of merge.openConflicts) {
    const resolution = byId.get(conflict.id)?.resolution;
    if (!resolution) {
      newOpen.push(conflict);
      continue;
    }
    if (resolution.confidence !== 'high') {
      // Replace the explainer's text with Opus's reasoning — it's
      // conflict-specific and names the recommendation directly, which
      // is more useful than the Haiku-generated baseline. The structured
      // verdict goes on `resolverVerdict` so the dashboard can render a
      // confidence affordance separately.
      //
      // Also overwrite `defaultPick` with the resolver's pick. Without
      // this, the conflict carried two competing "recommended" signals:
      // the violet badge on resolverVerdict.pick (LLM's analysis) and
      // defaultPick (the engine's newest-mtime guess) — and Accept-all
      // followed the latter, overriding the LLM's actual recommendation.
      // Falling back to the original defaultPick when the verdict's pick
      // is somehow out-of-bounds preserves the engine's earlier guess.
      const verdictPick =
        resolution.pick >= 0 && resolution.pick < conflict.candidates.length
          ? resolution.pick
          : conflict.defaultPick;
      newOpen.push({
        ...conflict,
        defaultPick: verdictPick,
        explanation: resolution.reasoning,
        resolverVerdict: {
          confidence: resolution.confidence,
          reasoning: resolution.reasoning,
          pick: resolution.pick,
        },
      });
      continue;
    }
    const winnerClaim = conflict.candidates[resolution.pick]?.claim;
    newDecided.push({
      conflict,
      decision: {
        conflictId: conflict.id,
        resolution: { kind: 'pick', candidateIndex: resolution.pick },
        resolvedAt: new Date().toISOString(),
        candidateFingerprint: 'auto-llm-resolve',
        note: `Auto-resolved by LLM (high confidence): ${resolution.reasoning}`,
      },
      resolvedClaim: winnerClaim,
      autoResolution: {
        by: 'llm',
        confidence: resolution.confidence,
        reasoning: resolution.reasoning,
      },
    });
  }
  return {
    resolvedClaims: merge.resolvedClaims,
    decidedConflicts: newDecided,
    openConflicts: newOpen,
  };
}

/**
 * Build the flat list of claims that should land in `claims.json`.
 * Sources:
 *   - merge.resolvedClaims (singletons + auto-merged)
 *   - merge.decidedConflicts[].resolvedClaim for `pick` decisions
 *   - synthesized claims for `custom` decisions — the user wrote
 *     free-text content, we wrap it in a Claim so downstream stages
 *     see one uniform shape
 *
 * Version-chain synthetic claims (`id` prefix `version-chain:`) are
 * metadata about the user's supersession decision, not real spec
 * content — filtered out so they never reach claims.json.
 */
function collectRenderableClaims(merge: MergeResult): Claim[] {
  const out: Claim[] = [...merge.resolvedClaims];
  for (const decided of merge.decidedConflicts) {
    if (decided.resolvedClaim) {
      if (decided.resolvedClaim.id.startsWith('version-chain:')) continue;
      out.push(decided.resolvedClaim);
      continue;
    }
    if (decided.decision.resolution.kind === 'custom') {
      out.push(
        synthesizeCustomClaim(
          decided.conflict,
          decided.decision.resolution.content,
          decided.decision.resolvedAt,
        ),
      );
    }
  }
  return out;
}

function synthesizeCustomClaim(
  conflict: { topic: Topic; subject: string },
  content: string,
  resolvedAt: string,
): Claim {
  return {
    id: `custom-${conflict.topic}-${conflict.subject}`,
    topic: conflict.topic,
    subject: conflict.subject,
    content: { _custom: content },
    kind: 'definition',
    provenance: {
      file: '.truecourse/specs/decisions.json',
      line: 0,
      quote: content,
    },
    metadata: {
      docKind: 'unknown',
      lastTouched: resolvedAt,
    },
  };
}
