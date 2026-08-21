/**
 * Shared in-process entry points for the BL Drift / Spec Consolidation
 * commands. Both the CLI and the dashboard server import these so
 * progress wiring, decision-file writes, and IL-extraction chaining
 * live in exactly one place.
 *
 * Same shape as `analyze-in-process.ts` — the caller passes a
 * `StepTracker` and we drive it through the high-level phases:
 *
 *   curate         discover → tag areas → group → flag overlaps → corpus.json
 *
 * Step keys + labels are stable across CLI/dashboard so the progress
 * UI is identical on both surfaces. Implementations of the actual
 * pipelines come from `@truecourse/spec-consolidator`; this module
 * just orchestrates them and reports progress.
 */

import {
  classifyDoc,
  readDecisions,
  writeDecisions,
  type CuratedCorpus,
  type CurateResult,
  type ConflictResolution,
  type DecisionsFile,
  type DocCandidate,
  type RepoIdentity,
} from '@truecourse/spec-consolidator';
import type { CoverageGap, ValidationIssue } from '@truecourse/contract-extractor';
import { effectiveLlmMode, type LlmTransportMode } from '../config/global-config.js';
import { resolveModel, type StageId } from '../config/llm-models.js';
import { openConflicts } from '@truecourse/shared';

export type {
  DecisionsFile,
  ConflictResolution,
  CuratedCorpus,
} from '@truecourse/spec-consolidator';
import { getStageUsage, stageTokenTotal } from '@truecourse/shared/llm';
import type { SessionDriver, UserInputQuestion } from '@truecourse/agent-loop';
import { runSpecScanSessions, type ScanStep } from '../services/spec-scan/run.js';
export { SCAN_STEPS, ScanStepNotReadyError, type ScanStep } from '../services/spec-scan/run.js';
import { normalizeScopePath } from '../services/spec-scan/orchestrate.js';
import { createSessionRun, type SessionRunStartedInfo } from '../lib/sessions-store.js';
import { resolveCommitSha } from '../lib/repo-ref.js';
import {
  createConfiguredSessionDriver,
  type ConfiguredSessionDriver,
} from '../services/llm/session-driver.js';
import type { LlmEstimate } from './analyze-core.js';
import { estimateScanTokens } from '../services/llm/spec-estimate.js';
import { getModelPrices } from '../services/llm/model-prices.js';

/**
 * Thrown when the user declines the pre-flight LLM cost estimate. Scan/generate
 * are entirely LLM-driven, so a decline aborts the run (unlike analyze, which
 * falls back to deterministic-only). Callers catch this to exit cleanly.
 */
export class EstimateDeclined extends Error {
  constructor(public readonly kind: 'scan' | 'guard' | 'guard setup') {
    super(`${kind} declined at the LLM cost estimate`);
    this.name = 'EstimateDeclined';
  }
}

import {
  infer,
  writeInferred,
  renderDecision,
  type InferResult,
} from '@truecourse/contract-verifier';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import {
  saveContracts,
  loadContracts,
  type RepoRef,
  type WorkspaceRef,
} from '../lib/contract-store.js';
import {
  saveSpec,
  loadSpec,
  deleteSpec,
  loadLatestSpec,
  saveWorkspaceSpec,
  loadWorkspaceSpec,
  specsMaterializeInPlace,
} from '../lib/spec-store.js';
import { readRepoDoc } from '../lib/repo-doc-reader.js';
import { getSpecInheritanceHook } from '../lib/spec-inheritance-hook.js';
import {
  reapplyPromoted,
  applyInferredActions,
  diffDecisions,
  type InferredDecisionSummary,
  type InferDiff,
} from '../lib/inferred-decisions.js';
import { listInferredActions } from '../lib/inferred-action-store.js';
import { readLatest } from '../lib/analysis-store.js';
import { withEstimatePhase, type EstimatePhase, type StepTracker } from '../progress.js';
import {
  trackEvent,
  bucketFileCount,
  bucketDuration,
  type TelemetrySource,
} from '../services/telemetry.service.js';

// ---------------------------------------------------------------------------
// Step taxonomies — exported so callers can pre-build the tracker.
// ---------------------------------------------------------------------------

// Curate docs into corpus.json.
export const CURATE_STEPS = [
  { key: 'discover', label: 'Discovering docs' },
  { key: 'tag', label: 'Tagging doc areas' },
  { key: 'overlap', label: 'Flagging overlaps' },
  { key: 'verify', label: 'Verifying conflicts' },
] as const;

export const INFER_STEPS = [
  { key: 'load', label: 'Loading authored contracts' },
  { key: 'scan', label: 'Reverse-engineering decisions from code' },
  { key: 'write', label: 'Writing inferred contracts' },
] as const;

// ---------------------------------------------------------------------------
// Live per-step usage tag (` · <model> · <tok> tok · $<cost>`)
// ---------------------------------------------------------------------------

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
 * ` · <model> · <tok> tok · $<cost>` suffix for an explicit stage set — the core
 * of {@link stepUsageTag}, exported so other steppers (guard generate) render the
 * SAME live tag from their own stage mapping, sharing the EE model-name toggle.
 *
 * `mode` is the run's effective transport mode, so the pre-call fallback names the
 * model the run will really use — not the one the saved selection would have.
 */
export function stageUsageTag(
  stages: StageId[],
  repoRoot: string,
  mode?: LlmTransportMode,
): string {
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
    model = [...new Set(stages.map((s) => resolveModel(s, undefined, repoRoot, mode)))].join(', ');
  }
  const parts: string[] = [];
  if (model) parts.push(model);
  if (tok > 0 || cost > 0) {
    parts.push(`${humanTokens(tok)} tok`);
    parts.push(`$${cost.toFixed(2)}`);
  }
  return parts.length ? ` · ${parts.join(' · ')}` : '';
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

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Corpus path driver — shared by the CLI (`spec scan`) and the dashboard
// routes. `curateInProcess` builds corpus.json via the SESSION-based scan run
// (`services/spec-scan/run.ts`, plan 02 steps 3–5): one `spec-scan.curate-doc`
// session per doc, at most one `spec-scan.settle-areas` session, one
// `spec-scan.overlap` session per area. The four CURATE_STEPS keys are kept so
// both surfaces' progress UIs render unchanged.
// ---------------------------------------------------------------------------

export interface SpecCurateInProcessResult {
  curate: CurateResult;
  /** True when the scan made zero LLM calls — every doc was unchanged (cached). */
  noChanges: boolean;
  /**
   * Questions the interactive scope orchestrator left unanswered (§3.7). A
   * non-interactive run never blocks on them; the CLI/dashboard summary must
   * surface them LOUDLY.
   */
  pendingQuestions: UserInputQuestion[];
  /** The orchestrator session's findings — verbatim observations for human eyes. */
  scanFindings: string[];
  /**
   * Set when a single-step run (`only`) stopped before assembly — the step ran,
   * corpus.json is untouched. Absent on a completed scan (including
   * `only: 'overlap'`, which runs through the corpus write).
   */
  stoppedAfter?: ScanStep;
  /** The sessions-store run dir (`.truecourse/sessions/spec-scan/<runId>/`) —
   *  where this run's transcripts landed, for stepwise inspection. */
  sessionsRunDir: string;
}

export interface CurateInProcessOptions {
  tracker?: StepTracker;
  source?: TelemetrySource;
  /**
   * LLM transport mode for the scan SESSIONS (`cli` = the claude-code driver,
   * `api` = the per-turn API driver). The `agent` mailbox transport has no
   * session driver and is refused — sessions are multi-turn, tool-calling
   * conversations the one-shot mailbox cannot carry.
   */
  llm?: 'cli' | 'agent' | 'api';
  /** Retired with the `agent` transport; accepted for caller compatibility. */
  io?: string;
  skipGit?: boolean;
  /** Compute the corpus without overwriting corpus.json — for read-only callers. */
  skipCorpusWrite?: boolean;
  /**
   * User resolutions (manual areas / includes / conflict verdicts) to fold into
   * the scan. EE MUST pass the stored decisions here: its re-scan runs on a
   * fresh clone with no `.truecourse/specs/decisions.json` (resolutions live in
   * Postgres), so without this the re-scan re-detects already-resolved
   * conflicts. Omit in OSS — the run reads them from the repo tree.
   */
  decisions?: DecisionsFile;
  /**
   * Inject the doc set instead of walking the filesystem. Editions with no live
   * working tree (EE) source docs through the repo-doc seam (`readRepoDoc`); OSS
   * omits it and the run discovers from disk.
   */
  docSource?: () => DocCandidate[] | Promise<DocCandidate[]>;
  /**
   * Who this repository is, for the curation session's IDENTITY block.
   * Omit and the run resolves it from the repo tree (OSS). EE passes it
   * explicitly — including explicit `null` — because its scan runs on an
   * ephemeral shallow clone whose directory is named `tc-gate-scan-XXXX`.
   */
  repoIdentity?: RepoIdentity | null;
  /**
   * Pre-flight LLM cost estimate gate. Called with the token estimate before any
   * LLM work; return `false` to abort (throws {@link EstimateDeclined}). Omit to
   * run without confirmation.
   */
  onLlmEstimate?: (estimate: LlmEstimate) => Promise<boolean>;
  /**
   * Progress surface for the estimate itself (it runs before the first pipeline
   * step, so the tracker can't carry it). The CLI resolves a spinner line above
   * the estimate panel; the dashboard passes `estimateStepPhase(tracker)`.
   */
  onEstimatePhase?: EstimatePhase;
  /** Ceiling on concurrent sessions (the pool's governor may run fewer). */
  concurrency?: number;
  /**
   * Single-step mode (the CLI's `--only-<step>` flags): run only this step's
   * sessions — prior steps replay from their durable artifacts (a missing one
   * throws {@link ScanStepNotReadyError}), later steps never start, and
   * corpus.json is written only by the final step (`overlap`). The estimate
   * gate prices only the chosen step.
   */
  only?: ScanStep;
  /** Skip the overlap sessions (the workspace corpus sync passes this). */
  disableOverlapDetection?: boolean;
  /**
   * Skip the scope-orchestrator session (stored verdicts still apply). The
   * workspace corpus sync passes this — its scratch tree (and the decisions
   * materialized into it) is deleted after the run, so a scope session there
   * would re-spend on every sync and settle nothing durable.
   */
  disableScopeOrchestration?: boolean;
  /**
   * A `question-asked` event from a scan session (the interactive scope
   * orchestrator — §3.7), as it happens. The CLI prints the dashboard deep
   * link; nothing ever blocks on it — an unanswered question lands in the
   * result's `pendingQuestions`.
   */
  onQuestion?: (workItem: string, question: UserInputQuestion) => void;
  /**
   * The sessions-store run record was just created (post-estimate-confirm,
   * before any session runs). The CLI prints the dashboard "watch live" deep
   * link from it.
   */
  onRunStarted?: (info: SessionRunStartedInfo) => void;
  /**
   * Test seam / EE injection: run the sessions on THIS driver instead of the
   * configured one. Tests pass a scripted driver; production passes none.
   */
  driver?: SessionDriver;
}

/**
 * Run the session-based scan (corpus path) and drive a tracker through
 * CURATE_STEPS. Writes `.truecourse/specs/corpus.json` (the run does).
 * Idempotent: unchanged docs hit the per-doc session cache and cost nothing.
 *
 * The four step keys survive from the one-shot pipeline so both surfaces'
 * progress UIs render unchanged; what each covers moved: `discover` =
 * discovery + prefilter, `tag` = the curate-doc pool + the settle session,
 * `overlap` = the per-area overlap sessions, `verify` = the deterministic
 * fold (pointer re-anchoring, cross-area dedup, confidence auto-apply).
 */
export async function curateInProcess(
  repoRoot: string,
  options: CurateInProcessOptions = {},
): Promise<SpecCurateInProcessResult> {
  const { tracker } = options;
  if (options.llm === 'agent') {
    throw new Error(
      'spec scan now runs agent sessions; the `agent` mailbox transport cannot carry them — use `--llm api` or `--llm cli`.',
    );
  }
  // The transport this run actually uses decides what the estimate names —
  // never the saved selection a `--llm-transport` flag just overrode.
  const mode = effectiveLlmMode(options.llm);
  const startedAt = Date.now();

  // Pre-flight cost estimate + confirm, before any LLM work. Skip the prompt
  // when there's nothing to spend (a warmed cache yields an empty estimate).
  // Decline → abort. The estimate models SESSIONS: it probes the same scan
  // caches (same key builders, instructions fingerprint included) the run
  // reads, so estimate and run agree on what is actually spent.
  if (options.onLlmEstimate) {
    const prices = await getModelPrices();
    const estimate = await withEstimatePhase(options.onEstimatePhase, () =>
      estimateScanTokens(repoRoot, prices, { identity: options.repoIdentity, mode, only: options.only }),
    );
    if ((estimate.stages?.length ?? 0) > 0) {
      const proceed = await options.onLlmEstimate(estimate);
      if (!proceed) throw new EstimateDeclined('scan');
    }
  }

  // The sessions run + transcript store (§3.9): `sessions/spec-scan/<runId>/`.
  // Created after the estimate gate, so a declined scan leaves no run record.
  const gitRef = await resolveCommitSha(repoRoot);
  const run = createSessionRun(repoRoot, { command: 'spec-scan', gitRef });
  options.onRunStarted?.({ command: 'spec-scan', runId: run.runId, dir: run.dir });
  // Mirror the step checklist into the run record: the CLI renders the tracker
  // locally, but the dashboard can only see what run.json carries, and the
  // early phases (discover/tag) have no sessions to show progress through.
  tracker?.tap((p) => {
    if (p.steps) run.setProgress(p.steps);
  });

  // The driver, LAZILY: a fully-cached re-scan resolves nothing (so an edition
  // that cannot construct a driver offline still re-scans for free), and the
  // run record learns what it ran on the moment the first session needs it.
  let configured: ConfiguredSessionDriver | null = null;
  const driver = async (): Promise<SessionDriver> => {
    if (options.driver) return options.driver;
    if (!configured) {
      configured = createConfiguredSessionDriver({
        ...(options.llm && options.llm !== 'agent' ? { transport: options.llm } : {}),
        cwd: repoRoot,
        providerStateDir: path.join(run.dir, 'provider'),
      });
      run.setLlm({
        mode: configured.mode,
        provider: configured.attribution.provider,
        model: configured.attribution.model,
        ...(configured.attribution.fallbackModel
          ? { fallbackModel: configured.attribution.fallbackModel }
          : {}),
      });
    }
    return configured.driver;
  };

  let tagStarted = false;
  let overlapStarted = false;
  let verifyStarted = false;
  const ensureTag = (): void => {
    if (tagStarted) return;
    tracker?.done('discover');
    tracker?.start('tag');
    tagStarted = true;
  };
  const ensureOverlap = (): void => {
    ensureTag();
    if (overlapStarted) return;
    tracker?.done('tag');
    tracker?.start('overlap');
    overlapStarted = true;
  };
  // The verify step is now the deterministic fold: pointer re-anchoring,
  // cross-area dedup, and the confidence auto-apply.
  const ensureVerify = (): void => {
    ensureOverlap();
    if (verifyStarted) return;
    tracker?.done('overlap');
    tracker?.start('verify');
    verifyStarted = true;
  };

  try {
    tracker?.start('discover');
    let result: Awaited<ReturnType<typeof runSpecScanSessions>>;
    try {
      result = await runSpecScanSessions({
        repoRoot,
        driver,
        persistence: run.persistence,
        decisions: options.decisions,
        docSource: options.docSource,
        repoIdentity: options.repoIdentity,
        skipGit: options.skipGit,
        skipCorpusWrite: options.skipCorpusWrite,
        disableOverlapDetection: options.disableOverlapDetection,
        disableScopeOrchestration: options.disableScopeOrchestration,
        ...(options.only !== undefined ? { only: options.only } : {}),
        ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
        onDiscover: (docs, toCurate) =>
          tracker?.detail('discover', `${docs} docs · ${toCurate} to curate`),
        onScope: (state) => {
          if (state === 'covered') tracker?.detail('discover', 'scope covered — no orchestrator session');
          else if (state === 'ran') tracker?.detail('discover', 'scan scope settled');
          else if (state === 'failed')
            tracker?.detail('discover', 'scope session failed — stored verdicts kept');
        },
        onSessionEvent: (workItem, event) => {
          if (event.type === 'question-asked') options.onQuestion?.(workItem, event.question);
        },
        onCurateProgress: (done, total) => {
          ensureTag();
          if (total > 0) tracker?.detail('tag', `${done}/${total} docs`);
        },
        onSettle: (state) => {
          ensureTag();
          if (state !== 'skipped') tracker?.detail('tag', `vocabulary ${state === 'cached' ? 'settled (cached)' : state === 'ran' ? 'settled' : 'settlement failed — labels kept as-is'}`);
        },
        onOverlapProgress: (done, total) => {
          ensureOverlap();
          tracker?.detail('overlap', total > 0 ? `${done}/${total} areas` : 'no areas');
        },
      });
    } catch (e) {
      const active = verifyStarted ? 'verify' : overlapStarted ? 'overlap' : tagStarted ? 'tag' : 'discover';
      tracker?.error(active, (e as Error).message);
      run.finish('failed');
      throw e;
    }

    if (result.stoppedAfter) {
      // Single-step run: close only the steps that actually opened. The CLI
      // hands the tracker a reduced checklist, so the later keys don't exist
      // (and StepTracker no-ops on unknown keys anyway).
      const note = `stopped after ${result.stoppedAfter}`;
      if (tagStarted) tracker?.done('tag', note);
      else tracker?.done('discover', note);
    } else {
      ensureVerify();
      tracker?.done('overlap', `${result.stats.areaCount} areas · ${result.stats.overlapFlags} overlaps`);
      tracker?.done(
        'verify',
        result.stats.autoResolvedConflicts.length > 0
          ? `${result.stats.autoResolvedConflicts.length} auto-resolved`
          : 'anchors verified',
      );
    }
    run.finish('completed');

    // A partial (single-step) run never reports telemetry — its counts would
    // read as a whole scan's.
    if (options.source && !result.stoppedAfter) {
      await trackEvent('spec_scan', {
        source: options.source,
        docsScannedRange: bucketFileCount(result.stats.docsScanned),
        claimsRange: bucketFileCount(result.stats.docsKept),
        openConflicts: result.stats.overlapFlags,
        durationRange: bucketDuration(Date.now() - startedAt),
      });
    }

    // "Nothing changed" = the scan ran zero fresh sessions (every kind was a
    // cache hit) and lost none. Computed by the run itself — sessions never
    // touch the one-shot stage-usage sink the old derivation read.
    return {
      curate: result,
      noChanges: result.noChanges,
      pendingQuestions: result.pendingQuestions,
      scanFindings: result.scanFindings,
      ...(result.stoppedAfter ? { stoppedAfter: result.stoppedAfter } : {}),
      sessionsRunDir: run.dir,
    };
  } catch (e) {
    // The run record is closed exactly once; the inner catch handled the scan
    // path, this covers the estimate/telemetry edges around it.
    if (run.record().status === 'running') run.finish('failed');
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Workspace Knowledge (enterprise) — corpus path.
//
// External KB sources (Confluence, …) are synced as in-memory markdown. The
// corpus engine is disk-based, so we materialize the docs into a TRANSIENT
// scratch tree, run curate over it exactly like a repo, then persist the curated
// corpus under WORKSPACE scope (Postgres in EE). The scratch tree — and the
// bodies — are deleted after. Unchanged docs hit the per-doc caches → ~0 LLM on
// re-sync. Scenario generation runs separately (the auto-chained workspace guard
// job); this path is corpus-only.
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
}

/**
 * Curate the workspace Knowledge docs on the corpus path and persist the curated
 * corpus under workspace scope. Returns the area count for the sync notice.
 * Scenario generation runs separately (the auto-chained workspace guard job); this
 * path is corpus-only — it never generates or stores workspace `.tc` contracts.
 */
export async function syncWorkspaceCorpusInProcess(options: {
  workspaceOrgId: string;
  docs: WorkspaceDocInput[];
  /**
   * The workspace's curation decisions (force includes/excludes, conflict
   * verdicts). Materialized as `decisions.json` in the scratch tree so curate
   * folds them exactly as it does for a repo — a force-exclude drops its doc, a
   * verdict marks its conflict resolved. Omit for an un-curated sync.
   */
  decisions?: DecisionsFile;
  tracker?: StepTracker;
  llm?: 'cli' | 'agent' | 'api';
  io?: string;
  // --- test seams (mirror curateInProcess(); production passes none) --------
  driver?: CurateInProcessOptions['driver'];
  disableOverlapDetection?: boolean;
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
    // Materialize the decisions BEFORE curate so it reads them from the tree, the
    // same channel a repo uses (curate reads `.truecourse/specs/decisions.json`).
    if (options.decisions) writeDecisions(tmp, options.decisions);

    const { curate: curateResult } = await curateInProcess(tmp, {
      tracker: options.tracker,
      skipGit: true,
      llm: options.llm,
      io: options.io,
      driver: options.driver,
      disableOverlapDetection: options.disableOverlapDetection,
      // The scratch tree is transient — a scope session here would re-spend on
      // every sync and its verdicts die with the tree.
      disableScopeOrchestration: true,
    });
    // Persist the curated corpus under workspace scope (the dashboard reads it).
    await saveWorkspaceSpec(ref, 'corpus', curateResult.corpus);
    return { areaCount: curateResult.stats.areaCount };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Workspace inheritance (enterprise) — a connected repo folds its workspace
// Knowledge corpus into its own spec before curate/generate.
//
// Inheritance is a materialization problem, not a connector one: the workspace
// layer is a set of STORED doc bodies (namespaced `knowledge/<kind>/<id>.md`) plus
// the workspace decisions. `materializeWorkspaceInheritance` writes those bodies
// into a checkout and folds the workspace decisions UNDER the repo's own (repo
// wins), so the repo's curate sees one doc universe with the workspace layer
// pre-resolved. The doc bodies are resolved through the `spec-inheritance-hook`
// seam (EE installs it; OSS/tests leave it unset → the repo curates alone).
// ---------------------------------------------------------------------------

/**
 * Fold the workspace decisions layer UNDER a repo's own — the decisions analog of
 * workspace doc-body inheritance. Pure. The repo overlay wins per identity on every
 * dimension (the same {@link mergeDecisions} keying `buildCorpusConflicts` uses): a
 * workspace-resolved conflict arrives pre-resolved, and a repo verdict on a
 * cross-layer conflict — written at repo scope — supersedes it.
 */
export function mergeInheritedDecisions(workspace: DecisionsFile, repo: DecisionsFile): DecisionsFile {
  return mergeDecisions(workspace, repo);
}

/**
 * Materialize the workspace Knowledge layer into `repoRoot` before curate/generate:
 * write every workspace doc body at its namespaced `knowledge/<kind>/<id>.md` path
 * (the same paths the workspace ledger stores, so the repo's curate hits the caches
 * the workspace already paid for) and return the effective decisions to curate with
 * — the workspace decisions folded under `repoDecisions` (repo wins). Inert when no
 * inheritance seam is installed (OSS) or the repo inherits nothing: the passed
 * `repoDecisions` are returned unchanged and `inherited` is false. Best-effort reads
 * only — never mutates repo state.
 */
export async function materializeWorkspaceInheritance(
  repoRoot: string,
  repoKey: string,
  repoDecisions: DecisionsFile,
): Promise<{ decisions: DecisionsFile; inherited: boolean }> {
  const hook = getSpecInheritanceHook();
  if (!hook) return { decisions: repoDecisions, inherited: false };
  const layer = await hook(repoKey);
  if (!layer) return { decisions: repoDecisions, inherited: false };
  for (const doc of layer.docs) {
    const dest = path.join(repoRoot, doc.docPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, doc.markdown, 'utf-8');
  }
  return { decisions: mergeInheritedDecisions(layer.decisions, repoDecisions), inherited: true };
}

/**
 * A stable content signature of a curated corpus — the sha over its meaningful
 * structure with the volatile fields zeroed (the top-level `generatedAt` and each
 * doc's `lastTouched`, both of which move on every run/sync without any content
 * change). Two corpora with the same signature curate to the same doc universe, so
 * the workspace ripple compares it before/after a process to skip re-scanning the
 * org's repos when nothing meaningful changed. Null corpus → the empty signature.
 */
export function corpusContentSha(corpus: CuratedCorpus | null): string {
  if (!corpus) return '';
  const stable = {
    ...corpus,
    generatedAt: '',
    docs: corpus.docs.map((d) => ({ ...d, lastTouched: '' })),
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
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

/** An empty decisions document (all lists empty) — the "no resolutions yet" base. */
export const EMPTY_DECISIONS: DecisionsFile = {
  version: 2,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
  conflictResolutions: [],
  scopeVerdicts: [],
  instructions: [],
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
 *   - manualIncludes / manualExcludes: union by path, but the overlay's verb wins
 *     per path — a path the overlay excludes is dropped from includes and vice
 *     versa (never a contradictory pair).
 *   - manualAreas: the overlay's override replaces the base's for that doc.
 *   - scopeVerdicts (v2): the overlay wins per verdict path.
 *   - instructions (v2): union — base order kept, overlay's new lines appended.
 */
export function mergeDecisions(base: DecisionsFile, overlay: DecisionsFile): DecisionsFile {
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

  // Scope verdicts: the overlay wins per verdict path (same normalization the
  // scan's own fold applies, so `docs/` and `docs` are one path).
  const overlayScopePaths = new Set((overlay.scopeVerdicts ?? []).map((v) => normalizeScopePath(v.path)));
  const scopeVerdicts = [
    ...(base.scopeVerdicts ?? []).filter((v) => !overlayScopePaths.has(normalizeScopePath(v.path))),
    ...(overlay.scopeVerdicts ?? []),
  ];
  const instructions = uniqueStrings([...(base.instructions ?? []), ...(overlay.instructions ?? [])]);

  return {
    version: 2,
    manualIncludes,
    manualExcludes,
    manualAreas,
    conflictResolutions,
    scopeVerdicts,
    instructions,
  };
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
 * run. Corpus-path analog of {@link getScanState}. OSS reads
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
// None of these re-curate the corpus.
// ---------------------------------------------------------------------------

// Pure DecisionsFile transforms — the read-modify-write core, shared verbatim by
// the repo (file/Postgres) and workspace (Postgres) helpers so both surfaces
// agree on update semantics. An `apply*` that makes no change returns the SAME
// object reference, letting callers skip a redundant store.

/**
 * Dispute-identity key for a section-scoped conflict verdict: the
 * unordered doc pair plus each side's section anchor, oriented by doc so the same
 * dispute keys identically regardless of which doc was recorded as A. One verdict
 * per dispute — re-recording replaces it.
 */
const conflictResolutionKey = (r: ConflictResolution): string => {
  const sides = [
    `${r.docA}#${r.anchorA ?? ''}`,
    `${r.docB}#${r.anchorB ?? ''}`,
  ].sort();
  return sides.join(' \x00 ');
};

// Include and exclude are mutually exclusive per doc: adding one clears the
// other for that path, so decisions.json can never hold a contradictory pair.

/**
 * The v2 fields every rebuild carries through untouched — a mutation of one
 * dimension must never drop another's rows (an EE row stored before v2 may
 * genuinely lack them, hence the `?? []`).
 */
function carriedV2Fields(existing: DecisionsFile): Pick<DecisionsFile, 'scopeVerdicts' | 'instructions'> {
  return {
    scopeVerdicts: existing.scopeVerdicts ?? [],
    instructions: existing.instructions ?? [],
  };
}

function applyAddManualInclude(existing: DecisionsFile, docPath: string): DecisionsFile {
  const includes = existing.manualIncludes ?? [];
  const excludes = existing.manualExcludes ?? [];
  if (includes.includes(docPath) && !excludes.includes(docPath)) return existing;
  return {
    version: 2,
    manualIncludes: includes.includes(docPath) ? includes : [...includes, docPath],
    manualExcludes: excludes.filter((p) => p !== docPath),
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: existing.conflictResolutions ?? [],
    ...carriedV2Fields(existing),
  };
}

function applyRemoveManualInclude(existing: DecisionsFile, docPath: string): DecisionsFile {
  return {
    version: 2,
    manualIncludes: (existing.manualIncludes ?? []).filter((p) => p !== docPath),
    manualExcludes: existing.manualExcludes ?? [],
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: existing.conflictResolutions ?? [],
    ...carriedV2Fields(existing),
  };
}

function applyAddManualExclude(existing: DecisionsFile, docPath: string): DecisionsFile {
  const includes = existing.manualIncludes ?? [];
  const excludes = existing.manualExcludes ?? [];
  if (excludes.includes(docPath) && !includes.includes(docPath)) return existing;
  return {
    version: 2,
    manualIncludes: includes.filter((p) => p !== docPath),
    manualExcludes: excludes.includes(docPath) ? excludes : [...excludes, docPath],
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: existing.conflictResolutions ?? [],
    ...carriedV2Fields(existing),
  };
}

function applyRemoveManualExclude(existing: DecisionsFile, docPath: string): DecisionsFile {
  return {
    version: 2,
    manualIncludes: existing.manualIncludes ?? [],
    manualExcludes: (existing.manualExcludes ?? []).filter((p) => p !== docPath),
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: existing.conflictResolutions ?? [],
    ...carriedV2Fields(existing),
  };
}

// Section-scoped conflict verdicts. One verdict per dispute identity —
// recording a verdict for a dispute already resolved replaces it (a side verdict
// overwrites a prior dismissal and vice versa).

function applyAddConflictResolution(existing: DecisionsFile, input: ConflictResolution): DecisionsFile {
  if (input.docA === input.docB) {
    throw new Error('addConflictResolution: docA and docB must be different docs');
  }
  const key = conflictResolutionKey(input);
  const dedup = (existing.conflictResolutions ?? []).filter((r) => conflictResolutionKey(r) !== key);
  return {
    version: 2,
    manualIncludes: existing.manualIncludes ?? [],
    manualExcludes: existing.manualExcludes ?? [],
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: [...dedup, input],
    ...carriedV2Fields(existing),
  };
}

function applyRemoveConflictResolution(
  existing: DecisionsFile,
  input: { docA: string; anchorA: string | null; docB: string; anchorB: string | null },
): DecisionsFile {
  const key = conflictResolutionKey({ ...input, verdict: 'dismissed', resolvedAt: '' });
  return {
    version: 2,
    manualIncludes: existing.manualIncludes ?? [],
    manualExcludes: existing.manualExcludes ?? [],
    manualAreas: existing.manualAreas ?? [],
    conflictResolutions: (existing.conflictResolutions ?? []).filter((r) => conflictResolutionKey(r) !== key),
    ...carriedV2Fields(existing),
  };
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
 * Record a SECTION-scoped conflict verdict — pick-a-side ('a'/'b') or
 * dismissal — for one flagged dispute. Replaces any prior verdict for the same
 * dispute identity. This does NOT re-curate: the
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

// ---------------------------------------------------------------------------
// Workspace decisions (enterprise) — the org-scoped analog of the repo decision
// mutations above. Same pure DecisionsFile transforms, persisted under WORKSPACE
// scope (the `workspace_spec_sets` `decisions` artifact, keyed by org, no commit).
// The EE Knowledge page's decision endpoints call these; a workspace has no PR
// overlay dimension, so there is no `pr` opt. Each write is followed (by the
// caller) with a re-process so the corpus reflects the decision.
// ---------------------------------------------------------------------------

async function loadWorkspaceDecisions(org: string): Promise<DecisionsFile> {
  return (await loadWorkspaceSpec<DecisionsFile>({ workspaceOrgId: org }, 'decisions')) ?? EMPTY_DECISIONS;
}

async function storeWorkspaceDecisions(org: string, next: DecisionsFile): Promise<void> {
  await saveWorkspaceSpec({ workspaceOrgId: org }, 'decisions', next);
}

/** The workspace's current decisions (the Knowledge page read), or empty when none. */
export function getWorkspaceDecisions(org: string): Promise<DecisionsFile> {
  return loadWorkspaceDecisions(org);
}

export async function addWorkspaceManualInclude(org: string, docPath: string): Promise<DecisionsFile> {
  const existing = await loadWorkspaceDecisions(org);
  const next = applyAddManualInclude(existing, docPath);
  if (next !== existing) await storeWorkspaceDecisions(org, next);
  return next;
}

export async function removeWorkspaceManualInclude(org: string, docPath: string): Promise<DecisionsFile> {
  const next = applyRemoveManualInclude(await loadWorkspaceDecisions(org), docPath);
  await storeWorkspaceDecisions(org, next);
  return next;
}

export async function addWorkspaceManualExclude(org: string, docPath: string): Promise<DecisionsFile> {
  const existing = await loadWorkspaceDecisions(org);
  const next = applyAddManualExclude(existing, docPath);
  if (next !== existing) await storeWorkspaceDecisions(org, next);
  return next;
}

export async function removeWorkspaceManualExclude(org: string, docPath: string): Promise<DecisionsFile> {
  const next = applyRemoveManualExclude(await loadWorkspaceDecisions(org), docPath);
  await storeWorkspaceDecisions(org, next);
  return next;
}

export async function addWorkspaceConflictResolution(
  org: string,
  input: ConflictResolution,
): Promise<DecisionsFile> {
  const next = applyAddConflictResolution(await loadWorkspaceDecisions(org), input);
  await storeWorkspaceDecisions(org, next);
  return next;
}

export async function removeWorkspaceConflictResolution(
  org: string,
  input: { docA: string; anchorA: string | null; docB: string; anchorB: string | null },
): Promise<DecisionsFile> {
  const next = applyRemoveConflictResolution(await loadWorkspaceDecisions(org), input);
  await storeWorkspaceDecisions(org, next);
  return next;
}
