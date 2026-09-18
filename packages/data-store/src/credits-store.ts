/**
 * The hosted half of core's `CreditsStore`: what a workspace may spend on
 * TrueCourse's own key, over `credit_balances` and the append-only
 * `credit_ledger`.
 *
 * EVERY MOVEMENT IS ONE TRANSACTION that begins by locking the workspace's
 * balance row `FOR UPDATE`. Two runs debiting at the same moment therefore
 * serialize on that lock: each reads a balance nobody else can be changing,
 * writes the ledger row stamped with the balance it left behind, and writes the
 * new balance. That is what makes concurrent debits exact, and what lets the
 * ledger be read as arithmetic instead of a reconstruction.
 *
 * The two low-balance CROSSINGS are stamped on the balance row as they happen,
 * inside the same lock, so the caller that notifies on them is told once per
 * grant however many runs are spending at once. A grant clears both stamps: the
 * warnings start over with the money.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  creditBalances,
  creditLedger,
  llmProviderConfig,
  llmUsage,
  repositories,
  type Db,
} from '@truecourse/db';
import type { CreditLedgerKind } from '@truecourse/shared';
import type {
  CreditBalanceRecord,
  CreditCharge,
  CreditChargeResult,
  CreditLedgerRecord,
  CreditMovement,
  CreditStatementRecord,
  CreditWorkspaceRecord,
  CreditsStore,
} from '@truecourse/core/lib/credits-store';
import { iso } from './iso.js';

/** A driver's rendering of a number: an aggregate arrives as a string. */
function num(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

type LedgerRow = typeof creditLedger.$inferSelect;
type BalanceRow = typeof creditBalances.$inferSelect;

function toLedgerRecord(row: LedgerRow): CreditLedgerRecord {
  return {
    id: row.id,
    workspaceOrgId: row.workspaceOrgId,
    kind: row.kind as CreditLedgerKind,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    actorUserId: row.actorUserId,
    note: row.note,
    usageId: row.usageId,
    createdAt: iso(row.createdAt),
  };
}

function toBalanceRecord(workspaceOrgId: string, row: BalanceRow | undefined): CreditBalanceRecord {
  return {
    workspaceOrgId,
    balance: row?.balance ?? 0,
    lastGrantCredits: row?.lastGrantCredits ?? 0,
    lastGrantAt: row?.lastGrantAt ? iso(row.lastGrantAt) : null,
  };
}

/** The share of the last grant below which a workspace is warned it is running out. */
const LOW_BALANCE_SHARE = 0.1;

export class PgCreditsStore implements CreditsStore {
  constructor(private readonly db: Db) {}

  async balance(workspaceOrgId: string): Promise<CreditBalanceRecord> {
    const [row] = await this.db
      .select()
      .from(creditBalances)
      .where(eq(creditBalances.workspaceOrgId, workspaceOrgId))
      .limit(1);
    return toBalanceRecord(workspaceOrgId, row);
  }

  grant(movement: CreditMovement): Promise<CreditLedgerRecord> {
    return this.move(movement, 'grant');
  }

  adjust(movement: CreditMovement): Promise<CreditLedgerRecord> {
    return this.move(movement, 'adjustment');
  }

  /**
   * A grant or an adjustment. A grant also re-bases the low-balance line and
   * clears both warning stamps; an adjustment is a correction and touches
   * neither, so a top-up that is really a fix does not re-arm the warnings.
   */
  private async move(
    movement: CreditMovement,
    kind: 'grant' | 'adjustment',
  ): Promise<CreditLedgerRecord> {
    const now = new Date().toISOString();
    return this.db.transaction(async (tx) => {
      const held = await lockBalance(tx, movement.workspaceOrgId, now);
      const balance = held.balance + movement.credits;
      await tx
        .update(creditBalances)
        .set({
          balance,
          updatedAt: now,
          ...(kind === 'grant'
            ? {
                lastGrantCredits: movement.credits,
                lastGrantAt: now,
                lowNotifiedAt: null,
                emptyNotifiedAt: null,
              }
            : {}),
        })
        .where(eq(creditBalances.workspaceOrgId, movement.workspaceOrgId));
      const [row] = await tx
        .insert(creditLedger)
        .values({
          id: randomUUID(),
          workspaceOrgId: movement.workspaceOrgId,
          kind,
          amount: movement.credits,
          balanceAfter: balance,
          actorUserId: movement.actorUserId,
          note: movement.note ?? null,
          usageId: null,
          createdAt: now,
        })
        .returning();
      return toLedgerRecord(row);
    });
  }

  async charge(charge: CreditCharge): Promise<CreditChargeResult> {
    const now = new Date().toISOString();
    return this.db.transaction(async (tx) => {
      const held = await lockBalance(tx, charge.workspaceOrgId, now);
      const balance = held.balance - charge.credits;
      // The line is a tenth of the last grant. With no grant on record there is
      // no line to cross — only empty, which speaks for itself.
      const low = Math.floor(held.lastGrantCredits * LOW_BALANCE_SHARE);
      const crossedLow =
        held.lastGrantCredits > 0 &&
        held.lowNotifiedAt === null &&
        held.balance > low &&
        balance <= low;
      const crossedEmpty = held.emptyNotifiedAt === null && held.balance > 0 && balance <= 0;
      await tx
        .update(creditBalances)
        .set({
          balance,
          updatedAt: now,
          ...(crossedLow ? { lowNotifiedAt: now } : {}),
          ...(crossedEmpty ? { emptyNotifiedAt: now } : {}),
        })
        .where(eq(creditBalances.workspaceOrgId, charge.workspaceOrgId));
      await tx.insert(creditLedger).values({
        id: randomUUID(),
        workspaceOrgId: charge.workspaceOrgId,
        kind: 'debit',
        amount: -charge.credits,
        balanceAfter: balance,
        actorUserId: null,
        note: null,
        usageId: charge.usageId,
        createdAt: now,
      });
      return { balance, crossedLow, crossedEmpty };
    });
  }

  async ledger(workspaceOrgId: string, limit: number): Promise<CreditLedgerRecord[]> {
    const rows = await this.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.workspaceOrgId, workspaceOrgId))
      .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
      .limit(limit);
    return rows.map(toLedgerRecord);
  }

  /**
   * The statement: grants and adjustments as themselves, and a run's debits
   * folded into ONE line through the `llm_usage` row each charges. A generate
   * makes thousands of calls and hundreds of debits; the tab shows the run.
   */
  async statement(workspaceOrgId: string, limit: number): Promise<CreditStatementRecord[]> {
    const movements = await this.db
      .select()
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.workspaceOrgId, workspaceOrgId),
          inArray(creditLedger.kind, ['grant', 'adjustment']),
        ),
      )
      .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
      .limit(limit);

    // One line per job: the debits added up, and — since a line shows where the
    // run left the balance — the `balance_after` of its NEWEST debit, picked
    // with an ordered aggregate rather than a second read.
    const debits = await this.db
      .select({
        jobId: llmUsage.jobId,
        amount: sql<string>`sum(${creditLedger.amount})`,
        at: sql<string>`max(${creditLedger.createdAt})`,
        balanceAfter: sql<string>`(array_agg(${creditLedger.balanceAfter} order by ${creditLedger.createdAt} desc, ${creditLedger.id} desc))[1]`,
        runId: sql<string | null>`max(${llmUsage.runId})`,
        jobType: sql<string>`min(${llmUsage.jobType})`,
        repoFullName: sql<string | null>`min(${llmUsage.repoFullName})`,
      })
      .from(creditLedger)
      .innerJoin(llmUsage, eq(llmUsage.id, creditLedger.usageId))
      .where(and(eq(creditLedger.workspaceOrgId, workspaceOrgId), eq(creditLedger.kind, 'debit')))
      .groupBy(llmUsage.jobId)
      .orderBy(sql`max(${creditLedger.createdAt}) desc`)
      .limit(limit);

    const lines: CreditStatementRecord[] = [
      ...movements.map((row) => ({
        ...toLedgerRecord(row),
        jobId: null,
        runId: null,
        jobType: null,
        repoFullName: null,
      })),
      // A folded line's identity is the run it belongs to: the ledger rows
      // behind it are many, and the tab opens the run, not a debit.
      ...debits.map((row) => ({
        id: `run:${row.jobId}`,
        workspaceOrgId,
        kind: 'debit' as const,
        amount: num(row.amount),
        balanceAfter: num(row.balanceAfter),
        actorUserId: null,
        note: null,
        usageId: null,
        createdAt: iso(String(row.at)),
        jobId: row.jobId,
        runId: row.runId ?? null,
        jobType: row.jobType,
        repoFullName: row.repoFullName ?? null,
      })),
    ];
    lines.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return lines.slice(0, limit);
  }

  /**
   * Every workspace the operator's page lists: those with a balance, plus those
   * that exist at all (a saved provider, a connected repository) so a workspace
   * that has never been granted is still there to grant to.
   */
  async workspaces(since: string): Promise<CreditWorkspaceRecord[]> {
    const known = new Set<string>();
    const balanced = await this.db.select().from(creditBalances);
    for (const row of balanced) known.add(row.workspaceOrgId);
    for (const row of await this.db
      .selectDistinct({ org: llmProviderConfig.orgId })
      .from(llmProviderConfig)) {
      known.add(row.org);
    }
    for (const row of await this.db
      .selectDistinct({ org: repositories.workspaceOrgId })
      .from(repositories)) {
      known.add(row.org);
    }

    const spent = new Map<string, number>();
    for (const row of await this.db
      .select({
        org: creditLedger.workspaceOrgId,
        amount: sql<string>`sum(${creditLedger.amount})`,
      })
      .from(creditLedger)
      .where(and(eq(creditLedger.kind, 'debit'), gte(creditLedger.createdAt, since)))
      .groupBy(creditLedger.workspaceOrgId)) {
      spent.set(row.org, Math.abs(num(row.amount)));
    }

    const byOrg = new Map(balanced.map((row) => [row.workspaceOrgId, row]));
    return [...known]
      .sort()
      .map((org) => ({
        ...toBalanceRecord(org, byOrg.get(org)),
        spentRecently: spent.get(org) ?? 0,
      }));
  }
}

/** The handle drizzle hands a transaction body — the same query surface as `Db`. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * The workspace's balance row, created if it has none and locked for the rest
 * of the transaction. Every movement starts here, which is the whole of the
 * concurrency story: the lock is the serialization point.
 */
async function lockBalance(
  tx: Tx,
  workspaceOrgId: string,
  now: string,
): Promise<BalanceRow> {
  await tx
    .insert(creditBalances)
    .values({ workspaceOrgId, balance: 0, lastGrantCredits: 0, updatedAt: now })
    .onConflictDoNothing({ target: creditBalances.workspaceOrgId });
  const [row] = await tx
    .select()
    .from(creditBalances)
    .where(eq(creditBalances.workspaceOrgId, workspaceOrgId))
    .for('update');
  if (!row) throw new Error(`No credit balance row for ${workspaceOrgId}`);
  return row;
}
