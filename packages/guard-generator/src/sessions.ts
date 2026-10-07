/**
 * What a pooled session kind did, as every stage of a generate reports it.
 */

/**
 * What one session-kind pool did — the session analog of a transport tally
 * (sessions, not calls). `allTransport` distinguishes "the provider was down"
 * (systemic ⇒ the run aborts before writing) from "a session went malformed /
 * over budget" (fail-open per doc, tallied).
 */
export interface GuardSessionSummary {
  /** The session kind that ran (`guard-generate.extract`, `guard-generate.flows`). */
  kind: string
  /** Sessions that actually ran (cache hits never do). */
  ran: number
  fromCache: number
  failed: number
  /** True when every failure was transport-class (vacuously true at 0 failures). */
  allTransport: boolean
  firstError?: string
  spent: { turns: number; tokens: number; costUsd: number }
}

/** A summary that means: sessions were attempted and the provider lost every one. */
export function isSystemicSessionLoss(s: GuardSessionSummary): boolean {
  return s.ran > 0 && s.failed === s.ran && s.allTransport
}
