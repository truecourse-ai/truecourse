/**
 * The credits ledger over the real SQL.
 *
 * What is being proved is the arithmetic and the locking: a grant, a debit and
 * a correction each leave ONE append-only row stamped with the balance behind
 * them, concurrent debits add up to the cent however they interleave, the two
 * low-balance crossings are reported once per grant, and the statement folds a
 * run's many debits into one line through the `llm_usage` row each charges.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installCreditsStore, type InstalledCreditsStore } from '../helpers/credits-store';
import type { UsageDelta } from '../../packages/core/src/lib/usage-store';

const ORG = 'org_credits';
const OTHER = 'org_other';
const OPERATOR = 'user_operator';

let installed: InstalledCreditsStore;

beforeEach(async () => {
  installed = await installCreditsStore();
});

afterEach(async () => {
  await installed.close();
});

/** One usage row for a debit to charge, answering the row id. */
function usageRow(over: Partial<UsageDelta> = {}): Promise<string> {
  const at = '2026-03-01T10:00:00.000Z';
  return installed.usage.record({
    workspaceOrgId: ORG,
    repoFullName: 'acme/api',
    jobType: 'repo.guard-generate',
    jobId: 'job_1',
    runId: 'run_1',
    subjectKind: 'stage',
    subject: 'guard.match',
    provider: 'truecourse',
    model: 'gpt-5.6',
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    calls: 1,
    costUsd: 0.25,
    startedAt: at,
    finishedAt: at,
    ...over,
  });
}

describe('PgCreditsStore', () => {
  it('starts every workspace at zero without a row of its own', async () => {
    expect(await installed.store.balance(ORG)).toEqual({
      workspaceOrgId: ORG,
      balance: 0,
      lastGrantCredits: 0,
      lastGrantAt: null,
    });
    expect(await installed.store.ledger(ORG, 10)).toEqual([]);
  });

  it('records a grant, an adjustment and a debit, each stamped with the balance behind it', async () => {
    await installed.store.grant({ workspaceOrgId: ORG, credits: 1000, actorUserId: OPERATOR, note: 'launch' });
    await installed.store.charge({ workspaceOrgId: ORG, credits: 25, usageId: await usageRow() });
    await installed.store.adjust({ workspaceOrgId: ORG, credits: -100, actorUserId: OPERATOR, note: 'fix' });

    const ledger = await installed.store.ledger(ORG, 10);
    expect(ledger.map((row) => [row.kind, row.amount, row.balanceAfter])).toEqual([
      ['adjustment', -100, 875],
      ['debit', -25, 975],
      ['grant', 1000, 1000],
    ]);
    expect(ledger.find((row) => row.kind === 'grant')?.actorUserId).toBe(OPERATOR);
    expect(ledger.find((row) => row.kind === 'grant')?.note).toBe('launch');
    expect(ledger.find((row) => row.kind === 'debit')?.usageId).toBeTruthy();
    expect((await installed.store.balance(ORG)).balance).toBe(875);
  });

  it('keeps the balance exact when many debits land at once', async () => {
    await installed.store.grant({ workspaceOrgId: ORG, credits: 500, actorUserId: OPERATOR });
    const usageId = await usageRow();
    await Promise.all(
      Array.from({ length: 40 }, () =>
        installed.store.charge({ workspaceOrgId: ORG, credits: 3, usageId }),
      ),
    );
    expect((await installed.store.balance(ORG)).balance).toBe(500 - 40 * 3);
    // Every debit left its own row, and no two of them claim the same balance.
    const debits = (await installed.store.ledger(ORG, 100)).filter((row) => row.kind === 'debit');
    expect(debits).toHaveLength(40);
    expect(new Set(debits.map((row) => row.balanceAfter)).size).toBe(40);
  });

  it('reports the low and empty crossings once each, and a grant re-arms them', async () => {
    await installed.store.grant({ workspaceOrgId: ORG, credits: 1000, actorUserId: OPERATOR });
    const usageId = await usageRow();
    const charge = (credits: number) => installed.store.charge({ workspaceOrgId: ORG, credits, usageId });

    expect(await charge(500)).toMatchObject({ balance: 500, crossedLow: false, crossedEmpty: false });
    // A tenth of the last grant is the line: 1000 → 100.
    expect(await charge(410)).toMatchObject({ balance: 90, crossedLow: true, crossedEmpty: false });
    expect(await charge(40)).toMatchObject({ balance: 50, crossedLow: false, crossedEmpty: false });
    expect(await charge(60)).toMatchObject({ balance: -10, crossedLow: false, crossedEmpty: true });
    expect(await charge(10)).toMatchObject({ balance: -20, crossedLow: false, crossedEmpty: false });

    await installed.store.grant({ workspaceOrgId: ORG, credits: 1000, actorUserId: OPERATOR });
    expect((await installed.store.balance(ORG)).balance).toBe(980);
    expect(await charge(900)).toMatchObject({ crossedLow: true });
  });

  it('does not re-arm the warnings on an adjustment — a correction is not a grant', async () => {
    await installed.store.grant({ workspaceOrgId: ORG, credits: 100, actorUserId: OPERATOR });
    const usageId = await usageRow();
    await installed.store.charge({ workspaceOrgId: ORG, credits: 100, usageId });
    await installed.store.adjust({ workspaceOrgId: ORG, credits: 100, actorUserId: OPERATOR });
    const after = await installed.store.balance(ORG);
    expect(after.balance).toBe(100);
    expect(after.lastGrantCredits).toBe(100);
    expect(
      await installed.store.charge({ workspaceOrgId: ORG, credits: 100, usageId }),
    ).toMatchObject({ crossedEmpty: false });
  });

  it('folds a run’s debits into one statement line, carrying the run it belongs to', async () => {
    await installed.store.grant({ workspaceOrgId: ORG, credits: 5000, actorUserId: OPERATOR, note: 'launch' });
    const extract = await usageRow({ subject: 'guard.extract' });
    const match = await usageRow({ subject: 'guard.match' });
    const scan = await usageRow({
      jobId: 'job_2',
      runId: 'run_2',
      jobType: 'context.scan',
      repoFullName: null,
      subject: 'spec.curate',
    });
    for (const usageId of [extract, match, extract, match]) {
      await installed.store.charge({ workspaceOrgId: ORG, credits: 10, usageId });
    }
    await installed.store.charge({ workspaceOrgId: ORG, credits: 7, usageId: scan });

    const statement = await installed.store.statement(ORG, 20);
    expect(statement.map((row) => row.kind)).toEqual(['debit', 'debit', 'grant']);
    const generate = statement.find((row) => row.jobId === 'job_1')!;
    expect(generate).toMatchObject({
      amount: -40,
      runId: 'run_1',
      jobType: 'repo.guard-generate',
      repoFullName: 'acme/api',
    });
    expect(statement.find((row) => row.jobId === 'job_2')).toMatchObject({
      amount: -7,
      runId: 'run_2',
      jobType: 'context.scan',
      repoFullName: null,
    });
    // The line shows where the run left the balance: 5000 − 40 − 7.
    expect(statement.find((row) => row.jobId === 'job_2')?.balanceAfter).toBe(4953);
  });

  it('keeps workspaces apart, and lists every one the operator can grant to', async () => {
    await installed.store.grant({ workspaceOrgId: ORG, credits: 300, actorUserId: OPERATOR });
    await installed.store.grant({ workspaceOrgId: OTHER, credits: 800, actorUserId: OPERATOR });
    await installed.store.charge({ workspaceOrgId: ORG, credits: 50, usageId: await usageRow() });

    expect((await installed.store.balance(ORG)).balance).toBe(250);
    expect((await installed.store.balance(OTHER)).balance).toBe(800);
    expect(await installed.store.ledger(OTHER, 10)).toHaveLength(1);

    const since = '2026-01-01T00:00:00.000Z';
    const workspaces = await installed.store.workspaces(since);
    expect(workspaces.map((row) => row.workspaceOrgId)).toEqual([ORG, OTHER]);
    expect(workspaces.find((row) => row.workspaceOrgId === ORG)).toMatchObject({
      balance: 250,
      lastGrantCredits: 300,
      spentRecently: 50,
    });
    expect(workspaces.find((row) => row.workspaceOrgId === OTHER)?.spentRecently).toBe(0);
  });
});
