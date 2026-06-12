/**
 * Shared in-process entry points for the BL Drift / Spec Consolidation
 * commands. Both the CLI and the dashboard server import these so
 * progress wiring, scan-state persistence, decision-file writes, and
 * IL-extraction chaining live in exactly one place.
 *
 * Same shape as `analyze-in-process.ts` — the caller passes a
 * `StepTracker` and we drive it through the high-level phases:
 *
 *   scan           discover → extract → merge → claims.json
 *   resolveAllDefaults  scan → write decisions → re-scan
 *
 * Step keys + labels are stable across CLI/dashboard so the progress
 * UI is identical on both surfaces. Implementations of the actual
 * pipelines come from `@truecourse/spec-consolidator` and
 * `@truecourse/contract-extractor`; this module just orchestrates
 * them and reports progress.
 */

import {
  candidateFingerprint,
  consolidate,
  remerge,
  readDecisions,
  writeDecisions,
  writeScanState,
  type Claim,
  type ClaimsFile,
  type DocCandidate,
  type ConsolidateModels,
  type ConsolidateResult,
  type Decision,
  type DecisionsFile,
  type ManualChain,
  type MergeResult,
  type Resolution,
  type ScanState,
  type VersionChain,
} from '@truecourse/spec-consolidator';
import {
  canonicalFromClaims,
  defaultConcurrency as defaultExtractorConcurrency,
  generateContracts,
  generateContractsInMemory,
  hasCanonicalSpec,
  spawnRunner as spawnExtractorRunner,
  type ExtractModels,
  type GenerateResult,
  type SliceRunner,
} from '@truecourse/contract-extractor';
import { resolveFallbackModel, resolveModel } from '../config/llm-models.js';
import { agentTransport, getDefaultTransport, type LlmTransport } from '@truecourse/shared/llm';

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

export const SCAN_STEPS = [
  { key: 'discover', label: 'Discovering docs' },
  { key: 'extract', label: 'Extracting claims' },
  { key: 'merge', label: 'Merging claims' },
  { key: 'explain', label: 'Explaining conflicts' },
  { key: 'resolve', label: 'Auto-resolving conflicts' },
] as const;

export const RESOLVE_STEPS = [
  { key: 'scan', label: 'Scanning' },
  { key: 'resolve-chains', label: 'Resolving version chains' },
  { key: 'resolve-content', label: 'Resolving content conflicts' },
  { key: 'finalize', label: 'Refreshing scan state' },
] as const;

export const GENERATE_STEPS = [
  { key: 'il', label: 'Extracting TC contracts' },
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
// Results
// ---------------------------------------------------------------------------

export interface SpecScanInProcessResult {
  consolidate: ConsolidateResult;
  /** What was written to scan-state.json. */
  scanState: ScanState;
}

export interface GenerateContractsInProcessResult {
  /** IL extraction outcome. `skipped` is set when the canonical spec
   *  is missing or the call was made with no work to do. */
  il:
    | { kind: 'extracted'; result: GenerateResult }
    | { kind: 'skipped'; reason: string }
    | { kind: 'failed'; error: Error };
}

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
}

export interface SpecResolveAllDefaultsResult {
  /** The scan that informed the default picks. */
  consolidate: ConsolidateResult;
  /** How many *new* decisions were written (existing ones survive). */
  additions: number;
  /** Final decisions file written to disk. */
  decisions: DecisionsFile;
  /** Re-scan after writing decisions — drives the dashboard refresh. */
  postScanState: ScanState;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

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
  /** Override block extraction runner; tests inject a stub. */
  blockRunner?: Parameters<typeof consolidate>[1] extends infer T
    ? T extends { blockRunner?: infer R }
      ? R
      : never
    : never;
  /** Override LLM chain-detection runner; tests inject a stub. */
  chainRunner?: Parameters<typeof consolidate>[1] extends infer T
    ? T extends { chainRunner?: infer R }
      ? R
      : never
    : never;
  /** When true, skip the LLM chain-detection step entirely. */
  disableLlmChainDetection?: boolean;
  /** When true, skip the LLM chain-recheck step. */
  disableChainRecheck?: boolean;
  /** When true, skip the LLM conflict-explanation step. */
  disableConflictExplanations?: boolean;
  /** When true, skip the LLM conflict-resolution step (no auto-resolve). */
  disableConflictResolution?: boolean;
  /** When true, skip the LLM relevance filter (every doc is in scope). */
  disableRelevanceFilter?: boolean;
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
 * Marker file stamped after a successful `contracts generate` run. The
 * dashboard's `/spec/staleness` endpoint reads its mtime against
 * `claims.json` (was the scan run after the last generate?) and against
 * `verify-state.json` (has verify run since the last generate?). Both
 * CLI and dashboard drive the same in-process helper, so a terminal
 * `truecourse contracts generate` keeps the dashboard's dots honest.
 */
const GENERATED_MARKER_REL = path.join('.truecourse', '.cache', '.last-generated.json');

export function generatedMarkerPath(repoRoot: string): string {
  return path.join(repoRoot, GENERATED_MARKER_REL);
}

export function stampGeneratedMarker(repoRoot: string): void {
  const file = generatedMarkerPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ generatedAt: new Date().toISOString() }, null, 2) + '\n',
  );
}

/**
 * Build the per-stage `ConsolidateModels` map by resolving each
 * spec-pipeline stage against env vars + `.truecourse/config.json` +
 * the in-code defaults. Called once at the top of every consolidate
 * driver so a single run uses the same model per stage across all
 * iterations (default-resolve loops re-scan multiple times).
 */
function resolveConsolidateModels(repoRoot: string): ConsolidateModels {
  return {
    chainDetect: resolveModel('spec.chainDetect', undefined, repoRoot),
    claimExtract: resolveModel('spec.claimExtract', undefined, repoRoot),
    chainRecheck: resolveModel('spec.chainRecheck', undefined, repoRoot),
    conflictExplain: resolveModel('spec.conflictExplain', undefined, repoRoot),
    conflictResolve: resolveModel('spec.conflictResolve', undefined, repoRoot),
    relevance: resolveModel('spec.relevance', undefined, repoRoot),
    fallback: resolveFallbackModel(repoRoot) ?? undefined,
  };
}

/**
 * Same idea for the contract-extractor's two LLM stages.
 */
function resolveExtractModels(repoRoot: string): ExtractModels {
  return {
    extract: resolveModel('contract.extract', undefined, repoRoot),
    repair: resolveModel('contract.repair', undefined, repoRoot),
    fallback: resolveFallbackModel(repoRoot) ?? undefined,
  };
}

interface ScanStateStats {
  docsScanned: number;
  blocksAttempted: number;
  claimsExtracted: number;
  skippedDocs: Array<{ path: string; reason: string }>;
}

/**
 * Build a scan-state from a merge result + extraction stats. Split out from
 * `buildScanState` so the body-free workspace `remerge` path can produce the
 * exact same shape from persisted derived state (it carries the doc/block counts
 * forward from the prior scan-state since it didn't re-extract).
 */
function scanStateFromMerge(merge: MergeResult, stats: ScanStateStats): ScanState {
  const openWithFp = merge.openConflicts.map((c) => ({
    ...c,
    candidateFingerprint: candidateFingerprint(c),
  }));
  return {
    scannedAt: new Date().toISOString(),
    docsScanned: stats.docsScanned,
    blocksAttempted: stats.blocksAttempted,
    claimsExtracted: stats.claimsExtracted,
    resolved: merge.resolvedClaims.length,
    decided: merge.decidedConflicts.length,
    openConflicts: openWithFp,
    decidedConflicts: merge.decidedConflicts.map((d) => ({
      // Stamp the same fingerprint we surface on open conflicts so the
      // Decisions tab can POST a change-of-mind via the existing
      // upsert endpoint (the server validates that the field is
      // present, and uses it as the candidate-set identity).
      conflict: { ...d.conflict, candidateFingerprint: candidateFingerprint(d.conflict) },
      decision: d.decision,
    })),
    skippedDocs: stats.skippedDocs,
  };
}

function buildScanState(result: ConsolidateResult): ScanState {
  return scanStateFromMerge(result.merge, {
    docsScanned: result.extract.docsScanned,
    blocksAttempted: result.extract.blocksAttempted,
    claimsExtracted: result.extract.claims.length,
    skippedDocs: result.skippedDocs ?? [],
  });
}

// ---------------------------------------------------------------------------
// scanInProcess
// ---------------------------------------------------------------------------

/**
 * Run `consolidate()`, persist the result to
 * `.truecourse/.cache/consolidator/scan-state.json` (and write the
 * structured `claims.json` snapshot for the downstream contract
 * extractor), and drive the provided tracker through the SCAN_STEPS
 * lifecycle.
 *
 * Idempotent: re-runs against unchanged docs hit the block cache and
 * cost nothing.
 */
export async function scanInProcess(
  repoRoot: string,
  options: SpecInProcessOptions = {},
): Promise<SpecScanInProcessResult> {
  const { tracker } = options;
  const startedAt = Date.now();
  let docsSeen = 0;
  let blocksTotal = 0;
  let blocksDone = 0;
  let extractStarted = false;
  let mergeStarted = false;

  const renderExtractDetail = (): string => {
    if (blocksTotal === 0) {
      return `${docsSeen} docs`;
    }
    return `${docsSeen} docs · ${blocksDone}/${blocksTotal} blocks`;
  };

  let explainTotal = 0;
  let explainDone = 0;
  let explainStarted = false;
  let resolveTotal = 0;
  let resolveDone = 0;
  let resolveStarted = false;

  tracker?.start('discover');
  const tConsolidateStart = perfNow();
  let result: ConsolidateResult;
  // A body-having scan into the server-side store (EE: the gate clones a fresh PR
  // head, which has no decisions.json) must NOT re-open already-resolved conflicts.
  // The consolidator otherwise falls back to reading decisions from the working
  // tree; load the repo's decisions from the ACTIVE store (EE: Postgres by repoKey;
  // OSS: the local file) and inject them, so resolutions hold across the scan —
  // exactly as the dashboard's body-free remerge does.
  const priorDecisions = await loadDecisions(options.ref?.repoKey ?? repoRoot);
  try {
    result = await consolidate(repoRoot, {
      decisions: priorDecisions,
      blockRunner: options.blockRunner,
      chainRunner: options.chainRunner,
      disableLlmChainDetection: options.disableLlmChainDetection,
      disableChainRecheck: options.disableChainRecheck,
      disableConflictExplanations: options.disableConflictExplanations,
      disableConflictResolution: options.disableConflictResolution,
      disableRelevanceFilter: options.disableRelevanceFilter,
      skipGit: options.skipGit,
      transport: resolveTransport(options),
      models: resolveConsolidateModels(repoRoot),
      onRelevanceProgress: (doneCount, total) => {
        // Numbered progress while "Discovering docs" runs (LLM relevance
        // filter over the discovered candidates).
        if (total > 0) tracker?.detail('discover', `${doneCount}/${total} docs`);
      },
      onDocStart: () => {
        if (!extractStarted) {
          tracker?.done('discover');
          tracker?.start('extract');
          extractStarted = true;
        }
        docsSeen++;
        tracker?.detail('extract', renderExtractDetail());
      },
      onBlocksReady: (total) => {
        blocksTotal = total;
        tracker?.detail('extract', renderExtractDetail());
      },
      onBlockDone: () => {
        blocksDone++;
        tracker?.detail('extract', renderExtractDetail());
      },
      onMergeStart: () => {
        if (!mergeStarted) {
          if (!extractStarted) {
            tracker?.done('discover');
            tracker?.start('extract');
          }
          tracker?.done('extract', `${blocksDone} blocks`);
          tracker?.start('merge');
          mergeStarted = true;
        }
      },
      onExplainStart: (total) => {
        // Merge itself is fast — close it as soon as the explainer
        // takes over (whether it has work or not).
        if (mergeStarted) {
          tracker?.done('merge');
        }
        explainTotal = total;
        explainStarted = true;
        tracker?.start('explain');
        tracker?.detail('explain', total === 0 ? 'no open conflicts' : `0/${total}`);
      },
      onExplainDone: () => {
        explainDone++;
        tracker?.detail('explain', `${explainDone}/${explainTotal}`);
      },
      onResolveStart: (total) => {
        if (explainStarted) {
          tracker?.done(
            'explain',
            explainTotal === 0 ? 'skipped' : `${explainDone}/${explainTotal}`,
          );
        }
        resolveTotal = total;
        resolveStarted = true;
        tracker?.start('resolve');
        tracker?.detail('resolve', total === 0 ? 'no open conflicts' : `0/${total}`);
      },
      onResolveDone: () => {
        resolveDone++;
        tracker?.detail('resolve', `${resolveDone}/${resolveTotal}`);
      },
    });
  } catch (e) {
    const activeKey = resolveStarted
      ? 'resolve'
      : explainStarted
        ? 'explain'
        : mergeStarted
          ? 'merge'
          : extractStarted
            ? 'extract'
            : 'discover';
    tracker?.error(activeKey, (e as Error).message);
    throw e;
  }

  // Stamp final detail on discover now that we have the full doc count.
  tracker?.detail('discover', `${result.extract.docsScanned} docs`);
  // Close any steps that didn't get a callback (e.g. empty repo, no docs).
  if (!extractStarted) {
    tracker?.done('discover', `${result.extract.docsScanned} docs`);
    tracker?.start('extract');
  }
  if (!mergeStarted) {
    tracker?.done('extract', `${result.extract.claims.length} claims`);
    tracker?.start('merge');
  }
  if (!explainStarted) {
    tracker?.done('merge', `${result.merge.openConflicts.length} open`);
    tracker?.start('explain');
  }
  if (!resolveStarted) {
    tracker?.done(
      'explain',
      explainTotal === 0 ? 'skipped' : `${explainDone}/${explainTotal}`,
    );
    tracker?.start('resolve');
  }
  const tBeforeDone = perfNow();
  debugLog(`scan: consolidate→tracker.done('resolve') gap=${(tBeforeDone - tConsolidateStart).toFixed(0)}ms (includes consolidate total)`);
  tracker?.done(
    'resolve',
    `${result.merge.openConflicts.length} open · ${result.merge.resolvedClaims.length + result.merge.decidedConflicts.length} resolved`,
  );

  const tBuildStart = perfNow();
  const scanState = buildScanState(result);
  const tWriteStart = perfNow();
  writeScanState(repoRoot, scanState);
  debugLog(
    `scan: buildScanState=${(tWriteStart - tBuildStart).toFixed(0)}ms writeScanState=${(perfNow() - tWriteStart).toFixed(0)}ms`,
  );

  if (options.source) {
    await trackEvent('spec_scan', {
      source: options.source,
      docsScannedRange: bucketFileCount(result.extract.docsScanned),
      claimsRange: bucketFileCount(result.extract.claims.length),
      openConflicts: result.merge.openConflicts.length,
      durationRange: bucketDuration(Date.now() - startedAt),
    });
  }

  // Ingest the consolidated spec docs + scan-state into the active store when
  // the caller passes an explicit `ref` (EE). OSS omits `ref` → no ingest
  // (`consolidate`/`writeScanState` already wrote them in place).
  if (options.ref) {
    const specsDir = path.join(repoRoot, '.truecourse', 'specs');
    const claims = readJsonOrNull(path.join(specsDir, 'claims.json'));
    if (claims !== null) await saveSpec(options.ref, 'claims', claims);
    const decisions = readJsonOrNull(path.join(specsDir, 'decisions.json'));
    if (decisions !== null) await saveSpec(options.ref, 'decisions', decisions);
    await saveSpec(options.ref, 'scanState', scanState);
    // Persist the raw (unmerged) claims + version chains too, so a later decision
    // can re-merge WITHOUT the docs (no re-clone, no git) — the same body-free
    // remerge the workspace flow uses. Drives hosted dashboard conflict resolution.
    await saveSpec(options.ref, 'rawClaims', result.extract.claims);
    await saveSpec(options.ref, 'chains', result.chains);
  }

  return { consolidate: result, scanState };
}

/** Parse a JSON file, or `null` when it is absent or unparseable. */
function readJsonOrNull(file: string): unknown {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// scanWorkspaceInProcess — workspace Knowledge consolidation (enterprise)
// ---------------------------------------------------------------------------

/**
 * One source document handed to the workspace consolidator. The body is
 * **transient** — materialized to a scratch tree for the duration of the scan
 * and then deleted; only the derived artifacts (claims/decisions/scan-state)
 * are persisted. `docPath` is the stable id that seeds the slicer's block hash
 * (`blockId = sha256(docPath + headingPath + text)`) and the claim's
 * `provenance.file`, so an unchanged doc re-uploaded under the same `docPath`
 * yields identical block ids → extraction-cache hits → free incremental sync.
 */
export interface WorkspaceDocInput {
  /** Stable, namespaced relative path, e.g. `knowledge/manual/<externalId>.md`. */
  docPath: string;
  /** The transient markdown body. Never persisted. */
  markdown: string;
  /**
   * ISO timestamp used for newest-wins version-chain weighting (manual upload =
   * upload time; a connector passes the tool's `updatedAt`). Defaults to now.
   */
  lastTouched?: string;
}

/**
 * Drive a StepTracker through the SCAN_STEPS lifecycle (discover → extract →
 * merge → explain → resolve) from `consolidate()`'s progress callbacks. Mirrors
 * the inline wiring in `scanInProcess` so the workspace scan surfaces the
 * identical numbered sub-phase detail (docs / blocks / conflicts). Returns the
 * callbacks to spread into `consolidate(...)`.
 */
function consolidateProgressCallbacks(tracker: StepTracker) {
  let docsSeen = 0;
  let blocksTotal = 0;
  let blocksDone = 0;
  let extractStarted = false;
  let mergeStarted = false;
  let explainTotal = 0;
  let explainDone = 0;
  let explainStarted = false;
  let resolveTotal = 0;
  let resolveDone = 0;
  const renderExtractDetail = (): string =>
    blocksTotal === 0
      ? `${docsSeen} docs`
      : `${docsSeen} docs · ${blocksDone}/${blocksTotal} blocks`;
  return {
    onRelevanceProgress: (doneCount: number, total: number) => {
      if (total > 0) tracker.detail('discover', `${doneCount}/${total} docs`);
    },
    onDocStart: () => {
      if (!extractStarted) {
        tracker.done('discover');
        tracker.start('extract');
        extractStarted = true;
      }
      docsSeen++;
      tracker.detail('extract', renderExtractDetail());
    },
    onBlocksReady: (total: number) => {
      blocksTotal = total;
      tracker.detail('extract', renderExtractDetail());
    },
    onBlockDone: () => {
      blocksDone++;
      tracker.detail('extract', renderExtractDetail());
    },
    onMergeStart: () => {
      if (!mergeStarted) {
        if (!extractStarted) {
          tracker.done('discover');
          tracker.start('extract');
        }
        tracker.done('extract', `${blocksDone} blocks`);
        tracker.start('merge');
        mergeStarted = true;
      }
    },
    onExplainStart: (total: number) => {
      if (mergeStarted) tracker.done('merge');
      explainTotal = total;
      explainStarted = true;
      tracker.start('explain');
      tracker.detail('explain', total === 0 ? 'no open conflicts' : `0/${total}`);
    },
    onExplainDone: () => {
      explainDone++;
      tracker.detail('explain', `${explainDone}/${explainTotal}`);
    },
    onResolveStart: (total: number) => {
      if (explainStarted) {
        tracker.done('explain', explainTotal === 0 ? 'skipped' : `${explainDone}/${explainTotal}`);
      }
      resolveTotal = total;
      tracker.start('resolve');
      tracker.detail('resolve', total === 0 ? 'no open conflicts' : `0/${total}`);
    },
    onResolveDone: () => {
      resolveDone++;
      tracker.detail('resolve', `${resolveDone}/${resolveTotal}`);
    },
  };
}

export interface WorkspaceScanOptions {
  /** WorkOS organization id — the workspace Knowledge scope key. */
  workspaceOrgId: string;
  /** The source docs to (re)consolidate. */
  docs: WorkspaceDocInput[];
  /** Progress tracker — driven through SCAN_STEPS (the EE job forwards it to its popup). */
  tracker?: StepTracker;
  /** Adapter that triggered the run (for telemetry). Omit to skip telemetry. */
  source?: TelemetrySource;
  /** LLM transport mode (`cli` default / `agent` mailbox). `agent` requires `io`. */
  llm?: 'cli' | 'agent';
  /** I/O dir for the agent transport's request/response mailbox. */
  io?: string;
  // --- test seams (mirror consolidate(); production passes none) ------------
  blockRunner?: SpecInProcessOptions['blockRunner'];
  chainRunner?: SpecInProcessOptions['chainRunner'];
  disableLlmChainDetection?: boolean;
  disableRelevanceFilter?: boolean;
  disableChainRecheck?: boolean;
  disableConflictExplanations?: boolean;
  disableConflictResolution?: boolean;
}

/** A stable per-org cache scope string. The EE Postgres KV cache ignores it
 *  (content-addressed); it only matters for the OSS file cache, which workspace
 *  scans never use. */
function workspaceScopeKey(orgId: string): string {
  return `workspace:${orgId}`;
}

/** Build an in-memory DocCandidate from a workspace doc input (no disk). */
function workspaceDocToCandidate(input: WorkspaceDocInput): DocCandidate {
  const contentHash = createHash('sha256').update(input.markdown).digest('hex');
  return {
    path: input.docPath,
    absPath: '',
    content: input.markdown,
    kind: 'spec',
    preview: input.markdown.split(/\r?\n/).slice(0, 200).join('\n'),
    lastTouched: input.lastTouched ?? new Date().toISOString(),
    contentHash,
    size: Buffer.byteLength(input.markdown, 'utf-8'),
  };
}

/**
 * Consolidate workspace Knowledge from a set of source docs and persist the
 * derived artifacts under WORKSPACE scope (keyed by org, always-latest).
 *
 * Runs FULLY IN MEMORY — the doc bodies are fed to the consolidator as in-memory
 * `content` (no temp dir, no local disk). Every cache (block extraction + the
 * LLM stages) goes through the KV seam (Postgres in EE), so re-running an
 * unchanged doc set costs **zero LLM**. We persist only derived artifacts; the
 * bodies are never written anywhere — they live in RAM for the scan and vanish.
 */
export async function scanWorkspaceInProcess(
  options: WorkspaceScanOptions,
): Promise<SpecScanInProcessResult> {
  const ref: WorkspaceRef = { workspaceOrgId: options.workspaceOrgId };
  const startedAt = Date.now();

  const candidates = options.docs.map(workspaceDocToCandidate);
  const decisions = await loadWorkspaceDecisions(options.workspaceOrgId);

  const { tracker } = options;
  tracker?.start('discover');
  // Docs + decisions injected → the consolidator reads/writes no local files.
  const result = await consolidate(workspaceScopeKey(options.workspaceOrgId), {
    docSource: () => candidates,
    decisions,
    skipClaimsWrite: true,
    skipGit: true,
    blockRunner: options.blockRunner,
    chainRunner: options.chainRunner,
    disableLlmChainDetection: options.disableLlmChainDetection,
    disableRelevanceFilter: options.disableRelevanceFilter,
    disableChainRecheck: options.disableChainRecheck,
    disableConflictExplanations: options.disableConflictExplanations,
    disableConflictResolution: options.disableConflictResolution,
    transport: resolveTransport(options),
    models: resolveConsolidateModels(process.cwd()),
    ...(tracker ? consolidateProgressCallbacks(tracker) : {}),
  });

  // Persist derived artifacts ONLY (never bodies). The raw claim set + detected
  // chains are what let a later decision re-merge without the docs.
  await saveWorkspaceSpec(ref, 'rawClaims', result.extract.claims);
  await saveWorkspaceSpec(ref, 'chains', result.chains);

  // Fold this scan's high-confidence LLM auto-resolutions into the durable
  // decisions, so a body-free remerge (which skips the LLM) keeps them resolved.
  // Everything else the merge decides (version chains, etc.) is re-derived
  // deterministically by remerge from chains + decisions.
  const autoDecisions = result.merge.decidedConflicts
    .filter((d) => d.autoResolution?.by === 'llm')
    .map((d) => d.decision);
  const nextDecisions: DecisionsFile =
    autoDecisions.length === 0
      ? decisions
      : {
          ...decisions,
          decisions: [
            ...decisions.decisions.filter(
              (d) => !autoDecisions.some((a) => a.conflictId === d.conflictId),
            ),
            ...autoDecisions,
          ],
        };

  // Produce + persist claims + decisions + scan-state through the SAME remerge
  // path the decision mutations use, so the first scan and every later edit are
  // byte-consistent. Carry this scan's doc/block counts forward.
  const scanState = await remergeAndPersistWorkspace(options.workspaceOrgId, nextDecisions, {
    docsScanned: result.extract.docsScanned,
    blocksAttempted: result.extract.blocksAttempted,
    skippedDocs: result.skippedDocs ?? [],
  });

  if (options.source) {
    await trackEvent('spec_scan', {
      source: options.source,
      docsScannedRange: bucketFileCount(result.extract.docsScanned),
      claimsRange: bucketFileCount(result.extract.claims.length),
      openConflicts: result.merge.openConflicts.length,
      durationRange: bucketDuration(Date.now() - startedAt),
    });
  }

  return { consolidate: result, scanState };
}

// ---------------------------------------------------------------------------
// resolveAllDefaultsInProcess
// ---------------------------------------------------------------------------

/**
 * Accept the engine's default pick on every open conflict, in a
 * stable order that respects cascading dependencies between
 * decisions:
 *
 *   1. Scan.
 *   2. If any version chain is unresolved, accept its default first
 *      — chain decisions filter out claims from superseded docs,
 *      which often makes downstream content conflicts evaporate.
 *      Writing decisions for those soon-to-be-gone conflicts would
 *      leave orphan entries in `decisions.json`.
 *   3. Re-scan. Repeat until no unresolved version chain remains.
 *   4. Accept defaults for the remaining content conflicts.
 *   5. Final re-scan to refresh `scan-state.json` so the dashboard
 *      reflects everything immediately.
 *
 * Existing decisions are preserved — only new conflict IDs get a
 * default written.
 */
export async function resolveAllDefaultsInProcess(
  repoRoot: string,
  options: SpecInProcessOptions = {},
): Promise<SpecResolveAllDefaultsResult> {
  const { tracker } = options;
  const MAX_ITERATIONS = 5;
  const consolidateOpts = {
    blockRunner: options.blockRunner,
    chainRunner: options.chainRunner,
    disableLlmChainDetection: options.disableLlmChainDetection,
    skipGit: options.skipGit,
    transport: resolveTransport(options),
    models: resolveConsolidateModels(repoRoot),
  };

  tracker?.start('scan');
  let firstScan: ConsolidateResult;
  try {
    firstScan = await consolidate(repoRoot, consolidateOpts);
  } catch (e) {
    tracker?.error('scan', (e as Error).message);
    throw e;
  }
  tracker?.done(
    'scan',
    `${firstScan.extract.docsScanned} docs · ${firstScan.extract.claims.length} claims`,
  );

  let totalAdditions = 0;
  let chainsResolved = 0;
  let contentResolved = 0;

  // Phase 1: chains first, iterating until none remain.
  tracker?.start('resolve-chains');
  let current: ConsolidateResult = firstScan;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const chainConflicts = current.merge.openConflicts.filter(isChainConflict);
    if (chainConflicts.length === 0) break;
    const added = appendDefaults(repoRoot, chainConflicts);
    if (added === 0) break;
    totalAdditions += added;
    chainsResolved += added;
    tracker?.detail('resolve-chains', `${chainsResolved} accepted`);
    current = await consolidate(repoRoot, consolidateOpts);
  }
  tracker?.done(
    'resolve-chains',
    chainsResolved === 0 ? 'none pending' : `${chainsResolved} accepted`,
  );

  // Phase 2: remaining content conflicts, iterating until stable.
  tracker?.start('resolve-content');
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const contentConflicts = current.merge.openConflicts.filter(
      (c) => !isChainConflict(c),
    );
    if (contentConflicts.length === 0) break;
    const added = appendDefaults(repoRoot, contentConflicts);
    if (added === 0) break;
    totalAdditions += added;
    contentResolved += added;
    tracker?.detail('resolve-content', `${contentResolved} accepted`);
    current = await consolidate(repoRoot, consolidateOpts);
  }
  tracker?.done(
    'resolve-content',
    contentResolved === 0 ? 'none pending' : `${contentResolved} accepted`,
  );

  // Final scan persists state for the dashboard. Block cache is
  // warm by now so this costs nothing.
  tracker?.start('finalize');
  const final = await consolidate(repoRoot, consolidateOpts);
  const postScanState = buildScanState(final);
  writeScanState(repoRoot, postScanState);
  tracker?.done(
    'finalize',
    `${final.merge.openConflicts.length} open · ${final.merge.resolvedClaims.length + final.merge.decidedConflicts.length} resolved`,
  );

  return {
    consolidate: firstScan,
    additions: totalAdditions,
    decisions: readDecisions(repoRoot),
    postScanState,
  };
}

/**
 * Append default-pick decisions for every conflict in `conflicts`
 * that doesn't already have a decision recorded. Returns the number
 * of *new* decisions written (0 when everything was already
 * decided).
 */
function appendDefaults(repoRoot: string, conflicts: ConsolidateResult['merge']['openConflicts']): number {
  const existing = readDecisions(repoRoot);
  const seen = new Set(existing.decisions.map((d) => d.conflictId));
  const additions: Decision[] = [];
  for (const c of conflicts) {
    if (seen.has(c.id)) continue;
    additions.push({
      conflictId: c.id,
      resolution: { kind: 'pick', candidateIndex: c.defaultPick },
      resolvedAt: new Date().toISOString(),
      candidateFingerprint: candidateFingerprint(c),
    });
  }
  if (additions.length === 0) return 0;
  const next: DecisionsFile = {
    version: 1,
    decisions: [...existing.decisions, ...additions],
    manualChains: existing.manualChains ?? [],
    manualIncludes: existing.manualIncludes ?? [],
  };
  writeDecisions(repoRoot, next);
  return additions.length;
}

function isChainConflict(c: ConsolidateResult['merge']['openConflicts'][number]): boolean {
  return c.candidates[0]?.claim.id.startsWith('version-chain:') ?? false;
}

// ---------------------------------------------------------------------------
// generateContractsInProcess — Module 2 IL extraction, decoupled from
// the spec-scan pipeline. Same in-process pattern (shared between CLI
// and dashboard, driven by a tracker).
// ---------------------------------------------------------------------------

/**
 * Run Module 2's `generateContracts()` against the canonical
 * `claims.json` on disk. Returns a `kind: 'skipped'` result when the
 * canonical isn't there yet (caller should run `scanInProcess` first),
 * `'extracted'` on success (even when validation surfaced issues), and
 * `'failed'` when extraction threw.
 */
export async function generateContractsInProcess(
  repoRoot: string,
  options: SpecInProcessOptions = {},
): Promise<GenerateContractsInProcessResult> {
  const { tracker } = options;
  const startedAt = Date.now();

  if (!hasCanonicalSpec(repoRoot)) {
    tracker?.start('il');
    tracker?.done('il', 'skipped — no canonical spec');
    return { il: { kind: 'skipped', reason: 'no canonical spec' } };
  }

  tracker?.start('il');
  let slicesTotal = 0;
  let slicesDone = 0;

  const renderIlDetail = (): string => {
    if (slicesTotal === 0) return '';
    return `${slicesDone}/${slicesTotal} slices`;
  };
  // Emit to BOTH the OSS tracker (rendered detail) and the headless callback
  // (raw counts), so EE shows the identical "N/M slices" the OSS popup does.
  const reportSlices = (): void => {
    tracker?.detail('il', renderIlDetail());
    options.onSliceProgress?.(slicesDone, slicesTotal);
  };

  try {
    const extractModels = resolveExtractModels(repoRoot);
    const transport = resolveTransport(options);
    const il = await generateContracts({
      repoRoot,
      transport,
      runner: spawnExtractorRunner({
        transport,
        concurrency: defaultExtractorConcurrency(),
        model: extractModels.extract,
        fallbackModel: extractModels.fallback,
        onSliceDone: () => {
          slicesDone++;
          reportSlices();
        },
      }),
      models: extractModels,
      onSlicesReady: (total) => {
        slicesTotal = total;
        reportSlices();
      },
      onSliceCacheHit: () => {
        slicesDone++;
        reportSlices();
      },
      onSliceDone: () => {
        slicesDone++;
        reportSlices();
      },
      onRepairProgress: (e) => {
        tracker?.detail('il', `repairing ${e.done}/${e.total}`);
        options.onRepairProgress?.(e.done, e.total);
      },
    });
    const issueCount = il.validationIssues.length;
    const wrote = il.write.written.length;
    const slicesSuffix = slicesDone > 0 ? `${slicesDone} slices · ` : '';
    tracker?.done(
      'il',
      issueCount === 0
        ? wrote === 0
          ? `${slicesSuffix}up to date`
          : `${slicesSuffix}${wrote} files`
        : `${slicesSuffix}${wrote} files · ${issueCount} issue${issueCount === 1 ? '' : 's'}`,
    );
    // Stamp only when validation passed; otherwise "fresh" would lie —
    // the .tc corpus didn't fully land.
    if (issueCount === 0) {
      stampGeneratedMarker(repoRoot);
    }
    if (options.source) {
      await trackEvent('contracts_generate', {
        source: options.source,
        artifactsWrittenRange: bucketFileCount(wrote),
        validationIssues: issueCount,
        durationRange: bucketDuration(Date.now() - startedAt),
      });
    }
    // Ingest the freshly generated `.tc` tree into the active store, but only
    // when the caller passes an explicit `ref` (the EE GitHub App, keyed by
    // `owner/repo` + head SHA). OSS/local omits `ref` → no ingest (the IL
    // already wrote the tree in place; the file store reads it there).
    if (options.ref) {
      await saveContracts(options.ref, 'contracts', path.join(repoRoot, '.truecourse', 'contracts'));
    }
    return { il: { kind: 'extracted', result: il } };
  } catch (e) {
    tracker?.error('il', (e as Error).message);
    const err = e instanceof Error ? e : new Error(String(e));
    return { il: { kind: 'failed', error: err } };
  }
}

// ---------------------------------------------------------------------------
// generateWorkspaceContractsInProcess — the enterprise workspace analog of
// generateContractsInProcess. Generates the workspace `.tc` corpus from the
// persisted canonical claims FULLY IN MEMORY (no repo tree, no scratch dir) and
// stores it under workspace scope. Unchanged claims hit the Postgres slice cache
// → 0 LLM on re-sync.
// ---------------------------------------------------------------------------

export interface WorkspaceContractsResult {
  kind: 'generated' | 'skipped';
  reason?: string;
  fileCount?: number;
  validationIssues?: number;
}

/**
 * Build the generateContractsInMemory slice callbacks that report `(done, total)`
 * to `onSliceProgress` — the same "N/M slices" count the OSS popup shows. Cache
 * hits and runner completions are mutually exclusive at this level, so they sum
 * to the total exactly once.
 */
function sliceProgressHooks(
  onSliceProgress?: (done: number, total: number) => void,
  onRepairProgress?: (done: number, total: number) => void,
) {
  let total = 0;
  let done = 0;
  const report = () => onSliceProgress?.(done, total);
  return {
    onSlicesReady: (t: number) => {
      total = t;
      report();
    },
    onSliceCacheHit: () => {
      done++;
      report();
    },
    onSliceDone: () => {
      done++;
      report();
    },
    // The silent post-extraction repair pass — surfaces "Repairing N/M" after the
    // slice count maxes out, so the contracts step keeps moving instead of freezing.
    onRepairProgress: (e: { done: number; total: number }) => onRepairProgress?.(e.done, e.total),
  };
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

export async function generateWorkspaceContractsInProcess(
  workspaceOrgId: string,
  options: {
    llm?: 'cli' | 'agent';
    io?: string;
    source?: TelemetrySource;
    /** Per-slice progress (`done`, `total`) — the EE job runner forwards it to its popup. */
    onSliceProgress?: (done: number, total: number) => void;
    /** Repair-pass progress (`done`, `total`) — the silent post-extraction LLM pass. */
    onRepairProgress?: (done: number, total: number) => void;
    // --- test seams (production passes none) ---
    runner?: SliceRunner;
    disableRepair?: boolean;
  } = {},
): Promise<WorkspaceContractsResult> {
  const ref: WorkspaceRef = { workspaceOrgId };
  const claims = await loadWorkspaceSpec<ClaimsFile>(ref, 'claims');
  if (!claims || claims.claims.length === 0) {
    return { kind: 'skipped', reason: 'no canonical claims' };
  }

  // Contracts require a fully-resolved spec: while any conflict is open the
  // canonical set is ambiguous, so clear the corpus and wait — the resolution
  // that takes openConflicts → 0 is what triggers the real regen.
  const scanState = await getWorkspaceScanState(workspaceOrgId);
  if (scanState && scanState.openConflicts.length > 0) {
    await saveWorkspaceContracts(ref, 'contracts', {});
    return { kind: 'skipped', reason: 'open conflicts' };
  }

  const startedAt = Date.now();
  const canonical = canonicalFromClaims(claims);
  // Every claim out-of-scope ⇒ no positive contracts. Persist an empty set so a
  // stale prior corpus is cleared rather than left dangling.
  if (canonical.slices.length === 0) {
    await saveWorkspaceContracts(ref, 'contracts', {});
    return { kind: 'generated', fileCount: 0, validationIssues: 0 };
  }

  const extractModels = resolveExtractModels(process.cwd());
  const transport = resolveTransport(options);
  const hooks = sliceProgressHooks(options.onSliceProgress, options.onRepairProgress);
  const result = await generateContractsInMemory({
    canonical,
    cacheScope: workspaceScopeKey(workspaceOrgId),
    transport,
    runner:
      options.runner ??
      spawnExtractorRunner({
        transport,
        concurrency: defaultExtractorConcurrency(),
        model: extractModels.extract,
        fallbackModel: extractModels.fallback,
        // Fresh (uncached) slices tick via the RUNNER's onSliceDone — the
        // generateContractsInMemory option is ignored once a runner is injected.
        onSliceDone: hooks.onSliceDone,
      }),
    models: extractModels,
    disableRepair: options.disableRepair,
    onSlicesReady: hooks.onSlicesReady,
    onSliceCacheHit: hooks.onSliceCacheHit,
    onRepairProgress: hooks.onRepairProgress,
  });

  // A resolver-hard corpus error produced NO contracts — fail loudly rather than
  // overwriting the corpus with an empty set (keep the prior, surface the error).
  const hard = resolverHardError(result);
  if (hard) throw hard;

  await saveWorkspaceContracts(ref, 'contracts', result.files);

  if (options.source) {
    await trackEvent('contracts_generate', {
      source: options.source,
      artifactsWrittenRange: bucketFileCount(Object.keys(result.files).length),
      validationIssues: result.validationIssues.length,
      durationRange: bucketDuration(Date.now() - startedAt),
    });
  }

  return {
    kind: 'generated',
    fileCount: Object.keys(result.files).length,
    validationIssues: result.validationIssues.length,
  };
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
 * pattern as scanInProcess: shared between CLI and dashboard, drives a
 * tracker through three phases (load contracts, extract code-side
 * operations, compare).
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
  /** Override the commit SHA when `ref` is omitted. */
  commitOverride?: string;
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
  const { tracker } = options;
  const startedAt = Date.now();
  const contractsDir =
    options.contractsDir ?? path.join(repoRoot, '.truecourse', 'contracts');
  const codeDir = options.codeDir ?? autodetectCodeDir(repoRoot);

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

  return { infer: result, written, proposed };
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
// Decisions + scan-state, routed through the SpecStore seam.
//
// OSS: the on-disk files via the IL (byte-identical). EE: Postgres `spec_sets`.
// Decisions are the user's accumulated resolutions — a single per-repo "current"
// document, not a per-commit snapshot. The dashboard read/edit routes use these.
// ---------------------------------------------------------------------------

const EMPTY_DECISIONS: DecisionsFile = {
  version: 1,
  decisions: [],
  manualChains: [],
  manualIncludes: [],
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

/** The repo's current scan-state (dashboard read), or null. Fails closed on a
 *  malformed/truncated payload (matching the IL `readScanState`). */
/**
 * Re-derive a repo's scan-state from its PERSISTED raw claims + chains +
 * decisions — no docs, no git, no LLM (the same body-free remerge the workspace
 * uses). Returns null when raw claims were never persisted (OSS file mode, or a
 * scan predating rawClaims persistence) so the caller falls back to the stored
 * scan-state.
 */
async function remergeRepoScanState(repoKey: string, decisions: DecisionsFile): Promise<ScanState | null> {
  const rawClaims = await loadLatestSpec<Claim[]>(repoKey, 'rawClaims');
  if (!rawClaims) return null;
  const chains = (await loadLatestSpec<VersionChain[]>(repoKey, 'chains')) ?? [];
  const baseline = await loadLatestSpec<ScanState>(repoKey, 'scanState');
  const merged = remerge(rawClaims, chains, decisions);
  return scanStateFromMerge(merged.merge, {
    docsScanned: baseline?.docsScanned ?? 0,
    blocksAttempted: baseline?.blocksAttempted ?? 0,
    claimsExtracted: rawClaims.length,
    skippedDocs: baseline?.skippedDocs ?? [],
  });
}

export async function getScanState(repoKey: string): Promise<ScanState | null> {
  // Hosted (Postgres store): re-merge the persisted raw claims + chains with the
  // always-latest decisions, so a dashboard resolution is reflected WITHOUT a
  // re-scan (no local clone, no git). Falls through when raw claims are absent.
  if (!specsMaterializeInPlace()) {
    const remerged = await remergeRepoScanState(repoKey, await loadDecisions(repoKey));
    if (remerged) return remerged;
  }
  const raw = await loadLatestSpec<ScanState>(repoKey, 'scanState');
  if (!raw || typeof raw.scannedAt !== 'string') return null;
  if (!Array.isArray(raw.openConflicts) || !Array.isArray(raw.decidedConflicts)) return null;
  return raw;
}

/**
 * Accept the engine default on every open conflict, hosted (body-free) — the
 * repo analogue of `resolveAllWorkspaceDefaults`. Iterates (resolving a chain can
 * reveal content conflicts) over the re-merged state, writes the defaults into the
 * persisted decisions, and returns the final re-merged scan-state.
 */
export async function resolveAllDefaultsRemerge(repoKey: string): Promise<ScanState | null> {
  let decisions = await loadDecisions(repoKey);
  for (let i = 0; i < 5; i++) {
    const scan = await remergeRepoScanState(repoKey, decisions);
    if (!scan) return null;
    const open = scan.openConflicts as Array<{ id: string; defaultPick: number; candidateFingerprint: string }>;
    if (open.length === 0) break;
    for (const c of open) {
      decisions = applyUpsertDecision(decisions, {
        conflictId: c.id,
        resolution: { kind: 'pick', candidateIndex: c.defaultPick },
        candidateFingerprint: c.candidateFingerprint,
        note: 'Accepted engine default.',
      });
    }
  }
  await storeDecisions(repoKey, decisions);
  return remergeRepoScanState(repoKey, decisions);
}

/** Stage an in-memory `{relPath → content}` map into the contract store (which
 *  ingests a directory) under `ref`, via a transient temp dir. */
async function ingestContractFiles(ref: RepoRef, files: Record<string, string>): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-contracts-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const dest = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content, 'utf-8');
    }
    await saveContracts(ref, 'contracts', tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Regenerate a HOSTED repo's `.tc` contracts from the re-merged claims (raw
 * claims + chains + persisted decisions) and persist them — plus the re-merged
 * canonical `claims` — under the latest commit. The repo analogue of
 * `generateWorkspaceContractsInProcess`: it makes the Contracts tab + gate
 * reflect a dashboard conflict resolution immediately. Runs from STORE state
 * (no working tree); unchanged slices hit the content-addressed EE cache → ~0
 * LLM. Skipped when raw claims were never persisted (OSS / pre-rawClaims scan)
 * or no commit is stored.
 */
/**
 * Re-merge a HOSTED repo's persisted raw claims + chains + decisions and persist
 * the refreshed canonical `claims` + `scanState` under the latest commit — fast
 * (no docs, no git, no LLM). The repo analogue of the workspace's
 * remerge-and-persist: it makes the Spec view (canonical claims + conflicts)
 * reflect a decision IMMEDIATELY, independent of the slower `.tc` contract regen.
 * Returns the ref + claims, or null when raw claims / a stored commit are absent.
 */
export async function refreshRepoCanonicalSpec(
  repoKey: string,
): Promise<{ ref: RepoRef; claims: ClaimsFile; scanState: ScanState } | null> {
  const rawClaims = await loadLatestSpec<Claim[]>(repoKey, 'rawClaims');
  if (!rawClaims) return null;
  const commitSha = await latestSpecCommit(repoKey);
  if (!commitSha) return null;

  const chains = (await loadLatestSpec<VersionChain[]>(repoKey, 'chains')) ?? [];
  const decisions = await loadDecisions(repoKey);
  const baseline = await loadLatestSpec<ScanState>(repoKey, 'scanState');
  const merged = remerge(rawClaims, chains, decisions);
  const claims: ClaimsFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    modules: merged.modules.map((m) => m.manifest),
    claims: merged.claimEntries,
  };
  const scanState = scanStateFromMerge(merged.merge, {
    docsScanned: baseline?.docsScanned ?? 0,
    blocksAttempted: baseline?.blocksAttempted ?? 0,
    claimsExtracted: rawClaims.length,
    skippedDocs: baseline?.skippedDocs ?? [],
  });
  const ref: RepoRef = { repoKey, commitSha };
  await saveSpec(ref, 'claims', claims);
  await saveSpec(ref, 'scanState', scanState);
  return { ref, claims, scanState };
}

export async function regenerateRepoContractsFromDecisions(
  repoKey: string,
  options: {
    runner?: SliceRunner;
    disableRepair?: boolean;
    /** Phase callback for the stepped progress popup (EE jobs). */
    onPhase?: (phase: 'spec' | 'contracts') => void | Promise<void>;
    /** Per-slice progress (`done`, `total`) — the EE job runner forwards it to its popup. */
    onSliceProgress?: (done: number, total: number) => void;
    /** Repair-pass progress (`done`, `total`) — the silent post-extraction LLM pass. */
    onRepairProgress?: (done: number, total: number) => void;
  } = {},
): Promise<{ kind: 'generated' | 'skipped'; fileCount?: number }> {
  await options.onPhase?.('spec');
  const refreshed = await refreshRepoCanonicalSpec(repoKey);
  if (!refreshed) return { kind: 'skipped' };
  const { ref, claims: claimsFile, scanState } = refreshed;

  // Contracts are only generated from a fully-resolved spec: while any conflict
  // is open the canonical set is ambiguous, so we clear the corpus and wait. The
  // last resolution (openConflicts → 0) is what triggers a real regen. The Spec
  // re-merge above still ran, so the Spec tab reflects the decision immediately.
  if (scanState.openConflicts.length > 0) {
    await ingestContractFiles(ref, {}); // no contracts while conflicts remain
    return { kind: 'skipped' };
  }

  const canonical = canonicalFromClaims(claimsFile);
  if (canonical.slices.length === 0) {
    await ingestContractFiles(ref, {}); // clear any stale corpus
    return { kind: 'generated', fileCount: 0 };
  }

  await options.onPhase?.('contracts');

  const extractModels = resolveExtractModels(process.cwd());
  const transport = resolveTransport({});
  const hooks = sliceProgressHooks(options.onSliceProgress, options.onRepairProgress);
  const result = await generateContractsInMemory({
    canonical,
    cacheScope: `repo:${repoKey}`,
    transport,
    runner:
      options.runner ??
      spawnExtractorRunner({
        transport,
        concurrency: defaultExtractorConcurrency(),
        model: extractModels.extract,
        fallbackModel: extractModels.fallback,
        // Fresh (uncached) slices tick via the RUNNER's onSliceDone — the
        // generateContractsInMemory option is ignored once a runner is injected.
        onSliceDone: hooks.onSliceDone,
      }),
    models: extractModels,
    disableRepair: options.disableRepair,
    onSlicesReady: hooks.onSlicesReady,
    onSliceCacheHit: hooks.onSliceCacheHit,
    onRepairProgress: hooks.onRepairProgress,
  });
  // A resolver-hard corpus error produced NO contracts — fail loudly rather than
  // clearing the corpus to empty (keep the prior contracts, surface the error).
  const hard = resolverHardError(result);
  if (hard) throw hard;
  await ingestContractFiles(ref, result.files);
  return { kind: 'generated', fileCount: Object.keys(result.files).length };
}

// ---------------------------------------------------------------------------
// Workspace Knowledge reads (enterprise) — the Knowledge surface + future
// effective-merge consume these. Workspace artifacts are always-latest (no
// commit), so there is one current row per (org, artifact).
// ---------------------------------------------------------------------------

/** The workspace's current decisions, or the empty default. */
async function loadWorkspaceDecisions(workspaceOrgId: string): Promise<DecisionsFile> {
  return (
    (await loadWorkspaceSpec<DecisionsFile>({ workspaceOrgId }, 'decisions')) ?? EMPTY_DECISIONS
  );
}

/** The workspace's current decisions (dashboard read). */
export function getWorkspaceDecisions(workspaceOrgId: string): Promise<DecisionsFile> {
  return loadWorkspaceDecisions(workspaceOrgId);
}

/** The workspace's current consolidated claims set (or null if never scanned). */
export function getWorkspaceClaims<T = unknown>(workspaceOrgId: string): Promise<T | null> {
  return loadWorkspaceSpec<T>({ workspaceOrgId }, 'claims');
}

/** The workspace's current scan-state, or null. Fails closed on a malformed payload. */
export async function getWorkspaceScanState(workspaceOrgId: string): Promise<ScanState | null> {
  const raw = await loadWorkspaceSpec<ScanState>({ workspaceOrgId }, 'scanState');
  if (!raw || typeof raw.scannedAt !== 'string') return null;
  if (!Array.isArray(raw.openConflicts) || !Array.isArray(raw.decidedConflicts)) return null;
  return raw;
}

// ---------------------------------------------------------------------------
// Workspace Knowledge writes (enterprise) — body-free remerge through the seam.
//
// A workspace decision is applied by re-running the deterministic merge over the
// PERSISTED raw claims + chains (the workspace equivalent of the repo dashboard's
// "re-scan from files after a decision" — same merge math, sourced from stored
// derived state because the bodies were never kept). Identical mutation logic to
// the repo helpers below (the pure `apply*` transforms), only the storage scope
// and the refresh differ — exactly the OSS-files / EE-Postgres split.
// ---------------------------------------------------------------------------

/**
 * Re-apply `decisions` to the workspace's persisted raw claims + chains and
 * persist the refreshed `claims` + `decisions` + `scanState`. No source docs,
 * no LLM. `stats` carries this run's doc/block counts (the initial scan passes
 * them; a later decision-only remerge inherits them from the prior scan-state).
 */
async function remergeAndPersistWorkspace(
  workspaceOrgId: string,
  decisions: DecisionsFile,
  stats?: { docsScanned: number; blocksAttempted: number; skippedDocs: Array<{ path: string; reason: string }> },
): Promise<ScanState> {
  const ref: WorkspaceRef = { workspaceOrgId };
  const rawClaims = (await loadWorkspaceSpec<Claim[]>(ref, 'rawClaims')) ?? [];
  const chains = (await loadWorkspaceSpec<VersionChain[]>(ref, 'chains')) ?? [];
  const prior = stats ? null : await getWorkspaceScanState(workspaceOrgId);
  const merged = remerge(rawClaims, chains, decisions);
  const scanState = scanStateFromMerge(merged.merge, {
    docsScanned: stats?.docsScanned ?? prior?.docsScanned ?? 0,
    blocksAttempted: stats?.blocksAttempted ?? prior?.blocksAttempted ?? 0,
    claimsExtracted: rawClaims.length,
    skippedDocs: stats?.skippedDocs ?? prior?.skippedDocs ?? [],
  });
  const claimsFile: ClaimsFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    modules: merged.modules.map((m) => m.manifest),
    claims: merged.claimEntries,
  };
  await saveWorkspaceSpec(ref, 'decisions', decisions);
  await saveWorkspaceSpec(ref, 'claims', claimsFile);
  await saveWorkspaceSpec(ref, 'scanState', scanState);
  return scanState;
}

/** Mutate the workspace decisions, then remerge + persist; returns the fresh scan-state. */
async function mutateWorkspaceDecisions(
  workspaceOrgId: string,
  mutate: (existing: DecisionsFile) => DecisionsFile,
): Promise<ScanState> {
  const existing = await loadWorkspaceDecisions(workspaceOrgId);
  return remergeAndPersistWorkspace(workspaceOrgId, mutate(existing));
}

/** Upsert one workspace conflict decision; returns the refreshed scan-state. */
export function upsertWorkspaceDecision(
  workspaceOrgId: string,
  input: { conflictId: string; resolution: Resolution; candidateFingerprint: string; note?: string },
): Promise<ScanState> {
  return mutateWorkspaceDecisions(workspaceOrgId, (e) => applyUpsertDecision(e, input));
}

/** Revoke one workspace conflict decision; returns the refreshed scan-state. */
export function revokeWorkspaceDecision(workspaceOrgId: string, conflictId: string): Promise<ScanState> {
  return mutateWorkspaceDecisions(workspaceOrgId, (e) => applyRevokeDecision(e, conflictId));
}

/** Mark a workspace version chain (older superseded by newer); returns the refreshed scan-state. */
export function addWorkspaceManualChain(
  workspaceOrgId: string,
  input: { older: string; newer: string; note?: string },
): Promise<ScanState> {
  return mutateWorkspaceDecisions(workspaceOrgId, (e) => applyAddManualChain(e, input));
}

/** Remove a workspace manual chain; returns the refreshed scan-state. */
export function removeWorkspaceManualChain(
  workspaceOrgId: string,
  input: { older: string; newer: string },
): Promise<ScanState> {
  return mutateWorkspaceDecisions(workspaceOrgId, (e) => applyRemoveManualChain(e, input));
}

/** Force-include a workspace doc the relevance filter skipped; returns the refreshed scan-state. */
export function addWorkspaceManualInclude(workspaceOrgId: string, docPath: string): Promise<ScanState> {
  return mutateWorkspaceDecisions(workspaceOrgId, (e) => applyAddManualInclude(e, docPath));
}

/** Remove a workspace force-include override; returns the refreshed scan-state. */
export function removeWorkspaceManualInclude(workspaceOrgId: string, docPath: string): Promise<ScanState> {
  return mutateWorkspaceDecisions(workspaceOrgId, (e) => applyRemoveManualInclude(e, docPath));
}

/** Accept the engine default on every currently-open workspace conflict. */
export async function resolveAllWorkspaceDefaults(workspaceOrgId: string): Promise<ScanState> {
  const scan = await getWorkspaceScanState(workspaceOrgId);
  const open = (scan?.openConflicts ?? []) as Array<{
    id: string;
    defaultPick: number;
    candidateFingerprint: string;
  }>;
  return mutateWorkspaceDecisions(workspaceOrgId, (existing) => {
    let next = existing;
    for (const c of open) {
      next = applyUpsertDecision(next, {
        conflictId: c.id,
        resolution: { kind: 'pick', candidateIndex: c.defaultPick },
        candidateFingerprint: c.candidateFingerprint,
        note: 'Accepted engine default.',
      });
    }
    return next;
  });
}

// ---------------------------------------------------------------------------
// Decisions-file mutations
//
// Pure read-modify-write helpers around decisions. The dashboard server routes
// and the CLI both call these so the two surfaces agree on update semantics.
// None of these refresh the scan-state — callers who need a re-merge (CLI write
// commands) run scanInProcess afterwards.
// ---------------------------------------------------------------------------

// Pure DecisionsFile transforms — the read-modify-write core, shared verbatim by
// the repo (file/Postgres) and workspace (Postgres) helpers so both surfaces
// agree on update semantics. An `apply*` that makes no change returns the SAME
// object reference, letting callers skip a redundant store.

function applyUpsertDecision(
  existing: DecisionsFile,
  input: { conflictId: string; resolution: Resolution; candidateFingerprint: string; note?: string },
): DecisionsFile {
  const filtered = existing.decisions.filter((d) => d.conflictId !== input.conflictId);
  const decision: Decision = {
    conflictId: input.conflictId,
    resolution: input.resolution,
    resolvedAt: new Date().toISOString(),
    candidateFingerprint: input.candidateFingerprint,
    note: input.note,
  };
  return {
    version: 1,
    decisions: [...filtered, decision],
    manualChains: existing.manualChains ?? [],
    manualIncludes: existing.manualIncludes ?? [],
  };
}

function applyRevokeDecision(existing: DecisionsFile, conflictId: string): DecisionsFile {
  const filtered = existing.decisions.filter((d) => d.conflictId !== conflictId);
  if (filtered.length === existing.decisions.length) return existing;
  return {
    version: 1,
    decisions: filtered,
    manualChains: existing.manualChains ?? [],
    manualIncludes: existing.manualIncludes ?? [],
  };
}

function applyAddManualChain(
  existing: DecisionsFile,
  input: { older: string; newer: string; note?: string },
): DecisionsFile {
  if (input.older === input.newer) {
    throw new Error('addManualChain: older and newer must be different docs');
  }
  const dedup = (existing.manualChains ?? []).filter(
    (c) => !(c.older === input.older && c.newer === input.newer),
  );
  const chain: ManualChain = {
    older: input.older,
    newer: input.newer,
    markedAt: new Date().toISOString(),
    note: input.note,
  };
  return {
    version: 1,
    decisions: existing.decisions,
    manualChains: [...dedup, chain],
    manualIncludes: existing.manualIncludes ?? [],
  };
}

function applyRemoveManualChain(
  existing: DecisionsFile,
  input: { older: string; newer: string },
): DecisionsFile {
  return {
    version: 1,
    decisions: existing.decisions,
    manualChains: (existing.manualChains ?? []).filter(
      (c) => !(c.older === input.older && c.newer === input.newer),
    ),
    manualIncludes: existing.manualIncludes ?? [],
  };
}

function applyAddManualInclude(existing: DecisionsFile, docPath: string): DecisionsFile {
  const current = existing.manualIncludes ?? [];
  if (current.includes(docPath)) return existing;
  return {
    version: 1,
    decisions: existing.decisions,
    manualChains: existing.manualChains ?? [],
    manualIncludes: [...current, docPath],
  };
}

function applyRemoveManualInclude(existing: DecisionsFile, docPath: string): DecisionsFile {
  return {
    version: 1,
    decisions: existing.decisions,
    manualChains: existing.manualChains ?? [],
    manualIncludes: (existing.manualIncludes ?? []).filter((p) => p !== docPath),
  };
}

/**
 * Upsert a per-conflict decision. Replaces any previous decision for
 * the same conflictId. `manualChains` and `manualIncludes` are
 * preserved untouched.
 */
export async function upsertDecision(
  repoRoot: string,
  input: {
    conflictId: string;
    resolution: Resolution;
    candidateFingerprint: string;
    note?: string;
  },
): Promise<DecisionsFile> {
  const next = applyUpsertDecision(await loadDecisions(repoRoot), input);
  await storeDecisions(repoRoot, next);
  return next;
}

/**
 * Revoke a per-conflict decision. Idempotent — when the decision is
 * already absent, returns the current state unchanged.
 */
export async function revokeDecision(repoRoot: string, conflictId: string): Promise<DecisionsFile> {
  const existing = await loadDecisions(repoRoot);
  const next = applyRevokeDecision(existing, conflictId);
  if (next !== existing) await storeDecisions(repoRoot, next);
  return next;
}

/**
 * Add or replace a manual version chain. When a chain with the same
 * (older, newer) pair already exists, it's replaced (markedAt + note
 * refreshed). Self-pairs (`older === newer`) are rejected.
 */
export async function addManualChain(
  repoRoot: string,
  input: { older: string; newer: string; note?: string },
): Promise<DecisionsFile> {
  const next = applyAddManualChain(await loadDecisions(repoRoot), input);
  await storeDecisions(repoRoot, next);
  return next;
}

/**
 * Remove a manual chain by (older, newer). Idempotent.
 */
export async function removeManualChain(
  repoRoot: string,
  input: { older: string; newer: string },
): Promise<DecisionsFile> {
  const next = applyRemoveManualChain(await loadDecisions(repoRoot), input);
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
