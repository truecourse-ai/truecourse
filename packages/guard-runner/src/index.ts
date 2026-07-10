/**
 * `@truecourse/guard-runner` — the deterministic side of guard: scenario loading,
 * sandbox lifecycle, the cli driver, normalizers, evidence capture, and result
 * mapping. Zero LLM dependencies; fully exercisable with hand-written scenarios.
 */

export { runGuard, sourceGuardRunInputs, defaultRunConcurrency, runFailureMessage } from './run.js'
export type { RunGuardOptions, RunGuardResult, GuardRunInputs } from './run.js'

export { defaultGuardExecutor } from './guard-executor.js'
export type { GuardExecutor, GuardExecInput, GuardExecReport } from './guard-executor.js'

export { loadScenarios, walkScenarioRelFiles } from './scenario-loader.js'
export type { LoadedScenarios, ScenarioLoadError } from './scenario-loader.js'

export { loadRecipe, resolveEntry, computeRecipeFingerprint, RecipeError } from './recipe.js'
export type { Recipe, LoadedRecipe } from './recipe.js'
export { RecipeSchema } from './recipe.js'

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

export { runBuild, DEFAULT_BUILD_TIMEOUT_MS } from './build.js'
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
