/**
 * AI observability — the LLM trace store (enterprise edition).
 *
 * One row per real LLM call the hosted pipeline makes (spec consolidation,
 * contract extraction, the repair pass). This holds the QUERYABLE metadata —
 * stage, slice, model, token usage, latency, status, and the prompt hash that
 * groups identical prompts (the same-prompt→divergent-output view). The heavy
 * prompt/output/reasoning payloads are content-addressed in `content` (scope =
 * org), referenced here by sha (mirroring `contract_sets`).
 *
 * Workspace-scoped by `workspace_org_id` (nullable — a call made outside a trace
 * context records with a null org and is simply invisible to per-tenant queries,
 * never lost). Cache HITS are not traced: the slice cache short-circuits before
 * the transport, so a row exists iff a real model call (and its cost) happened.
 */

import { pgTable, text, integer, boolean, jsonb, timestamp, index } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const llmTraces = pgTable(
  'llm_traces',
  {
    id: text('id').primaryKey(),
    /** Tenant (WorkOS org). Nullable — see file header. */
    workspaceOrgId: text('workspace_org_id'),
    /** Groups every call of one logical operation (= the jobId when job-run). */
    traceId: text('trace_id'),
    /** A sub-call's parent (repair → its source extraction). */
    parentId: text('parent_id'),
    /** Pipeline stage, e.g. 'contract.extract' / 'spec.relevance'. */
    stage: text('stage'),
    /** The call's natural id, e.g. 'contract.extract:<sliceId>'. */
    callId: text('call_id'),
    /** Granular unit id parsed from callId (the slice/block processed). */
    sliceId: text('slice_id'),
    module: text('module'),
    topic: text('topic'),
    /** The model that answered (primary, or fallback when used_fallback). */
    model: text('model').notNull(),
    /** 'ok' | 'error'. */
    status: text('status').notNull(),
    errorMessage: text('error_message'),
    finishReason: text('finish_reason'),
    usedFallback: boolean('used_fallback').notNull().default(false),
    /** sha256 of the prompt — the grouping key for the divergence view. */
    promptHash: text('prompt_hash').notNull(),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    totalTokens: integer('total_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    latencyMs: integer('latency_ms').notNull(),
    /** shas into `content` (scope = org) for the content-addressed payloads. */
    promptSha: text('prompt_sha').notNull(),
    outputSha: text('output_sha'),
    reasoningSha: text('reasoning_sha'),
    /** Free-form tags: repoFullName, commitSha, jobId, provider, … */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    index('llm_traces_org_created_idx').on(t.workspaceOrgId, t.createdAt),
    index('llm_traces_trace_idx').on(t.traceId),
    index('llm_traces_org_stage_idx').on(t.workspaceOrgId, t.stage),
    index('llm_traces_org_prompt_idx').on(t.workspaceOrgId, t.promptHash),
  ],
);
