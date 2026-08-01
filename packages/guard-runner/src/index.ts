/**
 * `@truecourse/guard-runner` — the deterministic side of guard: scenario loading,
 * sandbox lifecycle, the cli and api drivers, normalizers, evidence capture, and
 * result mapping. Zero LLM dependencies; fully exercisable with hand-written scenarios.
 */

export { runGuard, sourceGuardRunInputs, defaultRunConcurrency, apiBootConcurrency, runFailureMessage, orderReadBeforeWrite } from './run.js'
export type { RunGuardOptions, RunGuardResult, GuardRunInputs } from './run.js'

export { newRunNonce, scenarioUnique, applyUnique, applyUniqueEnv, applyUniqueSetup } from './unique.js'

// No-op anomaly detection (C4) — per-driver step aggregation + the verdict the
// runner reports and the generator aborts on.
export {
  NO_OP_STEP_THRESHOLD_MS,
  ANOMALY_MIN_EXECUTED_STEPS,
  ANOMALY_NOOP_FRACTION,
  ANOMALY_MIN_DISTINCT_REQUEST_LINES,
  emptyStepStats,
  foldStepStats,
  isNoOpStep,
  isInertRequest,
  createStepStatsCollector,
  detectNoOpAnomaly,
} from './step-stats.js'
export type {
  StepObservation,
  ApiStepObservation,
  GuardCliStepStats,
  GuardApiStepStats,
  GuardRunStepStats,
  GuardNoOpAnomaly,
  StepStatsCollector,
} from './step-stats.js'

export { defaultGuardExecutor } from './guard-executor.js'
export type { GuardExecutor, GuardExecInput, GuardExecReport } from './guard-executor.js'

export { loadScenarios, walkScenarioRelFiles, outdatedFormatMessage } from './scenario-loader.js'
export type { LoadedScenarios, ScenarioLoadError } from './scenario-loader.js'

export {
  loadRecipe,
  resolveEntry,
  computeRecipeFingerprint,
  resolveApiCredentials,
  credentialShapeWarning,
  warnCredentialShapes,
  CredentialResolutionError,
  RecipeError,
  DEFAULT_API_HEALTH_PATH,
  DEFAULT_API_READY_TIMEOUT_MS,
  DEFAULT_API_SERVER_NAME,
  resolveApiServers,
  resolveScenarioServer,
  credentialServers,
} from './recipe.js'
export type {
  Recipe,
  RecipeApi,
  RecipeApiServer,
  ResolvedApiServer,
  ResolvedApiServers,
  RecipeApiCredential,
  RecipeApiCredentialRequest,
  RecipeApiSeed,
  RecipeApiSeedCredential,
  ResolvedCredential,
  LoadedRecipe,
} from './recipe.js'
export {
  RecipeSchema,
  RecipeApiSchema,
  RecipeApiServerSchema,
  RecipeApiCredentialSchema,
  RecipeApiCredentialRequestSchema,
  RecipeApiSeedSchema,
  RecipeApiSeedCredentialSchema,
  RecipeApiExternalSchema,
  RecipeApiExternalEnvSchema,
} from './recipe.js'
export { hashableRecipeText, resolveSeedScript, recipeControlledEnvVars } from './recipe.js'
export { isNoOpEntry, NO_OP_ENTRY_MESSAGE } from './recipe.js'

// The route manifest (item 76) — which workspace app serves which path, derived
// from the tree alone. Consumed by the generate-time gate and the run-time triage.
export { buildRouteManifest, whichAppServes, canonicalizePath, workspacePackageDirs } from './route-manifest.js'
export type { RouteManifest, RouteManifestApp, BuildRouteManifestOptions } from './route-manifest.js'
export type { RecipeApiExternal, RecipeApiExternalEnv } from './recipe.js'

// External API accounts (item 62) — the declaration/overlay join and the single
// provided/incomplete/unprovided derivation every surface reads.
export {
  ExternalsLocalFileSchema,
  ExternalsError,
  loadExternalsLocal,
  mergeExternals,
  resolveExternal,
  resolveExternals,
  loadResolvedExternals,
  externalsInjectEnv,
  externalsSecrets,
  externalProxyTargets,
  incompleteExternalMessage,
  firstIncompleteExternal,
  boundIncompleteExternals,
} from './externals.js'
export type {
  ExternalsLocalFile,
  MergedExternal,
  MergedExternalEnv,
  MergedExternalEndpoint,
  ExternalProxyTarget,
  ExternalState,
  ExternalRequirement,
  ResolvedExternal,
} from './externals.js'

export { runApiScenario } from './api/run-api-scenario.js'
export type { RunApiScenarioContext, ServesPathVerdict } from './api/run-api-scenario.js'
export {
  startApiServer,
  spawnApiProcess,
  awaitApiServerReady,
  allocateFreePort,
  substitutePort,
  PORT_PLACEHOLDER,
} from './api/server.js'
export type {
  ApiServerHandle,
  ApiServerExit,
  SpawnedApiServer,
  StartApiServerResult,
  StartApiServerOptions,
} from './api/server.js'
export { executeApiRequest } from './api/executor.js'
export type { ApiStepCapture, ExecuteApiRequestOptions } from './api/executor.js'
export { CookieJar, defaultCookiePath, cookiePathMatches } from './api/cookies.js'
export { runCredentialRequests, CredentialRequestError } from './api/credential-request.js'
export type { RunCredentialRequestsOptions } from './api/credential-request.js'
export { evaluateApiExpect, parseJsonBody } from './api/expect.js'
export type { ApiExpectMismatch, EvaluateApiExpectParams } from './api/expect.js'
export {
  interpolate,
  interpolateRequest,
  interpolateApiExpect,
  resolveHeaderValue,
  lookupJsonPath,
  captureValueToString,
  JSON_PATH_MISS,
  UnknownVariableError,
  UnknownCredentialError,
  UnknownFixtureError,
} from './api/vars.js'
export { preflightApiServer } from './api/preflight.js'
export type { ApiPreflightOptions } from './api/preflight.js'
export { writeApiEvidence } from './api/evidence.js'
export type { ApiEvidenceStep, WriteApiEvidenceParams } from './api/evidence.js'
export { buildCredentialRedactor } from './api/redact.js'
export { runSeed, SeedError, SEED_OUT_ENV } from './api/seed.js'
export type { SeedResult, RunSeedOptions } from './api/seed.js'

export {
  runScenario,
  isSetupDefectResult,
  SANDBOX_SETUP_EXPECTED,
  CAPABILITY_SETUP_EXPECTED,
} from './run-scenario.js'
export type { RunScenarioContext } from './run-scenario.js'

export { createSandbox, SandboxError, listSandboxFiles, DETERMINISM_PINS } from './sandbox.js'
export type { Sandbox, SandboxOptions } from './sandbox.js'

export { constructChildEnv, overlayStepEnv, BUILD_PASSTHROUGH } from './child-env.js'
export type { ChildEnvOptions } from './child-env.js'

export { applyCapabilities, CapabilityError } from './capabilities/index.js'
export type { CapabilityContext } from './capabilities/index.js'
export { materializeGit } from './capabilities/git.js'
export { startHttpStubs, applyHttpStubOrigins, evaluateStubExpect, pathMatches } from './capabilities/http.js'
export type { HttpStubsHandle, HttpStubViolation, HttpStubRequestRecord } from './capabilities/http.js'
export { startExternalProxies } from './capabilities/external-proxy.js'
export type {
  ExternalProxiesHandle,
  ExternalProxyViolation,
  ExternalCallRecord,
  StartExternalProxiesOptions,
} from './capabilities/external-proxy.js'

export { executeStep, DEFAULT_STEP_TIMEOUT_MS } from './executor.js'
export type { StepCapture, ExecuteStepOptions } from './executor.js'

export { normalize } from './normalizers.js'
export type { NormalizerContext } from './normalizers.js'

export { evaluateExpect } from './expect.js'
export type { ExpectMismatch, EvaluateExpectParams } from './expect.js'

export { runBuild, runInstall, DEFAULT_BUILD_TIMEOUT_MS, DEFAULT_INSTALL_TIMEOUT_MS } from './build.js'
export type { BuildResult } from './build.js'

export {
  preflightEntry,
  entryStarts,
  probesProducedOutput,
  defaultEntryProbeExecutor,
  entryPreflightHeadline,
  entrySilentHeadline,
  formatEntryPreflightError,
  missingEntryScript,
  formatMissingEntryScript,
  ENTRY_PROBE_ARGVS,
  ENTRY_PREFLIGHT_TIMEOUT_MS,
} from './preflight.js'
export type {
  EntryPreflightResult,
  EntryProbe,
  EntryProbeExecutor,
  EntryProbeWorld,
  MissingEntryScript,
  PreflightEntryOptions,
} from './preflight.js'

export { writeEvidence } from './evidence.js'
export type { EvidenceStep, WriteEvidenceParams } from './evidence.js'

export {
  guardDir,
  guardLatestPath,
  guardRunsDir,
  guardRunPath,
  guardHistoryPath,
  guardResultPath,
  guardSetupPath,
  guardJourneysPath,
  scenariosDir,
  recipePath,
  manifestPath,
  guardDecisionsPath,
  externalsLocalPath,
  evidenceRunDir,
  evidenceScenarioDir,
  evidenceRelPath,
  sanitizeSegment,
  writeGuardLatest,
  readGuardLatest,
  writeGuardRun,
  readGuardHistory,
  appendGuardHistory,
  writeGuardResult,
  readGuardResult,
  writeGuardSetup,
  readGuardSetup,
  guardAutoResolutionsPath,
  readGuardAutoResolutions,
  writeGuardAutoResolutions,
  readJourneyCatalog,
  atomicWriteJson,
} from './store.js'

export {
  buildDocSectionIndex,
  extractSectionTexts,
  splitTopLevelSections,
  resolveBinding,
  resolveScenarioBinds,
  slugifyHeading,
  normalizeSectionText,
  fingerprintText,
  isMarkdownDoc,
  isOpenApiDoc,
  deriveOpenApiSections,
} from './section-index.js'
export type {
  DocSection,
  DocSectionIndex,
  BindingResolution,
  ScenarioBindingVerdict,
  SectionText,
} from './section-index.js'

export { isJourneyDrifted } from './journey-drift.js'

export { corpusKeptDocs, indexRepoDocs, nodeRefContext } from './doc-index.js'
export type { RepoDocIndexes } from './doc-index.js'
export type { RefResolutionContext } from './section-index.js'

export { readManifest, writeManifest, rebuildManifestFromScenarios } from './manifest.js'

export {
  readGuardDecisions,
  writeGuardDecisions,
  dismissGuardClaim,
  undismissGuardClaim,
} from './decisions.js'
