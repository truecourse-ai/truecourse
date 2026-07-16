/**
 * `@truecourse/guard-generator` — the LLM side of guard: whole-document claim
 * extraction, recipe discovery, batched scenario authoring, and birth validation.
 * Authorship is output-only — the model returns content through the shared
 * transport seam and the engine (this package) parses, validates, birth-validates,
 * and writes. Depends on `@truecourse/guard-runner` (the deterministic engine) and
 * `@truecourse/shared`; those never depend back on it.
 */

export {
  generateGuards,
  defaultGenerateBatch,
  resolveGenerateBatch,
  generateBatchOverride,
  retryCacheKey,
  GENERATE_CACHE_NAME,
  FIDELITY_CACHE_NAME,
  type GenerateGuardsOptions,
  type GenerateMode,
  type GuardGenerateResult,
  type GuardGenerateModels,
  type GeneratedScenarioInfo,
  type GuardBirthFinding,
  type GuardGenerateError,
  type GuardExtractionFailure,
  type AuthorFailure,
} from './generate.js'

export {
  planGuardWork,
  collectWorkDocs,
  hasGuardUniverse,
  readCorpusAreaTags,
  generationInputsHash,
  type GuardWorkPlan,
  type GuardDoc,
  type SectionInput,
} from './section-plan.js'

export {
  readSuppressedClaims,
  readSuppressionIndex,
  suppressedQuotesIn,
  suppressionKey,
} from './suppression.js'

export { seedInvariantPack, invariantPackId } from './invariant.js'

export {
  extractDocClaims,
  docExtractionCached,
  countExtractViews,
  countUncachedExtractViews,
  EXTRACT_CACHE_NAME,
  type DocClaims,
  type ExtractResult,
} from './extract.js'

export {
  discoverRecipe,
  collectDiscoveryInputs,
  RECIPE_CACHE_NAME,
  type RecipeDiscoveryResult,
} from './recipe-discovery.js'

export {
  deriveStaticProbes,
  deriveExpansionProbes,
  captureProbes,
  groundProbes,
  defaultProbeExecutor,
  programNamesOf,
  GROUND_CACHE_NAME,
  MAX_PROBES_PER_BATCH,
  PROBE_OUTPUT_LIMIT,
  PROBE_TIMEOUT_MS,
  type ProbeTranscript,
  type ProbeExecutor,
  type CaptureProbesOptions,
  type GroundProbesOptions,
  type StaticProbes,
} from './ground.js'

export { scenarioCompositionDefect, quoteInvalidOutput, flattenZodError } from './validate.js'

export {
  birthValidate,
  type BirthCandidate,
  type BirthOutcome,
  type BirthOptions,
  type BirthResult,
} from './birth.js'

export {
  EXTRACT_SYSTEM_PROMPT,
  GENERATE_SYSTEM_PROMPT,
  RECIPE_SYSTEM_PROMPT,
  RECIPE_PROMPT_FINGERPRINT,
  FIDELITY_SYSTEM_PROMPT,
  FIDELITY_PROMPT_FINGERPRINT,
  buildAuthorUserPrompt,
  buildRecipeUserPrompt,
  buildFidelityUserPrompt,
  type AuthorUserContext,
  type AuthorClaim,
  type FidelityUserContext,
  type RecipeDiscoveryInput,
  type RecipeManifest,
  type ManifestEcosystem,
} from './prompts.js'

export {
  spawnExtractRunner,
  spawnGenerateRunner,
  spawnRecipeRunner,
  spawnFidelityRunner,
  spawnTriageRunner,
  spawnExemplarRunner,
  type ExtractRunner,
  type GenerateRunner,
  type RecipeRunner,
  type FidelityRunner,
  type TriageRunner,
} from './runners.js'

export {
  runTriage,
  triageCacheKey,
  buildTriageUserPrompt,
  TRIAGE_CACHE_NAME,
  TRIAGE_SYSTEM_PROMPT,
  TRIAGE_PROMPT_FINGERPRINT,
  type TriageUserContext,
  type TriageSectionContext,
} from './triage.js'

export {
  TestabilityVerdictSchema,
  RecipeProposalSchema,
  ExampleBlockSchema,
  SupportSubjectSchema,
  ExtractedClaimSchema,
  UntestableNoteSchema,
  DocExtractionSchema,
  RawGeneratedScenarioSchema,
  AuthoredClaimSchema,
  AuthoredBatchSchema,
  FidelityReviewSchema,
  CLAIM_DRIVERS,
  type TestabilityVerdict,
  type RecipeProposal,
  type ExampleBlock,
  type SupportSubject,
  type ExtractedClaim,
  type UntestableNote,
  type DocExtraction,
  type RawGeneratedScenario,
  type AuthoredClaim,
  type FidelityReview,
} from './schemas.js'

export {
  seedSupportPack,
  supportPackId,
  defaultSupportPackSize,
  buildExemplarUserPrompt,
  EXEMPLAR_CACHE_NAME,
  EXEMPLAR_SYSTEM_PROMPT,
  EXEMPLAR_PROMPT_FINGERPRINT,
  type ExemplarRunner,
  type ExemplarUserContext,
} from './exemplars.js'
