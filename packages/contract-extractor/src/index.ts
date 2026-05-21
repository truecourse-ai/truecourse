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

import { fileHash } from './slicer.js';
import {
  ensureCacheDirs,
  gcOrphanedSlices,
  readManifest,
  readSliceEntry,
  writeManifest,
  writeSliceEntry,
} from './cache.js';
import {
  hasCanonicalSpec,
  readCanonicalSpec,
  type CanonicalModuleInfo,
} from './canonical-spec-reader.js';
import { mergeRankedFragments, type MergeDiagnostic, type RankedFragment } from './merger.js';
import { validateMerged, type ValidationIssue } from './validator.js';
import { writeContracts, type WriteResult } from './writer.js';
import { spawnRunner, type SliceRunner, type SliceRunResult } from './claude-runner.js';
import type { Manifest, SpecSlice } from './types.js';
import fs from 'node:fs';

export interface GenerateOptions {
  /** Repo root — `.truecourse/specs/` and `.truecourse/contracts/` live here. */
  repoRoot: string;
  /** Override the runner; defaults to `spawnRunner()`. Tests pass a stub. */
  runner?: SliceRunner;
  /** When true, don't write `.tc` files — return what would change. */
  dryRun?: boolean;
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
      `No .truecourse/specs/ found in ${repoRoot}. Run \`truecourse spec apply\` first.`,
    );
  }

  ensureCacheDirs(repoRoot);
  readManifest(repoRoot); // touch — kept for future incremental invalidation
  const canonical = readCanonicalSpec(repoRoot);
  const slices = canonical.slices;
  opts.onSlicesReady?.(slices.length);
  const runner = opts.runner ?? spawnRunner({
    onSliceStart: opts.onSliceStart,
    onSliceDone: opts.onSliceDone,
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

  // ---- Merge + validate ----------------------------------------------------
  const merged = mergeRankedFragments(ranked);
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
  repoRoot: string,
  modules: CanonicalModuleInfo[],
  slices: SpecSlice[],
): Manifest {
  const specs: Manifest['specs'] = {};
  // Every section file from every module contributes one entry,
  // keyed by its repo-relative path. Re-running over the same
  // canonical spec produces an identical manifest.
  const seenFiles = new Set<string>();
  for (const m of modules) {
    for (const file of m.sectionFiles) {
      const rel = file.startsWith(repoRoot)
        ? file.slice(repoRoot.length).replace(/^[/\\]+/, '').split(/[/\\]/).join('/')
        : file;
      if (seenFiles.has(rel)) continue;
      seenFiles.add(rel);
      const fileHashStr = fileHash(fs.readFileSync(file, 'utf-8'));
      const sliceList = slices
        .filter((s) => s.specPath === rel)
        .map((s) => ({ headingPath: s.headingPath, sliceId: s.id }));
      specs[rel] = { fileHash: fileHashStr, slices: sliceList };
    }
  }
  return { version: 1, specs };
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
} from './canonical-spec-reader.js';
export type {
  CanonicalReadResult,
  CanonicalModuleInfo,
  ManifestData,
} from './canonical-spec-reader.js';
export type {
  SpecSlice,
  Fragment,
  ExtractionResult,
  Manifest,
} from './types.js';
export { sliceMarkdown, sliceHash, fileHash } from './slicer.js';
export { mergeFragments, mergeRankedFragments } from './merger.js';
export type { MergedArtifact, MergeDiagnostic, MergeResult, RankedFragment } from './merger.js';
export { validateMerged } from './validator.js';
export type { ValidationIssue, ValidationResult } from './validator.js';
export { writeContracts } from './writer.js';
export type { WriteRequest, WriteResult, WriteOptions } from './writer.js';
