/**
 * What a pull request's check needs from the chain that carries it. The check
 * is the main chain's own links (setup → generate → run) working the head
 * under the pull request's scope; this module is how a link tells the check it
 * started, how the link that ends the chain settles it, and what the run is
 * compared with.
 *
 * The check's row holds the first half of its report from the moment the
 * coordinator (`repo.pr-check`) hands over: the base, the documents it scanned,
 * the conflicts the head creates. The link that settles merges its own half in.
 * A link whose check is already settled (a newer head superseded it, the pull
 * request closed) does nothing: its row keeps the first word. A link the
 * balance paused leaves its check open, so its resume carries the same check on.
 */

import { log } from '@truecourse/core/lib/logger';
import {
  readGuardRunCoverage,
  readGuardRunForCommit,
  readManifest,
} from '@truecourse/core/lib/guard-store';
import { readGuardRunFlowSummary } from '@truecourse/core/commands/guard-read';
import { compareFlows, sectionsMoved } from '@truecourse/core/services/pr-check/compare';
import { PAUSED_CHECK_OUTPUT, renderCheckOutput, updateCheck, type OctokitClient } from '@truecourse/github-app';
import {
  isWorldBootFailure,
  readGuardFlowsCorpus,
  readManifest as readTreeManifest,
  type RunGuardResult,
} from '@truecourse/guard-runner';
import {
  CHECK_CONCLUSION_OF_REASON,
  type GuardLatest,
  type GuardManifest,
  type GuardRunFlowSummary,
  type PullRequestCheckConclusion,
  type PullRequestCheckReason,
  type PullRequestCheckRecord,
  type PullRequestCheckReport,
  type PullRequestStore,
} from '@truecourse/shared';
import type { PullRequestLink } from './tasks/onboarding.js';

/** What the links reach the check through. */
export interface PullRequestCheckPort {
  pulls: PullRequestStore;
  /** An installation-scoped GitHub client. */
  octokitFor: (installationId: number) => OctokitClient;
  /** Where the product is served, for the check's details link. */
  appUrl: string;
}

/** Where a check's link points: the record of the link it stopped in, or the run it settled on. */
export const checkLinks = {
  record: (appUrl: string, runId: string): string => `${appUrl}/agent/${runId}`,
  run: (appUrl: string, slug: string, guardRunId: string): string =>
    `${appUrl}/repos/${slug}/runs/${encodeURIComponent(guardRunId)}`,
  runs: (appUrl: string, slug: string): string => `${appUrl}/repos/${slug}/runs`,
  conflicts: (appUrl: string, repoFullName: string, number: number): string =>
    `${appUrl}/context/conflicts?pr=${encodeURIComponent(`${repoFullName}#${number}`)}`,
};

/** How a check settles: its reason, the report's half this settle adds, and the run it settled on. */
export interface CheckOutcome {
  reason: PullRequestCheckReason;
  /** Defaults to the reason's conclusion; a conflict only the base had is neutral. */
  conclusion?: PullRequestCheckConclusion;
  report?: Partial<PullRequestCheckReport>;
  guardRunId?: string | null;
}

/** Move GitHub's check, when one was posted. A GitHub that refuses is logged, never the check's failure. */
export async function postCheck(
  octokit: OctokitClient,
  check: PullRequestCheckRecord,
  input: Parameters<typeof updateCheck>[3],
): Promise<void> {
  if (check.githubCheckRunId === null) return;
  try {
    await updateCheck(octokit, check.repoFullName, check.githubCheckRunId, input);
  } catch (err) {
    log.warn(`[jobs] could not update GitHub's check for ${check.repoFullName}#${check.number}: ${(err as Error).message}`);
  }
}

/**
 * A link of the check's chain started: the row names its job (what a
 * supersede stops) and GitHub's check points at it. False when the check is
 * already settled, and the link then does nothing.
 */
export async function linkStarted(
  port: PullRequestCheckPort,
  link: PullRequestLink,
  jobId: string,
  detailsUrl: string,
  what: string,
): Promise<boolean> {
  const check = await port.pulls.getCheck(link.checkId);
  if (!check || check.status === 'settled') return false;
  await port.pulls.updateCheck(check.id, {
    status: 'running',
    jobId,
    ...(check.startedAt ? {} : { startedAt: new Date().toISOString() }),
  });
  await postCheck(port.octokitFor(link.installationId), check, {
    status: 'in_progress',
    detailsUrl,
    output: { title: 'Checking', summary: what },
  });
  return true;
}

/** Whether the check a link works for is still open. */
export async function checkIsOpen(port: PullRequestCheckPort, link: PullRequestLink): Promise<boolean> {
  const check = await port.pulls.getCheck(link.checkId);
  return check !== null && check.status !== 'settled';
}

/**
 * Settle a check with the report's half this settle adds merged over the half
 * its row holds, and move GitHub's check with it. The one transition: a row a
 * webhook settled meanwhile keeps its word, and GitHub is not told twice.
 */
export async function settleCheck(
  port: PullRequestCheckPort,
  check: PullRequestCheckRecord,
  installationId: number,
  outcome: CheckOutcome,
  detailsUrl: string | null,
): Promise<PullRequestCheckRecord | null> {
  const current = (await port.pulls.getCheck(check.id)) ?? check;
  const report = current.report || outcome.report ? ({ ...current.report, ...outcome.report } as PullRequestCheckReport) : null;
  const conclusion = outcome.conclusion ?? CHECK_CONCLUSION_OF_REASON[outcome.reason];
  const settled = await port.pulls.settleCheck(check.id, {
    conclusion,
    reason: outcome.reason,
    ...(report ? { report } : {}),
    ...(outcome.guardRunId ? { guardRunId: outcome.guardRunId } : {}),
  });
  if (!settled) {
    log.info(`[jobs] check ${check.id} of ${check.repoFullName}#${check.number} was settled before it could be: ${outcome.reason} not recorded`);
    return null;
  }
  await postCheck(port.octokitFor(installationId), settled, {
    status: 'completed',
    reason: outcome.reason,
    conclusion,
    ...(detailsUrl ? { detailsUrl } : {}),
    output: renderCheckOutput(outcome.reason, report, detailsUrl),
  });
  return settled;
}

/**
 * The balance paused the job a check waits on. The check stays open: the
 * resumed job carries it on, and a newer head, a close or a draft settles it
 * meanwhile as it settles any open check. GitHub's check says why it waits.
 */
export async function pauseCheck(
  port: PullRequestCheckPort,
  check: PullRequestCheckRecord,
  installationId: number,
  detailsUrl: string | null,
): Promise<void> {
  await postCheck(port.octokitFor(installationId), check, {
    status: 'in_progress',
    ...(detailsUrl ? { detailsUrl } : {}),
    output: PAUSED_CHECK_OUTPUT,
  });
}

/** Mark the check a link works for paused; nothing when its row is gone or settled. */
export async function pauseLinkCheck(
  port: PullRequestCheckPort,
  link: PullRequestLink,
  detailsUrl: string | null,
): Promise<void> {
  try {
    const check = await port.pulls.getCheck(link.checkId);
    if (check && check.status !== 'settled') await pauseCheck(port, check, link.installationId, detailsUrl);
  } catch (err) {
    log.warn(`[jobs] could not mark check ${link.checkId} paused: ${(err as Error).message}`);
  }
}

/** Settle the check a link works for; nothing when its row is gone. */
export async function settleLinkCheck(
  port: PullRequestCheckPort,
  link: PullRequestLink,
  outcome: CheckOutcome,
  detailsUrl: string | null,
): Promise<void> {
  try {
    const check = await port.pulls.getCheck(link.checkId);
    if (check) await settleCheck(port, check, link.installationId, outcome, detailsUrl);
  } catch (err) {
    log.warn(`[jobs] could not settle check ${link.checkId}: ${(err as Error).message}`);
  }
}

/** A run that could not start: the head does not build, seed or boot. */
export function buildFailed(result: Exclude<RunGuardResult, { status: 'ok' }>): boolean {
  return (
    result.status === 'build-failed' ||
    result.status === 'entry-preflight-failed' ||
    result.status === 'seed-failed'
  );
}

/** Every scenario met a world that never came up, and none ran at all. */
export function worldNeverBooted(latest: GuardLatest): boolean {
  if (latest.scenarios.length === 0) return false;
  const ran = latest.scenarios.some((s) => s.outcome === 'pass' || s.outcome === 'fail');
  return !ran && latest.scenarios.some(isWorldBootFailure);
}

/**
 * The head's run compared flow by flow with the base's, and the sections the
 * head's scenario set moved: the run's half of the report and the reason it
 * settles on. A new failure fails the check; else a conflict the head created
 * (already on the row) does; else it is clean.
 */
export async function compareWithBase(input: {
  repoFullName: string;
  link: PullRequestLink;
  treeDir: string;
  latest: GuardLatest;
  headFlows: GuardRunFlowSummary;
  conflictsCreated: number;
}): Promise<CheckOutcome> {
  const { repoFullName, link, treeDir, latest } = input;
  const baseRun = await readGuardRunForCommit(repoFullName, link.baseCommit);
  const baseFlows = baseRun ? await baseFlowSummary(repoFullName, baseRun) : {};
  const deltas = compareFlows(baseFlows, input.headFlows);
  const titles = new Map((readGuardFlowsCorpus(treeDir)?.flows ?? []).map((f) => [f.id, f.title]));
  const of = (kind: (typeof deltas)[number]['kind']) =>
    deltas.filter((d) => d.kind === kind).map((d) => ({ id: d.flowId, title: titles.get(d.flowId) ?? d.flowId }));
  const headManifest = readTreeManifest(treeDir);
  const scenarioIds = scenarioIdsByFlow(headManifest);
  const newFailures = of('new-failure').map((f) => ({ ...f, scenarioIds: scenarioIds.get(f.id) ?? [] }));
  const run: NonNullable<PullRequestCheckReport['run']> = {
    runId: latest.run.runId,
    counts: {
      newFailures: newFailures.length,
      preExisting: of('pre-existing').length,
      fixed: of('fixed').length,
      newlyBlocked: of('newly-blocked').length,
      newlyCovered: of('newly-covered').length,
      added: of('added').length,
      retired: of('retired').length,
    },
    newFailures,
    preExisting: of('pre-existing'),
    fixed: of('fixed'),
    newlyBlocked: of('newly-blocked').map((f) => ({
      ...f,
      why: link.fork ? 'the registered instances are not provided to a fork' : 'could not run at the head',
    })),
    newlyCovered: of('newly-covered'),
  };
  const baseManifest = await readManifest(repoFullName, { commitSha: link.baseCommit });
  const moved = baseManifest
    ? sectionsMoved(baseManifest, headManifest).map((s) => ({
        doc: s.doc,
        anchor: s.anchor,
        flows: s.flowIds.map((id) => ({ id, title: titles.get(id) ?? id })),
      }))
    : [];
  const reason: PullRequestCheckReason =
    newFailures.length > 0 ? 'new-failures' : input.conflictsCreated > 0 ? 'conflict' : 'clean';
  return { reason, report: { sectionsMoved: moved, run, codeHalf: 'ran' }, guardRunId: latest.run.runId };
}

/** The base run's flows as stored beside it, else derived from its snapshot. */
async function baseFlowSummary(repoFullName: string, run: GuardLatest): Promise<GuardRunFlowSummary> {
  const stored = (await readGuardRunCoverage(repoFullName)).find((r) => r.runId === run.run.runId)?.flows;
  if (stored && Object.keys(stored).length > 0) return stored;
  return (await readGuardRunFlowSummary(repoFullName, run)) ?? {};
}

function scenarioIdsByFlow(manifest: GuardManifest | null): Map<string, string[]> {
  return new Map((manifest?.flows ?? []).map((f) => [f.flowId, f.scenarios.map((s) => s.id)]));
}
