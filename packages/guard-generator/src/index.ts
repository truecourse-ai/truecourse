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
  authorCacheKey,
  retryCacheKey,
  GENERATE_CACHE_NAME,
  FIDELITY_CACHE_NAME,
  type GenerateGuardsOptions,
  type GuardGenerateResult,
  type GuardGenerateModels,
  type GeneratedScenarioInfo,
  type GuardBirthFinding,
  type GuardGenerateError,
  type GuardExtractionFailure,
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
  parseOperationSection,
  buildOperationIndex,
  matchOperationsForSection,
  matchedRequestSchemas,
  matchedSchemaFingerprint,
  type OperationEntry,
} from './openapi-enrich.js'

export {
  resolveSectionAuth,
  securityFingerprintForSection,
  type AuthCredential,
  type SectionAuth,
  type SatisfiedScheme,
} from './openapi-security.js'

export {
  readSuppressedClaims,
  readSuppressionIndex,
  suppressedQuotesIn,
  suppressionKey,
} from './suppression.js'

export {
  extractDocClaims,
  docExtractionCached,
  countExtractViews,
  countUncachedExtractViews,
  EXTRACT_CACHE_NAME,
  type DocClaims,
  type ExtractResult,
} from './extract.js'

export { discoverRecipe, RECIPE_CACHE_NAME, type RecipeDiscoveryResult } from './recipe-discovery.js'

export {
  deriveStaticProbes,
  deriveExpansionProbes,
  captureProbes,
  groundProbes,
  defaultProbeExecutor,
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

export { birthValidate, type BirthCandidate, type BirthOutcome, type BirthOptions } from './birth.js'

export {
  EXTRACT_SYSTEM_PROMPT,
  GENERATE_SYSTEM_PROMPT,
  GENERATE_API_SYSTEM_PROMPT,
  GENERATE_API_PROMPT_FINGERPRINT,
  RECIPE_SYSTEM_PROMPT,
  FIDELITY_SYSTEM_PROMPT,
  FIDELITY_PROMPT_FINGERPRINT,
  buildAuthorUserPrompt,
  buildFidelityUserPrompt,
  buildRecipeUserPrompt,
  type AuthorUserContext,
  type AuthorClaim,
  type FidelityUserContext,
} from './prompts.js'

export {
  spawnExtractRunner,
  spawnGenerateRunner,
  spawnRecipeRunner,
  spawnFidelityRunner,
  type ExtractRunner,
  type GenerateRunner,
  type RecipeRunner,
  type FidelityRunner,
} from './runners.js'

export {
  TestabilityVerdictSchema,
  RecipeProposalSchema,
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
  type ExtractedClaim,
  type UntestableNote,
  type DocExtraction,
  type RawGeneratedScenario,
  type AuthoredClaim,
  type FidelityReview,
} from './schemas.js'
