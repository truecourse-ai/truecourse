/**
 * Public surface of the spec-consolidator package.
 *
 * The engine's stages live in dedicated modules (see PLAN.md
 * Phase B); this index re-exports the type contracts every stage talks
 * through. Stages are added in subsequent sub-phases.
 */

export type {
  Topic,
  Status,
  DocKind,
  Provenance,
  Claim,
  ClaimMetadata,
  Conflict,
  ConflictCandidate,
  Resolution,
  Decision,
  DecisionsFile,
  ManualChain,
  Scope,
  ModuleManifest,
} from './types.js';

export {
  TopicSchema,
  StatusSchema,
  DocKindSchema,
  ProvenanceSchema,
  ClaimSchema,
  ClaimMetadataSchema,
  ConflictSchema,
  ConflictCandidateSchema,
  ResolutionSchema,
  DecisionSchema,
  DecisionsFileSchema,
  ScopeSchema,
  ModuleManifestSchema,
} from './types.js';

export { discoverDocs, classifyDoc } from './discovery.js';
export type { DocCandidate, DiscoveryOptions } from './discovery.js';

export { sliceDoc } from './slicer.js';
export type { Block } from './slicer.js';

export { spawnRunner, defaultConcurrency } from './runner.js';
export type { BlockRunner, BlockRunResult, SpawnRunnerOptions } from './runner.js';

export {
  SYSTEM_PROMPT,
  buildUserPrompt,
  LlmExtractionSchema,
  LlmClaimSchema,
} from './prompt.js';
export type { LlmExtraction, LlmClaim } from './prompt.js';

export { extractClaims } from './extractor.js';
export type { ExtractOptions, ExtractResult } from './extractor.js';

export { mergeClaims, candidateFingerprint } from './merger.js';
export type { MergeResult, DecidedConflict } from './merger.js';

export { detectModules, topicsInModule, SHARED_MODULE } from './module-detector.js';
export type { DetectedModule, ModuleDetectionResult } from './module-detector.js';

export { spawnSectionRunner } from './section-runner.js';
export type {
  SectionRunner,
  PendingSection,
  RenderedSection,
  SpawnSectionRunnerOptions,
} from './section-runner.js';

export { materializeSpec } from './materializer.js';
export type { MaterializeOptions, MaterializeResult } from './materializer.js';

export {
  cachePaths,
  ensureCacheDirs,
  readBlockCache,
  writeBlockCache,
  sectionId,
  readSectionCache,
  writeSectionCache,
  readScanState,
  writeScanState,
  clearScanState,
  scanStatePath,
} from './cache.js';
export type {
  CachePaths,
  BlockCacheEntry,
  SectionCacheEntry,
  SectionCacheKey,
  ScanState,
} from './cache.js';

export {
  consolidate,
  readDecisions,
  writeDecisions,
  decisionsPath,
  specRootPath,
} from './orchestrator.js';
export type { ConsolidateOptions, ConsolidateResult } from './orchestrator.js';

export { detectVersionChains, materializeManualChains } from './version-chain.js';
export type { VersionChain } from './version-chain.js';

export {
  existingChainPairKeys,
  runChainRecheck,
  selectRecheckPairs,
  CHAIN_RECHECK_SYSTEM_PROMPT,
} from './chain-recheck.js';
export type {
  ChainRecheckCandidatePair,
  ChainRecheckOptions,
  ChainRecheckResult,
  ChainRecheckRunner,
  ChainRecheckRunnerInput,
} from './chain-recheck.js';

export {
  explainConflicts,
  CONFLICT_EXPLAINER_SYSTEM_PROMPT,
} from './conflict-explainer.js';
export type {
  ConflictExplainerInput,
  ConflictExplainerOptions,
  ConflictExplainerRunner,
} from './conflict-explainer.js';

export {
  filterByRelevance,
  RELEVANCE_SYSTEM_PROMPT,
} from './relevance-filter.js';
export type {
  RelevanceFilterOptions,
  RelevanceFilterOutcome,
  RelevanceRunner,
  RelevanceRunnerInput,
  RelevanceVerdict,
} from './relevance-filter.js';

export {
  detectVersionChainsViaLlm,
  CHAIN_DETECTION_SYSTEM_PROMPT,
  buildChainDetectionUserPrompt,
} from './version-chain-llm.js';
export type {
  ChainDetectionInput,
  ChainRunner,
  ChainRunnerOptions,
  DetectChainsOptions,
  DetectedChainOutput,
} from './version-chain-llm.js';
