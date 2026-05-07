/**
 * Contract extractor — top-level orchestrator.
 *
 * `generateContracts({ repoRoot, runner })` walks the configured specs,
 * slices each into heading-keyed chunks, runs cache-miss slices through
 * the supplied runner (Claude Code subprocess by default), merges the
 * extracted fragments by `(kind, identity)`, validates the merged
 * corpus via the verifier's parser+resolver, and writes `.tc` files
 * into `.truecourse/contracts/`.
 *
 * The runner is injected so tests can drive the pipeline without
 * spawning real subprocesses.
 */

import fs from 'node:fs';
import path from 'node:path';
import { sliceMarkdown, fileHash } from './slicer.js';
import {
  cachePaths,
  ensureCacheDirs,
  gcOrphanedSlices,
  readManifest,
  readSliceEntry,
  writeManifest,
  writeSliceEntry,
} from './cache.js';
import { mergeRankedFragments, type MergeDiagnostic, type RankedFragment } from './merger.js';
import { validateMerged, type ValidationIssue } from './validator.js';
import { writeContracts, type WriteResult } from './writer.js';
import { resolveSpecEntry, readSpecsConfig } from './specs-config.js';
import { spawnRunner, type SliceRunner, type SliceRunResult } from './claude-runner.js';
import type { Manifest, SpecSlice, SpecsConfig } from './types.js';

export interface GenerateOptions {
  /** Repo root — `.truecourse/specs.yaml` and `.truecourse/contracts/` live here. */
  repoRoot: string;
  /** Override the runner; defaults to `spawnRunner()`. Tests pass a stub. */
  runner?: SliceRunner;
  /** Override the loaded config. When unset, reads `.truecourse/specs.yaml`. */
  config?: SpecsConfig;
  /** When true, don't write `.tc` files — return what would change. */
  dryRun?: boolean;
  /** Hooks for the CLI to render progress. */
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
  const config = opts.config ?? readSpecsConfig(repoRoot);
  if (!config) {
    throw new ConfigMissingError(
      `No .truecourse/specs.yaml found in ${repoRoot}. Run \`truecourse contracts generate --bootstrap\` first.`,
    );
  }

  ensureCacheDirs(repoRoot);
  readManifest(repoRoot); // touch — kept for future incremental invalidation
  const slicesWithRank = enumerateSlices(repoRoot, config);
  const slices = slicesWithRank.map((sw) => sw.slice);
  const sliceRankById = new Map(slicesWithRank.map((sw) => [sw.slice.id, sw.rank]));
  const runner = opts.runner ?? spawnRunner();

  // ---- Slice cache lookup --------------------------------------------------
  const outcomes: SliceOutcome[] = [];
  const misses: SpecSlice[] = [];
  for (const slice of slices) {
    const cached = readSliceEntry(repoRoot, slice.id);
    if (cached) {
      outcomes.push({ slice, cache: 'hit' });
      opts.onSliceCacheHit?.(slice);
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
  const manifest = buildManifest(repoRoot, config, slices);
  for (const outcome of outcomes) {
    let result;
    if (outcome.cache === 'hit') {
      result = readSliceEntry(repoRoot, outcome.slice.id)?.result;
    } else {
      result = outcome.run?.result;
    }
    if (!result) continue;
    const rank = sliceRankById.get(outcome.slice.id) ?? 0;
    for (const fragment of result.fragments) ranked.push({ fragment, rank });
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

export class ConfigMissingError extends Error {
  readonly kind = 'config-missing';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SliceWithRank {
  slice: SpecSlice;
  rank: number;
}

function enumerateSlices(repoRoot: string, config: SpecsConfig): SliceWithRank[] {
  const out: SliceWithRank[] = [];
  for (const entry of config.specs) {
    const files = resolveSpecEntry(repoRoot, entry);
    for (const file of files) {
      const rel = path.relative(repoRoot, file);
      const source = fs.readFileSync(file, 'utf-8');
      for (const slice of sliceMarkdown(rel, source)) {
        out.push({ slice, rank: entry.rank });
      }
    }
  }
  return out;
}

function buildManifest(repoRoot: string, config: SpecsConfig, slices: SpecSlice[]): Manifest {
  const specs: Manifest['specs'] = {};
  for (const entry of config.specs) {
    const files = resolveSpecEntry(repoRoot, entry);
    for (const file of files) {
      const rel = path.relative(repoRoot, file);
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
export { gatherCandidates, proposeWithHeuristic } from './bootstrap.js';
export type { BootstrapCandidate, BootstrapProposal } from './bootstrap.js';
export { proposeWithLlm } from './llm-bootstrap.js';
export type { LlmBootstrapOptions, LlmBootstrapProposal } from './llm-bootstrap.js';
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
  readSpecsConfig,
  writeSpecsConfig,
  resolveSpecEntry,
  specsConfigPath,
  SPECS_CONFIG_FILE,
} from './specs-config.js';
export type {
  SpecSlice,
  Fragment,
  ExtractionResult,
  Manifest,
  SpecsConfig,
} from './types.js';
export { sliceMarkdown, sliceHash, fileHash } from './slicer.js';
export { mergeFragments, mergeRankedFragments } from './merger.js';
export type { MergedArtifact, MergeDiagnostic, MergeResult, RankedFragment } from './merger.js';
export { validateMerged } from './validator.js';
export type { ValidationIssue, ValidationResult } from './validator.js';
export { writeContracts } from './writer.js';
export type { WriteRequest, WriteResult, WriteOptions } from './writer.js';
