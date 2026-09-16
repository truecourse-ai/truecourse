/**
 * CREDITS: what a workspace may spend on TrueCourse's own key, and every
 * movement of it.
 *
 * A credit is one USD CENT of priced model cost. `credit_ledger` is
 * APPEND-ONLY — one row per grant, debit or adjustment, each stamped with the
 * balance it left behind — and `credit_balances` is that balance kept in one
 * row so a check before a call is a single read rather than a sum over the
 * history. The two move in ONE transaction, with the balance row locked for
 * update, which is what keeps concurrent debits exact.
 *
 * A debit names the `llm_usage` row it charges, so a line on the Credits tab
 * and a line on the Usage page are the same money said twice.
 */

import { pgTable, text, timestamp, integer, index } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: text('id').primaryKey(),
    workspaceOrgId: text('workspace_org_id').notNull(),
    /** 'grant' | 'debit' | 'adjustment'. */
    kind: text('kind').notNull(),
    /** Signed credits: a grant is positive, a debit negative. */
    amount: integer('amount').notNull(),
    /** The balance this movement left behind. */
    balanceAfter: integer('balance_after').notNull(),
    /** The operator behind a grant or an adjustment; null for a debit. */
    actorUserId: text('actor_user_id'),
    note: text('note'),
    /** The `llm_usage` row a debit charges; null for a grant or an adjustment. */
    usageId: text('usage_id'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    index('credit_ledger_org_created_idx').on(t.workspaceOrgId, t.createdAt),
    index('credit_ledger_usage_idx').on(t.usageId),
  ],
);

export const creditBalances = pgTable('credit_balances', {
  workspaceOrgId: text('workspace_org_id').primaryKey(),
  balance: integer('balance').notNull().default(0),
  /** The last grant's size: 10% of it is where the low-balance warning sits. */
  lastGrantCredits: integer('last_grant_credits').notNull().default(0),
  lastGrantAt: ts('last_grant_at'),
  /** When the low warning and the empty warning were sent; cleared by the next grant. */
  lowNotifiedAt: ts('low_notified_at'),
  emptyNotifiedAt: ts('empty_notified_at'),
  updatedAt: ts('updated_at').notNull(),
});
