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
  type AuthorFailure,
  type JourneyProvider,
} from './generate.js'

export {
  planGuardWork,
  collectWorkDocs,
  corpusOpenApiDocs,
  hasGuardUniverse,
  readCorpusAreaTags,
  sectionInputsKey,
  flowGenerationInputsHash,
  type GuardWorkPlan,
  type GuardDoc,
  type SectionInput,
} from './section-plan.js'

export {
  matchFlow,
  planFlowMatching,
  readCachedMatch,
  buildSurfaceCatalogs,
  journeyDigest,
  realizationLines,
  matchCacheKey,
  MATCH_CACHE_NAME,
  type MatchOutcome,
  type MatchPlan,
  type MatchPairPlan,
  type RealizationPlan,
  type SurfaceCatalog,
} from './match.js'

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
  recipeAuthCredentials,
  validateCredentialSatisfies,
  type AuthCredential,
  type SatisfiesDiagnostics,
  type SpecDocText,
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

export {
  synthesizeFlows,
  planFlowSynthesis,
  buildFlowAreas,
  flowAreaIdForDoc,
  flowAreaCacheKey,
  flowEpicCacheKey,
  flowSectionKey,
  flowsPath,
  readFlowsFile,
  FLOWS_CACHE_NAME,
  type SynthesizeFlowsOptions,
  type FlowSynthesisResult,
  type FlowSynthesisPlan,
  type FlowAreaPlan,
  type FlowSynthesisArea,
  type FlowAreaDocInput,
  type FlowClaimInput,
  type FlowDocInput,
  type SubsumedFlow,
  type UnsettledArea,
} from './flows.js'

export {
  discoverRecipe,
  verifyProposal,
  RECIPE_CACHE_NAME,
  type RecipeDiscoveryResult,
  type RecipeDiscoverySource,
  type DiscoverRecipeOptions,
  type DatabaseDependencyHint,
  type VerifiableProposal,
  type VerifyContext,
  type ProposalVerdict,
} from './recipe-discovery.js'

export {
  proposeRecipe,
  routesFromJourneys,
  rankHealthPath,
  credentialStubs,
  credentialEnvName,
  detectComposeServices,
  detectEcosystems,
  tokenizeCommand,
  type ApiRouteRef,
  type ProposeRecipeInputs,
  type ProposeRecipeOutcome,
  type RecipeEcosystem,
} from './recipe-propose.js'

export {
  deriveGuardCompose,
  GUARD_COMPOSE_FILE,
  NEUTRAL_USER,
  type ComposePlan,
  type ComposeDerivation,
} from './datastore-compose.js'

export { enrichBlockedOn, isGenericExternalNoun } from './external-blocked.js'
export {
  buildJourneyContractHints,
  buildOutboundRequestHints,
  outboundOverflow,
  MAX_OUTBOUND_REQUESTS,
  MAX_QUERY_PARAMS,
  MAX_RESPONSE_FIELDS,
} from './grounding.js'

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

export {
  draftSeed,
  seedDraftGate,
  detectRoleColumns,
  SEED_CACHE_NAME,
  type DraftSeedOptions,
  type DraftSeedResult,
  type SeedBlockedFlow,
  type SeedDraftDatabase,
} from './seed-draft.js'

// `truecourse guard setup` (item 77) — the cheap preparation stage between the spec
// scan and the (expensive) generate.
export {
  runGuardSetup,
  readSpecExcerpts,
  collectSecuritySchemes,
  GUARD_SETUP_STEPS,
  type GuardSetupOptions,
  type GuardSetupResult,
  type GuardSetupStepKey,
} from './setup.js'

export {
  probeApiServers,
  pickProbePath,
  PROBE_REQUEST_TIMEOUT_MS,
  type ProbeApiServersOptions,
} from './endpoint-probe.js'

export { deriveExternalsSkeleton, type ExternalsSkeleton } from './externals-skeleton.js'

export {
  birthValidate,
  isRunRefusalStatus,
  type BirthCandidate,
  type BirthOutcome,
  type BirthOptions,
  type BirthRound,
} from './birth.js'

// Failing-test triage (item 81) — the post-birth judgment stage.
export {
  runTriage,
  triageCacheKey,
  buildTriageUserPrompt,
  TRIAGE_CACHE_NAME,
  TRIAGE_SYSTEM_PROMPT,
  TRIAGE_PROMPT_FINGERPRINT,
  type TriageUserContext,
  type TriageFlowContext,
  type TriageMilestone,
} from './triage.js'

export {
  EXTRACT_SYSTEM_PROMPT,
  GENERATE_SYSTEM_PROMPT,
  GENERATE_API_SYSTEM_PROMPT,
  GENERATE_API_PROMPT_FINGERPRINT,
  RECIPE_SYSTEM_PROMPT,
  SEED_SYSTEM_PROMPT,
  SEED_PROMPT_FINGERPRINT,
  buildSeedUserPrompt,
  FIDELITY_SYSTEM_PROMPT,
  FIDELITY_PROMPT_FINGERPRINT,
  FLOWS_SYSTEM_PROMPT,
  FLOWS_PROMPT_FINGERPRINT,
  FLOWS_EPIC_SYSTEM_PROMPT,
  FLOWS_EPIC_PROMPT_FINGERPRINT,
  MATCH_SYSTEM_PROMPT,
  MATCH_PROMPT_FINGERPRINT,
  GENERATE_PROMPT_FINGERPRINT,
  buildMatchUserPrompt,
  buildAuthorUserPrompt,
  buildFidelityUserPrompt,
  buildRecipeUserPrompt,
  buildFlowsUserPrompt,
  buildFlowsEpicUserPrompt,
  type AuthorUserContext,
  type JourneyContractHint,
  type OutboundRequestHint,
  type AuthorMilestone,
  type BirthRetryContext,
  type FidelityUserContext,
  type FidelityMilestone,
  type MatchUserContext,
  type MatchMilestoneLine,
  type JourneyDigest,
  type FlowsUserContext,
  type FlowsEpicUserContext,
  type FlowClaimLine,
  type FlowDocOutline,
  type FlowDigest,
  type OutlineEntry,
  type SeedDraftInput,
  type SeedBlockedClaim,
  type SeedRetryContext,
  type SeedSchemaTable,
} from './prompts.js'

// Example mining (D3) — the doc's own examples run verbatim.
export {
  mineExampleBlocks,
  exampleFidelityDefect,
  MAX_EXAMPLE_BLOCKS_PER_SECTION,
  MAX_EXAMPLE_BLOCK_BYTES,
  MIN_EXAMPLE_COMPARE_CHARS,
  type MinedExampleBlock,
  type DocExampleBlock,
} from './examples.js'

export {
  spawnExtractRunner,
  spawnGenerateRunner,
  spawnRecipeRunner,
  spawnSeedRunner,
  spawnFidelityRunner,
  spawnTriageRunner,
  spawnFlowsRunner,
  spawnFlowsEpicRunner,
  spawnMatchRunner,
  type ExtractRunner,
  type GenerateRunner,
  type RecipeRunner,
  type SeedRunner,
  type FidelityRunner,
  type TriageRunner,
  type FlowsRunner,
  type FlowsEpicRunner,
  type MatchRunner,
} from './runners.js'

export {
  TestabilityVerdictSchema,
  RecipeProposalSchema,
  RecipeApiProposalSchema,
  RecipeApiServerProposalSchema,
  SeedProposalSchema,
  SeedProvidesProposalSchema,
  ExtractedClaimSchema,
  UntestableNoteSchema,
  DocExtractionSchema,
  RawGeneratedScenarioSchema,
  AuthoredFlowScenarioSchema,
  RealizationMatchSchema,
  FidelityReviewSchema,
  FlowSynthesisSchema,
  EpicSynthesisSchema,
  SynthesizedFlowSchema,
  SynthesizedMilestoneSchema,
  SynthesizedEpicFlowSchema,
  CLAIM_DRIVERS,
  type SeedProposal,
  type SeedProvidesProposal,
  type TestabilityVerdict,
  type RecipeProposal,
  type RecipeApiProposal,
  type RecipeApiServerProposal,
  type ExtractedClaim,
  type UntestableNote,
  type DocExtraction,
  type RawGeneratedScenario,
  type AuthoredFlowScenario,
  type RealizationMatch,
  type RealizationStep,
  type FidelityReview,
  type FlowSynthesis,
  type EpicSynthesis,
  type SynthesizedFlow,
  type SynthesizedMilestone,
  type SynthesizedEpicFlow,
} from './schemas.js'

// The app↔server join (item 76) — which recipe server serves a flow's paths, and
// the blocked-on nouns for the flows no declared server can run.
export {
  buildServerRouteIndex,
  bindFlowServer,
  documentedApiPaths,
  missingServerBlockedOn,
  multiServerBlockedOn,
  servedByOtherApp,
  appDirOfServer,
  MISSING_SERVER_NOUN,
  MULTI_SERVER_NOUN,
  type ServerRouteIndex,
  type ServerBinding,
} from './server-binding.js'

// The validate-then-correct helpers — the corrective re-ask's two renderings, and
// the per-driver COMPOSITION rules the scenario schema cannot express.
export {
  quoteInvalidOutput,
  flattenZodError,
  scenarioCompositionDefect,
  cliCompositionDefect,
  apiCompositionDefect,
} from './validate.js'
