/**
 * Public surface of the spec-consolidator package (corpus path).
 *
 * The scan pipeline curates docs into a `CuratedCorpus` (areas +
 * relations + overlaps); this index re-exports the type contracts and
 * stage entry points the CLI, dashboard server, and contract-extractor
 * talk through.
 */

export type {
  Status,
  DocKind,
  Relation,
  RelationType,
  ManualArea,
  DecisionsFile,
} from './types.js';

export {
  StatusSchema,
  DocKindSchema,
  RelationSchema,
  RelationTypeSchema,
  ManualAreaSchema,
  DecisionsFileSchema,
} from './types.js';

// --- Curated corpus (spec-scan redesign) -----------------------------------

export {
  DocRefSchema,
  AreaTagSchema,
  CorpusDocSchema,
  OverlapSchema,
  OverlapSectionSchema,
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
  OverlapSection,
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

export { tagDocs, isAreaTagCached, parseDocStatus, AREA_TAGGER_SYSTEM_PROMPT, buildAreaTaggerUserPrompt } from './area-tagger.js';
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
export { prefilterDocs } from './relevance-filter.js';

export { defaultConcurrency } from './runner.js';

export {
  readDecisions,
  writeDecisions,
  decisionsPath,
  specRootPath,
} from './orchestrator.js';

export { detectVersionChains } from './version-chain.js';
export type { VersionChain } from './version-chain.js';

export {
  filterByRelevance,
  readRelevanceCache,
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
