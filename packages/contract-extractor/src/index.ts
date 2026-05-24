/**
 * Contract extractor — top-level orchestrator.
 *
 * `generateContracts({ repoRoot, runner })` walks the canonical
 * spec under `.truecourse/specs/` (Module 1's output), slices each
 * section file into heading-keyed chunks, runs cache-miss slices
 * through the supplied runner (Claude Code subprocess by default),
 * merges the extracted fragments by `(kind, identity)`, validates
 * the merged corpus via the verifier's parser+resolver, and writes
 * `.tc` files into `.truecourse/contracts/`.
 *
 * The legacy `specs.yaml` + raw-doc input path is gone: the
 * consolidator (Module 1) produces a structured, user-confirmed
 * canonical spec; Module 2 reads only that.
 *
 * The runner is injected so tests can drive the pipeline without
 * spawning real subprocesses.
 */

import {
  ensureCacheDirs,
  gcOrphanedSlices,
  readManifest,
  readSliceEntry,
  writeManifest,
  writeSliceEntry,
} from './cache.js';
import {
  canonicalSpecPath,
  hasCanonicalSpec,
  readCanonicalSpec,
  type CanonicalModuleInfo,
} from './claims-reader.js';
import { mergeRankedFragments, type MergeDiagnostic, type RankedFragment } from './merger.js';
import { propagateCrossCuttingTags } from './tag-propagator.js';
import { repair } from './repair.js';
import { validateMerged, type ValidationIssue } from './validator.js';
import { writeContracts, type WriteResult } from './writer.js';
import { spawnRunner, type SliceRunner, type SliceRunResult } from './claude-runner.js';
import type { Manifest, SpecSlice } from './types.js';
import crypto from 'node:crypto';

/**
 * Per-stage model overrides for the extractor. Resolved per-stage by
 * the CLI / dashboard layer via `@truecourse/core/config/llm-models`
 * and forwarded here so the default `spawnRunner()` / `repair()` calls
 * pick them up.
 */
export interface ExtractModels {
  extract?: string;
  repair?: string;
  /** Forwarded as `--fallback-model` to every stage. */
  fallback?: string;
}

export interface GenerateOptions {
  /** Repo root — `.truecourse/specs/` and `.truecourse/contracts/` live here. */
  repoRoot: string;
  /** Override the runner; defaults to `spawnRunner()`. Tests pass a stub. */
  runner?: SliceRunner;
  /** Per-stage model overrides (extract / repair / fallback). */
  models?: ExtractModels;
  /** When true, don't write `.tc` files — return what would change. */
  dryRun?: boolean;
  /**
   * Skip the post-extraction repair pass. Tests set this to true when
   * injecting a stub runner — repair spawns `claude` subprocesses
   * directly and would bypass the stub. Production callers (the CLI,
   * the dashboard) leave it false so repair runs.
   */
  disableRepair?: boolean;
  /** Hooks for the CLI to render progress. */
  onSlicesReady?: (total: number) => void;
  onSliceCacheHit?: (slice: SpecSlice) => void;
  onSliceStart?: (slice: SpecSlice) => void;
  onSliceDone?: (slice: SpecSlice, ok: boolean) => void;
}

export interface SliceOutcome {
  slice: SpecSlice;
  /** "hit" | "miss" → either pulled from cache or freshly extracted. */
  cache: 'hit' | 'miss';
  /** Populated on cache miss; absent on hit. */
  run?: SliceRunResult;
}

export interface GenerateResult {
  ran: boolean;
  /** Files written (or that would be written when dryRun). */
  write: WriteResult;
  /** Per-slice outcome, in the order slices were enumerated. */
  slices: SliceOutcome[];
  /** Validation issues. Empty when the gate passes. */
  validationIssues: ValidationIssue[];
  /** Merge diagnostics (e.g. duplicate fragments). */
  mergeDiagnostics: MergeDiagnostic[];
  /** Manifest written this run. Useful for tests. */
  manifest: Manifest;
}

export async function generateContracts(opts: GenerateOptions): Promise<GenerateResult> {
  const { repoRoot, dryRun = false } = opts;
  if (!hasCanonicalSpec(repoRoot)) {
    throw new CanonicalSpecMissingError(
      `No .truecourse/specs/claims.json found in ${repoRoot}. Run \`truecourse spec scan\` first.`,
    );
  }

  ensureCacheDirs(repoRoot);
  readManifest(repoRoot); // touch — kept for future incremental invalidation
  const canonical = readCanonicalSpec(repoRoot);
  const slices = canonical.slices;
  opts.onSlicesReady?.(slices.length);
  const models = opts.models ?? {};
  const runner = opts.runner ?? spawnRunner({
    onSliceStart: opts.onSliceStart,
    onSliceDone: opts.onSliceDone,
    model: models.extract,
    fallbackModel: models.fallback,
  });

  // ---- Slice cache lookup --------------------------------------------------
  const outcomes: SliceOutcome[] = [];
  const misses: SpecSlice[] = [];
  let hitsSinceYield = 0;
  for (const slice of slices) {
    const cached = readSliceEntry(repoRoot, slice.id);
    if (cached) {
      outcomes.push({ slice, cache: 'hit' });
      opts.onSliceCacheHit?.(slice);
      // Yield every 10 hits so the event loop can flush socket frames and
      // the progress counter visibly increments in the dashboard.
      if (++hitsSinceYield % 10 === 0) {
        await Promise.resolve();
      }
    } else {
      outcomes.push({ slice, cache: 'miss' });
      misses.push(slice);
    }
  }

  // ---- Run cache-misses through the runner --------------------------------
  if (misses.length > 0) {
    const results = await runner(misses);
    const byId = new Map(results.map((r) => [r.slice.id, r]));
    for (const outcome of outcomes) {
      if (outcome.cache !== 'miss') continue;
      const r = byId.get(outcome.slice.id);
      if (!r) continue;
      outcome.run = r;
      if (r.result) {
        writeSliceEntry(repoRoot, outcome.slice, r.result);
      }
    }
  }

  // ---- Collect fragments + write manifest ---------------------------------
  const ranked: RankedFragment[] = [];
  const manifest = buildManifest(repoRoot, canonical.modules, slices);
  for (const outcome of outcomes) {
    let result;
    if (outcome.cache === 'hit') {
      result = readSliceEntry(repoRoot, outcome.slice.id)?.result;
    } else {
      result = outcome.run?.result;
    }
    if (!result) continue;
    // No multi-spec layering anymore — canonical spec is the single
    // source of truth, every fragment shares the same rank.
    for (const fragment of result.fragments) ranked.push({ fragment, rank: 0 });
  }

  if (!dryRun) {
    writeManifest(repoRoot, manifest);
    gcOrphanedSlices(repoRoot, manifest);
  }

  // ---- Merge + cross-cutting tag propagation + repair + validate ---------
  const merged = mergeRankedFragments(ranked);
  merged.artifacts = propagateCrossCuttingTags(merged.artifacts, slices);
  // `repair` runs LLM-targeted re-prompts when an artifact references a
  // missing cross-ref or violates a per-kind structural rule. Tests
  // opt out via `disableRepair: true` because repair spawns `claude`
  // directly and would bypass any injected stub runner.
  if (slices.length > 0 && !dryRun && !opts.disableRepair) {
    const repaired = await repair(merged.artifacts, slices, {
      model: models.repair,
      fallbackModel: models.fallback,
    });
    merged.artifacts = repaired.artifacts;
    merged.diagnostics.push(
      ...repaired.log.map((message) => ({
        artifactKey: 'repair',
        severity: 'info' as const,
        message,
      })),
    );
  }
  const validation = validateMerged(merged.artifacts);

  // Don't write when validation fails — the caller surfaces issues to the
  // user. Caching of slice results is preserved so re-running after the
  // user fixes the spec doesn't burn tokens on the unchanged slices.
  if (!validation.ok) {
    return {
      ran: misses.length > 0,
      write: { written: [], proposed: [] },
      slices: outcomes,
      validationIssues: validation.issues,
      mergeDiagnostics: merged.diagnostics,
      manifest,
    };
  }

  // ---- Write -------------------------------------------------------------
  const write = writeContracts(repoRoot, merged.artifacts, { dryRun, prune: !dryRun });

  return {
    ran: misses.length > 0,
    write,
    slices: outcomes,
    validationIssues: [],
    mergeDiagnostics: merged.diagnostics,
    manifest,
  };
}

// ---------------------------------------------------------------------------
// Errors callers want to discriminate
// ---------------------------------------------------------------------------

export class CanonicalSpecMissingError extends Error {
  readonly kind = 'canonical-spec-missing';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildManifest(
  _repoRoot: string,
  _modules: CanonicalModuleInfo[],
  slices: SpecSlice[],
): Manifest {
  const specs: Manifest['specs'] = {};
  // Group slices by `specPath` — each `(module, topic)` group has a
  // single synthetic specPath (`claims.json#<module>/<topic>`). The
  // per-spec `fileHash` is the sha256 of all slice ids in that group,
  // so any structural change to the group's contents (a renamed
  // subject, an added claim, a content edit) invalidates the entry.
  const groups = new Map<string, SpecSlice[]>();
  for (const slice of slices) {
    const list = groups.get(slice.specPath) ?? [];
    list.push(slice);
    groups.set(slice.specPath, list);
  }
  for (const [specPath, group] of groups) {
    const sliceList = group.map((s) => ({ headingPath: s.headingPath, sliceId: s.id }));
    const fingerprint = group
      .map((s) => s.id)
      .sort()
      .join('');
    specs[specPath] = { fileHash: hashString(fingerprint), slices: sliceList };
  }
  return { version: 1, specs };
}

function hashString(s: string): string {
  // Local hash so this module doesn't reach back into claims-reader's
  // internal helpers. Equivalent to `fileHash` in the old slicer.
  return crypto.createHash('sha256').update(s).digest('hex');
}

// ---------------------------------------------------------------------------
// Re-exports — keep call sites tidy
// ---------------------------------------------------------------------------

export { spawnRunner, defaultConcurrency } from './claude-runner.js';
export type { SliceRunner, SliceRunResult } from './claude-runner.js';
export {
  diffContractDirs,
  diffCorpora,
  loadCorpus,
  formatCorpusDiff,
} from './corpus-diff.js';
export type {
  ArtifactDiff,
  ObligationDiff,
  CorpusDiff,
} from './corpus-diff.js';
export {
  hasCanonicalSpec,
  readCanonicalSpec,
  canonicalSpecPath,
  sliceHash,
  fileHash,
} from './claims-reader.js';
export type {
  CanonicalReadResult,
  CanonicalModuleInfo,
} from './claims-reader.js';
export type {
  SpecSlice,
  Fragment,
  ExtractionResult,
  Manifest,
} from './types.js';
export { mergeFragments, mergeRankedFragments } from './merger.js';
export type { MergedArtifact, MergeDiagnostic, MergeResult, RankedFragment } from './merger.js';
export { validateMerged } from './validator.js';
export type { ValidationIssue, ValidationResult } from './validator.js';
export { writeContracts } from './writer.js';
export type { WriteRequest, WriteResult, WriteOptions } from './writer.js';
