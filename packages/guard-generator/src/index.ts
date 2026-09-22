/**
 * `@truecourse/guard-generator` — the DETERMINISTIC half of guard: the work
 * plan, the section plan, recipe discovery, realization matching, birth
 * validation and every write. The model's part arrives through injected SEAMS
 * (`leaf-seams.ts` and the session seams on `generateGuards`), implemented in
 * `@truecourse/core`, which this package cannot depend on. Depends on
 * `@truecourse/guard-runner` (the deterministic engine) and
 * `@truecourse/shared`; those never depend back on it.
 */

export {
  generateGuards,
  looksWorldMutating,
  buildWebAuthorCatalog,
  workerCacheKey,
  workerRecipeMaterial,
  flowWorkerKeyFingerprints,
  // Single-step mode (`only`): the pipeline's session
  // steps in order. `@truecourse/core` enforces the cache-only replay of the
  // prior ones against these.
  GENERATE_SESSION_STEPS,
  type GenerateStep,
  type GenerateGuardsOptions,
  // One line per thing a run did, filed under the phase that did it.
  type GuardGenerateFactStep,
  type GuardGenerateResult,
  type GeneratedScenarioInfo,
  type GuardBirthFinding,
  type GuardGenerateError,
  type GuardExtractionFailure,
  type InterfaceProvider,
  // The flow-worker session seam — implemented by `@truecourse/core`, injected
  // by the command adapter.
  type FlowWorkerSessionSeam,
  type FlowWorkerSessionResult,
  type FlowWorkerTask,
  type FlowWorkerReview,
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
  legacyFlowGenerationInputsHash,
  flowGenerationInputComponents,
  flowInterfaceFingerprintBag,
  flowSettleDigest,
  flowSettleVerdict,
  type FlowGenerationInputParts,
  type FlowSettleCheck,
  type GuardWorkPlan,
  type GuardDoc,
  type SectionInput,
} from './section-plan.js'

export {
  matchFlow,
  matchProviderControls,
  planFlowMatching,
  readCachedMatch,
  buildSurfaceCatalogs,
  interfaceDigest,
  realizationLines,
  realizationAssignmentFingerprint,
  partitionPlanPreparations,
  matchCacheKey,
  matchLegacyCacheKeys,
  surfaceIdentityFingerprint,
  MATCH_STAGE_VERSION,
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
  reconciliationProblems,
  mergeSettledSections,
  priorClaimsToAccount,
  type DocClaims,
  type ExtractResult,
  type ExtractedClaimWithNeeds,
  type ExtractPrior,
  type PriorClaim,
  type ReconcilableDraft,
  type ExtractSessionSeam,
  type PriorExtraction,
  type ReuseExtractionSeam,
  type GuardSessionSummary,
} from './extract.js'

export { priorExtractions, type PriorExtractionsInput } from './extract-prior.js'

export {
  mergeExtractedClaims,
  persistExtractedClaims,
  type ExtractedDocOutcome,
} from './claims-persist.js'

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
  type RetiredFlowRecord,
  type FlowReconciliation,
} from './flows.js'

export {
  discoverRecipe,
  verifyProposal,
  recipeCacheKey,
  recipeLegacyCacheKey,
  staticProposalComplaints,
  failureReport,
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
  repairExistingRecipe,
  recipeRepairCacheKey,
  type RecipeRepairContext,
  type RecipeRepairResult,
  type RecipeRepairFn,
  type RecipeRepairScope,
  type RepairExistingRecipeOptions,
  type RepairExistingRecipeResult,
} from './recipe-discovery.js'

// Needs vs provides — the deterministic detector behind the recipe gate, and
// the scope a repair of a standing recipe is held to.
export {
  recipeNeeds,
  recipeNeedsDiff,
  recipeNeedsOf,
  needsFingerprint,
  parseDetectionSnapshot,
  type DetectedWorld,
  type RecipeNeed,
  type RecipeNeedsDiff,
  type UnprovidedNeed,
  type NeedAnswer,
} from './recipe-needs.js'
export {
  NEEDS_REPAIR_FIELDS,
  foldRepairedRecipe,
  changedRecipeFields,
  outOfScopeChanges,
  needsScopeRefusal,
  movedFlowSlices,
} from './recipe-scope.js'

export {
  proposeRecipe,
  routesFromInterfaces,
  rankHealthPath,
  credentialStubs,
  credentialEnvName,
  browserAppEvidence,
  composeProjectName,
  defaultComposeFiles,
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
  groundInputsFingerprint,
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

// Flow setup — the cheap preparation stage between the spec scan and
// the (expensive) generate.
export {
  runGuardSetup,
  readSpecExcerpts,
  collectSecuritySchemes,
  recipeStepFingerprint,
  legacyRecipeStepFingerprint,
  interfacesFingerprint,
  legacyInterfacesFingerprint,
  computeSeedStepFingerprint,
  legacySeedStepFingerprint,
  authFingerprint,
  settledSteps,
  stepSettled,
  type SettledStepRow,
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
export { detectedCredentialVars, extendCredentialRegistrations } from './credential-registrations.js'

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

// The failing-test TRIAGE stage is RETIRED: a committed red's adjudication is
// the flow worker's own confirmed `expectedReds` prediction. `GuardTriageSchema`
// lives on in `@truecourse/shared` because stored manifests still carry
// historical triage verdicts read-side.

export {
  GENERATE_SYSTEM_PROMPT,
  GENERATE_API_SYSTEM_PROMPT,
  GENERATE_API_PROMPT_FINGERPRINT,
  GENERATE_WEB_SYSTEM_PROMPT,
  GENERATE_WEB_PROMPT_FINGERPRINT,
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
  CLAIM_DIFF_SYSTEM_PROMPT,
  CLAIM_DIFF_PROMPT_FINGERPRINT,
  buildClaimDiffUserPrompt,
  type ClaimDiffSectionInput,
  WORLD_CLASSIFY_SYSTEM_PROMPT,
  WORLD_CLASSIFY_PROMPT_FINGERPRINT,
  buildWorldClassifyUserPrompt,
  type WorldClassifyFlowInput,
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
  RECIPE_PROPOSE_SESSION_KIND,
  MATCH_SESSION_KIND,
  CLAIM_DIFF_SESSION_KIND,
  WORLD_CLASSIFY_SESSION_KIND,
  type RecipeRunner,
  type MatchRunner,
  type WorldClassifyRunner,
  type ClaimDiffRunner,
  type LeafSummaries,
} from './leaf-seams.js'

export {
  reuseCosmeticExtractions,
  rememberDocTexts,
  claimDiffCacheKey,
  claimDiffLegacyCacheKey,
  docContentHash,
  CLAIM_DIFF_CACHE_NAME,
  DOC_TEXT_CACHE_NAME,
  EMPTY_CLAIM_DIFF_GATE,
  type ClaimDiffGateResult,
} from './claim-diff.js'

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
  RawGeneratedWebScenarioSchema,
  rawScenarioSchemaFor,
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
  type RawGeneratedWebScenario,
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
  type RetiredFlow,
  ClaimDiffSchema,
  type ClaimDiff,
  WorldClassifySchema,
  type WorldClassify,
} from './schemas.js'

// The app↔server join — which recipe server serves a flow's paths, and
// the blocked-on nouns for the flows no declared server can run.
export {
  buildServerRouteIndex,
  bindFlowServer,
  bindRealizationServer,
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
export { apiAuthEvidence, probeCandidatesFromInterfaces, requiredResources } from './seed-evidence.js'
export type { ApiAuthEvidence, RequiredResource } from './seed-evidence.js'

export type { GuardSetupPreparationSession, GuardSetupPreparationSessionInput } from './setup.js'

export { bindClaimPrerequisites, partitionFlowPrerequisites, flowPrerequisiteStateMaterial, flowPrerequisiteShapeFingerprint, flowInvocationGaps } from './prerequisites.js'

export { completeRealization } from './match.js'

export { createAuthorCatalog, scopedAuthorResources, catalogReadMaterial, recordCatalogReads, webAuthorKeyMaterial, webSetupCandidates, AUTHOR_CATALOG_VERSION, AUTHOR_TOOL_RESULT_CHARS, AUTHOR_INITIAL_BYTES, type AuthorCatalog, type CatalogReadLog, type CatalogSearch, type CatalogGet } from './author-catalog.js'
