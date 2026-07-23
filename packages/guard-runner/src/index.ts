/**
 * `@truecourse/guard-runner` — the deterministic side of guard: scenario loading,
 * sandbox lifecycle, the cli and api drivers, normalizers, evidence capture, and
 * result mapping. Zero LLM dependencies; fully exercisable with hand-written scenarios.
 */

export { runGuard, sourceGuardRunInputs, defaultRunConcurrency, apiBootConcurrency, runFailureMessage, orderReadBeforeWrite } from './run.js'
export type { RunGuardOptions, RunGuardResult, GuardRunInputs } from './run.js'

export { newRunNonce, scenarioUnique } from './unique.js'

export { defaultGuardExecutor } from './guard-executor.js'
export type { GuardExecutor, GuardExecInput, GuardExecReport } from './guard-executor.js'

export { loadScenarios, walkScenarioRelFiles } from './scenario-loader.js'
export type { LoadedScenarios, ScenarioLoadError } from './scenario-loader.js'

export {
  loadRecipe,
  resolveEntry,
  computeRecipeFingerprint,
  resolveApiCredentials,
  CredentialResolutionError,
  RecipeError,
  DEFAULT_API_HEALTH_PATH,
  DEFAULT_API_READY_TIMEOUT_MS,
} from './recipe.js'
export type {
  Recipe,
  RecipeApi,
  RecipeApiCredential,
  RecipeApiSeed,
  RecipeApiSeedCredential,
  ResolvedCredential,
  LoadedRecipe,
} from './recipe.js'
export {
  RecipeSchema,
  RecipeApiSchema,
  RecipeApiCredentialSchema,
  RecipeApiSeedSchema,
  RecipeApiSeedCredentialSchema,
} from './recipe.js'

export { runApiScenario } from './api/run-api-scenario.js'
export type { RunApiScenarioContext } from './api/run-api-scenario.js'
export { startApiServer, allocateFreePort } from './api/server.js'
export type { ApiServerHandle, StartApiServerResult, StartApiServerOptions } from './api/server.js'
export { executeApiRequest } from './api/executor.js'
export type { ApiStepCapture, ExecuteApiRequestOptions } from './api/executor.js'
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

export { constructChildEnv, BUILD_PASSTHROUGH } from './child-env.js'
export type { ChildEnvOptions } from './child-env.js'

export { applyCapabilities, CapabilityError } from './capabilities/index.js'
export type { CapabilityContext } from './capabilities/index.js'
export { materializeGit } from './capabilities/git.js'

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
  defaultEntryProbeExecutor,
  entryPreflightHeadline,
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
  scenariosDir,
  recipePath,
  manifestPath,
  guardDecisionsPath,
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
  atomicWriteJson,
} from './store.js'

export {
  buildDocSectionIndex,
  extractSectionTexts,
  splitTopLevelSections,
  resolveBinding,
  slugifyHeading,
  normalizeSectionText,
  fingerprintText,
  isMarkdownDoc,
  isOpenApiDoc,
  deriveOpenApiSections,
} from './section-index.js'
export type { DocSection, DocSectionIndex, BindingResolution, SectionText } from './section-index.js'

export { indexRepoDocs } from './doc-index.js'
export type { RepoDocIndexes } from './doc-index.js'

export { readManifest, writeManifest, rebuildManifestFromScenarios } from './manifest.js'

export {
  readGuardDecisions,
  writeGuardDecisions,
  dismissGuardClaim,
  undismissGuardClaim,
} from './decisions.js'
