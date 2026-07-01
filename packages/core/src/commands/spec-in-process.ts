/**
 * Shared in-process entry points for the BL Drift / Spec Consolidation
 * commands. Both the CLI and the dashboard server import these so
 * progress wiring, decision-file writes, and IL-extraction chaining
 * live in exactly one place.
 *
 * Same shape as `analyze-in-process.ts` — the caller passes a
 * `StepTracker` and we drive it through the high-level phases:
 *
 *   curate         discover → tag areas → group → detect relations → corpus.json
 *   generate       corpus.json → contracts/*.tc
 *
 * Step keys + labels are stable across CLI/dashboard so the progress
 * UI is identical on both surfaces. Implementations of the actual
 * pipelines come from `@truecourse/spec-consolidator` and
 * `@truecourse/contract-extractor`; this module just orchestrates
 * them and reports progress.
 */

import {
  curate,
  readDecisions,
  writeDecisions,
  type CuratedCorpus,
  type CurateModels,
  type CurateOptions,
  type CurateResult,
  type DecisionsFile,
  type Relation,
} from '@truecourse/spec-consolidator';
import {
  generateContractsFromCorpus,
  hasCorpusSpec,
  readCorpusForGenerate,
  classifyAreas,
  readManifest,
  type CorpusGenerateModels,
  type CorpusGenerateResult,
  type CoverageGap,
  type EnumerateRunner,
  type GapJudgeRunner,
  type GenerateBatchRunner,
  type ValidationIssue,
} from '@truecourse/contract-extractor';
import { resolveFallbackModel, resolveModel, type StageId } from '../config/llm-models.js';
import {
  agentTransport,
  getDefaultTransport,
  getStageUsage,
  resetStageUsage,
  setLlmCallSink,
  stageTokenTotal,
  type LlmTransport,
} from '@truecourse/shared/llm';
import { createLlmCallLogger } from '../lib/llm-call-log.js';
import type { LlmEstimate } from './analyze-core.js';
import { estimateScanTokens, estimateGenerateTokens } from '../services/llm/spec-estimate.js';
import { getModelPrices } from '../services/llm/model-prices.js';

/**
 * Thrown when the user declines the pre-flight LLM cost estimate. Scan/generate
 * are entirely LLM-driven, so a decline aborts the run (unlike analyze, which
 * falls back to deterministic-only). Callers catch this to exit cleanly.
 */
export class EstimateDeclined extends Error {
  constructor(public readonly kind: 'scan' | 'generate') {
    super(`${kind} declined at the LLM cost estimate`);
    this.name = 'EstimateDeclined';
  }
}

// Debug timing — gated behind TRUECOURSE_DEBUG_TIMING=1.
function perfNow(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}
function debugLog(msg: string): void {
  if (process.env.TRUECOURSE_DEBUG_TIMING) {
    process.stderr.write(`[tc-timing] ${msg}\n`);
  }
}
import {
  verify,
  infer,
  writeInferred,
  renderDecision,
  type ContractDrift,
  type VerifyResult,
  type InferResult,
} from '@truecourse/contract-verifier';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { getGit, isGitRepo } from '../lib/git.js';
import {
  writeVerifyRun,
  writeVerifyLatest,
  readVerifyLatest,
  readVerifyRun,
  readVerifyHistory as readVerifyHistoryStore,
  appendVerifyHistory,
  deleteVerifyDiff,
  writeVerifyDiff,
  verifyMaterializeInPlace,
} from '../lib/verify-store.js';
export { readVerifyDiff, readVerifyLatest, verifyLatestPath, readVerifyHistory, deleteVerifyRun } from '../lib/verify-store.js';
export type { VerifyDiff, VerifyLatest, VerifyHistory } from '../types/verify-snapshot.js';
import { repoRef } from '../lib/repo-ref.js';
import {
  saveContracts,
  loadContracts,
  saveWorkspaceContracts,
  loadWorkspaceContracts,
  contractsMaterializeInPlace,
  type RepoRef,
  type WorkspaceRef,
  type MaterializedDir,
} from '../lib/contract-store.js';
import {
  saveSpec,
  loadSpec,
  loadLatestSpec,
  latestSpecCommit,
  saveWorkspaceSpec,
  loadWorkspaceSpec,
  specsMaterializeInPlace,
} from '../lib/spec-store.js';
import {
  reapplyPromoted,
  applyInferredActions,
  diffDecisions,
  type InferredDecisionSummary,
  type InferDiff,
} from '../lib/inferred-decisions.js';
import { listInferredActions } from '../lib/inferred-action-store.js';
import {
  diffDrifts,
  summarizeDrifts,
  type VerifyRunSnapshot,
  type VerifyLatest,
  type VerifyDiff,
} from '../types/verify-snapshot.js';
import type { StepTracker } from '../progress.js';
import {
  trackEvent,
  bucketFileCount,
  bucketDuration,
  type TelemetrySource,
} from '../services/telemetry.service.js';

// ---------------------------------------------------------------------------
// Step taxonomies — exported so callers can pre-build the tracker.
// ---------------------------------------------------------------------------

// Curate docs into corpus.json, then generate contracts area-by-area.
export const CURATE_STEPS = [
  { key: 'discover', label: 'Discovering docs' },
  { key: 'tag', label: 'Tagging doc areas' },
  { key: 'relate', label: 'Detecting relations' },
  { key: 'overlap', label: 'Flagging overlaps' },
] as const;

export const CORPUS_GENERATE_STEPS = [
  { key: 'enumerate', label: 'Enumerating targets' },
  { key: 'reconcile', label: 'Reconciling targets' },
  { key: 'generate', label: 'Generating contracts' },
  { key: 'repair', label: 'Repairing contracts' },
] as const;

export const VERIFY_STEPS = [
  { key: 'load', label: 'Loading contracts' },
  { key: 'extract-code', label: 'Scanning code for operations' },
  { key: 'compare', label: 'Comparing code against contracts' },
] as const;

export const INFER_STEPS = [
  { key: 'load', label: 'Loading authored contracts' },
  { key: 'scan', label: 'Reverse-engineering decisions from code' },
  { key: 'write', label: 'Writing inferred contracts' },
] as const;

// ---------------------------------------------------------------------------
// Live per-step usage tag (` · <model> · <tok> tok · $<cost>`)
// ---------------------------------------------------------------------------

/** Which LLM stage(s) each UI progress step covers — so a step line can show the
 *  model + live tokens/$ of the work it's doing. Shared by the terminal renderer
 *  and the dashboard popup (both render the same step `detail`). */
const STEP_STAGES: Record<string, StageId[]> = {
  // scan (curate)
  discover: ['spec.relevance'],
  tag: ['spec.areaTag', 'spec.vocab'],
  relate: ['spec.relation', 'spec.chainDetect'],
  overlap: ['spec.overlap'],
  // generate (corpus)
  enumerate: ['contract.enumerate'],
  reconcile: ['contract.reconcile'],
  generate: ['contract.extract', 'contract.gapJudge'],
  repair: ['contract.repairParse', 'contract.repair'],
};

function humanTokens(n: number): string {
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

/**
 * Whether progress may fall back to the per-stage *resolved* model when no real
 * usage was recorded. OSS honors per-stage model tiers (CLI `--model`), so the
 * fallback is accurate there. EE runs ONE model for every stage (the AI-SDK
 * transport ignores the per-stage hint) and records no per-stage usage, so the
 * fallback would show a misleading OSS tier — EE turns this off at boot
 * ({@link setShowResolvedStageModel}), and progress then shows no model name.
 */
let showResolvedStageModel = true;

/** EE calls this at boot (`false`) so progress doesn't show OSS per-stage tiers. */
export function setShowResolvedStageModel(show: boolean): void {
  showResolvedStageModel = show;
}

/**
 * ` · <model> · <tok> tok · $<cost>` suffix for a step. Tokens/cost appear only
 * when real LLM calls were recorded this run (cache hits and the agent transport
 * record nothing). The model shows the resolved id once a call happened; absent
 * that, it falls back to the configured per-stage alias UNLESS the single-model
 * (EE) transport is active. Empty string when there's nothing to add.
 */
function stepUsageTag(stepKey: string, repoRoot: string): string {
  const stages = STEP_STAGES[stepKey] ?? [];
  if (stages.length === 0) return '';
  const usage = getStageUsage();
  let tok = 0;
  let cost = 0;
  const models = new Set<string>();
  for (const s of stages) {
    const u = usage.get(s);
    if (u && u.calls > 0) {
      tok += stageTokenTotal(u);
      cost += u.costUsd;
      if (u.model) models.add(u.model);
    }
  }
  let model = [...models].join(', ');
  if (!model && showResolvedStageModel) {
    model = [...new Set(stages.map((s) => resolveModel(s, undefined, repoRoot)))].join(', ');
  }
  const parts: string[] = [];
  if (model) parts.push(model);
  if (tok > 0 || cost > 0) {
    parts.push(`${humanTokens(tok)} tok`);
    parts.push(`$${cost.toFixed(2)}`);
  }
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

/**
 * Whether the corpus has spec changes not yet reflected in the generated
 * contracts — the deterministic staleness signal for the Generate dot. Uses the
 * committed manifest (content hashes), NOT file mtimes: a no-op scan that
 * rewrites `corpus.json` doesn't falsely mark contracts stale, and this exactly
 * matches whether `contracts generate` would do any work. True when there's a
 * corpus and its areas don't all match the manifest (new / edited / deleted).
 */
export function isCorpusStale(repoRoot: string): boolean {
  let areas;
  try {
    areas = readCorpusForGenerate(repoRoot);
  } catch {
    return false; // no readable corpus → nothing to generate → not stale
  }
  if (areas.length === 0) return false;
  return !classifyAreas(areas, readManifest(repoRoot)).allUnchanged;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface VerifyInProcessResult {
  /** Verifier output — full drift list + counts. */
  verify: VerifyResult;
  /** State persisted to disk for the dashboard to consume on next mount. */
  state: VerifyState;
}

export interface VerifyDiffInProcessResult {
  /** Verifier output for the current working tree. */
  verify: VerifyResult;
  /** The computed + persisted diff against the committed LATEST baseline. */
  diff: VerifyDiff;
}

/**
 * What we persist to
 * `.truecourse/.cache/verifier/verify-state.json`. The dashboard
 * Verify tab reads this on mount; the CLI's `truecourse verify`
 * writes it on every run. One shape, two surfaces.
 */
export interface VerifyState {
  verifiedAt: string;
  contractsDir: string;
  codeDir: string;
  artifactCount: number;
  extractedOperationCount: number;
  drifts: ContractDrift[];
  resolverErrors: string[];
  unresolvedRefs: string[];
  /**
   * Commit the drifts were observed at — the baseline commit for the latest
   * state, the snapshot's commit for a past run. Lets EE deep-link drift sites
   * to the GitHub blob at the right sha even in the (non-PR) base view. Null
   * when verify ran outside a git repo.
   */
  commitHash?: string | null;
}

export interface InferInProcessResult {
  /** Inference output — the undocumented decisions found in code. */
  infer: InferResult;
  /** Files written under `_inferred/` (empty on a dry run). */
  written: string[];
  /** Files that would be written, on a dry run. */
  proposed: string[];
  /**
   * The `.tc` rel path (relative to the `_inferred/` root, e.g. `order/x.tc` —
   * which is also the path in the `contracts_inferred` set) for each decision,
   * PARALLEL to `infer.decisions`. Lets the gate promote a decision by reading its
   * `.tc` from `contracts_inferred` and writing it into authored `contracts`.
   */
  decisionPaths: string[];
  /** The structured summaries the dashboard reads (built even on a dry run). */
  summaries: InferredDecisionSummary[];
}

export interface SpecInProcessOptions {
  /** Required for progress emission. Build via `new StepTracker(...)`. */
  tracker?: StepTracker;
  /**
   * Per-slice contract-generation progress (`done`, `total`) — the headless
   * analogue of the tracker's "N/M slices" detail, for callers without a
   * StepTracker (the EE job runner forwards it to its own stepped popup).
   */
  onSliceProgress?: (done: number, total: number) => void;
  /** Repair-pass progress (`done`, `total`) — the silent post-extraction LLM pass. */
  onRepairProgress?: (done: number, total: number) => void;
  /** When true, skip git mtime resolution. */
  skipGit?: boolean;
  /**
   * Adapter that triggered this run (CLI vs dashboard). Auto-emitted in the
   * telemetry payload for `spec scan` / `contracts generate`. Omit to skip
   * telemetry (e.g. tests, internal re-scans).
   */
  source?: TelemetrySource;
  /**
   * Explicit store identity (opaque repo handle + commit). The EE GitHub App
   * passes this so persisted sets key off the PR head + `owner/repo`, not the
   * ephemeral clone path. OSS omits it → derived from `repoRoot`'s HEAD.
   */
  ref?: RepoRef;
  /** Override the commit SHA used to key persisted sets when `ref` is omitted. */
  commitOverride?: string;
  /**
   * LLM transport mode. `cli` (default) spawns `claude -p`; `agent` uses a
   * filesystem mailbox under `io` so an orchestrating agent answers the
   * prompts (no `claude` binary, no API key). `agent` requires `io`.
   */
  llm?: 'cli' | 'agent';
  /** I/O dir for the agent transport's request/response mailbox. */
  io?: string;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Build the LLM transport for a run. `agent` → a filesystem-mailbox transport
 * under `options.io` (required). `cli` (default) → the process-installed default
 * transport when present (the EE edition installs an API-backed transport at
 * boot so hosted runs need no `claude` binary), else `undefined` so each runner
 * falls back to its built-in cli transport — preserving OSS behavior exactly.
 */
function resolveTransport(options: { llm?: 'cli' | 'agent'; io?: string }): LlmTransport | undefined {
  if (options.llm === 'agent') {
    if (!options.io) {
      throw new Error('--llm agent requires --io <dir> (the request/response mailbox directory)');
    }
    return agentTransport(options.io);
  }
  return getDefaultTransport();
}

/**
 * The last `contracts generate` run's result + staleness marker. Lives in
 * `contracts/`, next to the `.tc` output it describes — NOT under `.cache/`
 * (that's for safe-to-delete re-run caches) and not top-level (that's the analyze
 * store). It's run-output metadata the dashboard reads back (written count, gaps,
 * validation issues); gitignored even though the rest of `contracts/` is tracked.
 * The dashboard's `/spec/staleness` endpoint reads its mtime against `corpus.json`
 * (was the scan run after the last generate?) and against the verifier state (has
 * verify run since?). Both CLI and dashboard drive the same in-process helper.
 */
const GENERATED_MARKER_REL = path.join('.truecourse', 'contracts', 'result.json');

export function generatedMarkerPath(repoRoot: string): string {
  return path.join(repoRoot, GENERATED_MARKER_REL);
}

/**
 * The last `contracts generate` run's outcome — persisted alongside the staleness
 * marker so the dashboard can show what was written / what's still wrong AFTER a
 * page reload (the run result itself is otherwise transient). Derived/gitignored.
 */
export interface GeneratedSummary {
  generatedAt: string;
  /** Number of `.tc` files written. */
  written: number;
  /** Enumerated targets that never got a contract. */
  gaps: CoverageGap[];
  /** Structural validation diagnostics (hard = dropped, soft = kept). */
  validationIssues: ValidationIssue[];
}

export function stampGeneratedMarker(
  repoRoot: string,
  summary?: { written: number; gaps: CoverageGap[]; validationIssues: ValidationIssue[] },
): void {
  const file = generatedMarkerPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body: GeneratedSummary = {
    generatedAt: new Date().toISOString(),
    written: summary?.written ?? 0,
    gaps: summary?.gaps ?? [],
    validationIssues: summary?.validationIssues ?? [],
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n');
}

/** Read the last generate run's summary (written count + gaps + issues), or null. */
export function readGeneratedSummary(repoRoot: string): GeneratedSummary | null {
  try {
    const raw = JSON.parse(fs.readFileSync(generatedMarkerPath(repoRoot), 'utf-8'));
    return {
      generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : '',
      written: typeof raw.written === 'number' ? raw.written : 0,
      gaps: Array.isArray(raw.gaps) ? raw.gaps : [],
      validationIssues: Array.isArray(raw.validationIssues) ? raw.validationIssues : [],
    };
  } catch {
    return null;
  }
}

/** Per-stage models for the corpus-path curate pipeline. */
function resolveCurateModels(repoRoot: string): CurateModels {
  return {
    relevance: resolveModel('spec.relevance', undefined, repoRoot),
    areaTag: resolveModel('spec.areaTag', undefined, repoRoot),
    vocab: resolveModel('spec.vocab', undefined, repoRoot),
    overlap: resolveModel('spec.overlap', undefined, repoRoot),
    relation: resolveModel('spec.relation', undefined, repoRoot),
    fallback: resolveFallbackModel(repoRoot) ?? undefined,
  };
}

/** Per-stage models for the corpus-path generate pipeline (adds `enumerate`). */
function resolveCorpusGenerateModels(repoRoot: string): CorpusGenerateModels {
  return {
    enumerate: resolveModel('contract.enumerate', undefined, repoRoot),
    reconcile: resolveModel('contract.reconcile', undefined, repoRoot),
    extract: resolveModel('contract.extract', undefined, repoRoot),
    repair: resolveModel('contract.repair', undefined, repoRoot),
    repairParse: resolveModel('contract.repairParse', undefined, repoRoot),
    gapJudge: resolveModel('contract.gapJudge', undefined, repoRoot),
    fallback: resolveFallbackModel(repoRoot) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Corpus path drivers — shared by the CLI (`spec scan`, `contracts generate`)
// and the dashboard routes. `curateInProcess` builds corpus.json (discover →
// tag → group → detect relations); `generateFromCorpusInProcess` turns it into
// the contracts/*.tc corpus.
// ---------------------------------------------------------------------------

export interface SpecCurateInProcessResult {
  curate: CurateResult;
  /** True when the scan made zero LLM calls — every doc was unchanged (cached). */
  noChanges: boolean;
}

export interface CurateInProcessOptions {
  tracker?: StepTracker;
  source?: TelemetrySource;
  /** LLM transport mode (`cli` default / `agent` mailbox). `agent` requires `io`. */
  llm?: 'cli' | 'agent';
  io?: string;
  skipGit?: boolean;
  /** Compute the corpus without overwriting corpus.json — for read-only callers. */
  skipCorpusWrite?: boolean;
  /**
   * User resolutions (relations / manual areas / includes) to fold into curate.
   * EE MUST pass the stored decisions here: its re-scan runs on a fresh clone with
   * no `.truecourse/specs/decisions.json` (resolutions live in Postgres), so
   * without this the re-scan re-detects already-resolved conflicts. Omit in OSS —
   * curate then reads them from the repo tree.
   */
  decisions?: CurateOptions['decisions'];
  /**
   * Pre-flight LLM cost estimate gate. Called with the token estimate before any
   * LLM work; return `false` to abort (throws {@link EstimateDeclined}). Omit to
   * run without confirmation.
   */
  onLlmEstimate?: (estimate: LlmEstimate) => Promise<boolean>;
  // --- test seams (mirror curate(); production passes none) -----------------
  relevanceRunner?: CurateOptions['relevanceRunner'];
  areaTagRunner?: CurateOptions['areaTagRunner'];
  overlapRunner?: CurateOptions['overlapRunner'];
  relationChainRunner?: CurateOptions['relationChainRunner'];
  disableRelevanceFilter?: boolean;
  disableAreaTagging?: boolean;
  disableOverlapDetection?: boolean;
  disableLlmRelationDetection?: boolean;
}

/**
 * Run the curate pipeline (corpus path) and drive a tracker through CURATE_STEPS.
 * Writes `.truecourse/specs/corpus.json` (curate does). Idempotent: unchanged
 * docs hit the per-doc tag cache and cost nothing.
 */
export async function curateInProcess(
  repoRoot: string,
  options: CurateInProcessOptions = {},
): Promise<SpecCurateInProcessResult> {
  const { tracker } = options;
  resetStageUsage();
  const startedAt = Date.now();

  // A step's detail line = base text + its live usage tag (model/tokens/$).
  const withUsage = (key: string, base?: string): string | undefined => {
    const tag = stepUsageTag(key, repoRoot);
    if (base !== undefined) return `${base}${tag}`;
    return tag ? tag.replace(/^ · /, '') : undefined;
  };

  // Pre-flight cost estimate + confirm, before any LLM call. Skip the prompt when
  // there's no LLM work to do (nothing to spend). Decline → abort.
  if (options.onLlmEstimate) {
    const prices = await getModelPrices();
    const estimate = await estimateScanTokens(repoRoot, prices);
    if ((estimate.stages?.length ?? 0) > 0) {
      const proceed = await options.onLlmEstimate(estimate);
      if (!proceed) throw new EstimateDeclined('scan');
    }
  }

  let tagStarted = false;
  let overlapStarted = false;
  const ensureTag = (): void => {
    if (tagStarted) return;
    tracker?.done('discover', withUsage('discover'));
    tracker?.start('tag');
    tagStarted = true;
  };
  // Relations are detected between tagging and overlap with no progress signal of
  // their own, so the `relate` step is opened+closed at the overlap boundary.
  const ensureOverlap = (): void => {
    ensureTag();
    if (overlapStarted) return;
    tracker?.done('tag', withUsage('tag'));
    tracker?.start('relate');
    tracker?.done('relate', withUsage('relate'));
    tracker?.start('overlap');
    overlapStarted = true;
  };

  tracker?.start('discover');
  let result: CurateResult;
  try {
    result = await curate(repoRoot, {
      models: resolveCurateModels(repoRoot),
      transport: resolveTransport(options),
      skipGit: options.skipGit,
      skipCorpusWrite: options.skipCorpusWrite,
      decisions: options.decisions,
      relevanceRunner: options.relevanceRunner,
      areaTagRunner: options.areaTagRunner,
      overlapRunner: options.overlapRunner,
      relationChainRunner: options.relationChainRunner,
      disableRelevanceFilter: options.disableRelevanceFilter,
      disableAreaTagging: options.disableAreaTagging,
      disableOverlapDetection: options.disableOverlapDetection,
      disableLlmRelationDetection: options.disableLlmRelationDetection,
      onRelevanceProgress: (done, total) => {
        if (total > 0) tracker?.detail('discover', withUsage('discover', `${done}/${total} docs`)!);
      },
      onTagProgress: (done, total) => {
        ensureTag();
        if (total > 0) tracker?.detail('tag', withUsage('tag', `${done}/${total} docs`)!);
      },
      onOverlapProgress: (done, total) => {
        ensureOverlap();
        tracker?.detail('overlap', withUsage('overlap', total > 0 ? `${done}/${total} pairs` : 'no pairs')!);
      },
    });
  } catch (e) {
    const active = overlapStarted ? 'overlap' : tagStarted ? 'tag' : 'discover';
    tracker?.error(active, (e as Error).message);
    throw e;
  }

  ensureOverlap();
  tracker?.done('overlap', withUsage('overlap', `${result.stats.areaCount} areas · ${result.stats.overlapFlags} overlaps`));

  if (options.source) {
    await trackEvent('spec_scan', {
      source: options.source,
      docsScannedRange: bucketFileCount(result.stats.docsScanned),
      claimsRange: bucketFileCount(result.stats.docsKept),
      openConflicts: result.stats.overlapFlags,
      durationRange: bucketDuration(Date.now() - startedAt),
    });
  }

  // "Nothing changed" = the scan made zero real LLM calls (every stage was a
  // cache hit — cache hits don't reach the transport, so they don't record
  // usage). Lets the dashboard tell the user a rescan found no doc changes.
  const llmCalls = [...getStageUsage().values()].reduce((n, u) => n + u.calls, 0);
  return { curate: result, noChanges: llmCalls === 0 };
}

export interface CorpusGenerateInProcessResult {
  corpus:
    | { kind: 'generated'; result: CorpusGenerateResult }
    | { kind: 'skipped'; reason: string }
    | { kind: 'failed'; error: Error };
}

export interface CorpusGenerateInProcessOptions {
  tracker?: StepTracker;
  source?: TelemetrySource;
  llm?: 'cli' | 'agent';
  io?: string;
  dryRun?: boolean;
  disableRepair?: boolean;
  batchSize?: number;
  /**
   * Pre-flight LLM cost estimate gate. Called with the token estimate before any
   * LLM work; return `false` to abort (throws {@link EstimateDeclined}).
   */
  onLlmEstimate?: (estimate: LlmEstimate) => Promise<boolean>;
  /** Skip the LLM gap-judge auto-close pass (gaps reported raw). */
  disableGapJudge?: boolean;
  // --- test seams ---
  enumerateRunner?: EnumerateRunner;
  generateRunner?: GenerateBatchRunner;
  gapJudgeRunner?: GapJudgeRunner;
}

/**
 * Generate the `.tc` corpus from `corpus.json` (corpus path). Returns
 * `kind: 'skipped'` when no corpus exists (run `spec scan` first).
 */
export async function generateFromCorpusInProcess(
  repoRoot: string,
  options: CorpusGenerateInProcessOptions = {},
): Promise<CorpusGenerateInProcessResult> {
  const { tracker } = options;
  const startedAt = Date.now();

  if (!hasCorpusSpec(repoRoot)) {
    tracker?.start('enumerate');
    tracker?.done('enumerate', 'skipped — no corpus');
    return { corpus: { kind: 'skipped', reason: 'no corpus' } };
  }

  // Pre-flight cost estimate + confirm, before any LLM call. When every area is
  // already cached the estimate has no stages — skip the prompt and just run
  // (the deterministic assemble/write tail still executes). Decline → abort.
  if (options.onLlmEstimate) {
    const prices = await getModelPrices();
    const estimate = await estimateGenerateTokens(repoRoot, prices);
    if ((estimate.stages?.length ?? 0) > 0) {
      const proceed = await options.onLlmEstimate(estimate);
      if (!proceed) throw new EstimateDeclined('generate');
    }
  }

  // Instrument every LLM call (opt-in via TRUECOURSE_LLM_LOG) so wall time can be
  // attributed per stage (enumerate / extract / repair). Null + zero overhead when unset.
  resetStageUsage();
  const llmLog = createLlmCallLogger(repoRoot, 'corpus-generate');
  if (llmLog) setLlmCallSink(llmLog.sink);
  const tGenStart = perfNow();

  // Multi-step checklist (matches scan): enumerate → reconcile → generate →
  // repair. We advance the tracker as the engine's deterministic phases fire,
  // with a moving count on the active step. No progress bar.
  const STEPS = ['enumerate', 'reconcile', 'generate', 'repair'] as const;
  let cur = 0; // index into STEPS of the active step
  let areasTotal = 0;
  let enumeratedAreas = 0;
  let areasDone = 0;
  let contractsEmitted = 0;
  let gaps = 0;
  let repairDone = 0;
  let repairTotal = 0;
  // A step's detail line = base text + its live usage tag (model/tokens/$).
  const withUsage = (key: string, base?: string): string | undefined => {
    const tag = stepUsageTag(key, repoRoot);
    if (base !== undefined) return `${base}${tag}`;
    return tag ? tag.replace(/^ · /, '') : undefined;
  };
  const advanceTo = (key: (typeof STEPS)[number]): void => {
    const ni = STEPS.indexOf(key);
    if (ni <= cur) return; // only ever move forward
    for (let i = cur; i < ni; i++) tracker?.done(STEPS[i], withUsage(STEPS[i]));
    tracker?.start(key);
    cur = ni;
  };
  const genDetail = (): string =>
    withUsage(
      'generate',
      `${areasDone}/${areasTotal} areas · ${contractsEmitted} contracts` + (gaps > 0 ? ` · ${gaps} gaps` : ''),
    )!;

  tracker?.start('enumerate');

  try {
    const result = await generateContractsFromCorpus({
      repoRoot,
      transport: resolveTransport(options),
      models: resolveCorpusGenerateModels(repoRoot),
      dryRun: options.dryRun,
      disableRepair: options.disableRepair,
      batchSize: options.batchSize,
      disableGapJudge: options.disableGapJudge,
      enumerateRunner: options.enumerateRunner,
      generateRunner: options.generateRunner,
      gapJudge: options.gapJudgeRunner,
      onAreasReady: (n) => {
        areasTotal = n;
        tracker?.detail('enumerate', withUsage('enumerate', `0/${n} areas`)!);
      },
      onAreaEnumerated: () => {
        enumeratedAreas++;
        tracker?.detail('enumerate', withUsage('enumerate', `${enumeratedAreas}/${areasTotal} areas`)!);
        // All areas enumerated → the (silent) reconcile pass runs next.
        if (enumeratedAreas >= areasTotal) advanceTo('reconcile');
      },
      onContractsEmitted: (delta) => {
        advanceTo('generate');
        contractsEmitted += delta;
        tracker?.detail('generate', genDetail());
      },
      onAreaDone: (cov) => {
        advanceTo('generate');
        areasDone++;
        gaps += cov.gaps.length;
        tracker?.detail('generate', genDetail());
      },
      onRepairProgress: (e) => {
        advanceTo('repair');
        repairDone = e.done;
        repairTotal = e.total;
        tracker?.detail('repair', withUsage('repair', `${repairDone}/${repairTotal}`)!);
      },
    });
    // A resolver-hard corpus (duplicate/conflicting identities) produced NO
    // contracts — surface it as a failure to the tracker AND the discriminant, so
    // a caller keying off `kind` (e.g. a dashboard route) can't read it as success.
    if (result.resolverHard) {
      tracker?.error(STEPS[cur], 'corpus failed to resolve (duplicate or conflicting identities)');
      return {
        corpus: {
          kind: 'failed',
          error: resolverHardError(result) ?? new Error('Contract corpus failed to resolve.'),
        },
      };
    }
    // A dry run populates `proposed`, not `written` — report the right count.
    const produced = options.dryRun ? result.write.proposed.length : result.write.written.length;
    // Mark every remaining step done; the file/gap summary lands on `generate`.
    for (let i = cur; i < STEPS.length; i++) tracker?.done(STEPS[i], withUsage(STEPS[i]));
    tracker?.done(
      'generate',
      withUsage(
        'generate',
        `${options.dryRun ? 'would write ' : ''}${produced} file${produced === 1 ? '' : 's'} · ${result.gaps.length} gap${result.gaps.length === 1 ? '' : 's'}`,
      ),
    );
    // Stamp the staleness marker only on a real (non-dry) resolved write, and
    // persist the run summary so the dashboard can show written/gaps/issues after
    // a reload (the run result is otherwise transient).
    // Skip on a no-op run (noChanges) — it wrote nothing, so don't overwrite the
    // prior run's summary with zeros.
    if (!options.dryRun && !result.noChanges)
      stampGeneratedMarker(repoRoot, {
        written: result.write.written.length,
        gaps: result.gaps,
        validationIssues: result.validationIssues,
      });
    if (options.source && !options.dryRun) {
      await trackEvent('contracts_generate', {
        source: options.source,
        artifactsWrittenRange: bucketFileCount(result.write.written.length),
        validationIssues: result.validationIssues.length,
        durationRange: bucketDuration(Date.now() - startedAt),
      });
    }
    return { corpus: { kind: 'generated', result } };
  } catch (e) {
    tracker?.error(STEPS[cur], (e as Error).message);
    return { corpus: { kind: 'failed', error: e instanceof Error ? e : new Error(String(e)) } };
  } finally {
    if (llmLog) {
      setLlmCallSink(undefined);
      llmLog.finish(perfNow() - tGenStart);
    }
  }
}

/**
 * A blocking resolver-level corpus error (e.g. duplicate/conflicting artifact
 * identities) means generation produced NO contracts — a failure, not "no
 * contracts." Return a descriptive error (with the hard issue reasons) so the
 * caller can throw and surface it, instead of silently saving an empty corpus.
 */
function resolverHardError(result: {
  resolverHard: boolean;
  validationIssues: Array<{ severity: 'hard' | 'soft'; message: string }>;
}): Error | null {
  if (!result.resolverHard) return null;
  const reasons = result.validationIssues.filter((i) => i.severity === 'hard').map((i) => i.message);
  const detail = reasons.length ? reasons.slice(0, 3).join('; ') : 'duplicate or conflicting artifact identities';
  return new Error(`Contract corpus failed to resolve — ${detail}`);
}

// ---------------------------------------------------------------------------
// Workspace Knowledge (enterprise) — corpus path.
//
// External KB sources (Confluence, …) are synced as in-memory markdown. The
// corpus engine is disk-based, so we materialize the docs into a TRANSIENT
// scratch tree, run curate + corpus-generate over it exactly like a repo, then
// persist the curated corpus + the generated `.tc` contracts under WORKSPACE
// scope (Postgres in EE). The scratch tree — and the bodies — are deleted after.
// Unchanged docs hit the per-doc / per-slice caches → ~0 LLM on re-sync.
// ---------------------------------------------------------------------------

/** One source document handed to the workspace corpus sync. The body is transient. */
export interface WorkspaceDocInput {
  /** Stable, namespaced relative path, e.g. `knowledge/confluence/<externalId>.md`. */
  docPath: string;
  /** The transient markdown body. Never persisted. */
  markdown: string;
  /** ISO timestamp (the source tool's `updatedAt`); informational. */
  lastTouched?: string;
}

export interface WorkspaceCorpusSyncResult {
  /** Areas in the curated workspace corpus. */
  areaCount: number;
  /** Workspace `.tc` files generated and stored. */
  contractFileCount: number;
  /** Validation issues surfaced by generate (0 = clean). */
  validationIssues: number;
}

/**
 * Curate + generate workspace Knowledge contracts on the corpus path and persist
 * them under workspace scope. Returns counts for the sync notice. Best-effort
 * generate: a resolver-hard corpus throws (the caller surfaces it); otherwise the
 * `.tc` corpus is replaced wholesale.
 */
export async function syncWorkspaceCorpusInProcess(options: {
  workspaceOrgId: string;
  docs: WorkspaceDocInput[];
  tracker?: StepTracker;
  source?: TelemetrySource;
  llm?: 'cli' | 'agent';
  io?: string;
}): Promise<WorkspaceCorpusSyncResult> {
  const ref: WorkspaceRef = { workspaceOrgId: options.workspaceOrgId };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ws-corpus-'));
  try {
    // Materialize the synced docs into the scratch tree (the corpus engine reads files).
    for (const doc of options.docs) {
      const dest = path.join(tmp, doc.docPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, doc.markdown, 'utf-8');
    }

    const { curate: curateResult } = await curateInProcess(tmp, {
      tracker: options.tracker,
      skipGit: true,
      llm: options.llm,
      io: options.io,
    });
    // Persist the curated corpus under workspace scope (the dashboard reads it).
    await saveWorkspaceSpec(ref, 'corpus', curateResult.corpus);

    const { corpus } = await generateFromCorpusInProcess(tmp, {
      llm: options.llm,
      io: options.io,
    });
    if (corpus.kind === 'failed') throw corpus.error;
    if (corpus.kind === 'skipped') {
      // No areas to generate from → clear any stale workspace corpus.
      await saveWorkspaceContracts(ref, 'contracts', {});
      return { areaCount: curateResult.stats.areaCount, contractFileCount: 0, validationIssues: 0 };
    }

    const files = readContractTree(path.join(tmp, '.truecourse', 'contracts'));
    await saveWorkspaceContracts(ref, 'contracts', files);

    if (options.source) {
      await trackEvent('contracts_generate', {
        source: options.source,
        artifactsWrittenRange: bucketFileCount(Object.keys(files).length),
        validationIssues: corpus.result.validationIssues.length,
        durationRange: bucketDuration(0),
      });
    }
    return {
      areaCount: curateResult.stats.areaCount,
      contractFileCount: Object.keys(files).length,
      validationIssues: corpus.result.validationIssues.length,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Walk a `.tc` contract tree into a `{ posix relPath → content }` map. */
function readContractTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(root)) return out;
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && entry.name.endsWith('.tc')) {
        const rel = path.relative(root, abs).split(path.sep).join('/');
        out[rel] = fs.readFileSync(abs, 'utf-8');
      }
    }
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// verify — compare code against generated IL contracts
// ---------------------------------------------------------------------------

// Pre-store location, kept only so a verify run can delete it. The verifier
// store (`verifier/LATEST.json`) is the single source of truth — there is no
// read fallback to this path.
const LEGACY_VERIFY_STATE_REL = path.join('.truecourse', '.cache', 'verifier', 'verify-state.json');

function legacyVerifyStatePath(repoRoot: string): string {
  return path.join(repoRoot, LEGACY_VERIFY_STATE_REL);
}

/**
 * Current verify state, read from the verifier store's `LATEST.json` only.
 * Returns null when no run has been recorded — callers show a "Run verify"
 * CTA. (No fallback to the legacy `verify-state.json`.)
 */
export async function readVerifyState(repoRoot: string): Promise<VerifyState | null> {
  const latest = await readVerifyLatest(repoRoot);
  if (!latest) return null;
  return {
    verifiedAt: latest.run.verifiedAt,
    contractsDir: latest.run.contractsDir,
    codeDir: latest.run.codeDir,
    artifactCount: latest.artifactCount,
    extractedOperationCount: latest.extractedOperationCount,
    drifts: latest.drifts,
    resolverErrors: latest.resolverErrors,
    unresolvedRefs: latest.unresolvedRefs,
    commitHash: latest.run.commitHash,
  };
}

/**
 * State for a specific past verify run, looked up by run id via the history
 * index. Same `VerifyState` shape as `readVerifyState` so the dashboard's
 * "view a past run" path reuses the live view unchanged. Null if the run
 * (or its snapshot file) is gone.
 */
export async function readVerifyRunState(
  repoRoot: string,
  runId: string,
): Promise<VerifyState | null> {
  const entry = (await readVerifyHistoryStore(repoRoot)).runs.find((r) => r.id === runId);
  if (!entry) return null;
  const snap = await readVerifyRun(repoRoot, entry.filename);
  if (!snap) return null;
  return {
    verifiedAt: snap.verifiedAt,
    contractsDir: snap.contractsDir,
    codeDir: snap.codeDir,
    artifactCount: snap.artifactCount,
    extractedOperationCount: snap.extractedOperationCount,
    drifts: snap.drifts,
    resolverErrors: snap.resolverErrors,
    unresolvedRefs: snap.unresolvedRefs,
    commitHash: snap.commitHash,
  };
}

export interface VerifyInProcessOptions {
  tracker?: StepTracker;
  /**
   * Where to find the IL contracts. Defaults to
   * `<repoRoot>/.truecourse/contracts`.
   */
  contractsDir?: string;
  /**
   * Where the implementation code lives. Defaults to the repo root
   * itself. For our fixture layout (`<repoRoot>/code/`), pass that
   * explicitly.
   */
  codeDir?: string;
  /**
   * Analyze the working tree as-is instead of stashing dirty changes first.
   * The CLI sets this from `--no-stash` (or after the user declines the stash
   * prompt). Defaults to `false` (stash if dirty) so the baseline reflects the
   * committed state — mirroring `analyze`. Diff mode ignores this (never stashes).
   */
  skipStash?: boolean;
  /** Adapter that triggered this run; auto-emitted in the `verify` telemetry payload. */
  source?: TelemetrySource;
  /**
   * Source contracts from the store under this identity instead of deriving
   * from `repoRoot`. The EE gate sets it to verify the PR head's stored
   * contracts (`owner/repo` + head SHA) against the cloned working tree. When
   * omitted, derived from `repoRoot`'s HEAD; `options.contractsDir` overrides both.
   */
  ref?: RepoRef;
  /**
   * Load the CONTRACTS from this ref instead of `ref`. The gate sets it to verify
   * a PR head's CODE against the BASE's already-resolved contracts when the PR
   * changes no spec docs — so it never re-scans, while the snapshot still keys by
   * `ref` (the head). Omitted → contracts come from `ref`.
   */
  contractsRef?: RepoRef;
  /**
   * Transient verify: record ONLY this commit's per-commit snapshot, and skip the
   * repo's canonical LATEST/runs/history writes. The EE gate sets it so a PR-head
   * verify never moves the repo's baseline (the baseline job — non-transient — is
   * the only writer that does). OSS/local never sets it. Defaults to `false`.
   */
  transient?: boolean;
  /** Override the commit SHA when `ref` is omitted. */
  commitOverride?: string;
  /**
   * Verify against the repo's EFFECTIVE contracts (enterprise): union the
   * workspace contracts for this org UNDER the repo's, repo winning on a
   * `${kind}:${identity}` collision. Omitted (OSS/local, or an EE repo not linked
   * to a workspace) → repo-only, unchanged. The workspace layer is materialized
   * transiently and cleaned up after the run.
   */
  workspaceOrgId?: string | null;
}

/**
 * Compare the canonical IL contracts against the code in `codeDir`
 * and persist the result to `.truecourse/.cache/verifier/`. Same
 * pattern as the curate/generate drivers: shared between CLI and
 * dashboard, drives a tracker through three phases (load contracts,
 * extract code-side operations, compare).
 */
/**
 * Source the authored contract tree (`options.contractsDir` override → store)
 * and run `fn` with the local dir + the value to record in snapshots, always
 * cleaning up the materialization afterward. OSS: the store returns the live
 * `<repo>/.truecourse/contracts` with a no-op cleanup (byte-identical to the old
 * inline path). EE: a temp dir materialized from the content-addressed store,
 * `rm -rf`'d in the `finally`; the recorded value is a logical `contracts@<sha>`
 * descriptor, never the ephemeral temp path.
 */
async function withContracts<T>(
  repoRoot: string,
  options: VerifyInProcessOptions,
  tracker: StepTracker | undefined,
  fn: (contractsDir: string, recordedContractsDir: string, baseContractsDir?: string) => Promise<T>,
): Promise<T> {
  const fallbackPath = path.join(repoRoot, '.truecourse', 'contracts');
  // EFFECTIVE merge (enterprise): the workspace contracts are the BASE layer the
  // repo's contracts override on a key collision. Absent org / no workspace
  // corpus / OSS file store → null → repo-only (unchanged).
  const wsMat = options.workspaceOrgId
    ? await loadWorkspaceContracts({ workspaceOrgId: options.workspaceOrgId }, 'contracts')
    : null;
  let repoMat: MaterializedDir | null = null;
  try {
    let recorded: string;
    if (options.contractsDir) {
      if (!fs.existsSync(options.contractsDir)) {
        const err = new Error(
          `Contracts directory not found at ${options.contractsDir}. Run \`truecourse contracts generate\` first.`,
        );
        tracker?.error('load', err.message);
        throw err;
      }
      repoMat = { dir: options.contractsDir, cleanup: async () => {} };
      recorded = options.contractsDir;
    } else {
      // Contracts come from `contractsRef` when set (gate base-reuse), else `ref`.
      const ref = options.contractsRef ?? options.ref ?? (await repoRef(repoRoot, options.commitOverride));
      repoMat = await loadContracts(ref, 'contracts');
      recorded = repoMat
        ? contractsMaterializeInPlace()
          ? repoMat.dir
          : `contracts@${ref.commitSha}`
        : 'workspace:contracts';
    }

    // Repo is the PRIMARY layer (wins on collision); workspace is the BASE. When
    // the repo has NO contracts of its own, the workspace IS the corpus (no base)
    // — the cross-repo ripple. Neither present → genuinely no spec.
    if (!repoMat && !wsMat) {
      const err = new Error(
        `Contracts directory not found at ${fallbackPath}. Run \`truecourse contracts generate\` first.`,
      );
      tracker?.error('load', err.message);
      throw err;
    }
    const primaryDir = (repoMat ?? wsMat!).dir;
    const baseDir = repoMat ? wsMat?.dir : undefined;
    return await fn(primaryDir, recorded, baseDir);
  } finally {
    await repoMat?.cleanup();
    await wsMat?.cleanup();
  }
}

export async function verifyInProcess(
  repoRoot: string,
  options: VerifyInProcessOptions = {},
): Promise<VerifyInProcessResult> {
  const { tracker } = options;
  const startedAt = Date.now();
  const codeDir = options.codeDir ?? autodetectCodeDir(repoRoot);

  return withContracts(repoRoot, options, tracker, async (contractsDir, recordedContractsDir, baseContractsDir) => {
  // The verifier doesn't expose per-phase hooks today, so we mark
  // each step done as soon as `verify()` returns. The work is
  // synchronous-feeling from the caller's POV (~hundreds of ms on
  // the fixture), so a single progress emit per phase is fine.
  tracker?.start('load');
  let result: VerifyResult;
  try {
    // `verify()` internally: load .tc files → resolve → extract
    // code-side operations → compare. We collapse those phases into
    // one tracker call because the engine doesn't surface them yet.
    // Stash dirty changes first (unless opted out) so the baseline reflects
    // the committed state — same model as a full `analyze`.
    result = await runWithStash(repoRoot, options.skipStash ?? false, tracker, () =>
      verify({ contractsDir, codeDir, baseContractsDir }),
    );
  } catch (e) {
    tracker?.error('load', (e as Error).message);
    throw e;
  }
  tracker?.done(
    'load',
    `${result.artifactCount} artifact${result.artifactCount === 1 ? '' : 's'}`,
  );

  tracker?.start('extract-code');
  tracker?.done(
    'extract-code',
    `${result.extractedOperationCount} operation${result.extractedOperationCount === 1 ? '' : 's'}`,
  );

  tracker?.start('compare');
  tracker?.done(
    'compare',
    `${result.drifts.length} drift${result.drifts.length === 1 ? '' : 's'}`,
  );

  // Stored snapshots must be PORTABLE + repo-relative. The EE gate verifies on an
  // EPHEMERAL clone (`repoRoot` = a temp dir like /tmp/tc-gate-verify-XXX), so the
  // verifier's absolute drift paths are meaningless once the clone is deleted —
  // the dashboard can't render or deep-link them. When persisting by `ref` (EE),
  // rewrite drift paths to repo-root-relative POSIX form so the dashboard's "Where
  // in the code" + the GitHub blob deep-link resolve correctly. OSS/local (no ref)
  // keeps its absolute local paths for the in-app file viewer (unchanged).
  if (options.ref) {
    result.drifts = result.drifts.map((d) =>
      d.filePath && path.isAbsolute(d.filePath)
        ? { ...d, filePath: path.relative(repoRoot, d.filePath).split(path.sep).join('/') }
        : d,
    );
  }

  // Persist mirroring analyze: write a per-run snapshot, materialize LATEST
  // (the diff baseline), append a history summary, and drop any stale diff.
  const verifiedAt = new Date().toISOString();
  const { branch, commitHash } = await gitMeta(repoRoot);
  const runId = randomUUID();
  const snapshot: VerifyRunSnapshot = {
    id: runId,
    verifiedAt,
    branch,
    commitHash,
    contractsDir: recordedContractsDir,
    codeDir,
    artifactCount: result.artifactCount,
    extractedOperationCount: result.extractedOperationCount,
    drifts: result.drifts,
    resolverErrors: result.resolverErrors,
    unresolvedRefs: result.unresolvedRefs,
  };
  // Canonical persistence — the repo's LATEST + run timeline + history. A
  // TRANSIENT verify (the gate, on a PR-head clone) SKIPS this so it never moves
  // the repo's baseline; it records only the per-commit snapshot below. OSS/local
  // is never transient, so its behaviour is unchanged.
  if (!options.transient) {
    // Hosted (EE) stores by repo identity, not files: the gate runs verify on an
    // ephemeral clone (`repoRoot` = a temp dir), so persist by the ref's repoKey —
    // otherwise the dashboard Verify tab (which reads by repoKey) never finds it.
    // Only when the HOSTED store is active, though: the OSS file store must key by
    // the working-tree path (a repoKey like `owner/repo` would write a bogus
    // cwd-relative `.truecourse/`). OSS/local has no ref → repoRoot regardless.
    const storeKey =
      options.ref && !verifyMaterializeInPlace() ? options.ref.repoKey : repoRoot;
    const { filename } = await writeVerifyRun(storeKey, snapshot);
    const summary = summarizeDrifts(result.drifts);
    const latest: VerifyLatest = {
      head: filename,
      run: { id: runId, verifiedAt, branch, commitHash, contractsDir: recordedContractsDir, codeDir },
      artifactCount: result.artifactCount,
      extractedOperationCount: result.extractedOperationCount,
      drifts: result.drifts,
      resolverErrors: result.resolverErrors,
      unresolvedRefs: result.unresolvedRefs,
      summary,
    };
    await writeVerifyLatest(storeKey, latest);
    await appendVerifyHistory(storeKey, {
      id: runId,
      filename,
      verifiedAt,
      branch,
      commitHash,
      artifactCount: result.artifactCount,
      driftCount: result.drifts.length,
      bySeverity: summary.bySeverity,
    });
    await deleteVerifyDiff(storeKey); // baseline moved — any prior diff is obsolete
    fs.rmSync(legacyVerifyStatePath(repoRoot), { force: true }); // drop pre-store cruft (file edition)
  }

  const state: VerifyState = {
    verifiedAt,
    contractsDir: recordedContractsDir,
    codeDir,
    artifactCount: result.artifactCount,
    extractedOperationCount: result.extractedOperationCount,
    drifts: result.drifts,
    resolverErrors: result.resolverErrors,
    unresolvedRefs: result.unresolvedRefs,
    commitHash,
  };

  if (options.source) {
    await trackEvent('verify', {
      source: options.source,
      mode: 'full',
      artifactCountRange: bucketFileCount(result.artifactCount),
      operationCountRange: bucketFileCount(result.extractedOperationCount),
      driftCountRange: bucketFileCount(result.drifts.length),
      durationRange: bucketDuration(Date.now() - startedAt),
    });
  }

  // EE: persist this commit's verify snapshot so the dashboard ref switcher can
  // show a PR's drift (the verify-store's LATEST is per-repo, not per-commit).
  // OSS omits `ref`, so nothing extra is written.
  if (options.ref) {
    await saveSpec(options.ref, 'verifyState', state);
  }

  return { verify: result, state };
  });
}

/** Best-effort current branch + commit; null when not a git repo. */
async function gitMeta(repoRoot: string): Promise<{ branch: string | null; commitHash: string | null }> {
  try {
    const git = await getGit(repoRoot);
    const branch = (await git.branch()).current || null;
    const commitHash = (await git.revparse(['HEAD'])).trim() || null;
    return { branch, commitHash };
  } catch {
    return { branch: null, commitHash: null };
  }
}

/**
 * Run `fn` against the committed state by stashing the dirty working tree first
 * and popping after — mirroring `analyze-core`'s full-mode stash. No-ops when
 * `skipStash`, when the tree is clean, when the repo is a subdirectory of a
 * larger repo (stashing would touch parent-repo files), or when git is
 * unavailable.
 */
async function runWithStash<T>(
  repoRoot: string,
  skipStash: boolean,
  tracker: StepTracker | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  let didStash = false;
  let stashGit: Awaited<ReturnType<typeof getGit>> | undefined;
  if (!skipStash) {
    try {
      stashGit = await getGit(repoRoot);
      const status = await stashGit.status();
      if (!status.isClean()) {
        const gitRoot = (await stashGit.revparse(['--show-toplevel'])).trim();
        if (path.resolve(repoRoot) === path.resolve(gitRoot)) {
          tracker?.detail?.('load', 'Stashing pending changes...');
          const res = await stashGit.stash(['push', '--include-untracked', '-m', 'truecourse-verify-stash']);
          didStash = !res.includes('No local changes');
        }
      }
    } catch {
      // Not a git repo / git unavailable — verify the current state as-is.
    }
  }
  try {
    return await fn();
  } finally {
    if (didStash && stashGit) {
      tracker?.detail?.('load', 'Restoring pending changes...');
      try {
        await stashGit.stash(['pop']);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[Verify] Failed to restore stashed changes. Run "git stash pop" manually. ${(e as Error).message}`);
      }
    }
  }
}

/** Uncommitted working-tree changes from `git status`; empty when not a repo. */
async function gitChangedFiles(repoRoot: string): Promise<import('../types/verify-snapshot.js').ChangedFile[]> {
  const out: import('../types/verify-snapshot.js').ChangedFile[] = [];
  try {
    const git = await getGit(repoRoot);
    const s = await git.status();
    for (const f of s.not_added) out.push({ path: f, status: 'new' });
    for (const f of s.created) out.push({ path: f, status: 'new' });
    for (const f of s.modified) out.push({ path: f, status: 'modified' });
    for (const f of s.staged) if (!out.some((c) => c.path === f)) out.push({ path: f, status: 'modified' });
    for (const f of s.deleted) out.push({ path: f, status: 'deleted' });
  } catch {
    /* not a repo */
  }
  return out;
}

/**
 * Diff the current working tree's drifts against the committed `LATEST.json`
 * baseline (mirrors `analyze --diff`). Drifts are matched by obligation key
 * (`driftKey`) so the comparison is stable even though `ContractDrift.id`
 * regenerates each run. Writes `verifier/diff.json` and does NOT touch LATEST.
 */
export async function verifyDiffInProcess(
  repoRoot: string,
  options: VerifyInProcessOptions = {},
): Promise<VerifyDiffInProcessResult> {
  const { tracker } = options;
  const startedAt = Date.now();
  const codeDir = options.codeDir ?? autodetectCodeDir(repoRoot);

  // The diff is "what do my uncommitted changes do vs the committed baseline",
  // so it requires a git repo (like `analyze --diff`).
  if (!(await isGitRepo(repoRoot))) {
    const err = new Error(
      'Verify diff requires a git repository — the diff compares your working-tree changes against the committed baseline.',
    );
    tracker?.error('load', err.message);
    throw err;
  }
  const baseline = await readVerifyLatest(repoRoot);
  if (!baseline) {
    const err = new Error(
      'No verify baseline found. Run `truecourse verify` first to establish LATEST.json.',
    );
    tracker?.error('load', err.message);
    throw err;
  }

  return withContracts(repoRoot, options, tracker, async (contractsDir) => {
  tracker?.start('load');
  let result: VerifyResult;
  try {
    // Diff mode never stashes — it verifies the working tree as-is.
    result = await verify({ contractsDir, codeDir });
  } catch (e) {
    tracker?.error('load', (e as Error).message);
    throw e;
  }
  tracker?.done('load', `${result.artifactCount} artifact${result.artifactCount === 1 ? '' : 's'}`);

  tracker?.start('extract-code');
  tracker?.done('extract-code', `${result.extractedOperationCount} operation${result.extractedOperationCount === 1 ? '' : 's'}`);

  tracker?.start('compare');
  const { added, resolved, unchangedCount } = diffDrifts(baseline.drifts, result.drifts);

  const { branch, commitHash } = await gitMeta(repoRoot);
  const changedFiles = await gitChangedFiles(repoRoot);
  const diff: VerifyDiff = {
    id: randomUUID(),
    baseRunId: baseline.run.id,
    verifiedAt: new Date().toISOString(),
    branch,
    commitHash,
    added,
    resolved,
    unchangedCount,
    changedFiles,
    summary: { added: added.length, resolved: resolved.length, unchanged: unchangedCount },
  };
  await writeVerifyDiff(repoRoot, diff);
  tracker?.done('compare', `+${added.length} / -${resolved.length} drift${added.length + resolved.length === 1 ? '' : 's'}`);

  if (options.source) {
    await trackEvent('verify', {
      source: options.source,
      mode: 'diff',
      addedRange: bucketFileCount(added.length),
      resolvedRange: bucketFileCount(resolved.length),
      durationRange: bucketDuration(Date.now() - startedAt),
    });
  }

  return { verify: result, diff };
  });
}

export interface InferInProcessOptions {
  tracker?: StepTracker;
  /** Where authored contracts live (the coverage baseline). Defaults to
   *  `<repoRoot>/.truecourse/contracts`. `_inferred/` is always excluded. */
  contractsDir?: string;
  /** Where the implementation code lives. Defaults to the auto-detected
   *  code dir (the `code/` subdir when present, else the repo root). */
  codeDir?: string;
  /** When true, don't write — just report what would be written. */
  dryRun?: boolean;
  /** Adapter that triggered this run; auto-emitted in the `infer` telemetry payload. */
  source?: TelemetrySource;
  /** Explicit store identity (EE). When omitted, derived from `repoRoot`'s HEAD. */
  ref?: RepoRef;
  /**
   * Fallback contracts source when `ref` has no authored contracts of its own. In
   * the gate's warm path (a PR that changed no spec) the head commit stores no
   * `contracts` — the head's code was verified against the BASELINE's contracts —
   * so coverage must subtract those. Pass the baseline ref here; `ref` (the head)
   * is still tried first (the cold path, where the PR generated its own contracts).
   */
  contractsRef?: RepoRef;
  /** Override the commit SHA when `ref` is omitted. */
  commitOverride?: string;
  /**
   * Re-apply promoted decisions into authored `contracts` (default true). Set false
   * for a transient PR-head infer, where it would write a partial `contracts`
   * manifest at the head and pollute the contracts tree/diff.
   */
  reapplyPromotions?: boolean;
}

/**
 * Reverse-engineer undocumented decisions from `codeDir` and write them as
 * `inferred` `.tc` artifacts under `<contractsDir>/_inferred/`. The mirror of
 * `verifyInProcess`: instead of checking code against the spec, it surfaces
 * what the code decided that the spec never recorded. Coverage is computed
 * from authored contracts only, so a decision drops out once it's documented.
 */
export async function inferInProcess(
  repoRoot: string,
  options: InferInProcessOptions = {},
): Promise<InferInProcessResult> {
  const startedAt = Date.now();
  const codeDir = options.codeDir ?? autodetectCodeDir(repoRoot);

  // Resolve the authored-contract coverage dir (also where the inferred `.tc` output
  // is written). EE runs on an ephemeral clone with no committed `.truecourse/contracts`
  // — its contracts live in the store — so when a `ref` is set we materialize them from
  // the store, the same source `verify` reads. Reading the clone's disk would see zero
  // contracts and re-infer everything already documented. OSS (no `ref`) uses the
  // working-tree dir; an explicit `contractsDir` overrides both.
  let contractsDir = options.contractsDir ?? path.join(repoRoot, '.truecourse', 'contracts');
  let releaseContracts: () => Promise<void> = async () => {};
  if (!options.contractsDir && options.ref) {
    // Prefer the head ref's own authored contracts (the cold path — the PR changed
    // the spec and the gate generated contracts at the head). When the head has none
    // (the warm path), fall back to `contractsRef` (the baseline) so coverage matches
    // the contracts the gate verified against — otherwise infer sees nothing and
    // re-offers everything already documented.
    const mat =
      (await loadContracts(options.ref, 'contracts')) ??
      (options.contractsRef ? await loadContracts(options.contractsRef, 'contracts') : null);
    if (mat) {
      contractsDir = mat.dir;
      releaseContracts = mat.cleanup;
    }
  }

  try {
    return await persistInferred(repoRoot, options, contractsDir, codeDir, startedAt);
  } finally {
    await releaseContracts();
  }
}

/**
 * Run inference against the resolved `contractsDir` and persist the results. Split
 * from {@link inferInProcess} only so a store-materialized `contractsDir` can be
 * released in a `finally`.
 */
async function persistInferred(
  repoRoot: string,
  options: InferInProcessOptions,
  contractsDir: string,
  codeDir: string,
  startedAt: number,
): Promise<InferInProcessResult> {
  const { tracker } = options;

  tracker?.start('load');
  let result: InferResult;
  try {
    result = await infer({ contractsDir, codeDir });
  } catch (e) {
    tracker?.error('load', (e as Error).message);
    throw e;
  }
  const covered = Object.values(result.coveredCounts).reduce((a, b) => a + b, 0);
  tracker?.done('load', `${covered} authored artifact${covered === 1 ? '' : 's'}`);

  tracker?.start('scan');
  tracker?.done(
    'scan',
    `${result.decisions.length} undocumented decision${result.decisions.length === 1 ? '' : 's'}`,
  );

  tracker?.start('write');
  const { written, proposed } = writeInferred(contractsDir, result.decisions, {
    dryRun: options.dryRun,
  });
  tracker?.done(
    'write',
    options.dryRun
      ? `${proposed.length} would be written`
      : `${written.length} written`,
  );

  if (options.source) {
    await trackEvent('infer', {
      source: options.source,
      decisionsRange: bucketFileCount(result.decisions.length),
      dryRun: !!options.dryRun,
      durationRange: bucketDuration(Date.now() - startedAt),
    });
  }

  // Ingest the inferred `.tc` subtree into the active store as the split kind,
  // when the caller passes an explicit `ref` (EE). OSS omits `ref` → no ingest.
  if (!options.dryRun && options.ref) {
    await saveContracts(options.ref, 'contracts_inferred', path.join(contractsDir, '_inferred'));
  }

  // Render each decision once — its `.tc` rel path keys the contracts_inferred set
  // (so the gate/promote can locate it) and its source is the detail-view body.
  const rendered = result.decisions.map((d) => renderDecision(d));
  const decisionPaths = rendered.map((r) => r.relPath);

  // The structured summaries the dashboard's Inferred tab reads — built regardless
  // of dryRun so the OSS diff run (dryRun: true) can compute the working-tree set
  // without overwriting the committed baseline.
  const summaries: InferredDecisionSummary[] = result.decisions.map((d, i) => ({
    kind: d.kind,
    identity: d.identity,
    path: d.codeLoc?.path,
    line: d.codeLoc?.lines?.[0],
    reason: d.reason,
    confidence: d.confidence,
    contractPath: decisionPaths[i],
    tc: rendered[i].tcSource,
  }));

  // Persist them — OSS (file under `specs/`) and EE (Postgres) alike. The store ref
  // is the PR head / baseline commit in EE; in OSS the repo tree (commit unused).
  if (!options.dryRun) {
    const specRef = options.ref ?? { repoKey: repoRoot, commitSha: options.commitOverride ?? '' };
    await saveSpec(specRef, 'inferredDecisions', summaries);
    // Re-apply user promotions: writing the `.tc` files regenerated the inferred
    // tree, so each promoted decision's `.tc` is rewritten into authored contracts.
    // Skipped for a transient PR-head infer (`reapplyPromotions: false`) — there it
    // would write a PARTIAL `contracts` manifest at the head (just the promotions),
    // polluting the contracts tree/diff into showing the whole base as removed.
    if (options.reapplyPromotions ?? true) await reapplyPromoted(specRef, summaries);
  }

  return { infer: result, written, proposed, decisionPaths, summaries };
}

/**
 * OSS Git-Diff: the inferred decisions the WORKING TREE adds/changes vs the
 * committed baseline (`specs/inferredDecisions.json`, committed like the analyze
 * `LATEST.json`). Re-runs inference on the working tree with `dryRun` so the
 * baseline file is untouched, then diffs against it. Mirrors `verifyDiffInProcess`.
 * EE uses the per-commit `/inferred/diff?ref=` route instead.
 */
export async function inferDiffInProcess(
  repoRoot: string,
  options: InferInProcessOptions = {},
): Promise<InferDiff> {
  const { summaries: current } = await inferInProcess(repoRoot, { ...options, dryRun: true });
  const baseRaw = await loadLatestSpec<InferredDecisionSummary[]>(repoRoot, 'inferredDecisions');
  const actions = await listInferredActions(repoRoot);
  const head = applyInferredActions(current, actions);
  const base = baseRaw ? applyInferredActions(baseRaw, actions) : null;
  return diffDecisions(head, base);
}

/**
 * Try to find the project's code root. Most real projects keep code
 * at the repo root; the fixture nests it under `code/`. We prefer
 * the explicit subdir when present; otherwise fall back to repoRoot.
 */
function autodetectCodeDir(repoRoot: string): string {
  const codeSubdir = path.join(repoRoot, 'code');
  if (fs.existsSync(codeSubdir) && fs.statSync(codeSubdir).isDirectory()) {
    return codeSubdir;
  }
  return repoRoot;
}

// ---------------------------------------------------------------------------
// Decisions, routed through the SpecStore seam.
//
// OSS: the on-disk files via the IL (byte-identical). EE: Postgres `spec_sets`.
// Decisions are the user's accumulated resolutions — a single per-repo "current"
// document, not a per-commit snapshot. The dashboard read/edit routes use these.
// ---------------------------------------------------------------------------

const EMPTY_DECISIONS: DecisionsFile = {
  version: 1,
  manualIncludes: [],
  relations: [],
  manualAreas: [],
};
/** Sentinel commit for the per-repo "current" decisions document in EE. */
const DECISIONS_REF = '_repo';

async function loadDecisions(repoKey: string): Promise<DecisionsFile> {
  if (specsMaterializeInPlace()) return readDecisions(repoKey);
  return (
    (await loadSpec<DecisionsFile>({ repoKey, commitSha: DECISIONS_REF }, 'decisions')) ??
    EMPTY_DECISIONS
  );
}

async function storeDecisions(repoKey: string, next: DecisionsFile): Promise<void> {
  if (specsMaterializeInPlace()) {
    writeDecisions(repoKey, next);
    return;
  }
  await saveSpec({ repoKey, commitSha: DECISIONS_REF }, 'decisions', next);
}

/** The repo's current decisions (dashboard read) — file in OSS, Postgres in EE. */
export function getDecisions(repoKey: string): Promise<DecisionsFile> {
  return loadDecisions(repoKey);
}

/**
 * The repo's current curated corpus (dashboard read), or null when no scan has
 * run. Corpus-path analog of {@link getScanState}; no remerge needed since user
 * relations are folded into corpus.json at curate time. OSS reads
 * `specs/corpus.json`; EE reads the store (Phase 6).
 */
export function getCorpus(repoKey: string): Promise<CuratedCorpus | null> {
  return loadLatestSpec<CuratedCorpus>(repoKey, 'corpus');
}

// ---------------------------------------------------------------------------
// Decisions-file mutations
//
// Pure read-modify-write helpers around decisions. The dashboard server routes
// and the CLI both call these so the two surfaces agree on update semantics.
// None of these re-curate the corpus — callers who need the new relations
// reflected (CLI write commands) run curateInProcess afterwards.
// ---------------------------------------------------------------------------

// Pure DecisionsFile transforms — the read-modify-write core, shared verbatim by
// the repo (file/Postgres) and workspace (Postgres) helpers so both surfaces
// agree on update semantics. An `apply*` that makes no change returns the SAME
// object reference, letting callers skip a redundant store.

/** Dedup key for a user relation — a pair is unique per scope (area). */
const relationKey = (r: { older: string; newer: string; scope?: string }): string =>
  `${[r.older, r.newer].sort().join(' ')} ${r.scope ?? ''}`;

function applyAddRelation(existing: DecisionsFile, input: Relation): DecisionsFile {
  if (input.older === input.newer) {
    throw new Error('addRelation: older and newer must be different docs');
  }
  const key = relationKey(input);
  const dedup = (existing.relations ?? []).filter((r) => relationKey(r) !== key);
  const relation: Relation = { ...input, detectedFrom: input.detectedFrom ?? 'manual' };
  return {
    version: 1,
    manualIncludes: existing.manualIncludes ?? [],
    relations: [...dedup, relation],
    manualAreas: existing.manualAreas ?? [],
  };
}

function applyRemoveRelation(
  existing: DecisionsFile,
  input: { older: string; newer: string; scope?: string },
): DecisionsFile {
  // Scope omitted → drop every user relation for the pair (either order).
  const matches = (r: Relation): boolean => {
    const samePair =
      (r.older === input.older && r.newer === input.newer) ||
      (r.older === input.newer && r.newer === input.older);
    return samePair && (input.scope === undefined || r.scope === input.scope);
  };
  return {
    version: 1,
    manualIncludes: existing.manualIncludes ?? [],
    relations: (existing.relations ?? []).filter((r) => !matches(r)),
    manualAreas: existing.manualAreas ?? [],
  };
}

function applyAddManualInclude(existing: DecisionsFile, docPath: string): DecisionsFile {
  const current = existing.manualIncludes ?? [];
  if (current.includes(docPath)) return existing;
  return {
    version: 1,
    manualIncludes: [...current, docPath],
    relations: existing.relations ?? [],
    manualAreas: existing.manualAreas ?? [],
  };
}

function applyRemoveManualInclude(existing: DecisionsFile, docPath: string): DecisionsFile {
  return {
    version: 1,
    manualIncludes: (existing.manualIncludes ?? []).filter((p) => p !== docPath),
    relations: existing.relations ?? [],
    manualAreas: existing.manualAreas ?? [],
  };
}

/**
 * Add (or replace) a user-authored doc→doc relation — the corpus-path verb that
 * resolves a flagged overlap (replace / precedence / keep-both). When a relation
 * for the same (older, newer, scope) already exists it's replaced. Self-pairs are
 * rejected. Re-run `spec scan` (curate) to apply.
 */
export async function addRelation(repoRoot: string, input: Relation): Promise<DecisionsFile> {
  const next = applyAddRelation(await loadDecisions(repoRoot), input);
  await storeDecisions(repoRoot, next);
  return next;
}

/**
 * Remove a user-authored relation by (older, newer) — either order, optionally
 * scoped to one area. Idempotent.
 */
export async function removeRelation(
  repoRoot: string,
  input: { older: string; newer: string; scope?: string },
): Promise<DecisionsFile> {
  const next = applyRemoveRelation(await loadDecisions(repoRoot), input);
  await storeDecisions(repoRoot, next);
  return next;
}

/**
 * Force-include a doc the relevance filter skipped. Idempotent.
 */
export async function addManualInclude(repoRoot: string, docPath: string): Promise<DecisionsFile> {
  const existing = await loadDecisions(repoRoot);
  const next = applyAddManualInclude(existing, docPath);
  if (next !== existing) await storeDecisions(repoRoot, next);
  return next;
}

/**
 * Remove a force-include override. Idempotent.
 */
export async function removeManualInclude(
  repoRoot: string,
  docPath: string,
): Promise<DecisionsFile> {
  const next = applyRemoveManualInclude(await loadDecisions(repoRoot), docPath);
  await storeDecisions(repoRoot, next);
  return next;
}
