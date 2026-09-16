/**
 * The CREDITS store — what a workspace may spend on TrueCourse's own key.
 *
 * One seam, ONE implementation: the Postgres store (`@truecourse/data-store`),
 * installed at boot. Nothing is installed by default, and a read that arrives
 * before boot says so rather than inventing a workspace with money.
 *
 * The unit is a credit: one USD CENT of priced model cost, no markup. The
 * ledger is append-only and the balance is one row kept in step with it in the
 * SAME transaction, with the balance row locked, so two runs debiting at once
 * still add up. A debit names the `llm_usage` row it charges, which is what
 * makes the Credits tab and the Usage page agree to the cent.
 *
 * {@link CreditsExhaustedError} is thrown by whoever checks before spending. It
 * is a PAUSE, not a failure: the job that meets one settles `paused`, its
 * sessions park with their journals intact, and a grant carries them on.
 */

import type { CreditLedgerKind } from '@truecourse/shared';

/** A workspace's balance and the grant the low-balance line is measured from. */
export interface CreditBalanceRecord {
  workspaceOrgId: string;
  balance: number;
  lastGrantCredits: number;
  lastGrantAt: string | null;
}

/** One movement, exactly as the ledger holds it. */
export interface CreditLedgerRecord {
  id: string;
  workspaceOrgId: string;
  kind: CreditLedgerKind;
  /** Signed credits: a grant is positive, a debit negative. */
  amount: number;
  balanceAfter: number;
  actorUserId: string | null;
  note: string | null;
  /** The `llm_usage` row a debit charges. */
  usageId: string | null;
  createdAt: string;
}

/**
 * One line of the statement: a grant or an adjustment as itself, a run's debits
 * folded into one. A debit line carries the job it charges, so it opens where
 * the spending happened.
 */
export interface CreditStatementRecord extends CreditLedgerRecord {
  jobId: string | null;
  runId: string | null;
  jobType: string | null;
  repoFullName: string | null;
}

/** What an operator hands a workspace, or takes back. */
export interface CreditMovement {
  workspaceOrgId: string;
  /** Whole credits. Positive for a grant; either sign for an adjustment. */
  credits: number;
  actorUserId: string;
  note?: string;
}

/** One flush's spend, charged against the usage row that holds it. */
export interface CreditCharge {
  workspaceOrgId: string;
  /** Whole credits, positive. */
  credits: number;
  usageId: string;
}

/**
 * What a charge left behind. The two crossings are reported ONCE per grant —
 * the store stamps them as it sees them, so a caller that notifies on them
 * never repeats itself until the next grant clears the stamps.
 */
export interface CreditChargeResult {
  balance: number;
  /** The balance first fell below a tenth of the last grant. */
  crossedLow: boolean;
  /** The balance first reached zero. */
  crossedEmpty: boolean;
}

/** One workspace as the operator's page lists it. */
export interface CreditWorkspaceRecord extends CreditBalanceRecord {
  /** Credits debited since `since`. */
  spentRecently: number;
}

export interface CreditsStore {
  /** The workspace's balance; a workspace that was never granted has zero. */
  balance(workspaceOrgId: string): Promise<CreditBalanceRecord>;
  /** Add credits and clear the low-balance stamps: a grant starts the warnings over. */
  grant(movement: CreditMovement): Promise<CreditLedgerRecord>;
  /** A correction, either sign. It is not a grant: the warning stamps stand. */
  adjust(movement: CreditMovement): Promise<CreditLedgerRecord>;
  /** Take one flush's spend off the balance, in one transaction with its ledger row. */
  charge(charge: CreditCharge): Promise<CreditChargeResult>;
  /** The movements themselves, newest first. */
  ledger(workspaceOrgId: string, limit: number): Promise<CreditLedgerRecord[]>;
  /** The statement the Credits tab draws: one line per run, newest first. */
  statement(workspaceOrgId: string, limit: number): Promise<CreditStatementRecord[]>;
  /** Every workspace the credits system knows about, with its recent spend. */
  workspaces(since: string): Promise<CreditWorkspaceRecord[]>;
}

/**
 * The workspace cannot spend: its balance is at or below zero. Thrown BEFORE a
 * call or a turn, so a run overshoots by at most the one call in flight.
 */
export class CreditsExhaustedError extends Error {
  readonly code = 'credits-exhausted';
  constructor(
    readonly workspaceOrgId: string,
    readonly balance: number,
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
      (err as { code?: unknown }).code === 'credits-exhausted')
  );
}

/** Reaching the store before boot installed it is a bug — say so, don't invent. */
const NOT_INSTALLED = 'No credits store installed (boot did not run installDbStores).';

class UninstalledCreditsStore implements CreditsStore {
  private fail(): never {
    throw new Error(NOT_INSTALLED);
  }
  balance(): Promise<CreditBalanceRecord> {
    this.fail();
  }
  grant(): Promise<CreditLedgerRecord> {
    this.fail();
  }
  adjust(): Promise<CreditLedgerRecord> {
    this.fail();
  }
  charge(): Promise<CreditChargeResult> {
    this.fail();
  }
  ledger(): Promise<CreditLedgerRecord[]> {
    this.fail();
  }
  statement(): Promise<CreditStatementRecord[]> {
    this.fail();
  }
  workspaces(): Promise<CreditWorkspaceRecord[]> {
    this.fail();
  }
}

const unavailable = new UninstalledCreditsStore();
let active: CreditsStore = unavailable;

export function setCreditsStore(store: CreditsStore): void {
  active = store;
}

export function resetCreditsStore(): void {
  active = unavailable;
}

/** Whether boot installed the credits store. */
export function creditsStoreInstalled(): boolean {
  return active !== unavailable;
}

export const readCreditBalance = (workspaceOrgId: string): Promise<CreditBalanceRecord> =>
  active.balance(workspaceOrgId);

export const grantCredits = (movement: CreditMovement): Promise<CreditLedgerRecord> =>
  active.grant(movement);

export const adjustCredits = (movement: CreditMovement): Promise<CreditLedgerRecord> =>
  active.adjust(movement);

export const chargeCredits = (charge: CreditCharge): Promise<CreditChargeResult> =>
  active.charge(charge);

export const readCreditLedger = (
  workspaceOrgId: string,
  limit: number,
): Promise<CreditLedgerRecord[]> => active.ledger(workspaceOrgId, limit);

export const readCreditStatement = (
  workspaceOrgId: string,
  limit: number,
): Promise<CreditStatementRecord[]> => active.statement(workspaceOrgId, limit);

export const readCreditWorkspaces = (since: string): Promise<CreditWorkspaceRecord[]> =>
  active.workspaces(since);
