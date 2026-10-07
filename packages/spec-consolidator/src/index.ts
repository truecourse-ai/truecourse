/**
 * Public surface of the spec-consolidator package (corpus path).
 *
 * The scan pipeline curates docs into a `CuratedCorpus` (areas +
 * conflicts); this index re-exports the type contracts and stage entry
 * points the dashboard server talks through.
 */

export type {
  Status,
  DocKind,
  ManualArea,
  ConflictResolution,
  DecisionsFile,
  ScopeVerdict,
} from './types.js';

export {
  StatusSchema,
  DocKindSchema,
  ManualAreaSchema,
  ConflictResolutionSchema,
  DecisionsFileSchema,
  ScopeVerdictSchema,
  DECISIONS_FILE_VERSION,
} from './types.js';

// --- Curated corpus (spec-scan redesign) -----------------------------------

export {
  DocRefSchema,
  AreaTagSchema,
  CorpusDocSchema,
  ConflictSchema,
  ConflictSideSchema,
  ConflictReviewSchema,
  AreaSchema,
  CuratedCorpusSchema,
  FactSkipReasonSchema,
  DocLedgerCountsSchema,
  AreaComparisonSchema,
  CorpusComparisonSchema,
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
  Conflict,
  ConflictSide,
  ConflictReview,
  Area,
  CuratedCorpus,
  VocabMap,
  FactSkipReason,
  DocLedgerCounts,
  AreaComparison,
  CorpusComparison,
} from './corpus-types.js';

export { partitionByAffinity, clusterByAffinity, affinityTokens, extractClaimTokens, PAIR_GEN_DF_CAP } from './affinity-partition.js';
export type { AffinityOptions, AffinityPartition } from './affinity-partition.js';

export {
  corpusFilePath,
  hasCorpus,
  readCorpus,
  writeCorpus,
} from './corpus-store.js';

export {
  parseDocStatus,
  classifyStatusValue,
  AREA_TAGGER_SYSTEM_PROMPT,
} from './area-tagger.js';
export type { DocAreaTags } from './area-tagger.js';

// Beside the readers above, because it answers the same question about the same
// doc. It is IMPLEMENTED in `@truecourse/shared` rather than here: the dashboard
// renders the very same facts on a document's page, and the client cannot import
// this package (node builtins).
export { readDocFrontmatter } from '@truecourse/shared';
export type { DocFrontmatter, StatusTransition } from '@truecourse/shared';

export { groupByArea, assignDocPairArea } from './area-grouper.js';
export type { GroupResult } from './area-grouper.js';

export { VOCAB_NORMALIZER_SYSTEM_PROMPT } from './vocab-normalizer.js';

export { verifyConflictSides, splitDocSections, locateQuote } from './pointer-verifier.js';
export type { VerifyPointersInput, DocSection } from './pointer-verifier.js';

export {
  splitDocSentences,
  planSentenceWindows,
  presentSentence,
  SENTENCE_SPLITTER_VERSION,
  CODE_LINES_PER_SENTENCE,
} from './doc-sentences.js';
export type { DocSentence, DocSentenceKind, SentenceWindow, SentenceWindowBounds } from './doc-sentences.js';

export { headingOutline, leadText, sectionText } from './doc-sections.js';

export {
  readCorpusDecisions,
  pruneOrphanedConflictResolutions,
  autoApplyHighConfidenceRecommendations,
} from './curate.js';
export type { CurateResult, CurateStats } from './curate.js';

export {
  resolveRepoIdentity,
  resolveWorkspaceIdentity,
  readRepoIdentityInput,
  repoFromRemote,
  coresOf,
  aliasMatcher,
  identityFingerprint,
  identityBlock,
  stripForNames,
  taglineFromReadme,
  MIN_MATCHABLE_ALIAS,
  MAX_ALIASES,
  MAX_DESCRIPTION_CHARS,
} from './repo-identity.js';
export type { RepoIdentity, RepoIdentityInput } from './repo-identity.js';

export { discoverDocs, classifyDoc, docBody, docProse, isStructuralSpecDoc } from './discovery.js';
export type { DocCandidate, DiscoveryOptions } from './discovery.js';
export { prefilterDocs } from './relevance-filter.js';

export { defaultConcurrency } from './runner.js';

export {
  readDecisions,
  writeDecisions,
  decisionsPath,
  specRootPath,
} from './orchestrator.js';

export { atomicWriteFile, atomicWriteJson } from './atomic-write.js';

// --- Web spec sources (llms.txt docs sites) ---------------------------------

export {
  parseLlmsTxt,
  flattenLinks,
  normalizeSourceUrl,
  assertLlmsTxtUrl,
  fetchLlmsTxt,
  fetchPages,
  partitionByOrigin,
  previewSource,
  sourceIdFromUrl,
  slugifyId,
  urlToSnapshotPath,
  mapUrlsToPaths,
  hashContent,
  SourceSkipReasonSchema,
  SourceSkipSchema,
  InvalidSourceUrlError,
  LlmsTxtFetchError,
  SourcePathError,
  USER_AGENT,
  fetchPublicSource,
  SourceNetworkPolicyError,
} from './sources/index.js';
export type {
  LlmsTxtDoc,
  LlmsTxtSection,
  LlmsTxtLink,
  FetchOptions,
  FetchProgress,
  FetchPagesResult,
  FetchedPage,
  SourcePreview,
  SourceSkipReason,
  SourceSkip,
} from './sources/index.js';

export {
  buildRelevanceUserPrompt,
  isCarvedOutAgentSkill,
  applySubjectAttribution,
  namesOurProduct,
  prefilterCategory,
  SkipCategorySchema,
  DocSubjectSchema,
  RELEVANCE_SYSTEM_PROMPT,
} from './relevance-filter.js';
export type {
  SkipCategory,
  DocSubject,
  RelevanceVerdict,
} from './relevance-filter.js';
export { diffCorpora } from './corpus-diff.js';
