/**
 * A LEAF SESSION SEAM — one KIND of one-turn judgement, asked many times over a
 * run and tallied once.
 *
 * The engine that asks is deterministic and knows nothing about sessions: it
 * asks a question and gets the model's answer, or a throw naming why there is
 * none. That is the shape it has always had, and keeping it is the point — the
 * re-ask loops, the caches and the fail-open rules around each leaf are the
 * engine's, unchanged; only where the answer comes from moved.
 *
 * What the run gets in exchange is the {@link GuardSessionSummary} every other
 * session kind reports: how many ran, how many were lost, and whether the
 * losses were the provider's. A kind whose every session died transport-class
 * is a systemic loss, and that is what still stops a run before it writes
 * anything.
 */

import type {
  SessionDriver,
  SessionEvent,
  SessionImage,
  SessionPersistence,
} from '@truecourse/agent-loop'
import { CreditsExhaustedError, isCreditsPauseFailure } from '@truecourse/shared'
import type { GuardSessionSummary } from '@truecourse/guard-generator'
import { describeSessionFailure } from '../guard-setup/session-context.js'
import { runOneTurnSession, type OneTurnSession } from './one-turn.js'

/** The driver + journal one leaf session runs on, built when one is needed. */
export interface LeafSessionContext {
  driver: SessionDriver
  persistence: SessionPersistence
}

export interface LeafQuestion<TOutcome> {
  session: OneTurnSession<TOutcome>
  /** The thing this judgement is about (a flow id, a section anchor, a step). */
  workItem: string
  briefing: string
  images?: readonly SessionImage[]
}

export interface LeafSessionSeam {
  /** The model's answer, or a throw naming why there is none. */
  ask<TOutcome>(question: LeafQuestion<TOutcome>): Promise<TOutcome>
  /** What this kind did across the run. */
  summary(): GuardSessionSummary
}

export interface LeafSessionOptions {
  /** The session kind every question of this seam runs as. */
  kind: string
  acquire: () => Promise<LeafSessionContext>
  /** Every transcript event as it is persisted — the caller's live view. */
  onSessionEvent?: (workItem: string, event: SessionEvent) => void
  signal?: AbortSignal
  mintSessionId?: () => string
  /** What one settled session spent, for a run that totals its own. */
  onSpend?: (spent: { turns: number; tokens: number; costUsd: number }) => void
}

/** Cap on a recorded failure message, matching the transport tally's. */
const MAX_LEAF_ERROR_CHARS = 500

export function createLeafSessionSeam(opts: LeafSessionOptions): LeafSessionSeam {
  const observe = opts.onSessionEvent
  const summary: GuardSessionSummary = {
    kind: opts.kind,
    ran: 0,
    fromCache: 0,
    failed: 0,
    allTransport: true,
    spent: { turns: 0, tokens: 0, costUsd: 0 },
  }

  const lost = (detail: string, transportClass: boolean): Error => {
    summary.failed++
    if (!transportClass) summary.allTransport = false
    summary.firstError ??= detail.slice(0, MAX_LEAF_ERROR_CHARS)
    return new Error(detail)
  }

  return {
    summary: () => ({ ...summary, spent: { ...summary.spent } }),

    async ask<TOutcome>(question: LeafQuestion<TOutcome>): Promise<TOutcome> {
      summary.ran++
      let context: LeafSessionContext
      try {
        context = await opts.acquire()
      } catch (e) {
        // A driver that cannot even be built is the provider being unusable —
        // transport-class, exactly as an unbuildable transport was.
        throw lost(
          `the session driver could not be constructed: ${e instanceof Error ? e.message : String(e)}`,
          true,
        )
      }

      const outcome = await runOneTurnSession<TOutcome>({
        session: question.session,
        workItem: question.workItem,
        briefing: question.briefing,
        ...(question.images?.length ? { images: question.images } : {}),
        driver: context.driver,
        persistence: observe
          ? teeEvents(context.persistence, (event) => observe(question.workItem, event))
          : context.persistence,
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
      })

      summary.spent.turns += outcome.spent.turns
      summary.spent.tokens += outcome.spent.tokens
      summary.spent.costUsd += outcome.spent.costUsd
      opts.onSpend?.(outcome.spent)

      if (outcome.status === 'completed') return outcome.output
      // An empty balance is a PAUSE, not a lost call: it travels as the error
      // the whole pipeline already routes to a parked run.
      if (isCreditsPauseFailure(outcome.failure)) throw new CreditsExhaustedError()
      throw lost(describeSessionFailure(outcome.failure), outcome.failure.kind === 'transport')
    },
  }
}

/** Persistence that also hands every event to the caller's observer, AFTER the
 *  shell stamped it — reads untouched. */
function teeEvents(
  inner: SessionPersistence,
  observe: (event: SessionEvent) => void,
): SessionPersistence {
  return {
    ...(inner.publishProgress ? { publishProgress: inner.publishProgress.bind(inner) } : {}),
    ...(inner.flush ? { flush: inner.flush.bind(inner) } : {}),
    appendEvent(sessionId, event) {
      inner.appendEvent(sessionId, event)
      observe(event)
    },
    updateIndex: (entry) => inner.updateIndex(entry),
    readEvents: (sessionId) => inner.readEvents(sessionId),
  }
}
