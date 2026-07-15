/**
 * Public surface of the spec-consolidator package (corpus path).
 *
 * The scan pipeline curates docs into a `CuratedCorpus` (areas +
 * overlaps); this index re-exports the type contracts and stage entry
 * points the CLI, dashboard server, and contract-extractor talk through.
 */

export type {
  Status,
  DocKind,
  Relation,
  RelationType,
  ManualArea,
  ConflictResolution,
  DecisionsFile,
} from './types.js';

export {
  StatusSchema,
  DocKindSchema,
  RelationSchema,
  RelationTypeSchema,
  ManualAreaSchema,
  ConflictResolutionSchema,
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
  canonicalizeConcern,
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

export {
  flagOverlaps,
  OVERLAP_DETECTOR_SYSTEM_PROMPT,
  buildOverlapUserPrompt,
  OVERLAP_WINDOW_CHARS,
} from './overlap-detector.js';
export type {
  OverlapRunner,
  OverlapRunnerInput,
  OverlapVerdict,
  OverlapDetectorOptions,
  OverlapPart,
} from './overlap-detector.js';

export { verifyOverlapSections } from './pointer-verifier.js';
export type { VerifyPointersInput } from './pointer-verifier.js';

export {
  verifyFlaggedOverlaps,
  buildVerifyOverlapUserPrompt,
  VERIFY_OVERLAP_SYSTEM_PROMPT,
  VERIFY_DOC_BUDGET_CHARS,
} from './overlap-verifier.js';
export type {
  OverlapVerification,
  VerifyOverlapRunner,
  VerifyFlaggedOverlapsOptions,
  VerifyOverlapsResult,
} from './overlap-verifier.js';

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

export {
  filterByRelevance,
  planRelevanceWork,
  readRelevanceCache,
  buildRelevanceUserPrompt,
  RELEVANCE_SYSTEM_PROMPT,
} from './relevance-filter.js';
export type {
  RelevanceFilterOptions,
  RelevanceFilterOutcome,
  RelevancePlan,
  RelevanceRunner,
  RelevanceRunnerInput,
  RelevanceVerdict,
} from './relevance-filter.js';
