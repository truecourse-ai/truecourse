/**
 * Contract extractor — public surface (corpus path).
 *
 * `generateContractsFromCorpus({ repoRoot, ... })` reads the curated
 * corpus under `.truecourse/specs/corpus.json`, builds per-area
 * generation inputs (relations applied, precedence order), enumerates
 * each area's targets, generates in small batches with a completeness
 * gate, and runs the result through the shared
 * merge→normalize→repair→validate tail (`assembleArtifacts`), writing
 * `.tc` files into `.truecourse/contracts/`.
 */

/**
 * Per-stage model overrides for the extractor. Resolved per-stage by
 * the CLI / dashboard layer via `@truecourse/core/config/llm-models`
 * and forwarded to the default runner / repair calls.
 */
export interface ExtractModels {
  extract?: string;
  repair?: string;
  /** Cheaper model for early parse-repair attempts (last attempt escalates to `repair`). */
  repairParse?: string;
  /** Forwarded as `--fallback-model` to every stage. */
  fallback?: string;
}

// ---------------------------------------------------------------------------
// Re-exports — keep call sites tidy
// ---------------------------------------------------------------------------

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
export { sliceHash } from './hash.js';
export type {
  SpecSlice,
  Fragment,
  ExtractionResult,
} from './types.js';
export { mergeFragments, mergeRankedFragments } from './merger.js';
export type { MergedArtifact, MergeDiagnostic, MergeResult, RankedFragment } from './merger.js';
export { validateMerged } from './validator.js';
export type { ValidationIssue, ValidationResult } from './validator.js';
export { writeContracts } from './writer.js';
export type { WriteRequest, WriteResult, WriteOptions } from './writer.js';

// --- Shared fragment→artifact tail + corpus generate path ---
export { assembleArtifacts } from './assemble.js';
export type { AssembleOptions, AssembleResult } from './assemble.js';
export {
  readCorpusForGenerate,
  hasCorpusSpec,
} from './corpus-reader.js';
export type { AreaDoc, AreaGenInput, CorpusReadOptions } from './corpus-reader.js';
export {
  ENUMERATE_SYSTEM_PROMPT,
  EnumerateResultSchema,
  TargetSpecSchema,
  buildEnumerateUserPrompt,
  buildCorpusGenerateUserPrompt,
  chunkByHeading,
  coverageKey,
} from './corpus-prompt.js';
export type { TargetSpec, EnumerateResult } from './corpus-prompt.js';
export { canonicalIdentity, slugIdentity } from './identity.js';
export {
  reconcileTargets,
  RECONCILE_SYSTEM_PROMPT,
  buildReconcileUserPrompt,
} from './target-reconciler.js';
export type { ReconcileRunner, ReconcileRunnerInput, AreaTargets, TargetReconcilerOptions } from './target-reconciler.js';
export {
  judgeGaps,
  GAP_JUDGE_SYSTEM_PROMPT,
  buildGapJudgeUserPrompt,
} from './judge-gaps.js';
export type { GapJudgeRunner, GapJudgeInput, GapJudgeResult, GapVerdict, GapJudgeOptions } from './judge-gaps.js';
export {
  generateContractsFromCorpus,
  defaultGenerateBatch,
} from './corpus-generate.js';
export type {
  EnumerateRunner,
  GenerateBatchRunner,
  CorpusGenerateModels,
  CorpusGenerateOptions,
  CorpusGenerateResult,
  CoverageGap,
  AreaCoverage,
} from './corpus-generate.js';
export {
  areaSpecHash,
  buildManifest,
  readManifest,
  writeManifest,
  classifyAreas,
} from './manifest.js';
export type { CorpusManifest, AreaDiff } from './manifest.js';
