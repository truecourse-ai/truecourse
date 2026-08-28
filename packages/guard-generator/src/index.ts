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
  workerCacheKey,
  // Single-step mode (the CLI's `--only-<step>` flags): the pipeline's session
  // steps in order. `@truecourse/core` enforces the cache-only replay of the
  // prior ones against these.
  GENERATE_SESSION_STEPS,
  type GenerateStep,
  type GenerateGuardsOptions,
  type GuardGenerateResult,
  type GuardGenerateModels,
  type GeneratedScenarioInfo,
  type GuardBirthFinding,
  type GuardGenerateError,
  type GuardExtractionFailure,
  type InterfaceProvider,
  // The flow-worker session seam (plan 04 steps 17 + 18) — implemented by
  // `@truecourse/core`, injected by the command adapter.
  type FlowWorkerSessionSeam,
  type FlowWorkerSessionResult,
  type FlowWorkerTask,
  type FlowWorkerToolReport,
  type FlowWorkerCacheMaterial,
  type WorkerFidelityInput,
  type WorkerFidelityVerdict,
  type WorkerFidelityJudge,
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
  interfaceDigest,
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
  collectProbeCandidates,
  type ProbeCandidate,
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
  snapExtraction,
  isSystemicSessionLoss,
  type DocClaims,
  type ExtractResult,
  type ExtractedClaimWithNeeds,
  type ExtractSessionSeam,
  type GuardSessionSummary,
} from './extract.js'

export {
  synthesizeFlows,
  buildFlowAreas,
  flowAreaKey,
  FLOW_AREA_CLAIM_CEILING,
  flowAreaIdForDoc,
  flowAreaClaimsMaterial,
  flowAreaOutlinesMaterial,
  flowEpicDigestsMaterial,
  flowSectionKey,
  flowsPath,
  readFlowsFile,
  checkFlowSet,
  checkEpicSet,
  isFlowSetClean,
  isFlowSynthesisWipeout,
  type SynthesizeFlowsOptions,
  type FlowSynthesisResult,
  type FlowSynthesisArea,
  type FlowAreaDocInput,
  type FlowClaimInput,
  type FlowDocInput,
  type FlowSetCheckContext,
  type FlowSetCheckReport,
  type FlowsAreaSessionSeam,
  type FlowsAreaSessionResult,
  type FlowsEpicSessionSeam,
  type FlowsEpicSessionResult,
  type FlowsSessionGrounding,
  type SubsumedFlow,
  type UnsettledArea,
} from './flows.js'

export {
  discoverRecipe,
  verifyProposal,
  recipeCacheKey,
  staticProposalComplaints,
  RECIPE_CACHE_NAME,
  type RecipeDiscoveryResult,
  type RecipeDiscoverySource,
  type RecipeDiscoveryPhase,
  type RecipeVerifyStage,
  type DiscoverRecipeOptions,
  type DatabaseDependencyHint,
  type VerifiableProposal,
  type VerifyContext,
  type ProposalVerdict,
  type RecipeRepairContext,
  type RecipeRepairResult,
  type RecipeRepairFn,
} from './recipe-discovery.js'

export {
  proposeRecipe,
  routesFromInterfaces,
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
  buildInterfaceContractHints,
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
  seedDraftGate,
  detectRoleColumns,
  principalShapedTables,
  readExistingSeedScript,
  connectionEnvVars,
  suggestedScriptPath,
  toRecipeSeed,
  resolveScriptPath,
  writeSeedArtifacts,
  SEED_CACHE_NAME,
  type DraftSeedResult,
  type SeedBlockedFlow,
  type SeedDraftDatabase,
} from './seed-draft.js'

// `truecourse guard setup` — the cheap preparation stage between the spec scan and
// the (expensive) generate.
export {
  runGuardSetup,
  readSpecExcerpts,
  collectSecuritySchemes,
  ecosystemFingerprint,
  interfacesFingerprint,
  computeSeedStepFingerprint,
  authFingerprint,
  settledFingerprints,
  GUARD_SETUP_STEPS,
  GUARD_SETUP_ONLY_STEPS,
  SetupStepNotReadyError,
  type GuardSetupOnlyStep,
  type GuardSetupOptions,
  type GuardSetupResult,
  type GuardSetupStepKey,
  type GuardSetupCatalogSession,
  type GuardSetupCatalogSessionInput,
  type GuardSetupCatalogSessionResult,
  type GuardSetupInterfaceProvider,
  type GuardSetupInterfacesStep,
  type GuardSetupInterfacesStepInput,
  type GuardSetupInterfacesStepResult,
  type GuardSetupSeedSession,
  type GuardSetupSeedSessionInput,
  type GuardSetupSeedSessionResult,
  type GuardSetupAuthStep,
  type GuardSetupAuthStepInput,
  type GuardSetupAuthStepResult,
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
  birthRunTimeoutMs,
  isRunRefusalStatus,
  type BirthCandidate,
  type BirthOutcome,
  type BirthOptions,
  type BirthRound,
} from './birth.js'

// Scenario yaml round-trip helpers the worker session path reads through.
export { serializeScenarioYaml, parseRawScenarioYaml, parseScenarioYaml } from './serialize.js'

// The failing-test TRIAGE stage is RETIRED (plan 04 step 20): a committed
// red's adjudication is the flow worker's own confirmed `expectedReds`
// prediction. The orphaned `.cache/guard/triage` files remain on disk
// (derived, deletable); `GuardTriageSchema` lives on in `@truecourse/shared`
// because committed manifests still carry historical triage verdicts read-side.

export {
  GENERATE_SYSTEM_PROMPT,
  GENERATE_API_SYSTEM_PROMPT,
  GENERATE_API_PROMPT_FINGERPRINT,
  RECIPE_SYSTEM_PROMPT,
  SEED_SYSTEM_PROMPT,
  SEED_PROMPT_FINGERPRINT,
  buildSeedUserPrompt,
  FIDELITY_SYSTEM_PROMPT,
  FIDELITY_PROMPT_FINGERPRINT,
  MATCH_SYSTEM_PROMPT,
  MATCH_PROMPT_FINGERPRINT,
  GENERATE_PROMPT_FINGERPRINT,
  buildMatchUserPrompt,
  buildAuthorUserPrompt,
  buildFidelityUserPrompt,
  buildRecipeUserPrompt,
  type AuthorUserContext,
  type InterfaceContractHint,
  type OutboundRequestHint,
  type AuthorMilestone,
  type BirthRetryContext,
  type FidelityUserContext,
  type FidelityMilestone,
  type MatchUserContext,
  type MatchMilestoneLine,
  type InterfaceDigest,
  type FlowDigest,
  type OutlineEntry,
  type SeedDraftInput,
  type SeedBlockedClaim,
  type SeedRetryContext,
  type SeedSchemaTable,
  type RecipeAppInventoryEntry,
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
  spawnRecipeRunner,
  spawnMatchRunner,
  type RecipeRunner,
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
  RawGeneratedCliScenarioSchema,
  AuthoredFlowScenarioSchema,
  RealizationMatchSchema,
  FidelityReviewSchema,
  FlowSynthesisSchema,
  FlowSetSchema,
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
  type RawGeneratedApiScenario,
  type RawGeneratedCliScenario,
  type RawGeneratedScenario,
  type AuthoredFlowScenario,
  type RealizationMatch,
  type RealizationStep,
  type FidelityReview,
  type FlowSynthesis,
  type FlowSet,
  type EpicSynthesis,
  type SynthesizedFlow,
  type SynthesizedMilestone,
  type SynthesizedEpicFlow,
} from './schemas.js'

// The app↔server join — which recipe server serves a flow's paths, and
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
