/**
 * The LLM trace contract: what one completed call looks like to whatever
 * records it.
 *
 * The transport hands a recorder the prompt, the output, the model, the token
 * usage, the latency, the status and the context tags of every call it makes.
 * The run's own diagnostics log is the recorder the engine installs; nothing
 * stores traces durably.
 */

export type TraceStatus = 'ok' | 'error'

/**
 * What the transport hands the recorder for one completed (or failed) LLM call.
 * Carries the RAW payloads (system/user/output/reasoning); the recorder hashes
 * them, writes the blobs, and inserts the metadata row.
 */
export interface LlmTraceInput {
  /** Tenant (WorkOS org). Null only for calls made outside a trace context. */
  workspaceOrgId: string | null
  /** Groups every call of one logical operation (= the jobId when run from a job). */
  traceId: string | null
  /** A sub-call's parent (e.g. a repair call → its source extraction). */
  parentId: string | null
  /** Pipeline stage, from `LlmRequest.stage` (e.g. `contract.extract`). */
  stage: string | null
  /** The call's natural id, from `LlmRequest.id` (e.g. `contract.extract:<sliceId>`). */
  callId: string | null
  /** The granular unit id parsed from `callId` (the slice/block the call processed). */
  sliceId: string | null
  /** Optional (deferred) — only set when the request carries it. */
  module: string | null
  topic: string | null
  /** The model that actually answered (primary, or fallback when `usedFallback`). */
  model: string
  status: TraceStatus
  errorMessage: string | null
  finishReason: string | null
  /** The primary model errored and the fallback answered. */
  usedFallback: boolean
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  reasoningTokens: number | null
  latencyMs: number
  /** Raw system + user prompt (stored as one content-addressed blob). */
  system: string
  user: string
  /** Raw model output; null on error. */
  output: string | null
  /** Native reasoning, when the provider emitted it (opt-in); else null. */
  reasoning: string | null
  /** Free-form tags (repoFullName, commitSha, jobId, provider, …). */
  metadata: Record<string, unknown> | null
}

/** The sink the transport writes each call to. */
export interface LlmTraceRecorder {
  record(input: LlmTraceInput): Promise<void>
}
