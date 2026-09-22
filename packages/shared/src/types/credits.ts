/**
 * CREDITS: what a workspace may spend on TrueCourse's own key.
 *
 * A credit is one USD CENT of priced model cost — 100 credits is a dollar of
 * list-price spend, with no markup — so a debit and the `llm_usage` row it
 * charges are the same money said twice, and the Credits tab and the Usage page
 * agree to the cent.
 *
 * The ledger is append-only and the balance is one row kept in step with it, so
 * a statement is arithmetic rather than a reconstruction. What the tab shows
 * folds a run's many debits into ONE line for the run: a generate makes
 * thousands of calls, and nobody reads a ledger per call.
 *
 * THE PAUSE lives here too — the error and the two predicates that recognise
 * it — because it has to TRAVEL. Every engine package catches errors around its
 * LLM calls and softens them into a failed item; an empty balance is the one
 * thing none of them may soften, and they all depend on this package while none
 * of them may depend on core.
 */

import type { SessionFailure } from '@truecourse/agent-loop';

/** How many credits a dollar of priced model cost is. */
export const CREDITS_PER_USD = 100;

/** `$1.20` worth of spend as the 120 credits it charges. */
export function creditsOfUsd(usd: number): number {
  return Math.round(usd * CREDITS_PER_USD);
}

/** The credits of a balance as the dollars they are worth. */
export function usdOfCredits(credits: number): number {
  return credits / CREDITS_PER_USD;
}

// --- the pause ------------------------------------------------------

/** The code the pause travels under, and the refusal a start answers with on an empty balance. */
export const CREDITS_EXHAUSTED = 'credits-exhausted';

/**
 * The workspace cannot spend: its balance is at or below zero. Thrown BEFORE a
 * call or a turn, so a run overshoots by at most the one call in flight.
 *
 * It is a PAUSE, not a failure. A stage that catches it and returns a soft
 * outcome tells the run the ITEM failed, and the run carries on spending what
 * it does not have, ticks its step done over work that never happened, and
 * leaves a step that can never be replayed from cache. So every catch around an
 * LLM call rethrows this one, and the first refusal ends the run.
 *
 * The workspace and the balance are carried when the thrower held the account;
 * a caller that met the pause as a parked session has neither in hand.
 */
export class CreditsExhaustedError extends Error {
  readonly code = CREDITS_EXHAUSTED;
  constructor(
    readonly workspaceOrgId?: string,
    readonly balance?: number,
  ) {
    super('This workspace is out of credits. The run is paused until it can spend again.');
    this.name = 'CreditsExhaustedError';
  }
}

/** Whether this is the pause rather than a failure. Matched on the code, so an
 *  error that crossed a package boundary is still recognised. */
export function isCreditsExhausted(err: unknown): err is CreditsExhaustedError {
  return (
    err instanceof CreditsExhaustedError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { code?: unknown }).code === CREDITS_EXHAUSTED)
  );
}

/**
 * How the pause reaches an agent session: a driver never throws (a rejected
 * `done` is reserved for driver defects), so the refusal arrives as the park it
 * is. `blocked` is the shell's word for "park loudly, never hammer".
 */
export const CREDITS_PAUSE_FAILURE: Extract<SessionFailure, { kind: 'transport' }> = {
  kind: 'transport',
  detail: 'out of credits',
  class: 'permission',
  retryability: 'blocked',
};

/** Whether a session parked because the workspace could no longer pay. */
export function isCreditsPauseFailure(failure: SessionFailure): boolean {
  return (
    failure.kind === 'transport' &&
    failure.class === CREDITS_PAUSE_FAILURE.class &&
    failure.retryability === CREDITS_PAUSE_FAILURE.retryability &&
    failure.detail === CREDITS_PAUSE_FAILURE.detail
  );
}

/** The three movements. A grant and an adjustment are an operator's; a debit is a run's. */
export const CREDIT_LEDGER_KINDS = ['grant', 'debit', 'adjustment'] as const;
export type CreditLedgerKind = (typeof CREDIT_LEDGER_KINDS)[number];

/** A workspace's balance, and the grant the low-balance warnings are measured against. */
export interface CreditBalanceView {
  balance: number;
  /** The last grant's size, which 10% of is the low-balance line. */
  lastGrantCredits: number;
  lastGrantAt: string | null;
}

/**
 * One line of the statement. A grant or an adjustment is its own ledger row; a
 * debit is every debit of ONE RUN added up, which is why it carries the run
 * rather than a usage row.
 */
export interface CreditEntryView {
  id: string;
  kind: CreditLedgerKind;
  /** Signed credits: a grant is positive, a debit negative. */
  amount: number;
  /** The balance after the last movement of this line. */
  balanceAfter: number;
  note: string | null;
  /** The operator behind a grant or an adjustment. */
  actorUserId: string | null;
  at: string;
  // --- a debit's run -------------------------------------------------
  jobId?: string;
  /** Null when the job never opened a run record; such a line opens nowhere. */
  runId?: string | null;
  jobType?: string;
  /** The job type's word: Document scan, Flow generation, … */
  title?: string;
  /** `owner/repo`, or null for the workspace's own work. */
  repository?: string | null;
}

/** A run this workspace has stopped mid-way, waiting on credits. */
export interface PausedRunView {
  jobId: string;
  jobType: string;
  /** The job type's word. */
  title: string;
  repository: string | null;
  /** The run record it paused in, when it had one. */
  runId: string | null;
  pausedAt: string;
}

/** `GET /api/credits` — the whole Credits tab in one answer. */
export interface CreditsResponse extends CreditBalanceView {
  /** Newest first. */
  entries: CreditEntryView[];
  /** Oldest first: the order a grant resumes them in. */
  pausedRuns: PausedRunView[];
  /** Whether this workspace is spending its credits right now. */
  onCredits: boolean;
}

/** `POST /api/credits/resume/:jobId`. */
export interface CreditsResumeResponse {
  /** The job carrying on — the paused one itself, back on the queue. */
  jobId: string;
}

// --- the operator's side --------------------------------------------

/** One workspace as the operator's Credits page lists it. */
export interface OperatorCreditsRow {
  workspaceOrgId: string;
  /**
   * The workspace's name as the identity provider knows it, and null when it
   * cannot be resolved. An operator reads a customer, not an id, and a name
   * nobody could give up is no reason to withhold the balance.
   */
  workspaceName: string | null;
  balance: number;
  lastGrantCredits: number;
  lastGrantAt: string | null;
  /** Credits debited in the last 30 days. */
  spent30d: number;
  pausedRuns: number;
}

/** `GET /api/operator/credits`. */
export interface OperatorCreditsResponse {
  workspaces: OperatorCreditsRow[];
}

/** `POST /api/operator/credits/grant`. */
export interface CreditGrantRequest {
  workspaceOrgId: string;
  /** Whole credits, positive. */
  credits: number;
  note?: string;
  /** Carry the workspace's paused runs on, in the order they paused. Default true. */
  resumePaused?: boolean;
}

/** `POST /api/operator/credits/adjust` — a correction, signed either way. */
export interface CreditAdjustRequest {
  workspaceOrgId: string;
  credits: number;
  note?: string;
}

/** What a grant or an adjustment left behind. */
export interface CreditMovementResponse {
  balance: number;
  /** Paused runs this movement carried on. */
  resumed: number;
}

/**
 * The refusal code a start answers with when the workspace spends credits and
 * its model has no price: no price table has been fetched yet, or the table
 * holds none for the model the credits provider is charged as. A run that
 * cannot be priced cannot be charged, so it does not start.
 */
export const CREDITS_PRICES_UNAVAILABLE = 'credits-prices-unavailable';

/** What a person is told when {@link CREDITS_PRICES_UNAVAILABLE} refuses a start. */
export const CREDITS_PRICES_UNAVAILABLE_MESSAGE =
  'Model prices are not available yet, so a run on TrueCourse credits cannot be charged. Try again in a few minutes.';


/**
 * The refusal code a start answers with when the workspace chose TrueCourse
 * credits on a server that holds no platform key to run them on. Its remedy is
 * the same as an unconfigured provider's: a key of the workspace's own.
 */
export const CREDITS_PROVIDER_UNAVAILABLE = 'credits-provider-unavailable';

/** How a start was answered when the workspace spends credits. */
export type CreditsStartVerdict = 'ok' | 'confirm' | 'refused';

/**
 * What a start route says about the balance before it queues anything.
 * `confirm` means the run may not finish on what is left, so the client asks
 * before spending it; `refused` means there is nothing to spend at all, or the
 * run could not be charged for.
 */
export interface CreditsStartCheck {
  verdict: CreditsStartVerdict;
  /**
   * Why a `refused` start was refused: nothing left to spend, or no price to
   * charge the run's model at.
   */
  reason?: 'exhausted' | 'prices-unavailable';
  balance: number;
  /** The run's ceiling cost in credits, when an estimate could be made. */
  estimate?: number;
  message?: string;
}
