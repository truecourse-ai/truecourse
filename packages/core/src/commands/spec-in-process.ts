/**
 * Shared in-process entry points for the BL Drift / Spec Consolidation
 * commands. Both the CLI and the dashboard server import these so
 * progress wiring, scan-state persistence, decision-file writes, and
 * IL-extraction chaining live in exactly one place.
 *
 * Same shape as `analyze-in-process.ts` — the caller passes a
 * `StepTracker` and we drive it through the high-level phases:
 *
 *   scan           discover → extract → merge
 *   resolveAllDefaults  scan → write decisions → re-scan
 *   apply          discover → extract → merge → materialize → IL
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
  readDecisions,
  writeDecisions,
  writeScanState,
  type ConsolidateResult,
  type Decision,
  type DecisionsFile,
  type ScanState,
} from '@truecourse/spec-consolidator';
import {
  defaultConcurrency as defaultExtractorConcurrency,
  generateContracts,
  hasCanonicalSpec,
  spawnRunner as spawnExtractorRunner,
  type GenerateResult,
} from '@truecourse/contract-extractor';
import {
  verify,
  type ContractDrift,
  type VerifyResult,
} from '@truecourse/contract-verifier';
import fs from 'node:fs';
import path from 'node:path';
import type { StepTracker } from '../progress.js';

// ---------------------------------------------------------------------------
// Step taxonomies — exported so callers can pre-build the tracker.
// ---------------------------------------------------------------------------

export const SCAN_STEPS = [
  { key: 'discover', label: 'Discovering docs' },
  { key: 'extract', label: 'Extracting claims' },
  { key: 'merge', label: 'Merging + detecting conflicts' },
] as const;

export const RESOLVE_STEPS = [
  { key: 'scan', label: 'Scanning' },
  { key: 'resolve-chains', label: 'Resolving version chains' },
  { key: 'resolve-content', label: 'Resolving content conflicts' },
  { key: 'finalize', label: 'Refreshing scan state' },
] as const;

export const APPLY_STEPS = [
  { key: 'discover', label: 'Discovering docs' },
  { key: 'extract', label: 'Extracting claims' },
  { key: 'merge', label: 'Merging + detecting conflicts' },
  { key: 'materialize', label: 'Rendering canonical spec' },
] as const;

export const GENERATE_STEPS = [
  { key: 'il', label: 'Extracting TC contracts' },
] as const;

export const VERIFY_STEPS = [
  { key: 'load', label: 'Loading contracts' },
  { key: 'extract-code', label: 'Scanning code for operations' },
  { key: 'compare', label: 'Comparing code against contracts' },
] as const;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface SpecScanInProcessResult {
  consolidate: ConsolidateResult;
  /** What was written to scan-state.json. */
  scanState: ScanState;
}

export interface SpecApplyInProcessResult {
  consolidate: ConsolidateResult;
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
  /** Override block extraction runner; tests inject a stub. */
  blockRunner?: Parameters<typeof consolidate>[1]['blockRunner'];
  /** Override section-rendering runner; tests inject a stub. */
  sectionRunner?: Parameters<typeof consolidate>[1]['sectionRunner'];
  /** Override LLM chain-detection runner; tests inject a stub. */
  chainRunner?: Parameters<typeof consolidate>[1]['chainRunner'];
  /** When true, skip the LLM chain-detection step entirely. */
  disableLlmChainDetection?: boolean;
  /** When true, skip git mtime resolution. */
  skipGit?: boolean;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Marker files stamped after a successful Apply / Generate run. The
 * dashboard's `/spec/staleness` endpoint reads their mtimes (against
 * `decisions.json` and the canonical spec) to tell the user whether
 * Apply or Generate has unfinished work. Both CLI and dashboard run
 * through the in-process functions below, so a CLI run keeps the
 * dashboard's staleness indicators honest.
 */
const APPLIED_MARKER_REL = path.join('.truecourse', '.cache', '.last-applied.json');
const GENERATED_MARKER_REL = path.join('.truecourse', '.cache', '.last-generated.json');

export function appliedMarkerPath(repoRoot: string): string {
  return path.join(repoRoot, APPLIED_MARKER_REL);
}

export function generatedMarkerPath(repoRoot: string): string {
  return path.join(repoRoot, GENERATED_MARKER_REL);
}

function writeStampMarker(file: string, payload: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n');
}

/**
 * Stamp the apply marker. Exposed for callers that run their own
 * apply path (e.g. the CLI's `truecourse spec apply` does today, but
 * external integrations may bypass `applyInProcess` in the future).
 */
export function stampAppliedMarker(repoRoot: string): void {
  writeStampMarker(appliedMarkerPath(repoRoot), {
    appliedAt: new Date().toISOString(),
  });
}

/**
 * Stamp the generate marker. Exposed so `truecourse contracts generate`
 * — which drives the extractor directly rather than via
 * `generateContractsInProcess` — can keep the dashboard's
 * `contractsStale` signal honest.
 */
export function stampGeneratedMarker(repoRoot: string): void {
  writeStampMarker(generatedMarkerPath(repoRoot), {
    generatedAt: new Date().toISOString(),
  });
}

function buildScanState(result: ConsolidateResult): ScanState {
  const openWithFp = result.merge.openConflicts.map((c) => ({
    ...c,
    candidateFingerprint: candidateFingerprint(c),
  }));
  return {
    scannedAt: new Date().toISOString(),
    docsScanned: result.extract.docsScanned,
    blocksAttempted: result.extract.blocksAttempted,
    claimsExtracted: result.extract.claims.length,
    resolved: result.merge.resolvedClaims.length,
    decided: result.merge.decidedConflicts.length,
    openConflicts: openWithFp,
    decidedConflicts: result.merge.decidedConflicts.map((d) => ({
      // Stamp the same fingerprint we surface on open conflicts so the
      // Decisions tab can POST a change-of-mind via the existing
      // upsert endpoint (the server validates that the field is
      // present, and uses it as the candidate-set identity).
      conflict: { ...d.conflict, candidateFingerprint: candidateFingerprint(d.conflict) },
      decision: d.decision,
    })),
  };
}

// ---------------------------------------------------------------------------
// scanInProcess
// ---------------------------------------------------------------------------

/**
 * Run `consolidate({ materialize: false })`, persist the result to
 * `.truecourse/.cache/consolidator/scan-state.json`, and drive the
 * provided tracker through the SCAN_STEPS lifecycle.
 *
 * Idempotent: re-runs against unchanged docs hit the block cache and
 * cost nothing.
 */
export async function scanInProcess(
  repoRoot: string,
  options: SpecInProcessOptions = {},
): Promise<SpecScanInProcessResult> {
  const { tracker } = options;
  let docsSeen = 0;
  let blocksTotal = 0;
  let blocksDone = 0;
  let extractStarted = false;

  const renderExtractDetail = (): string => {
    if (blocksTotal === 0) {
      return `${docsSeen} docs`;
    }
    return `${docsSeen} docs · ${blocksDone}/${blocksTotal} blocks`;
  };

  tracker?.start('discover');
  let result: ConsolidateResult;
  try {
    result = await consolidate(repoRoot, {
      materialize: false,
      blockRunner: options.blockRunner,
      chainRunner: options.chainRunner,
      disableLlmChainDetection: options.disableLlmChainDetection,
      skipGit: options.skipGit,
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
    });
  } catch (e) {
    tracker?.error(extractStarted ? 'extract' : 'discover', (e as Error).message);
    throw e;
  }

  if (!extractStarted) {
    tracker?.done('discover', `${result.extract.docsScanned} docs`);
    tracker?.start('extract');
  } else {
    tracker?.detail('discover', `${result.extract.docsScanned} docs`);
  }
  tracker?.done('extract', `${result.extract.claims.length} claims`);
  tracker?.start('merge');
  tracker?.done(
    'merge',
    `${result.merge.openConflicts.length} open · ${result.merge.resolvedClaims.length + result.merge.decidedConflicts.length} resolved`,
  );

  const scanState = buildScanState(result);
  writeScanState(repoRoot, scanState);
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
    materialize: false as const,
    blockRunner: options.blockRunner,
    chainRunner: options.chainRunner,
    disableLlmChainDetection: options.disableLlmChainDetection,
    skipGit: options.skipGit,
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
  };
  writeDecisions(repoRoot, next);
  return additions.length;
}

function isChainConflict(c: ConsolidateResult['merge']['openConflicts'][number]): boolean {
  return c.candidates[0]?.claim.id.startsWith('version-chain:') ?? false;
}

// ---------------------------------------------------------------------------
// applyInProcess
// ---------------------------------------------------------------------------

/**
 * Materialize the canonical spec: `consolidate({ materialize: true })`,
 * then persist scan-state. Step transitions: discover → extract →
 * merge → materialize. IL extraction (Module 2) is now a separate
 * `generateContractsInProcess` call so the two phases can be driven
 * independently from CLI + dashboard.
 */
export async function applyInProcess(
  repoRoot: string,
  options: SpecInProcessOptions = {},
): Promise<SpecApplyInProcessResult> {
  const { tracker } = options;
  let docsSeen = 0;
  let blocksTotal = 0;
  let blocksDone = 0;
  let sectionsDone = 0;
  let extractStarted = false;
  let materializeStarted = false;

  const renderExtractDetail = (): string => {
    if (blocksTotal === 0) {
      return `${docsSeen} docs`;
    }
    return `${docsSeen} docs · ${blocksDone}/${blocksTotal} blocks`;
  };

  tracker?.start('discover');
  let result: ConsolidateResult;
  try {
    result = await consolidate(repoRoot, {
      materialize: true,
      blockRunner: options.blockRunner,
      sectionRunner: options.sectionRunner,
      chainRunner: options.chainRunner,
      disableLlmChainDetection: options.disableLlmChainDetection,
      skipGit: options.skipGit,
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
      onSectionDone: () => {
        if (!materializeStarted) {
          if (extractStarted) tracker?.done('extract', `${blocksDone} blocks`);
          tracker?.done('merge');
          tracker?.start('materialize');
          materializeStarted = true;
        }
        sectionsDone++;
        tracker?.detail('materialize', `${sectionsDone} sections rendered`);
      },
    });
  } catch (e) {
    const activeKey = materializeStarted
      ? 'materialize'
      : extractStarted
        ? 'extract'
        : 'discover';
    tracker?.error(activeKey, (e as Error).message);
    throw e;
  }

  // Tidy up step-state for edge cases the callbacks didn't fire on.
  if (!extractStarted) {
    tracker?.done('discover', `${result.extract.docsScanned} docs`);
    tracker?.start('extract');
  } else {
    tracker?.detail('discover', `${result.extract.docsScanned} docs`);
  }
  if (!materializeStarted) {
    tracker?.done('extract', `${result.extract.claims.length} claims`);
    tracker?.start('merge');
    tracker?.done(
      'merge',
      `${result.merge.openConflicts.length} open · ${result.merge.resolvedClaims.length + result.merge.decidedConflicts.length} resolved`,
    );
    tracker?.start('materialize');
  } else {
    tracker?.detail('extract', `${result.extract.claims.length} claims`);
    tracker?.detail(
      'merge',
      `${result.merge.openConflicts.length} open · ${result.merge.resolvedClaims.length + result.merge.decidedConflicts.length} resolved`,
    );
  }
  tracker?.done(
    'materialize',
    result.materialize
      ? `${result.materialize.written.length} files written`
      : 'skipped',
  );

  const scanState = buildScanState(result);
  writeScanState(repoRoot, scanState);

  // Stamp the apply marker so the dashboard's staleness endpoint can
  // tell when decisions.json drifts past the last materialize. Only
  // stamp on a clean run (no open conflicts and no materialize
  // failures) — a partial Apply shouldn't claim "fresh."
  const clean =
    result.merge.openConflicts.length === 0 &&
    (result.materialize?.failures.length ?? 0) === 0;
  if (clean) {
    stampAppliedMarker(repoRoot);
  }

  return { consolidate: result, scanState };
}

// ---------------------------------------------------------------------------
// generateContractsInProcess — Module 2 IL extraction, decoupled from
// the spec-apply pipeline. Same in-process pattern (shared between CLI
// and dashboard, driven by a tracker).
// ---------------------------------------------------------------------------

/**
 * Run Module 2's `generateContracts()` against the canonical spec on
 * disk. Returns a `kind: 'skipped'` result when the canonical isn't
 * there yet (caller should run `applyInProcess` first), `'extracted'`
 * on success (even when validation surfaced issues), and `'failed'`
 * when extraction threw.
 */
export async function generateContractsInProcess(
  repoRoot: string,
  options: SpecInProcessOptions = {},
): Promise<GenerateContractsInProcessResult> {
  const { tracker } = options;

  if (!hasCanonicalSpec(repoRoot)) {
    tracker?.start('il');
    tracker?.done('il', 'skipped — no canonical spec');
    return { il: { kind: 'skipped', reason: 'no canonical spec' } };
  }

  tracker?.start('il');
  try {
    const il = await generateContracts({
      repoRoot,
      runner: spawnExtractorRunner({ concurrency: defaultExtractorConcurrency() }),
    });
    const issueCount = il.validationIssues.length;
    const wrote = il.write.written.length;
    tracker?.done(
      'il',
      issueCount === 0
        ? wrote === 0
          ? 'up to date'
          : `${wrote} files`
        : `${wrote} files · ${issueCount} issue${issueCount === 1 ? '' : 's'}`,
    );
    // Stamp the generate marker only when validation passed — issues
    // mean the .tc corpus didn't fully land, so "fresh" would lie.
    if (issueCount === 0) {
      stampGeneratedMarker(repoRoot);
    }
    return { il: { kind: 'extracted', result: il } };
  } catch (e) {
    tracker?.error('il', (e as Error).message);
    const err = e instanceof Error ? e : new Error(String(e));
    return { il: { kind: 'failed', error: err } };
  }
}

// ---------------------------------------------------------------------------
// verify — compare code against generated IL contracts
// ---------------------------------------------------------------------------

const VERIFY_STATE_REL = path.join('.truecourse', '.cache', 'verifier', 'verify-state.json');

export function verifyStatePath(repoRoot: string): string {
  return path.join(repoRoot, VERIFY_STATE_REL);
}

export function readVerifyState(repoRoot: string): VerifyState | null {
  const file = verifyStatePath(repoRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as VerifyState;
    if (typeof raw.verifiedAt !== 'string') return null;
    if (!Array.isArray(raw.drifts)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeVerifyState(repoRoot: string, state: VerifyState): void {
  const file = verifyStatePath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
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
}

/**
 * Compare the canonical IL contracts against the code in `codeDir`
 * and persist the result to `.truecourse/.cache/verifier/`. Same
 * pattern as scanInProcess/applyInProcess: shared between CLI and
 * dashboard, drives a tracker through three phases (load contracts,
 * extract code-side operations, compare).
 */
export async function verifyInProcess(
  repoRoot: string,
  options: VerifyInProcessOptions = {},
): Promise<VerifyInProcessResult> {
  const { tracker } = options;
  const contractsDir =
    options.contractsDir ?? path.join(repoRoot, '.truecourse', 'contracts');
  const codeDir = options.codeDir ?? autodetectCodeDir(repoRoot);

  if (!fs.existsSync(contractsDir)) {
    const err = new Error(
      `Contracts directory not found at ${contractsDir}. Run \`truecourse spec apply\` first.`,
    );
    tracker?.error('load', err.message);
    throw err;
  }

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
    result = await verify({ contractsDir, codeDir });
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

  const state: VerifyState = {
    verifiedAt: new Date().toISOString(),
    contractsDir,
    codeDir,
    artifactCount: result.artifactCount,
    extractedOperationCount: result.extractedOperationCount,
    drifts: result.drifts,
    resolverErrors: result.resolverErrors,
    unresolvedRefs: result.unresolvedRefs,
  };
  writeVerifyState(repoRoot, state);

  return { verify: result, state };
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
