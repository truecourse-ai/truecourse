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
  CanonicalSpecMissingError,
  defaultConcurrency as defaultExtractorConcurrency,
  generateContracts,
  hasCanonicalSpec,
  spawnRunner as spawnExtractorRunner,
  type GenerateResult,
} from '@truecourse/contract-extractor';
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
  { key: 'il', label: 'Extracting IL contracts' },
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
  /** IL extraction outcome — present only when the canonical landed cleanly. */
  il:
    | { kind: 'extracted'; result: GenerateResult }
    | { kind: 'skipped'; reason: string }
    | { kind: 'failed'; error: Error };
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
      conflict: d.conflict,
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
  let blocksSeen = 0;
  let extractStarted = false;

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
        tracker?.detail('extract', `${docsSeen} docs, ${blocksSeen} blocks`);
      },
      onDocDone: (_doc, blockCount) => {
        blocksSeen += blockCount;
        tracker?.detail('extract', `${docsSeen} docs, ${blocksSeen} blocks`);
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
 * Run the full Apply pipeline: `consolidate({ materialize: true })`,
 * persist scan-state, then (when the canonical landed cleanly) chain
 * into Module 2's `generateContracts()` to extract IL.
 *
 * Step transitions in order: discover → extract → merge → materialize → il.
 * The IL step is set to `done` with a `skipped` detail when there are
 * open conflicts or materialize failures.
 */
export async function applyInProcess(
  repoRoot: string,
  options: SpecInProcessOptions = {},
): Promise<SpecApplyInProcessResult> {
  const { tracker } = options;
  let docsSeen = 0;
  let blocksSeen = 0;
  let sectionsDone = 0;
  let extractStarted = false;
  let materializeStarted = false;

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
        tracker?.detail('extract', `${docsSeen} docs, ${blocksSeen} blocks`);
      },
      onDocDone: (_doc, blockCount) => {
        blocksSeen += blockCount;
        tracker?.detail('extract', `${docsSeen} docs, ${blocksSeen} blocks`);
      },
      onSectionDone: () => {
        if (!materializeStarted) {
          if (extractStarted) tracker?.done('extract', `${blocksSeen} blocks`);
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

  // Chain into Module 2 (IL extraction) when the canonical is clean.
  const canChainIntoIl =
    result.merge.openConflicts.length === 0 &&
    (result.materialize?.failures.length ?? 0) === 0 &&
    hasCanonicalSpec(repoRoot);

  if (!canChainIntoIl) {
    const reason =
      result.merge.openConflicts.length > 0
        ? 'open conflicts'
        : (result.materialize?.failures.length ?? 0) > 0
          ? 'materialize failures'
          : 'no canonical spec';
    tracker?.start('il');
    tracker?.done('il', `skipped — ${reason}`);
    return {
      consolidate: result,
      scanState,
      il: { kind: 'skipped', reason },
    };
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
    return { consolidate: result, scanState, il: { kind: 'extracted', result: il } };
  } catch (e) {
    tracker?.error('il', (e as Error).message);
    const err = e instanceof Error ? e : new Error(String(e));
    if (e instanceof CanonicalSpecMissingError) {
      return { consolidate: result, scanState, il: { kind: 'failed', error: err } };
    }
    return { consolidate: result, scanState, il: { kind: 'failed', error: err } };
  }
}
