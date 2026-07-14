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
  classifyDoc,
  readDecisions,
  writeDecisions,
  type CuratedCorpus,
  type CurateModels,
  type CurateOptions,
  type CurateResult,
  type ConflictResolution,
  type DecisionsFile,
  type DocCandidate,
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
  coverageKey,
  type GenerateBatchRunner,
  type PriorContracts,
  type PriorTarget,
  type ValidationIssue,
} from '@truecourse/contract-extractor';
import { resolveFallbackModel, resolveModel, type StageId } from '../config/llm-models.js';
import { openConflicts } from '@truecourse/shared';
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
  constructor(public readonly kind: 'scan' | 'generate' | 'guard') {
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
  infer,
  writeInferred,
  renderDecision,
  parserOhm,
  resolver,
  type InferResult,
} from '@truecourse/contract-verifier';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {
  saveContracts,
  loadContracts,
  saveWorkspaceContracts,
  type RepoRef,
  type WorkspaceRef,
} from '../lib/contract-store.js';
import {
  saveSpec,
  loadSpec,
  deleteSpec,
  loadLatestSpec,
  saveWorkspaceSpec,
  specsMaterializeInPlace,
} from '../lib/spec-store.js';
import { readRepoDoc } from '../lib/repo-doc-reader.js';
import {
  reapplyPromoted,
  applyInferredActions,
  diffDecisions,
  type InferredDecisionSummary,
  type InferDiff,
} from '../lib/inferred-decisions.js';
import { listInferredActions } from '../lib/inferred-action-store.js';
import { readLatest } from '../lib/analysis-store.js';
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
  return stageUsageTag(STEP_STAGES[stepKey] ?? [], repoRoot);
}

/**
 * ` · <model> · <tok> tok · $<cost>` suffix for an explicit stage set — the core
 * of {@link stepUsageTag}, exported so other steppers (guard generate) render the
 * SAME live tag from their own stage mapping, sharing the EE model-name toggle.
 */
export function stageUsageTag(stages: StageId[], repoRoot: string): string {
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
  /** Areas whose enumeration failed (e.g. LLM timeout) — contracts may be incomplete; re-run. */
  enumerateFailures: string[];
}

export function stampGeneratedMarker(
  repoRoot: string,
  summary?: {
    written: number;
    gaps: CoverageGap[];
    validationIssues: ValidationIssue[];
    enumerateFailures?: string[];
  },
): void {
  const file = generatedMarkerPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body: GeneratedSummary = {
    generatedAt: new Date().toISOString(),
    written: summary?.written ?? 0,
    gaps: summary?.gaps ?? [],
    validationIssues: summary?.validationIssues ?? [],
    enumerateFailures: summary?.enumerateFailures ?? [],
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
      enumerateFailures: Array.isArray(raw.enumerateFailures) ? raw.enumerateFailures : [],
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
   * Inject the doc set instead of walking the filesystem. Editions with no live
   * working tree (EE) source docs through the repo-doc seam (`readRepoDoc`); OSS
   * omits it and curate discovers from disk.
   */
  docSource?: CurateOptions['docSource'];
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

  // Instrument every LLM call (opt-in via TRUECOURSE_LLM_LOG, or on by default
  // under TRUECOURSE_DEV) so each scan stage's model and wall time are recorded
  // — same as the generate path. Null + zero overhead when unset.
  const llmLog = createLlmCallLogger(repoRoot, 'spec-scan');
  if (llmLog) setLlmCallSink(llmLog.sink);
  const tScanStart = perfNow();
  try {
    tracker?.start('discover');
    let result: CurateResult;
    try {
      result = await curate(repoRoot, {
        models: resolveCurateModels(repoRoot),
        transport: resolveTransport(options),
        docSource: options.docSource,
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
  } finally {
    if (llmLog) {
      setLlmCallSink(undefined);
      llmLog.finish(perfNow() - tScanStart);
    }
  }
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
  /**
   * Skip the Phase-4 existing-contract anchor (regenerate from scratch). The
   * anchor is on by default: an area whose spec is unchanged reproduces its prior
   * contracts instead of drifting. Reads the `.tc` already at
   * `<repoRoot>/.truecourse/contracts/` (OSS: committed; EE: the base contracts
   * the gate materialized into the clone).
   */
  disableAnchor?: boolean;
  // --- test seams ---
  enumerateRunner?: EnumerateRunner;
  generateRunner?: GenerateBatchRunner;
  gapJudgeRunner?: GapJudgeRunner;
}

/**
 * Build the Phase-4 anchor from the contracts ALREADY on disk at
 * `<repoRoot>/.truecourse/contracts/`. Parsing each `.tc` yields its
 * (kind, identity) — for the enumerate anchor — and the file body — for the
 * extract anchor. Best-effort: unparseable files are skipped, and a cold repo
 * (no prior contracts) returns undefined so generation runs exactly as before.
 * `_inferred/` is excluded — we never anchor authored generation to inferred output.
 */
function buildPriorContracts(repoRoot: string): PriorContracts | undefined {
  const dir = path.join(repoRoot, '.truecourse', 'contracts');
  if (!fs.existsSync(dir)) return undefined;
  const targets: PriorTarget[] = [];
  const bodyByKey = new Map<string, string>();
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === '_inferred') continue;
        walk(path.join(d, e.name));
      } else if (e.name.endsWith('.tc')) {
        const abs = path.join(d, e.name);
        const src = fs.readFileSync(abs, 'utf-8');
        try {
          const file = parserOhm.parseTcFile(path.relative(dir, abs), src);
          // index is keyed "<Kind>:<identity>" (PascalCase kind).
          for (const key of resolver.resolve([file]).index.keys()) {
            const colon = key.indexOf(':');
            if (colon < 0) continue;
            const kind = key.slice(0, colon);
            const identity = key.slice(colon + 1);
            targets.push({ kind, identity });
            bodyByKey.set(coverageKey(kind, identity), src);
          }
        } catch {
          // Best-effort anchor — a malformed prior file is skipped, never fatal.
        }
      }
    }
  };
  walk(dir);
  return targets.length > 0 ? { targets, bodyByKey } : undefined;
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
      // Phase 4: anchor regeneration to the contracts already on disk so an
      // unchanged area reproduces its prior output instead of drifting.
      prior: options.disableAnchor ? undefined : buildPriorContracts(repoRoot),
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
    const enumFailures = result.enumerateFailures ?? [];
    // Mark every remaining step done; the file/gap summary lands on `generate`.
    for (let i = cur; i < STEPS.length; i++) tracker?.done(STEPS[i], withUsage(STEPS[i]));
    tracker?.done(
      'generate',
      withUsage(
        'generate',
        `${options.dryRun ? 'would write ' : ''}${produced} file${produced === 1 ? '' : 's'} · ${result.gaps.length} gap${result.gaps.length === 1 ? '' : 's'}${enumFailures.length ? ` · ⚠ ${enumFailures.length} area${enumFailures.length === 1 ? '' : 's'} failed to enumerate` : ''}`,
      ),
    );
    // An enumerate failure (e.g. an LLM timeout) means an area's contracts may be
    // incomplete — and it's invisible to the gap count, so surface it loudly. The
    // cache no longer persists a failed enumeration, so a re-run retries it.
    if (enumFailures.length > 0) {
      process.stderr.write(
        `[truecourse] WARNING: ${enumFailures.length} area(s) failed to enumerate — their contracts may be incomplete. ` +
          `Re-run \`contracts generate\` to retry: ${enumFailures.join(', ')}\n`,
      );
    }
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
        enumerateFailures: enumFailures,
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
      tracker: options.tracker,
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
 * `inferred` `.tc` artifacts under `<contractsDir>/_inferred/`. Instead of
 * checking code against the spec, it surfaces what the code decided that the
 * spec never recorded. Coverage is computed from authored contracts only, so a
 * decision drops out once it's documented.
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
 * baseline file is untouched, then diffs against it.
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
  manualExcludes: [],
  relations: [],
  manualAreas: [],
  conflictResolutions: [],
};
/** Sentinel commit for the per-repo "current" decisions document in EE. */
const DECISIONS_REF = '_repo';
/** Sentinel commit for a PR-scoped decisions overlay in EE (`_pr/<number>`). */
const prDecisionsRef = (pr: number): string => `_pr/${pr}`;
/** The sentinel commit addressing the repo row or a PR overlay. */
const decisionsRef = (pr?: number): string =>
  pr === undefined ? DECISIONS_REF : prDecisionsRef(pr);

/** PR-scoped decisions live only in EE — a live-tree (OSS) store can't hold them. */
function assertNoPrInPlace(pr?: number): void {
  if (pr !== undefined && specsMaterializeInPlace()) {
    throw new Error('[spec] PR-scoped decisions require the enterprise store');
  }
}

async function loadDecisions(repoKey: string, opts?: { pr?: number }): Promise<DecisionsFile> {
  assertNoPrInPlace(opts?.pr);
  if (specsMaterializeInPlace()) return readDecisions(repoKey);
  return (
    (await loadSpec<DecisionsFile>(
      { repoKey, commitSha: decisionsRef(opts?.pr) },
      'decisions',
    )) ?? EMPTY_DECISIONS
  );
}

async function storeDecisions(
  repoKey: string,
  next: DecisionsFile,
  opts?: { pr?: number },
): Promise<void> {
  assertNoPrInPlace(opts?.pr);
  if (specsMaterializeInPlace()) {
    writeDecisions(repoKey, next);
    return;
  }
  await saveSpec({ repoKey, commitSha: decisionsRef(opts?.pr) }, 'decisions', next);
}

/**
 * The repo's current decisions (dashboard read) — file in OSS, Postgres in EE.
 * With `pr`, returns the effective decisions for that PR: the repo row merged
 * with the PR's overlay (the overlay wins — see {@link mergeDecisions}).
 */
export async function getDecisions(
  repoKey: string,
  opts?: { pr?: number },
): Promise<DecisionsFile> {
  if (opts?.pr === undefined) return loadDecisions(repoKey);
  const [base, overlay] = await Promise.all([
    loadDecisions(repoKey),
    loadDecisions(repoKey, { pr: opts.pr }),
  ]);
  return mergeDecisions(base, overlay);
}

/**
 * Merge a PR's decisions overlay over the repo row. Pure. The overlay wins on
 * every dimension:
 *   - relations: an overlay relation on the same doc pair (order-insensitive,
 *     same scope) replaces the base one; other base relations survive.
 *   - manualIncludes / manualExcludes: union by path, but the overlay's verb wins
 *     per path — a path the overlay excludes is dropped from includes and vice
 *     versa (never a contradictory pair).
 *   - manualAreas: the overlay's override replaces the base's for that doc.
 */
export function mergeDecisions(base: DecisionsFile, overlay: DecisionsFile): DecisionsFile {
  const overlayRelKeys = new Set((overlay.relations ?? []).map(relationKey));
  const relations = [
    ...(base.relations ?? []).filter((r) => !overlayRelKeys.has(relationKey(r))),
    ...(overlay.relations ?? []),
  ];

  const overlayIncludes = new Set(overlay.manualIncludes ?? []);
  const overlayExcludes = new Set(overlay.manualExcludes ?? []);
  const manualIncludes = uniqueStrings([
    ...(base.manualIncludes ?? []),
    ...(overlay.manualIncludes ?? []),
  ]).filter((p) => !overlayExcludes.has(p));
  const manualExcludes = uniqueStrings([
    ...(base.manualExcludes ?? []),
    ...(overlay.manualExcludes ?? []),
  ]).filter((p) => !overlayIncludes.has(p));

  const overlayAreaDocs = new Set((overlay.manualAreas ?? []).map((a) => a.doc));
  const manualAreas = [
    ...(base.manualAreas ?? []).filter((a) => !overlayAreaDocs.has(a.doc)),
    ...(overlay.manualAreas ?? []),
  ];

  // Conflict verdicts: the overlay wins per dispute identity (same unordered pair
  // + same section anchors), other base verdicts survive.
  const overlayResKeys = new Set((overlay.conflictResolutions ?? []).map(conflictResolutionKey));
  const conflictResolutions = [
    ...(base.conflictResolutions ?? []).filter((r) => !overlayResKeys.has(conflictResolutionKey(r))),
    ...(overlay.conflictResolutions ?? []),
  ];

  return { version: 1, manualIncludes, manualExcludes, relations, manualAreas, conflictResolutions };
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)];
}

/**
 * Promote a PR's decisions overlay onto the repo row on merge. Idempotent: when
 * no overlay exists returns false and does nothing (the merge flow may call this
 * twice — closed handler + baseline). Otherwise merges the overlay onto the repo
 * row, persists it, drops the overlay row, and returns true.
 */
export async function promoteDecisionsOverlay(repoKey: string, pr: number): Promise<boolean> {
  const overlay = await loadSpec<DecisionsFile>(
    { repoKey, commitSha: prDecisionsRef(pr) },
    'decisions',
  );
  if (!overlay) return false;
  const merged = mergeDecisions(await loadDecisions(repoKey), overlay);
  await storeDecisions(repoKey, merged);
  await deleteSpec({ repoKey, commitSha: prDecisionsRef(pr) }, 'decisions');
  return true;
}

/** Discard a PR's decisions overlay (unmerged close). Idempotent. */
export async function discardDecisionsOverlay(repoKey: string, pr: number): Promise<void> {
  await deleteSpec({ repoKey, commitSha: prDecisionsRef(pr) }, 'decisions');
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

/**
 * Build a curate `docSource` from the store, for editions with no live working
 * tree (EE). The doc universe is the corpus's own known docs (kept + relevance-
 * dropped) plus the decision toggles — a force include/exclude never introduces a
 * NEW file, so there's nothing to re-discover. Each doc's body is fetched through
 * the repo-doc seam (`readRepoDoc` → GitHub in EE), and the `contentHash` is
 * computed exactly as `discoverDocs` does (`sha256` of the utf-8 body) so the
 * per-doc stage caches HIT: an unchanged doc re-derives its tags from cache
 * instead of calling the LLM — which is what makes a restore cheap.
 */
export function buildStoredDocSource(
  repoKey: string,
  corpus: CuratedCorpus,
  decisions: DecisionsFile,
  commit?: string,
): () => Promise<DocCandidate[]> {
  const lastTouchedByRef = new Map(corpus.docs.map((d) => [d.ref, d.lastTouched]));
  const refs = new Set<string>();
  for (const d of corpus.docs) refs.add(d.ref);
  for (const s of corpus.skippedDocs ?? []) refs.add(s.ref);
  for (const p of decisions.manualExcludes ?? []) refs.add(p);
  for (const p of decisions.manualIncludes ?? []) refs.add(p);
  const readOpts = commit ? { commit } : undefined;
  return async () => {
    const docs: DocCandidate[] = [];
    for (const ref of refs) {
      const content = await readRepoDoc(repoKey, ref, readOpts);
      if (content == null) continue; // deleted upstream — drop it from the set
      docs.push({
        path: ref,
        absPath: '',
        content,
        kind: classifyDoc(ref, content),
        preview: content.split(/\r?\n/).slice(0, 200).join('\n'),
        lastTouched: lastTouchedByRef.get(ref) ?? '',
        contentHash: createHash('sha256').update(content).digest('hex'),
        size: Buffer.byteLength(content, 'utf-8'),
      });
    }
    return docs;
  };
}

/**
 * Re-curate the stored corpus after a decision change (force include/exclude),
 * for editions with no live working tree (EE). Runs the SAME `curate` the OSS path
 * runs — differing only in transport: docs come through {@link buildStoredDocSource}
 * (the repo-doc seam) instead of the filesystem, and the corpus is persisted to the
 * store instead of `corpus.json`. Unchanged docs hit the per-doc caches (the EE
 * Postgres KV store), so this is cheap and a RESTORE re-derives an excluded doc's
 * tags from cache. Contracts are NOT regenerated here — that stays a separate step,
 * exactly as in OSS. Returns the fresh corpus plus its open-conflict count (the
 * caller uses `openConflicts === 0` to decide whether to regenerate contracts), or
 * null when there is no corpus yet.
 */
export async function recurateStoredCorpus(
  repoKey: string,
): Promise<{ corpus: CuratedCorpus; openConflicts: number } | null> {
  const corpus = await getCorpus(repoKey);
  if (!corpus) return null;
  const decisions = await loadDecisions(repoKey);
  const { curate: result } = await curateInProcess(repoKey, {
    docSource: buildStoredDocSource(repoKey, corpus, decisions),
    decisions,
    skipGit: true,
    skipCorpusWrite: true,
  });
  // Save at the baseline commit — the repo-scope corpus the base view reads —
  // never `latestSpecCommit`, which a PR-head scan can leave pointing at a PR.
  const commitSha = await baselineSpecCommit(repoKey);
  if (commitSha) await saveSpec({ repoKey, commitSha }, 'corpus', result.corpus);
  // Open = the SAME shared derivation the gate uses (verdicts/dismissals/excludes
  // resolve; a flagged-but-verdicted dispute must not block regeneration).
  return { corpus: result.corpus, openConflicts: openConflicts(result.corpus, decisions).length };
}

/**
 * The default-branch baseline commit for PR-scoped corpus reads. The EE gate's
 * baseline job analyzes the default-branch head and persists it as the repo's
 * LATEST analysis; PR-head analyses are stateless (diff-only) so they never move
 * it. That commit is the base repo view + repo-scope corpus anchor. `null` before
 * any baseline. The base is derived from the analyze store, not the working tree,
 * so this resolves for editions with no live checkout (EE).
 */
async function baselineSpecCommit(repoKey: string): Promise<string | null> {
  return (await readLatest(repoKey))?.analysis.commitHash ?? null;
}

/** The corpus stored at the baseline commit, or null when none is stored yet. */
async function loadBaselineCorpus(repoKey: string): Promise<CuratedCorpus | null> {
  const commitSha = await baselineSpecCommit(repoKey);
  if (!commitSha) return null;
  return loadSpec<CuratedCorpus>({ repoKey, commitSha }, 'corpus');
}

/**
 * Re-curate a PR's corpus after a PR-scoped decision edit (EE only). Mirrors
 * {@link recurateStoredCorpus}, but scoped to one PR: the doc universe is the
 * corpus scanned at the PR head (falling back to the baseline corpus for a
 * code-only PR that never scanned specs), doc bodies are read at the PR head, the
 * effective decisions fold the PR overlay ({@link getDecisions} with `pr`), and
 * the result is saved at the PR head — so it never touches the base repo view or
 * another PR. Returns the fresh corpus + open-conflict count, or null when the
 * repo has no corpus at all yet.
 */
export async function recuratePrCorpus(
  repoKey: string,
  prHeadSha: string,
  prNumber: number,
): Promise<{ corpus: CuratedCorpus; openConflicts: number } | null> {
  const corpus =
    (await loadSpec<CuratedCorpus>({ repoKey, commitSha: prHeadSha }, 'corpus')) ??
    (await loadBaselineCorpus(repoKey));
  if (!corpus) return null;
  const decisions = await getDecisions(repoKey, { pr: prNumber });
  const { curate: result } = await curateInProcess(repoKey, {
    docSource: buildStoredDocSource(repoKey, corpus, decisions, prHeadSha),
    decisions,
    skipGit: true,
    skipCorpusWrite: true,
  });
  await saveSpec({ repoKey, commitSha: prHeadSha }, 'corpus', result.corpus);
  return { corpus: result.corpus, openConflicts: openConflicts(result.corpus, decisions).length };
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

/**
 * Dispute-identity key for a section-scoped conflict verdict (item 31): the
 * unordered doc pair plus each side's section anchor, oriented by doc so the same
 * dispute keys identically regardless of which doc was recorded as A. One verdict
 * per dispute — re-recording replaces it.
 */
const conflictResolutionKey = (r: ConflictResolution): string => {
  const sides = [
    `${r.docA}#${r.anchorA ?? ''}`,
    `${r.docB}#${r.anchorB ?? ''}`,
  ].sort();
  return sides.join('   ');
};

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
    manualExcludes: existing.manualExcludes ?? [],
    relations: [...dedup, relation],
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: existing.conflictResolutions ?? [],
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
    manualExcludes: existing.manualExcludes ?? [],
    relations: (existing.relations ?? []).filter((r) => !matches(r)),
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: existing.conflictResolutions ?? [],
  };
}

// Include and exclude are mutually exclusive per doc: adding one clears the
// other for that path, so decisions.json can never hold a contradictory pair.

function applyAddManualInclude(existing: DecisionsFile, docPath: string): DecisionsFile {
  const includes = existing.manualIncludes ?? [];
  const excludes = existing.manualExcludes ?? [];
  if (includes.includes(docPath) && !excludes.includes(docPath)) return existing;
  return {
    version: 1,
    manualIncludes: includes.includes(docPath) ? includes : [...includes, docPath],
    manualExcludes: excludes.filter((p) => p !== docPath),
    relations: existing.relations ?? [],
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: existing.conflictResolutions ?? [],
  };
}

function applyRemoveManualInclude(existing: DecisionsFile, docPath: string): DecisionsFile {
  return {
    version: 1,
    manualIncludes: (existing.manualIncludes ?? []).filter((p) => p !== docPath),
    manualExcludes: existing.manualExcludes ?? [],
    relations: existing.relations ?? [],
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: existing.conflictResolutions ?? [],
  };
}

function applyAddManualExclude(existing: DecisionsFile, docPath: string): DecisionsFile {
  const includes = existing.manualIncludes ?? [];
  const excludes = existing.manualExcludes ?? [];
  if (excludes.includes(docPath) && !includes.includes(docPath)) return existing;
  return {
    version: 1,
    manualIncludes: includes.filter((p) => p !== docPath),
    manualExcludes: excludes.includes(docPath) ? excludes : [...excludes, docPath],
    relations: existing.relations ?? [],
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: existing.conflictResolutions ?? [],
  };
}

function applyRemoveManualExclude(existing: DecisionsFile, docPath: string): DecisionsFile {
  return {
    version: 1,
    manualIncludes: existing.manualIncludes ?? [],
    manualExcludes: (existing.manualExcludes ?? []).filter((p) => p !== docPath),
    relations: existing.relations ?? [],
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: existing.conflictResolutions ?? [],
  };
}

// Section-scoped conflict verdicts (item 31). One verdict per dispute identity —
// recording a verdict for a dispute already resolved replaces it (a side verdict
// overwrites a prior dismissal and vice versa).

function applyAddConflictResolution(existing: DecisionsFile, input: ConflictResolution): DecisionsFile {
  if (input.docA === input.docB) {
    throw new Error('addConflictResolution: docA and docB must be different docs');
  }
  const key = conflictResolutionKey(input);
  const dedup = (existing.conflictResolutions ?? []).filter((r) => conflictResolutionKey(r) !== key);
  return {
    version: 1,
    manualIncludes: existing.manualIncludes ?? [],
    manualExcludes: existing.manualExcludes ?? [],
    relations: existing.relations ?? [],
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: [...dedup, input],
  };
}

function applyRemoveConflictResolution(
  existing: DecisionsFile,
  input: { docA: string; anchorA: string | null; docB: string; anchorB: string | null },
): DecisionsFile {
  const key = conflictResolutionKey({ ...input, verdict: 'dismissed', resolvedAt: '' });
  return {
    version: 1,
    manualIncludes: existing.manualIncludes ?? [],
    manualExcludes: existing.manualExcludes ?? [],
    relations: existing.relations ?? [],
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: (existing.conflictResolutions ?? []).filter((r) => conflictResolutionKey(r) !== key),
  };
}

/**
 * Add (or replace) a user-authored doc→doc relation (replace / precedence /
 * keep-both) — the doc-lifecycle/precedence tool (`spec chains`). A relation
 * never resolves a conflict; that takes a verdict, a dismissal, or an exclude.
 * When a relation for the same (older, newer, scope) already exists it's
 * replaced. Self-pairs are rejected. Re-run `spec scan` (curate) to apply.
 */
export async function addRelation(
  repoRoot: string,
  input: Relation,
  opts?: { pr?: number },
): Promise<DecisionsFile> {
  const next = applyAddRelation(await loadDecisions(repoRoot, opts), input);
  await storeDecisions(repoRoot, next, opts);
  return next;
}

/**
 * Remove a user-authored relation by (older, newer) — either order, optionally
 * scoped to one area. Idempotent.
 */
export async function removeRelation(
  repoRoot: string,
  input: { older: string; newer: string; scope?: string },
  opts?: { pr?: number },
): Promise<DecisionsFile> {
  const next = applyRemoveRelation(await loadDecisions(repoRoot, opts), input);
  await storeDecisions(repoRoot, next, opts);
  return next;
}

/**
 * Force-include a doc the relevance filter skipped. Idempotent.
 */
export async function addManualInclude(
  repoRoot: string,
  docPath: string,
  opts?: { pr?: number },
): Promise<DecisionsFile> {
  const existing = await loadDecisions(repoRoot, opts);
  const next = applyAddManualInclude(existing, docPath);
  if (next !== existing) await storeDecisions(repoRoot, next, opts);
  return next;
}

/**
 * Remove a force-include override. Idempotent.
 */
export async function removeManualInclude(
  repoRoot: string,
  docPath: string,
  opts?: { pr?: number },
): Promise<DecisionsFile> {
  const next = applyRemoveManualInclude(await loadDecisions(repoRoot, opts), docPath);
  await storeDecisions(repoRoot, next, opts);
  return next;
}

/**
 * Force-exclude a doc the relevance filter would keep — drops it from the corpus
 * on the next curate. Clears any force-include for the same path. Idempotent.
 */
export async function addManualExclude(
  repoRoot: string,
  docPath: string,
  opts?: { pr?: number },
): Promise<DecisionsFile> {
  const existing = await loadDecisions(repoRoot, opts);
  const next = applyAddManualExclude(existing, docPath);
  if (next !== existing) await storeDecisions(repoRoot, next, opts);
  return next;
}

/**
 * Remove a force-exclude override (restore the doc). Idempotent.
 */
export async function removeManualExclude(
  repoRoot: string,
  docPath: string,
  opts?: { pr?: number },
): Promise<DecisionsFile> {
  const next = applyRemoveManualExclude(await loadDecisions(repoRoot, opts), docPath);
  await storeDecisions(repoRoot, next, opts);
  return next;
}

/**
 * Record a SECTION-scoped conflict verdict (item 31) — pick-a-side ('a'/'b') or
 * dismissal — for one flagged dispute. Replaces any prior verdict for the same
 * dispute identity. Unlike a doc-relation resolve, this does NOT re-curate: the
 * corpus is unchanged (the overlap stays flagged), and the shared resolved-
 * derivation reads the verdict live, so a single later scan applies any batch.
 * Self-pairs are rejected.
 */
export async function addConflictResolution(
  repoRoot: string,
  input: ConflictResolution,
  opts?: { pr?: number },
): Promise<DecisionsFile> {
  const next = applyAddConflictResolution(await loadDecisions(repoRoot, opts), input);
  await storeDecisions(repoRoot, next, opts);
  return next;
}

/**
 * Remove a conflict verdict by dispute identity (unordered doc pair + section
 * anchors). Idempotent.
 */
export async function removeConflictResolution(
  repoRoot: string,
  input: { docA: string; anchorA: string | null; docB: string; anchorB: string | null },
  opts?: { pr?: number },
): Promise<DecisionsFile> {
  const next = applyRemoveConflictResolution(await loadDecisions(repoRoot, opts), input);
  await storeDecisions(repoRoot, next, opts);
  return next;
}
