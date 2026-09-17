/**
 * CREDITS, as the server works them: the balance a run spends from, the two
 * warnings a workspace gets on the way down, and the two ways a paused run is
 * carried on.
 *
 * The ledger itself is the store's (`@truecourse/core/lib/credits-store`). What
 * lives here is everything AROUND a movement — who is told, what is reported,
 * and which paused work a grant sets going again — so the meter that charges
 * holds nothing but the number it checks against.
 *
 * A PAUSED JOB IS A ROW, not a thing held in memory: it settled `paused` with
 * the resume pointer its body declared merged onto its payload, so carrying it
 * on is enqueuing that payload again. Two things do that — an operator's grant,
 * and a workspace saving a key of its own — and a member may do it by hand once
 * either has happened. They all go through {@link resumeWorkspaceJobs}, in the
 * order the jobs paused, so a workspace that stopped four runs starts them
 * again in the order it stopped them.
 */

import {
  adjustCredits,
  chargeCredits,
  grantCredits,
  readCreditBalance,
  readCreditStatement,
  readCreditWorkspaces,
  type CreditStatementRecord,
} from '@truecourse/core/lib/credits-store';
import { log } from '@truecourse/core/lib/logger';
import {
  creditsOfUsd,
  usageJobTypeWord,
  type CreditsStartCheck,
  type NotificationLevel,
  type OperatorCreditsRow,
  type PausedRunView,
} from '@truecourse/shared';
import { currentJobs } from '../jobs/current.js';
import { captureAction, EVENTS } from '../observability/posthog.js';
import type { CreditsAccount } from './usage-meter.service.js';

/** How many statement lines the Credits tab carries. It is a tab, not an archive. */
export const CREDIT_STATEMENT_LIMIT = 100;

/** How far back the operator's page counts a workspace's spend. */
const RECENT_SPEND_DAYS = 30;

/** Where a person goes to put credits back. */
const CREDITS_HREF = '/settings/credits';

/**
 * One notice to a workspace: the durable feed row plus the live push. Installed
 * at boot over the job runner's notification store; with none installed the
 * notice is logged and the movement still stands, because telling somebody is
 * not what makes the money move.
 */
export type CreditsNotifier = (
  org: string,
  notice: {
    level: NotificationLevel;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  },
) => Promise<void>;

let notifier: CreditsNotifier | null = null;

export function setCreditsNotifier(next: CreditsNotifier | null): void {
  notifier = next;
}

async function notify(
  org: string,
  level: NotificationLevel,
  title: string,
  body: string,
): Promise<void> {
  if (!notifier) {
    log.info(`[credits] ${org}: ${title} — ${body}`);
    return;
  }
  try {
    await notifier(org, { level, title, body, data: { href: CREDITS_HREF } });
  } catch (err) {
    log.warn(`[credits] could not tell ${org} "${title}": ${(err as Error).message}`);
  }
}

/**
 * The account a run spends from. The balance is read ONCE, here, and kept in
 * step by the charges themselves — the meter checks a number rather than the
 * database, so the gate before every call costs nothing.
 */
export async function openCreditsAccount(orgId: string): Promise<CreditsAccount> {
  const opening = await readCreditBalance(orgId);
  return {
    workspaceOrgId: orgId,
    balance: opening.balance,
    async charge(credits, usageId) {
      const result = await chargeCredits({ workspaceOrgId: orgId, credits, usageId });
      if (result.crossedLow) {
        await notify(
          orgId,
          'warning',
          'Credits running low',
          `${result.balance} credits left. Ask for more before the next run stops part-way.`,
        );
      }
      if (result.crossedEmpty) {
        captureAction(EVENTS.creditsExhausted, {
          workspaceId: orgId,
          properties: { usageId },
        });
        await notify(
          orgId,
          'warning',
          'Out of credits',
          'Runs are paused until this workspace can spend again.',
        );
      }
      return result.balance;
    },
  };
}

/** The workspace's balance, for the pages that show it beside something else. */
export async function creditsBalance(orgId: string): Promise<number> {
  return (await readCreditBalance(orgId)).balance;
}

/** The statement the Credits tab draws, named in the product's own words. */
export async function creditStatement(orgId: string): Promise<CreditStatementRecord[]> {
  return readCreditStatement(orgId, CREDIT_STATEMENT_LIMIT);
}

/** What this workspace has stopped mid-way, oldest first. */
export async function pausedRuns(orgId: string): Promise<PausedRunView[]> {
  const jobs = currentJobs();
  if (!jobs) return [];
  const paused = await jobs.jobStore.listPaused(orgId);
  return paused.map((job) => ({
    jobId: job.id,
    jobType: job.type,
    title: usageJobTypeWord(job.type),
    repository: (job.payload?.repoFullName as string | undefined) ?? null,
    runId: (job.payload?.resumeRunId as string | undefined) ?? null,
    pausedAt: job.pausedAt ?? '',
  }));
}

/**
 * One workspace's ledger as the operator's page lists it, bar the NAME: who a
 * workspace is belongs to the identity provider, which this service has no
 * client for and no business holding. The route composes the name on top.
 */
export type OperatorCreditsLedgerRow = Omit<OperatorCreditsRow, 'workspaceName'>;

/** Every workspace as the operator's page lists it. */
export async function operatorCredits(): Promise<OperatorCreditsLedgerRow[]> {
  const since = new Date(Date.now() - RECENT_SPEND_DAYS * 86_400_000).toISOString();
  const workspaces = await readCreditWorkspaces(since);
  const jobs = currentJobs();
  const paused = jobs
    ? await jobs.jobStore.pausedCounts(workspaces.map((row) => row.workspaceOrgId))
    : new Map<string, number>();
  return workspaces.map((row) => ({
    workspaceOrgId: row.workspaceOrgId,
    balance: row.balance,
    lastGrantCredits: row.lastGrantCredits,
    lastGrantAt: row.lastGrantAt,
    spent30d: row.spentRecently,
    pausedRuns: paused.get(row.workspaceOrgId) ?? 0,
  }));
}

/** What a grant or an adjustment left behind. */
export interface CreditMovementOutcome {
  balance: number;
  resumed: number;
}

/**
 * An operator hands a workspace credits. The grant re-bases the low-balance
 * line and clears the warnings, tells the workspace, and — unless the operator
 * said not to — carries on everything the workspace had paused.
 */
export async function grantWorkspaceCredits(input: {
  workspaceOrgId: string;
  credits: number;
  actorUserId: string;
  note?: string;
  resumePaused?: boolean;
}): Promise<CreditMovementOutcome> {
  const row = await grantCredits({
    workspaceOrgId: input.workspaceOrgId,
    credits: input.credits,
    actorUserId: input.actorUserId,
    ...(input.note ? { note: input.note } : {}),
  });
  captureAction(EVENTS.creditsGranted, {
    userId: input.actorUserId,
    workspaceId: input.workspaceOrgId,
    properties: { credits: input.credits, balance: row.balanceAfter },
  });
  await notify(
    input.workspaceOrgId,
    'success',
    'Credits granted',
    `${input.credits} credits added. The balance is ${row.balanceAfter}.`,
  );
  const resumed =
    input.resumePaused === false ? 0 : await resumeWorkspaceJobs(input.workspaceOrgId);
  return { balance: row.balanceAfter, resumed };
}

/** A correction, either sign. It is not a grant: the warnings are not re-armed. */
export async function adjustWorkspaceCredits(input: {
  workspaceOrgId: string;
  credits: number;
  actorUserId: string;
  note?: string;
}): Promise<CreditMovementOutcome> {
  const row = await adjustCredits({
    workspaceOrgId: input.workspaceOrgId,
    credits: input.credits,
    actorUserId: input.actorUserId,
    ...(input.note ? { note: input.note } : {}),
  });
  return { balance: row.balanceAfter, resumed: 0 };
}

/**
 * Carry on everything this workspace paused, in the order it paused it. A row
 * that could not be enqueued is left paused and logged: the next grant, or a
 * person, will try it again.
 */
export async function resumeWorkspaceJobs(orgId: string): Promise<number> {
  const jobs = currentJobs();
  if (!jobs) return 0;
  let resumed = 0;
  for (const job of await jobs.jobStore.listPaused(orgId)) {
    try {
      if (await jobs.resumePaused(job)) resumed += 1;
    } catch (err) {
      log.warn(`[credits] could not resume ${job.type} ${job.id}: ${(err as Error).message}`);
    }
  }
  return resumed;
}

/** Carry on ONE paused run, named by its job row. Null when there is no such row. */
export async function resumePausedJob(orgId: string, jobId: string): Promise<string | null> {
  const jobs = currentJobs();
  if (!jobs) return null;
  const job = (await jobs.jobStore.listPaused(orgId)).find((row) => row.id === jobId);
  if (!job) return null;
  return jobs.resumePaused(job);
}

/**
 * Whether a run may start on what this workspace has. At zero there is nothing
 * to spend and the start is refused; below what the run is expected to cost it
 * may still be worth starting — it will simply pause part-way — so the answer
 * asks rather than decides. A workspace on its own key is never gated here.
 *
 * `estimateUsd` is the run's CEILING cost when one could be worked out. The
 * hosted estimate reads a repository's working tree, which a route has not
 * cloned, so it is usually absent — and then the only gate is the empty one,
 * which is the gate that matters.
 */
export async function creditsStartCheck(
  orgId: string,
  estimateUsd?: number,
): Promise<CreditsStartCheck> {
  const { balance } = await readCreditBalance(orgId);
  if (balance <= 0) {
    captureAction(EVENTS.creditsExhausted, { workspaceId: orgId, properties: { atStart: true } });
    const message = 'This workspace is out of credits. Ask for more before starting a run.';
    await notify(orgId, 'warning', 'Out of credits', message);
    return { verdict: 'refused', balance, message };
  }
  if (estimateUsd === undefined || !Number.isFinite(estimateUsd)) return { verdict: 'ok', balance };
  const estimate = creditsOfUsd(estimateUsd);
  if (estimate <= balance) return { verdict: 'ok', balance, estimate };
  return {
    verdict: 'confirm',
    balance,
    estimate,
    message: `This run could cost up to ${estimate} credits and the balance is ${balance}. It will pause part-way if it runs out.`,
  };
}
