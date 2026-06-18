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
  type CanonicalReadResult,
} from './claims-reader.js';
import {
  mergeRankedFragments,
  type MergeDiagnostic,
  type MergedArtifact,
  type RankedFragment,
} from './merger.js';
import { propagateCrossCuttingTags } from './tag-propagator.js';
import { normalizeMergedArtifacts } from './normalizer.js';
import { repair, type RepairProgress } from './repair.js';
import { validateMerged, type ValidationIssue } from './validator.js';
import { composeContractFiles, writeContracts, type WriteResult } from './writer.js';
import type { LlmTransport } from '@truecourse/shared/llm';
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
  /**
   * LLM transport for the auto-created slice runner + the repair pass. Defaults
   * to the cli transport (spawn `claude -p`). The CLI/dashboard pass an agent
   * transport for headless runs. An explicit `runner` override ignores this.
   */
  transport?: LlmTransport;
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
  /** Fired once per repair re-prompt (the silent, LLM-bound post-extraction pass). */
  onRepairProgress?: (e: RepairProgress) => void;
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
  /** Blocking resolver-level corpus error — nothing was written; treat as a failure. */
  resolverHard: boolean;
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
  // The slice cache is keyed by `repoRoot` (the OSS file cache lives under it; the
  // EE KV cache ignores it). `dryRun` skips the LLM repair pass, as before.
  const core = await extractArtifacts({
    canonical,
    cacheScope: repoRoot,
    transport: opts.transport,
    runner: opts.runner,
    models: opts.models,
    disableRepair: dryRun || opts.disableRepair,
    onSlicesReady: opts.onSlicesReady,
    onSliceCacheHit: opts.onSliceCacheHit,
    onSliceStart: opts.onSliceStart,
    onSliceDone: opts.onSliceDone,
    onRepairProgress: opts.onRepairProgress,
  });

  if (!dryRun) {
    writeManifest(repoRoot, core.manifest);
    gcOrphanedSlices(repoRoot, core.manifest);
  }

  if (core.resolverHard) {
    return {
      ran: core.ran,
      write: { written: [], proposed: [] },
      resolverHard: true,
      slices: core.outcomes,
      validationIssues: core.validationIssues,
      mergeDiagnostics: core.mergeDiagnostics,
      manifest: core.manifest,
    };
  }

  const write = writeContracts(repoRoot, core.artifactsToWrite, { dryRun, prune: !dryRun });
  return {
    ran: core.ran,
    write,
    resolverHard: false,
    slices: core.outcomes,
    validationIssues: core.validationIssues,
    mergeDiagnostics: core.mergeDiagnostics,
    manifest: core.manifest,
  };
}

// ---------------------------------------------------------------------------
// In-memory generation (enterprise workspace) — no disk, no scratch tree.
// ---------------------------------------------------------------------------

export interface GenerateInMemoryOptions {
  /**
   * The canonical claims, injected (no disk read). Build it from a persisted
   * `claims.json` document with `canonicalFromClaims(claimsFile)`.
   */
  canonical: CanonicalReadResult;
  /**
   * Scope string for the KV slice cache. Content-addressed in EE (so the scope
   * is ignored and unchanged claims hit the cache across syncs → 0 LLM); any
   * stable string is fine.
   */
  cacheScope: string;
  transport?: LlmTransport;
  runner?: SliceRunner;
  models?: ExtractModels;
  disableRepair?: boolean;
  onSlicesReady?: (total: number) => void;
  onSliceCacheHit?: (slice: SpecSlice) => void;
  onSliceStart?: (slice: SpecSlice) => void;
  onSliceDone?: (slice: SpecSlice, ok: boolean) => void;
  onRepairProgress?: (e: RepairProgress) => void;
}

export interface GenerateInMemoryResult {
  /** `{ posix relPath → .tc content }`. Empty on a resolver-hard corpus error. */
  files: Record<string, string>;
  ran: boolean;
  /** A blocking resolver-level corpus error (e.g. duplicate identities) — `files`
   *  is empty and the corpus did NOT generate. Callers must treat this as a failure,
   *  not "no contracts" (see the hard `resolver` issues in `validationIssues`). */
  resolverHard: boolean;
  validationIssues: ValidationIssue[];
  mergeDiagnostics: MergeDiagnostic[];
}

/**
 * Generate the `.tc` corpus entirely in memory from injected canonical claims —
 * the enterprise workspace path, which has no repo tree and must never touch
 * local disk. Same pipeline as {@link generateContracts}; only the canonical
 * input and the output sink differ (an in-memory map instead of a `.tc` tree).
 */
export async function generateContractsInMemory(
  opts: GenerateInMemoryOptions,
): Promise<GenerateInMemoryResult> {
  const core = await extractArtifacts({
    canonical: opts.canonical,
    cacheScope: opts.cacheScope,
    transport: opts.transport,
    runner: opts.runner,
    models: opts.models,
    disableRepair: opts.disableRepair,
    onSlicesReady: opts.onSlicesReady,
    onSliceCacheHit: opts.onSliceCacheHit,
    onSliceStart: opts.onSliceStart,
    onSliceDone: opts.onSliceDone,
    onRepairProgress: opts.onRepairProgress,
  });
  return {
    files: core.resolverHard ? {} : composeContractFiles(core.artifactsToWrite),
    ran: core.ran,
    resolverHard: core.resolverHard,
    validationIssues: core.validationIssues,
    mergeDiagnostics: core.mergeDiagnostics,
  };
}

// ---------------------------------------------------------------------------
// Shared extraction core — slices → KV cache → run → merge → normalize →
// repair → validate. Touches NO disk (the slice cache rides the `@truecourse/llm`
// KV seam, keyed by `cacheScope`); both `generateContracts` (disk) and
// `generateContractsInMemory` (EE) build on it.
// ---------------------------------------------------------------------------

interface ExtractCoreInput {
  canonical: CanonicalReadResult;
  cacheScope: string;
  transport?: LlmTransport;
  runner?: SliceRunner;
  models?: ExtractModels;
  disableRepair?: boolean;
  onSlicesReady?: (total: number) => void;
  onSliceCacheHit?: (slice: SpecSlice) => void;
  onSliceStart?: (slice: SpecSlice) => void;
  onSliceDone?: (slice: SpecSlice, ok: boolean) => void;
  onRepairProgress?: (e: RepairProgress) => void;
}

interface ExtractCoreResult {
  ran: boolean;
  outcomes: SliceOutcome[];
  /** Artifacts that survived validation (hard-bad ones dropped), ready to emit. */
  artifactsToWrite: MergedArtifact[];
  validationIssues: ValidationIssue[];
  mergeDiagnostics: MergeDiagnostic[];
  /** The slice manifest (disk callers persist it; the in-memory path ignores it). */
  manifest: Manifest;
  /** Duplicate-identity corpus corruption — callers must abort the write/emit. */
  resolverHard: boolean;
}

async function extractArtifacts(input: ExtractCoreInput): Promise<ExtractCoreResult> {
  const { canonical, cacheScope } = input;
  const slices = canonical.slices;
  input.onSlicesReady?.(slices.length);
  const models = input.models ?? {};
  const runner =
    input.runner ??
    spawnRunner({
      transport: input.transport,
      onSliceStart: input.onSliceStart,
      onSliceDone: input.onSliceDone,
      model: models.extract,
      fallbackModel: models.fallback,
    });

  // ---- Slice cache lookup (KV seam) ---------------------------------------
  const outcomes: SliceOutcome[] = [];
  const misses: SpecSlice[] = [];
  let hitsSinceYield = 0;
  for (const slice of slices) {
    const cached = await readSliceEntry(cacheScope, slice.id);
    if (cached) {
      outcomes.push({ slice, cache: 'hit' });
      input.onSliceCacheHit?.(slice);
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
        await writeSliceEntry(cacheScope, outcome.slice, r.result);
      }
    }
  }

  // ---- Collect fragments + build manifest ---------------------------------
  const ranked: RankedFragment[] = [];
  const manifest = buildManifest(cacheScope, canonical.modules, slices);
  for (const outcome of outcomes) {
    let result;
    if (outcome.cache === 'hit') {
      result = (await readSliceEntry(cacheScope, outcome.slice.id))?.result;
    } else {
      result = outcome.run?.result;
    }
    if (!result) continue;
    // No multi-spec layering anymore — canonical spec is the single
    // source of truth, every fragment shares the same rank.
    for (const fragment of result.fragments) ranked.push({ fragment, rank: 0 });
  }

  // ---- Merge + cross-cutting tag propagation + normalize + repair + validate
  const merged = mergeRankedFragments(ranked);
  merged.artifacts = propagateCrossCuttingTags(merged.artifacts, slices);
  // Deterministic post-merge normalization — canonicalize Entity:<x>
  // cross-references against declared entities, lift parseable
  // `raw "<expr>"` query-rule predicates into the structured algebra,
  // and dedup query-rules that bind to the same (entity, predicate set)
  // under different identities. Runs before repair so the repair LLM
  // sees the cleaned shape.
  const normalized = normalizeMergedArtifacts(merged.artifacts);
  merged.artifacts = normalized.artifacts;
  if (
    normalized.stats.entityRefsRewritten +
      normalized.stats.rawPredicatesLifted +
      normalized.stats.identitiesAssigned +
      normalized.stats.artifactsDeduplicated >
    0
  ) {
    merged.diagnostics.push({
      artifactKey: 'normalize',
      severity: 'info',
      message: `normalize: entity-refs=${normalized.stats.entityRefsRewritten}, raw→structured=${normalized.stats.rawPredicatesLifted}, identities=${normalized.stats.identitiesAssigned}, dedup=${normalized.stats.artifactsDeduplicated}`,
    });
  }
  // `repair` runs LLM-targeted re-prompts when an artifact references a
  // missing cross-ref or violates a per-kind structural rule. Tests
  // opt out via `disableRepair: true` because repair spawns `claude`
  // directly and would bypass any injected stub runner.
  if (slices.length > 0 && !input.disableRepair) {
    const repaired = await repair(merged.artifacts, slices, {
      transport: input.transport,
      model: models.repair,
      fallbackModel: models.fallback,
      onProgress: input.onRepairProgress,
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

  // Drop artifacts with HARD validation issues and keep the rest.
  // A single bad artifact (a tcSource the LLM mangled, an identifier
  // starting with a digit, etc.) should NOT block every other contract
  // from being emitted. The dropped artifacts' diagnostics surface to
  // the user so the spec can be fixed.
  const badKeys = new Set(
    validation.issues
      .filter((i) => i.severity === 'hard' && i.artifactKey !== 'resolver')
      .map((i) => i.artifactKey),
  );
  let artifactsToWrite = merged.artifacts;
  if (badKeys.size > 0) {
    artifactsToWrite = merged.artifacts.filter((a) => !badKeys.has(`${a.kind}:${a.identity}`));
  }

  // Resolver-level hard errors (duplicate identities) are still
  // blocking — those indicate genuine corpus corruption.
  const resolverHard = validation.issues.some(
    (i) => i.severity === 'hard' && i.artifactKey === 'resolver',
  );

  return {
    ran: misses.length > 0,
    outcomes,
    artifactsToWrite,
    validationIssues: validation.issues,
    mergeDiagnostics: merged.diagnostics,
    manifest,
    resolverHard,
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
  canonicalFromClaims,
  canonicalSpecPath,
  sliceHash,
  fileHash,
} from './claims-reader.js';
export type {
  CanonicalReadResult,
  CanonicalModuleInfo,
  ClaimsFile,
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
