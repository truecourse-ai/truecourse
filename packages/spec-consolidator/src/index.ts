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
  Relation,
  RelationType,
  ManualArea,
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
  RelationSchema,
  RelationTypeSchema,
  ManualAreaSchema,
  ScopeSchema,
  ModuleManifestSchema,
} from './types.js';

// --- Curated corpus (spec-scan redesign) -----------------------------------

export {
  DocRefSchema,
  AreaTagSchema,
  CorpusDocSchema,
  OverlapSchema,
  AreaSchema,
  CuratedCorpusSchema,
  normalizeArea,
  splitArea,
  slugifyAxis,
  isProcessArea,
  CORE_PRODUCT,
  PROCESS_PRODUCT,
  PROCESS_CONCERNS,
} from './corpus-types.js';
export type {
  DocRef,
  AreaTag,
  CorpusDoc,
  Overlap,
  Area,
  CuratedCorpus,
  VocabMap,
} from './corpus-types.js';

export {
  corpusFilePath,
  hasCorpus,
  readCorpus,
  writeCorpus,
} from './corpus-store.js';

export { tagDocs, parseDocStatus, AREA_TAGGER_SYSTEM_PROMPT, buildAreaTaggerUserPrompt } from './area-tagger.js';
export type { DocAreaTags, AreaTagRunner, AreaTagRunnerInput, AreaTaggerOptions } from './area-tagger.js';

export { groupByArea } from './area-grouper.js';
export type { GroupResult } from './area-grouper.js';

export {
  normalizeVocabulary,
  VOCAB_NORMALIZER_SYSTEM_PROMPT,
  buildVocabUserPrompt,
} from './vocab-normalizer.js';
export type { VocabRunner, VocabRunnerInput, VocabNormalizerOptions } from './vocab-normalizer.js';

export { detectRelations, effectiveRelations } from './relation.js';
export type { DetectRelationsOptions } from './relation.js';

export {
  flagOverlaps,
  OVERLAP_DETECTOR_SYSTEM_PROMPT,
  buildOverlapUserPrompt,
} from './overlap-detector.js';
export type {
  OverlapRunner,
  OverlapRunnerInput,
  OverlapVerdict,
  OverlapDetectorOptions,
} from './overlap-detector.js';

export { curate, readCorpusDecisions } from './curate.js';
export type { CurateModels, CurateOptions, CurateResult, CurateStats } from './curate.js';

export { discoverDocs, classifyDoc } from './discovery.js';
export type { DocCandidate, DiscoveryOptions } from './discovery.js';

export { sliceDoc } from './slicer.js';
export type { Block } from './slicer.js';

export { spawnRunner, defaultConcurrency, defaultBatchSize } from './runner.js';
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

export {
  cachePaths,
  ensureCacheDirs,
  readBlockCache,
  writeBlockCache,
  readScanState,
  writeScanState,
  clearScanState,
  scanStatePath,
} from './cache.js';
export type {
  CachePaths,
  BlockCacheEntry,
  ScanState,
} from './cache.js';

export {
  claimsFilePath,
  hasClaims,
  readClaims,
  writeClaims,
  entryFromClaim,
  ClaimsFileEntrySchema,
  ClaimsFileSchema,
} from './claims-store.js';
export type {
  ClaimsFile,
  ClaimsFileEntry,
  ClaimsFileModule,
} from './claims-store.js';

export {
  consolidate,
  remerge,
  readDecisions,
  writeDecisions,
  decisionsPath,
  specRootPath,
} from './orchestrator.js';
export type {
  ConsolidateModels,
  ConsolidateOptions,
  ConsolidateResult,
  RemergeResult,
} from './orchestrator.js';

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
  isChainConflict,
  CONFLICT_EXPLAINER_SYSTEM_PROMPT,
  CHAIN_EXPLAINER_SYSTEM_PROMPT,
} from './conflict-explainer.js';

export {
  resolveConflicts,
  CONFLICT_RESOLVER_SYSTEM_PROMPT,
} from './conflict-resolver.js';
export type {
  ConflictResolution,
  ConflictResolverInput,
  ConflictResolverOptions,
  ConflictResolverRunner,
  ResolvedConflict,
} from './conflict-resolver.js';
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
