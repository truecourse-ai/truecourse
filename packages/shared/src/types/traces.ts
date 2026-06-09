/**
 * AI observability — the LLM trace contract (enterprise edition).
 *
 * Every LLM call the hosted pipeline makes (spec consolidation, contract
 * extraction, the repair pass) is captured at the EE transport and recorded as
 * one trace: the prompt, the output, the model, token usage, latency, status and
 * context tags. Metadata lives in Postgres (`llm_traces`); the heavy prompt/
 * output/reasoning payloads live in the BlobStore, content-addressed.
 *
 * These are type-only definitions shared by the EE producer (`ee-llm` transport),
 * the store (`ee-data-store`), the routes (`ee-server`) and the dashboard
 * (`ee-client`) — the same cross-package convention as `jobs.ts`/`ee.ts`. OSS
 * never references them.
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

/** The sink the EE transport writes each call to. Implemented by `PgBlobTraceStore`. */
export interface LlmTraceRecorder {
  record(input: LlmTraceInput): Promise<void>
}

/** Row-level metadata for the traces list — no payloads (those stay in the blob). */
export interface TraceSummary {
  id: string
  workspaceOrgId: string | null
  traceId: string | null
  stage: string | null
  callId: string | null
  sliceId: string | null
  module: string | null
  topic: string | null
  model: string
  status: TraceStatus
  finishReason: string | null
  usedFallback: boolean
  /** sha256 of the prompt — groups identical prompts (the divergence view). */
  promptHash: string
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  reasoningTokens: number | null
  latencyMs: number
  createdAt: string
}

/** A single trace with its hydrated payloads. */
export interface TraceDetail extends TraceSummary {
  parentId: string | null
  errorMessage: string | null
  metadata: Record<string, unknown> | null
  system: string | null
  user: string | null
  output: string | null
  reasoning: string | null
}

export interface TraceListFilters {
  /** Tenant scope. Omit (operator only) for cross-org reads; set to scope to one org. */
  org?: string
  stage?: string
  status?: TraceStatus
  promptHash?: string
  traceId?: string
  /** Page size (default 100). */
  limit?: number
  /** `createdAt` cursor — return rows strictly older than this. */
  before?: string
}

/** Filters for the cross-org Admin jobs list. */
export interface JobListFilters {
  /** Tenant scope. Omit for cross-org (operator); set to scope to one org. */
  org?: string
  type?: string
  status?: 'queued' | 'running' | 'succeeded' | 'failed'
  limit?: number
}

/** Per-stage aggregate for the overview. */
export interface TraceStageStat {
  stage: string | null
  calls: number
  errors: number
  totalTokens: number
  avgLatencyMs: number
}

export interface TraceStats {
  stages: TraceStageStat[]
  totalCalls: number
  totalErrors: number
}
