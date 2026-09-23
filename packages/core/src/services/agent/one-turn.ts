/**
 * THE ONE-TURN SESSION — how a leaf judgement reaches the model.
 *
 * Some of a run's work is a single question: here is a briefing, answer in
 * this shape. It has nothing to explore and no tools to call, so it takes one
 * turn. It still runs on the SESSION DRIVER, in a transcript, under the run's
 * own accounting, because ONE PATH is the point — one model, one usage record
 * per turn, one price, whether the work took thirty turns or one.
 *
 * The budget buys the RE-ASK a leaf judgement has always had: an answer that
 * does not fit its schema, or that names something that is not there, is
 * quoted back once and the session answers again on the same transcript
 * (`outcomeSchemaRepairs` for the shape, `validateOutcome` for the substance).
 * It never resumes: a leaf question that died is asked again from scratch by
 * whoever asked it, which is what its cache entry being absent already means.
 *
 * And it is bounded in TIME as well as turns: a provider stream that goes
 * quiet mid-answer is stopped by the stall clock, and the whole session by its
 * ceiling (`config/llm-timeouts.ts`) — the one kind of session with nothing
 * else that could take long.
 */

import {
  runAgentLoop,
  type KnownDisplayBlock,
  type SessionDef,
  type SessionDriver,
  type SessionImage,
  type SessionOutcome,
  type SessionPersistence,
} from '@truecourse/agent-loop'
import type { z } from 'zod'
import { resolveOneTurnTimeoutMs, resolveStallTimeoutMs } from '../../config/llm-timeouts.js'

/**
 * How a one-turn session DELIVERS the answer an output-only stage prompt asks
 * for. Those prompts forbid tool-call markup because a model answering them
 * used to EMIT it as prose; the outcome is not that, and saying so plainly is
 * what this line is for.
 *
 * Appended to the stage prompt rather than folded into it, so the prompt
 * fingerprint a stage caches under still names the prompt it always did and a
 * warm cache survives the move onto the session path.
 */
export const OUTCOME_DELIVERY = [
  'You are answering as a SESSION: deliver that JSON value as this session\u2019s OUTCOME.',
  'That is how an answer is given here \u2014 the note above about tool-call markup is about what you WRITE, never about the outcome itself.',
  'Produce it in one turn: you have nothing to look up and nothing to run.',
].join(' ')

/** A stage's output-only system prompt, told how a session hands its answer back. */
export function withOutcomeDelivery(systemPrompt: string): string {
  return `${systemPrompt}\n\n${OUTCOME_DELIVERY}`
}

/** What a leaf judgement IS: a prompt, a shape, and what it may spend. */
export interface OneTurnSession<TOutcome> {
  /** Session type, `<command>.<task>` — the kind its usage row is filed under. */
  kind: string
  /** The short name of this kind of work, as a surface reading the run says it. */
  title: string
  systemPrompt: string
  outcomeSchema: z.ZodType<TOutcome, z.ZodTypeDef, unknown>
  /** Compact wire shape, when the answer's own schema is not one a provider's
   *  structured output can express. */
  outcomeInputSchema?: z.ZodTypeAny
  /** Refuse a schema-valid answer that does not hold against the real task;
   *  the session is told why and answers again on the same transcript. */
  validateOutcome?: (outcome: TOutcome) => string | undefined | Promise<string | undefined>
  /** How this answer reads in the transcript. */
  presentOutcome?: (outcome: TOutcome) => KnownDisplayBlock[]
  /** Turns beyond the first, for the re-asks. One by default — the single
   *  corrective re-ask every leaf judgement has always had. */
  reasks?: number
  tokenCeiling: number
}

/** The def a one-turn session runs as: no tools, one turn plus its re-asks. */
export function oneTurnSessionDef<TOutcome>(session: OneTurnSession<TOutcome>): SessionDef<TOutcome> {
  const reasks = session.reasks ?? 1
  return {
    kind: session.kind,
    display: { title: session.title },
    systemPrompt: session.systemPrompt,
    tools: [],
    outcomeSchema: session.outcomeSchema,
    ...(session.outcomeInputSchema ? { outcomeInputSchema: session.outcomeInputSchema } : {}),
    outcomeSchemaRepairs: reasks,
    ...(session.validateOutcome ? { validateOutcome: session.validateOutcome } : {}),
    ...(session.presentOutcome ? { presentOutcome: session.presentOutcome } : {}),
    budget: { turns: 1 + reasks, maxResumes: 0, tokenCeiling: session.tokenCeiling },
  }
}

export interface OneTurnRun<TOutcome> {
  session: OneTurnSession<TOutcome>
  /** The thing this judgement is about (a flow id, a doc path, a scenario). */
  workItem: string
  briefing: string
  /** Images the judgement is about — shown with the briefing, and again on a
   *  re-ask, so a session asked to revise can still see what it judged. */
  images?: readonly SessionImage[]
  driver: SessionDriver
  persistence: SessionPersistence
  sessionId?: string
  signal?: AbortSignal
  /** The two clocks, when a caller has reason to set its own; the environment's otherwise. */
  stallTimeoutMs?: number
  timeoutMs?: number
  mintSessionId?: () => string
  now?: () => string
}

/** Ask one question and get the whole outcome — failures are data, as ever. */
export function runOneTurnSession<TOutcome>(run: OneTurnRun<TOutcome>): Promise<SessionOutcome<TOutcome>> {
  const mint = run.mintSessionId ?? (() => globalThis.crypto.randomUUID())
  return runAgentLoop<TOutcome>({
    def: oneTurnSessionDef(run.session),
    workItem: run.workItem,
    initialMessages: [run.briefing],
    ...(run.images?.length ? { images: run.images } : {}),
    driver: run.driver,
    persistence: run.persistence,
    sessionId: run.sessionId ?? mint(),
    ...(run.signal ? { signal: run.signal } : {}),
    stallTimeoutMs: run.stallTimeoutMs ?? resolveStallTimeoutMs(),
    timeoutMs: run.timeoutMs ?? resolveOneTurnTimeoutMs(),
    ...(run.mintSessionId ? { mintSessionId: run.mintSessionId } : {}),
    ...(run.now ? { now: run.now } : {}),
  }).outcome
}
