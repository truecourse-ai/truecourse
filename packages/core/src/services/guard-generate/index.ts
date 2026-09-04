/**
 * The guard-generate session kinds (plan 04): claim extraction (step 15) and
 * flow synthesis (step 16) as agent sessions, plus the seam factory the
 * command adapter injects into `generateGuards`. The key builders and prompt
 * fingerprints are exported for the step-20 estimate rework, which must probe
 * the REAL keys.
 */

export {
  EXTRACT_SESSION_KIND,
  EXTRACT_SESSION_CACHE_NAME,
  EXTRACT_SESSION_BUDGET,
  EXTRACT_SESSION_SYSTEM_PROMPT,
  EXTRACT_SESSION_PROMPT_FINGERPRINT,
  extractSessionCacheKey,
  extractSessionCacheKeyForContentHash,
  extractDocContentHash,
  extractSessionWorkItem,
  extractSessionDef,
  extractSessionBriefing,
  validateExtractDraft,
  type ExtractSessionInput,
} from './extract.js'

export {
  FLOWS_SESSION_KIND,
  FLOWS_SESSION_CACHE_NAME,
  FLOWS_SESSION_BUDGET,
  FLOWS_SESSION_SYSTEM_PROMPT,
  FLOWS_SESSION_PROMPT_FINGERPRINT,
  FLOWS_EPIC_SESSION_SYSTEM_PROMPT,
  FLOWS_EPIC_SESSION_PROMPT_FINGERPRINT,
  FLOWS_EPIC_WORK_ITEM,
  flowsSessionCacheKey,
  flowsEpicSessionCacheKey,
  flowsSessionWorkItem,
  flowsSessionDef,
  flowsEpicSessionDef,
  flowsSessionBriefing,
  flowsEpicSessionBriefing,
  flowSetRefusalReason,
  type FlowsCheckerContext,
  type FlowsSessionInput,
  type FlowsEpicSessionInput,
} from './flows.js'

export {
  FLOW_WORKER_SESSION_KIND,
  FLOW_WORKER_CACHE_NAME,
  FLOW_WORKER_BUDGET,
  FLOW_WORKER_CLI_SYSTEM_PROMPT,
  FLOW_WORKER_API_SYSTEM_PROMPT,
  FLOW_WORKER_WEB_SYSTEM_PROMPT,
  FLOW_WORKER_CLI_PROMPT_FINGERPRINT,
  FLOW_WORKER_API_PROMPT_FINGERPRINT,
  FLOW_WORKER_WEB_PROMPT_FINGERPRINT,
  flowWorkerSystemPrompt,
  flowWorkerPromptFingerprint,
  flowWorkerCacheKey,
  flowWorkerSessionDef,
  cacheableWorkerOutcome,
  CachedWorkerEntrySchema,
  type CachedWorkerEntry,
  type FlowWorkerSessionInput,
} from './flow-worker.js'

export {
  FIDELITY_SESSION_KIND,
  FIDELITY_SESSION_CACHE_NAME,
  FIDELITY_SESSION_BUDGET,
  FIDELITY_SESSION_SYSTEM_PROMPT,
  FIDELITY_SESSION_PROMPT_FINGERPRINT,
  FidelityVerdictSchema,
  fidelitySessionCacheKey,
  fidelitySessionDef,
  judgeWorkerFidelity,
  type FidelityVerdict,
} from './fidelity.js'

export {
  createGuardGenerateSessionSeams,
  // Single-step mode (`--only-<step>`): the loud refusal a cache-only replay of
  // a prior step raises instead of spending that step's sessions.
  GenerateStepNotReadyError,
  type GuardGenerateSessionSeams,
  type CreateGuardGenerateSeamsOptions,
  // The driver+persistence pair the `driver` test seam resolves to — exported
  // so a caller can type its injected thunk without reaching into run.ts.
  type AcquiredContext,
} from './run.js'

export {
  buildGuardDocUniverse,
  docOutlineLines,
  resolveSection,
  renderDocChunk,
  docChunkCount,
  GUARD_DOC_CHUNK_CHARS,
  type GuardDocUniverse,
} from './tools.js'
