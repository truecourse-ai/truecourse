/**
 * Agent-session transcript events — the durable record of one session.
 * One jsonl file per session; every event is
 * full-content (api-mode resume rebuilds the exact history from it, so
 * completeness is correctness). The transcript is turn-granular: streaming
 * deltas never enter the durable record.
 *
 * Drivers emit EVENT BODIES; the policy shell stamps the envelope (monotonic
 * per-session `seq` + `ts`), so DB paging and file tailing agree on ordering
 * and resume in both editions.
 */

import { z } from 'zod';

import { OutcomeDisplaySchema, SessionDisplaySchema } from './session-presentation.js';

// ---------------------------------------------------------------------------
// usage + budget
// ---------------------------------------------------------------------------

/** Where a recorded cost number came from — provenance, not billing truth. */
export const CostSourceSchema = z.enum(['provider-reported', 'model-priced', 'unpriced']);
export type CostSource = z.infer<typeof CostSourceSchema>;

/**
 * One turn's token usage, in the four disjoint buckets `StageUsage` already
 * tracks (input here = fresh, non-cached input). `reasoningTokens` is a
 * SUBSET of `outputTokens` — informational, never an addend.
 */
export const TurnUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheCreateTokens: z.number(),
  reasoningTokens: z.number().optional(),
  costUsd: z.number(),
  costSource: CostSourceSchema,
});
export type TurnUsage = z.infer<typeof TurnUsageSchema>;

/** A session's budget rollup, kept on the session index row and on child refs. */
export const BudgetSpentSchema = z.object({
  turns: z.number().int().nonnegative(),
  tokens: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type BudgetSpent = z.infer<typeof BudgetSpentSchema>;

// ---------------------------------------------------------------------------
// model attribution
// ---------------------------------------------------------------------------

/**
 * WHICH MODEL ANSWERED — declared by the driver, stamped on `session-start`
 * by the shell. A transcript read months later has to answer "what ran this"
 * without anyone reconstructing the config of the day; the per-turn
 * `assistant-turn.model` answers the same question for a turn the provider
 * actually served (a fallback swap, or a deployment name that resolves to
 * something else).
 *
 * `endpoint` is the base URL only — a gateway is part of "what answered".
 * Credentials never enter a transcript: no api key, no auth headers.
 */
export const SessionLlmSchema = z.object({
  provider: z.string(),
  /** The CONFIGURED model id — on Bedrock/Foundry a deployment name, which
   *  is why the response-reported id is recorded per turn as well. */
  model: z.string(),
  fallbackModel: z.string().optional(),
  endpoint: z.string().optional(),
});
export type SessionLlm = z.infer<typeof SessionLlmSchema>;

// ---------------------------------------------------------------------------
// failures
// ---------------------------------------------------------------------------

/** Classification of an error's origin, so readers never parse messages. */
export const SessionErrorClassSchema = z.enum([
  'provider',
  'transport',
  'permission',
  'validation',
  'unknown',
]);
export type SessionErrorClass = z.infer<typeof SessionErrorClassSchema>;

/**
 * The retryability axis, orthogonal to the failure kind: `transient`
 * = the shell may retry the turn once (a retried turn does not count against
 * the budget); `blocked` = park loudly, never hammer; `none` = a policy
 * outcome (resume is the path forward, not retry).
 */
export const RetryabilitySchema = z.enum(['transient', 'blocked', 'none']);
export type Retryability = z.infer<typeof RetryabilitySchema>;

/**
 * The structured session failures. Never an exception, never a
 * stranded task: a failure is data, persisted with the run.
 */
export const SessionFailureSchema = z.discriminatedUnion('kind', [
  // The hard turn limit bound on the last grant, naming what it did not reach.
  z.object({
    kind: z.literal('budget-exhausted'),
    notReached: z.string(),
    retryability: RetryabilitySchema,
  }),
  // The context ceiling pre-empted the wall (compaction never runs).
  z.object({ kind: z.literal('context-exhausted'), retryability: RetryabilitySchema }),
  // An unparseable action, unknown tool, schema-failing args, or a session
  // that ended without a valid outcome. Text-only replies are NOT malformed.
  z.object({
    kind: z.literal('malformed'),
    detail: z.string(),
    retryability: RetryabilitySchema,
  }),
  z.object({
    kind: z.literal('transport'),
    detail: z.string(),
    class: SessionErrorClassSchema,
    retryability: RetryabilitySchema,
  }),
  // A resume found the provider-side session gone.
  z.object({
    kind: z.literal('session-lost'),
    providerSessionId: z.string(),
    retryability: RetryabilitySchema,
  }),
]);
export type SessionFailure = z.infer<typeof SessionFailureSchema>;

// ---------------------------------------------------------------------------
// questions
// ---------------------------------------------------------------------------

/**
 * A structured question a session asks the user. `id` is minted by
 * the run process (never the provider), so resolution correlates across
 * restarts. In a non-interactive run policy auto-resolves what it can and
 * the rest land in the outcome as pending questions.
 */
export const UserInputQuestionSchema = z.object({
  id: z.string(),
  header: z.string(),
  question: z.string(),
  options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
  multiSelect: z.boolean(),
});
export type UserInputQuestion = z.infer<typeof UserInputQuestionSchema>;

// ---------------------------------------------------------------------------
// session status
// ---------------------------------------------------------------------------

/**
 * The observable session states. Turn end is DERIVED from these transitions
 * — a provider turn event is a hint, never the authority. `waiting` =
 * blocked on user input; `parked` = persisted mid-wait for a later resume.
 */
export const SessionStatusSchema = z.enum([
  'running',
  'waiting',
  'parked',
  'completed',
  'failed',
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

/**
 * The raw escape hatch: the driver's native wire payload and its source, so
 * the normalized event never loses the native one and a driver bug is
 * diagnosable from the transcript alone.
 */
export const RawPayloadSchema = z.object({ source: z.string(), payload: z.unknown() });
export type RawPayload = z.infer<typeof RawPayloadSchema>;

/** Envelope stamped by the policy shell — never by a driver. */
export const SessionEventEnvelopeSchema = z.object({
  seq: z.number().int().nonnegative(),
  ts: z.string(),
  raw: RawPayloadSchema.optional(),
});
export type SessionEventEnvelope = z.infer<typeof SessionEventEnvelopeSchema>;

/** Repeated in full on EVERY child event so stream folding is order-robust. */
export const ChildLinkageSchema = z.object({
  sessionId: z.string(),
  kind: z.string(),
  workItem: z.string(),
});
export type ChildLinkage = z.infer<typeof ChildLinkageSchema>;

export const SessionEventBodySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session-start'),
    kind: z.string(),
    workItem: z.string(),
    systemPrompt: z.string(),
    toolNames: z.array(z.string()),
    /** The prior session id when this start is a resume into a fresh process. */
    resumeOf: z.string().optional(),
    /** What the driver declared it will call (optional: a driver predating
     *  attribution still produces a legal transcript). */
    llm: SessionLlmSchema.optional(),
    /** How this session narrates itself, from its def. Optional so a
     *  transcript written before presentation existed still parses — and
     *  DECLARED because this schema is non-strict and would strip it. */
    display: SessionDisplaySchema.optional(),
  }),
  // A steer, an initial message, or a resume observation. `actor` is empty in
  // OSS, the workspace user in EE, so "who answered" is auditable.
  z.object({
    type: z.literal('user-message'),
    content: z.string(),
    actor: z.string().optional(),
  }),
  // One assistant turn — tool call or text; both count against the budget.
  z.object({
    type: z.literal('assistant-turn'),
    text: z.string().optional(),
    toolCall: z.object({ name: z.string(), args: z.unknown() }).optional(),
    usage: TurnUsageSchema,
    /** The model the RESPONSE reported, when the backend reports one — the
     *  honest answer for a turn a fallback or a deployment alias served. */
    model: z.string().optional(),
  }),
  z.object({
    type: z.literal('tool-result'),
    toolName: z.string(),
    content: z.string(),
    isError: z.boolean().optional(),
  }),
  z.object({ type: z.literal('question-asked'), question: UserInputQuestionSchema }),
  z.object({
    type: z.literal('question-resolved'),
    questionId: z.string(),
    answer: z.unknown(),
    resolvedBy: z.enum(['user', 'policy']),
  }),
  // The provider made us wait: a call failed retryably (or the model was
  // swapped for the fallback) and another attempt is coming. Budget-INERT —
  // a retry is not a turn, and the shell's `track` ignores it — but visible,
  // because a session that looks stalled for minutes is otherwise unexplained.
  z.object({
    type: z.literal('provider-retry'),
    /** 1-based over THIS turn's retries: the first retry is 1. */
    attempt: z.number().int().positive(),
    /** HTTP status when the failure had a response; absent for a connection
     *  error (timeout, socket reset) that never got one. */
    status: z.number().int().optional(),
    message: z.string(),
    /** The wait before the next attempt — 0 when there is none. */
    delayMs: z.number().nonnegative(),
    /** The model the NEXT attempt runs on, so a fallback swap reads as one. */
    model: z.string(),
  }),
  // The one re-ask for a genuinely invalid action (the narrowed policy).
  z.object({ type: z.literal('re-ask'), invalid: z.string(), reason: z.string() }),
  // A fresh budget grant: `grant` of `of` (maxResumes).
  z.object({
    type: z.literal('resume-grant'),
    grant: z.number().int().positive(),
    of: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('child-session'),
    phase: z.enum(['started', 'completed']),
    child: ChildLinkageSchema,
    status: SessionStatusSchema.optional(),
    spent: BudgetSpentSchema.optional(),
  }),
  z.object({
    type: z.literal('outcome'),
    value: z.unknown(),
    /** The def's own rendering of `value`, stamped at emit — the only moment
     *  the definition and the validated outcome coexist. Absent when the def
     *  presents nothing, or when its presenter threw. */
    display: OutcomeDisplaySchema.optional(),
    /** A presenter that threw, recorded as data: the UI stays silent, the
     *  failure stays greppable. */
    displayError: z.string().optional(),
  }),
  z.object({ type: z.literal('failure'), failure: SessionFailureSchema }),
]);
export type SessionEventBody = z.infer<typeof SessionEventBodySchema>;

/** A persisted transcript line: body + shell-stamped envelope. */
export const SessionEventSchema = z.intersection(
  SessionEventBodySchema,
  SessionEventEnvelopeSchema,
);
export type SessionEvent = SessionEventBody & SessionEventEnvelope;
