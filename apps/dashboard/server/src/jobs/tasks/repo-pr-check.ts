/**
 * `repo.pr-check` — one pull request's check, as one job: the whole pipeline
 * at the head commit, judged against what is stored for the commit the pull
 * request branched from, in one clone, one lane slot and one conversation.
 *
 * The check has two halves. The SPEC half runs when the repository is a
 * context source and the head changed a document in that source's scope: the
 * workspace scan runs once more with that source's documents taken from the
 * head, and what it produces is the pull request's corpus, stored under the
 * pull request's scope and never promoted. The CODE half — setup, generation,
 * the run — executes at the head against that corpus, starting from the base
 * commit's stored setup bundle and scenario set, and every version it writes
 * lands under the pull request's scope too.
 *
 * What the check reports, in this order: the conflicts the head creates
 * against the rest of the workspace, the sections it moved with the flows
 * bound to them, the other repositories the merge would move, and the run
 * compared with the base's — new failures, pre-existing ones, fixed ones. A
 * new failure or a created conflict concludes failure; a head that cannot
 * be brought up (a setup step, the cold proof, the run's world) concludes
 * failure too, since a pull request that breaks the boot is the pull
 * request's failure. Everything that produced no comparison is neutral.
 *
 * Every exit settles the check's row and moves the check posted on GitHub,
 * when one could be posted. A cancelled check is neutral and stores what it
 * had stored; a check the balance stopped pauses, and its resume is a new
 * attempt on the same head.
 */

import { CURATE_STEPS } from '@truecourse/core/commands/spec-in-process';
import { getWorkspaceDecisions } from '@truecourse/core/commands/spec-in-process';
import { workspaceContextScanInProcess } from '@truecourse/core/commands/context-scan';
import { guardSetupInProcess, GUARD_SETUP_STEPS } from '@truecourse/core/commands/guard-setup';
import {
  buildGuardReport,
  guardGenerateInProcess,
  guardRunInProcess,
  GUARD_GENERATE_STEPS,
  GUARD_RUN_STEPS,
} from '@truecourse/core/commands/guard-in-process';
import { readGuardRunFlowSummary, readGuardRunFlowSummaryFromTree } from '@truecourse/core/commands/guard-read';
import {
  listGuardVersions,
  loadGuardSetupBundle,
  readGuardResult,
  readGuardRunCoverage,
  readGuardRunForCommit,
  readManifest,
  saveGuardSetupBundle,
} from '@truecourse/core/lib/guard-store';
import { materializeGuardOverlays } from '@truecourse/core/lib/guard-overlays';
import { contextBindings, listContextDocuments } from '@truecourse/core/lib/context-store';
import { loadWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import { emitRepoLifecycle } from '@truecourse/core/lib/repo-lifecycle';
import { log } from '@truecourse/core/lib/logger';
import { parseContextDocRef } from '@truecourse/core/lib/context-ref';
import { repositoryDocumentsIn, sliceCorpus } from '@truecourse/core/services/context';
import {
  collectGuardSetupBundle,
  materializeGuardSetupBundle,
} from '@truecourse/core/services/guard-setup/bundle';
import { compareFlows, conflictsCreated, sectionsMoved } from '@truecourse/core/services/pr-check/compare';
import { guardVisualJudgeEnabled } from '@truecourse/core/services/llm/guard-visual-judge';
import { createCheck, renderCheckOutput, updateCheck, type OctokitClient } from '@truecourse/github-app';
import {
  isWorldBootFailure,
  readGuardFlowsCorpus,
  readManifest as readTreeManifest,
  runFailureMessage,
  type RunGuardResult,
} from '@truecourse/guard-runner';
import {
  isForkPullRequest,
  openConflicts,
  pullRequestScope,
  pullRequestWorkspaceScope,
  type CorpusConflict,
  type GuardLatest,
  type GuardManifest,
  type GuardRunFlowSummary,
  type PullRequestCheckConclusion,
  type PullRequestCheckReason,
  type PullRequestCheckRecord,
  type PullRequestCheckReport,
  type PullRequestStore,
  type RepositorySourceConfig,
  type RepositoryStore,
  CHECK_CONCLUSION_OF_REASON,
} from '@truecourse/shared';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';
import type { JobDefinition, JobOutcomeStatus, JobPayload } from '@truecourse/jobs';
import { dashboardActivity } from '../../services/dashboard-activity.service.js';
import { repositoryContextSource } from '../../services/context-lifecycle.service.js';
import { workspaceRepositories } from '../../services/context-scan.service.js';
import { startWorkspaceLlm, type WorkspaceLlm } from '../../services/workspace-llm.service.js';
import { createUsageMeter, withCredits, type UsageMeter } from '../../services/usage-meter.service.js';
import { acquireWorkTree } from '../../services/work-tree.service.js';
import { sliceChanged } from '../context-ripple.js';
import { materializeStoredSpec } from '../materialize-spec.js';
import {
  markWorldStateUnknown,
  materializeStoredGuardState,
  persistGeneratedGuard,
  persistGuardRun,
} from '../materialize-guard.js';
import { firstLine, pipelineTracker, type OnboardingJobRequest } from './onboarding.js';

export const REPO_PR_CHECK_TASK = 'repo.pr-check';

/** The check's own phases, after the clone the activity helper puts first. */
export const PR_CHECK_STEPS = [
  { key: 'base', label: 'Finding the base' },
  { key: 'scan', label: 'Scanning changed documents' },
  { key: 'setup', label: 'Setting up' },
  { key: 'generate', label: 'Generating scenarios' },
  { key: 'run', label: 'Running scenarios' },
  { key: 'compare', label: 'Comparing with the base' },
] as const;

export interface PullRequestCheckJobRequest extends OnboardingJobRequest {
  number: number;
  headSha: string;
  /** The `pull_request_checks` row this job settles. */
  checkId: string;
  /** The installation the check reads GitHub through. */
  installationId: number;
}

export type PullRequestCheckJobPayload = PullRequestCheckJobRequest & JobPayload;

/** One check per pull request is active: the single-flight key. */
export const pullRequestCheckJobKey = (repoFullName: string, number: number): string =>
  `${REPO_PR_CHECK_TASK}:${repoFullName}#${number}`;

/** The engines and stores the body drives — production wires the real ones. */
export interface RepoPullRequestCheckTaskDeps {
  pulls: PullRequestStore;
  repos: RepositoryStore;
  /** An installation-scoped GitHub client. */
  octokitFor: (installationId: number) => OctokitClient;
  /** Where the product is served, for the check's details link. */
  appUrl: string;
  startLlm?: (orgId: string, meter?: UsageMeter) => Promise<WorkspaceLlm>;
  runScan?: typeof workspaceContextScanInProcess;
  runSetup?: typeof guardSetupInProcess;
  runGenerate?: typeof guardGenerateInProcess;
  runGuard?: typeof guardRunInProcess;
}

/** What the job row records about a check that settled. */
export interface PullRequestCheckJobResult {
  repoFullName: string;
  number: number;
  checkId: string;
  reason: PullRequestCheckReason;
  conclusion: PullRequestCheckConclusion;
}

/** The base's stored state at the merge-base commit, all four or nothing. */
interface StoredBase {
  commit: string;
  manifest: GuardManifest;
  bundle: Record<string, string>;
  run: GuardLatest;
}

/** A settled outcome the body decided, carrying what the row and the check record. */
class CheckSettled {
  constructor(
    readonly reason: PullRequestCheckReason,
    readonly conclusion: PullRequestCheckConclusion,
    readonly report: PullRequestCheckReport,
    readonly guardRunId: string | null = null,
  ) {}
}

export function createRepoPullRequestCheckTask(
  deps: RepoPullRequestCheckTaskDeps,
): JobDefinition<PullRequestCheckJobPayload> {
  const startLlm = deps.startLlm ?? startWorkspaceLlm;
  const runScan = deps.runScan ?? workspaceContextScanInProcess;
  const runSetup = deps.runSetup ?? guardSetupInProcess;
  const runGenerate = deps.runGenerate ?? guardGenerateInProcess;
  const runGuard = deps.runGuard ?? guardRunInProcess;
  /** The check row each job works on: its payload's, or the new attempt a resume made. */
  const checks = new Map<string, string>();

  /**
   * Settle the row and move GitHub's check; the last word on every exit. A
   * row a webhook settled meanwhile (a newer head superseded this check) is
   * left as it is, and GitHub is not told twice.
   */
  async function settle(
    check: PullRequestCheckRecord,
    octokit: OctokitClient,
    outcome: CheckSettled,
    detailsUrl: string | null,
  ): Promise<PullRequestCheckJobResult> {
    const settled = await deps.pulls.settleCheck(check.id, {
      conclusion: outcome.conclusion,
      reason: outcome.reason,
      report: outcome.report,
      mergeBaseSha: outcome.report.base.mergeBase,
      baseCommitSha: outcome.report.base.commit,
      guardRunId: outcome.guardRunId,
    });
    if (settled) {
      await postCheck(octokit, check, {
        status: 'completed',
        reason: outcome.reason,
        conclusion: outcome.conclusion,
        ...(detailsUrl ? { detailsUrl } : {}),
        output: renderCheckOutput(outcome.reason, outcome.report, detailsUrl),
      });
    } else {
      log.info(`[jobs] check ${check.id} of ${check.repoFullName}#${check.number} was settled before its job could: ${outcome.reason} not recorded`);
    }
    return {
      repoFullName: check.repoFullName,
      number: check.number,
      checkId: check.id,
      reason: outcome.reason,
      conclusion: outcome.conclusion,
    };
  }

  return {
    type: REPO_PR_CHECK_TASK,
    title: 'Checking a pull request',
    steps: [{ key: 'clone', label: 'Cloning the head' }, ...PR_CHECK_STEPS],
    org: (payload) => payload.workspaceOrgId,
    traceMeta: (payload) => ({ repoFullName: payload.repoFullName, commitSha: payload.headSha }),

    async run(ctx) {
      const { repoFullName, number, headSha, installationId, workspaceOrgId } = ctx.payload;
      const pr = await deps.pulls.getPullRequest(repoFullName, number);
      if (!pr) throw new Error(`${repoFullName}#${number} is not a pull request this workspace holds.`);
      const octokit = deps.octokitFor(installationId);
      // A resumed job's row already settled (paused): this run is the next
      // attempt on the same head, with a row and a GitHub check of its own.
      let check = await deps.pulls.getCheck(ctx.payload.checkId);
      if (!check || check.status === 'settled') {
        check = await deps.pulls.createCheck({ repoFullName, number, headSha, jobId: ctx.jobId });
        const githubCheckRunId = await createCheck(octokit, repoFullName, { headSha, externalId: check.id }).catch(
          (err: unknown) => {
            log.warn(`[jobs] could not post a check for ${repoFullName}#${number}: ${(err as Error).message}`);
            return null;
          },
        );
        check = (await deps.pulls.updateCheck(check.id, { githubCheckRunId })) ?? check;
      }
      checks.set(ctx.jobId, check.id);
      const meter = createUsageMeter({
        workspaceOrgId,
        repoFullName,
        jobType: REPO_PR_CHECK_TASK,
        jobId: ctx.jobId,
      });
      const fork = isForkPullRequest(pr);
      const scope = pullRequestScope(number);
      const workspaceScope = pullRequestWorkspaceScope(repoFullName, number);
      let detailsUrl: string | null = null;

      try {
        return await dashboardActivity(
          ctx,
          'pr-check',
          PR_CHECK_STEPS,
          async (activityRun, activityTracker) => {
            meter.setRunId(activityRun.runId);
            // A resume carries this conversation on, on a new attempt.
            ctx.resumeWith({ carryOnRunId: activityRun.runId });
            detailsUrl = `${deps.appUrl}/agent/${activityRun.runId}`;
            await deps.pulls.updateCheck(check.id, {
              status: 'running',
              jobId: ctx.jobId,
              startedAt: new Date().toISOString(),
            });
            await postCheck(octokit, check, {
              status: 'in_progress',
              detailsUrl,
              output: { title: 'Checking', summary: `Checking ${headSha.slice(0, 8)} against its base.` },
            });
            await ctx.notify({
              level: 'started',
              title: `Checking #${number}`,
              data: { repoFullName, runId: activityRun.runId, pullRequest: number },
            });
            const llm = await startLlm(workspaceOrgId, meter);
            const driver = llm.driver();
            const provenance = { producedByRun: activityRun.runId, model: driver.attribution.model };
            const decide = (outcome: CheckSettled): Promise<PullRequestCheckJobResult> =>
              settle(check, octokit, outcome, detailsUrl);

            // Through the installation the check reads GitHub with, so a
            // repository only a context source reads clones too, and the
            // head is checked out under its own branch name.
            await ctx.phase('clone');
            const tree = await acquireWorkTree(repoFullName, {
              workspaceOrgId,
              installationId,
              commitSha: headSha,
              defaultBranch: pr.headRef,
            });
            try {
              activityRun.setGitRef?.(headSha);
              activityTracker.fact('clone', `fetched ${repoFullName}#${number} at ${headSha.slice(0, 8)}`);
              activityTracker.done('clone');

              // The base: the exact merge-base, and everything stored there.
              await ctx.phase('base');
              const mergeBase = await resolveMergeBase(octokit, repoFullName, pr.baseRef, headSha);
              const link = await deps.repos.getRepo(repoFullName);
              const connected = link?.enabled === true;
              const base = connected ? await storedBase(repoFullName, mergeBase) : null;
              activityTracker.fact(
                'base',
                base
                  ? `the base is ${mergeBase.slice(0, 8)}: its scenario set, setup bundle and run are stored`
                  : connected
                    ? `nothing is stored at the merge-base ${mergeBase.slice(0, 8)}`
                    : `the repository is not connected in Code: the documents alone are checked`,
              );
              const emptyReport = (parts: Partial<PullRequestCheckReport> = {}): PullRequestCheckReport => ({
                base: { mergeBase, commit: base?.commit ?? null, nearestWithBase: null },
                fork,
                conflictsCreated: [],
                sectionsMoved: [],
                repositoriesAffected: [],
                run: null,
                specHalf: 'not-a-source',
                codeHalf: 'not-run',
                ...parts,
              });
              if (connected && !base) {
                return decide(
                  new CheckSettled(
                    'no-base',
                    'neutral',
                    emptyReport({
                      base: { mergeBase, commit: null, nearestWithBase: await nearestCommitWithBase(repoFullName) },
                    }),
                  ),
                );
              }
              activityTracker.done('base');

              // The spec half: the head's documents, when it changed any in scope.
              await ctx.phase('scan');
              const spec = await scanHead({
                octokit,
                tree: tree.dir,
                pr: { repoFullName, number, headSha, baseRef: pr.baseRef, checkId: check.id },
                workspaceOrgId,
                defaultBranch: link?.defaultBranch ?? null,
                workspaceScope,
                run: (documents, sourceId) =>
                  withCredits(meter, () =>
                    runScan({
                      workspaceOrgId,
                      driver,
                      transportMode: llm.mode,
                      tracker: pipelineTracker(ctx, 'scan', CURATE_STEPS),
                      pullRequest: {
                        repoFullName,
                        number,
                        headSha,
                        checkId: check.id,
                        scope: workspaceScope,
                        sourceId,
                        documents,
                      },
                      ...(ctx.signal ? { signal: ctx.signal } : {}),
                    }),
                  ),
              });
              activityTracker.fact(
                'scan',
                spec.half === 'ran'
                  ? `${spec.changed} changed document${spec.changed === 1 ? '' : 's'} scanned into the pull request's corpus`
                  : spec.half === 'no-documents-changed'
                    ? 'no document in the source’s scope changed: the workspace corpus stands'
                    : 'the repository is no context source: nothing to scan',
              );
              activityTracker.done('scan');

              // The conflicts: created against the workspace, and open in this
              // repository's slice, which stops the code half as it does on main.
              const defaultCorpus = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId }, 'corpus');
              const decisions = await getWorkspaceDecisions(workspaceOrgId);
              const corpus = spec.corpus ?? defaultCorpus;
              const created = spec.corpus
                ? conflictsCreated(defaultCorpus, openConflicts(spec.corpus, decisions), decisions)
                : [];
              const sourceIds = await contextBindings(workspaceOrgId, repoFullName);
              const slice = corpus ? sliceCorpus(corpus, sourceIds) : null;
              const sliceOpen = slice ? openConflicts(slice, decisions) : [];
              const repos = await workspaceRepositories(workspaceOrgId);
              const report = emptyReport({
                specHalf: spec.half,
                conflictsCreated: created.map((c) =>
                  reportConflict(c, spec.source, spec.documents, repos),
                ),
                repositoriesAffected: spec.corpus
                  ? repos
                      .filter((r) => r.repoFullName !== repoFullName && sliceChanged(defaultCorpus, spec.corpus!, r.sourceIds))
                      .map((r) => ({ repoFullName: r.repoFullName, slug: r.repoId }))
                  : [],
              });
              const conflictOutcome = (codeHalf: PullRequestCheckReport['codeHalf']): CheckSettled =>
                new CheckSettled(
                  created.length > 0 ? 'conflict' : 'clean',
                  created.length > 0 ? 'failure' : 'success',
                  { ...report, codeHalf },
                );
              // A supersede that landed during the scan: nothing more is worth doing.
              if (ctx.signal?.aborted) return { notification: null };
              if (!connected || !base) return decide(conflictOutcome('not-connected'));
              if (sliceOpen.length > 0) {
                activityTracker.fact(
                  'scan',
                  `${sliceOpen.length} open conflict${sliceOpen.length === 1 ? '' : 's'} in the repository's slice: the code is not checked`,
                );
                // Open conflicts the pull request did not create still block
                // generation, but are not its failure.
                return decide(
                  created.length > 0
                    ? conflictOutcome('stopped-by-conflict')
                    : new CheckSettled('conflict', 'neutral', { ...report, codeHalf: 'stopped-by-conflict' }),
                );
              }

              // The code half. The head's corpus, the base's scenario set and
              // bundle go in; every version the engines write comes out under
              // the pull request's scope.
              await ctx.phase('setup');
              const ref = { repoKey: repoFullName, commitSha: headSha, scope };
              await materializeStoredSpec(ref, tree.dir, workspaceOrgId, { scope: workspaceScope });
              await materializeStoredGuardState(repoFullName, tree.dir, { commitSha: base.commit });
              materializeGuardSetupBundle(tree.dir, base.bundle);
              // A fork runs without the registered instances: its code is
              // nobody's yet, and the workspace's secrets stay in the workspace.
              if (!fork) await materializeGuardOverlays(repoFullName, tree.dir);
              markWorldStateUnknown(tree.dir);
              let setupReport: Awaited<ReturnType<typeof runSetup>>['report'];
              try {
                ({ report: setupReport } = await runSetup(tree.dir, {
                  driver,
                  transportMode: llm.mode,
                  sessionsKey: repoFullName,
                  composeKey: `${workspaceOrgId}/${repoFullName}#${number}`,
                  sessionRun: activityRun,
                  eagerRun: true,
                  tracker: pipelineTracker(ctx, 'setup', GUARD_SETUP_STEPS),
                  ...(ctx.signal ? { signal: ctx.signal } : {}),
                }));
              } finally {
                // Whatever setup settled at the head is kept under the pull
                // request's scope, so a rerun on the same head skips it.
                const files = collectGuardSetupBundle(tree.dir);
                if (Object.keys(files).length > 0) await saveGuardSetupBundle(ref, files, provenance);
              }
              if (ctx.signal?.aborted) return { notification: null };
              if (setupReport.status !== 'ok') {
                activityTracker.error('setup', firstLine(setupReport.reason) || 'setup did not complete');
                return decide(new CheckSettled('build-failed', 'failure', { ...report, codeHalf: 'ran' }));
              }
              activityTracker.done('setup');

              await ctx.phase('generate');
              const { guard } = await runGenerate(tree.dir, {
                driver,
                transportMode: llm.mode,
                attribution: driver.attribution,
                sessionsKey: repoFullName,
                sessionRun: activityRun,
                tracker: pipelineTracker(ctx, 'generate', GUARD_GENERATE_STEPS),
                requireExistingRecipe: true,
                ...(ctx.signal ? { signal: ctx.signal } : {}),
              });
              if (ctx.signal?.aborted) return { notification: null };
              meter.assertCredits();
              if (guard.status !== 'ok') throw new Error(guard.reason ?? `guard generate ended ${guard.status}.`);
              await persistGeneratedGuard(ref, tree.dir, buildGuardReport(guard, new Date().toISOString()), provenance);
              activityTracker.done('generate');

              await ctx.phase('run');
              const result = await withCredits(meter, () =>
                runGuard(tree.dir, {
                  tracker: pipelineTracker(ctx, 'run', GUARD_RUN_STEPS),
                  ...(guardVisualJudgeEnabled()
                    ? { judgeDriver: driver, transportMode: llm.mode, sessionsKey: repoFullName }
                    : {}),
                  ...(ctx.signal ? { signal: ctx.signal } : {}),
                }),
              );
              if (ctx.signal?.aborted) return { notification: null };
              if (result.status !== 'ok') {
                if (!buildFailed(result)) throw new Error(runFailureMessage(result));
                activityTracker.error('run', runFailureMessage(result));
                return decide(new CheckSettled('build-failed', 'failure', { ...report, codeHalf: 'ran' }));
              }
              const latest: GuardLatest = {
                ...result.latest,
                run: { ...result.latest.run, pullRequest: number },
              };
              if (worldNeverBooted(latest)) {
                activityTracker.error('run', 'the world never came up at the head');
                return decide(new CheckSettled('build-failed', 'failure', { ...report, codeHalf: 'ran' }));
              }
              const headFlows = readGuardRunFlowSummaryFromTree(tree.dir, latest) ?? {};
              await persistGuardRun(ref, tree.dir, latest, { provenance, coverage: { sections: {}, flows: headFlows } });
              activityTracker.done('run');

              await ctx.phase('compare');
              const baseFlows = await baseFlowSummary(repoFullName, base.run);
              const deltas = compareFlows(baseFlows, headFlows);
              const titles = flowTitles(tree.dir);
              const of = (kind: (typeof deltas)[number]['kind']) =>
                deltas.filter((d) => d.kind === kind).map((d) => ({ id: d.flowId, title: titles.get(d.flowId) ?? d.flowId }));
              const scenarioIds = scenarioIdsByFlow(readTreeManifest(tree.dir));
              const newFailures = of('new-failure').map((f) => ({ ...f, scenarioIds: scenarioIds.get(f.id) ?? [] }));
              const runReport: NonNullable<PullRequestCheckReport['run']> = {
                runId: latest.run.runId,
                counts: {
                  newFailures: newFailures.length,
                  preExisting: of('pre-existing').length,
                  fixed: of('fixed').length,
                  newlyBlocked: of('newly-blocked').length,
                  added: of('added').length,
                  retired: of('retired').length,
                },
                newFailures,
                preExisting: of('pre-existing'),
                fixed: of('fixed'),
                newlyBlocked: of('newly-blocked').map((f) => ({
                  ...f,
                  why: fork ? 'the registered instances are not provided to a fork' : 'could not run at the head',
                })),
              };
              const moved = sectionsMoved(base.manifest, readTreeManifest(tree.dir)).map((s) => ({
                doc: s.doc,
                anchor: s.anchor,
                flows: s.flowIds.map((id) => ({ id, title: titles.get(id) ?? id })),
              }));
              activityTracker.fact(
                'compare',
                `${newFailures.length} new failure${newFailures.length === 1 ? '' : 's'}, ${runReport.counts.preExisting} pre-existing, ${runReport.counts.fixed} fixed`,
              );
              const reason: PullRequestCheckReason =
                newFailures.length > 0 ? 'new-failures' : created.length > 0 ? 'conflict' : 'clean';
              return decide(
                new CheckSettled(
                  reason,
                  CHECK_CONCLUSION_OF_REASON[reason],
                  { ...report, sectionsMoved: moved, run: runReport, codeHalf: 'ran' },
                  latest.run.runId,
                ),
              );
            } finally {
              tree.dispose();
            }
          },
          meter,
          { pullRequest: { repoFullName, number, headSha, checkId: check.id } },
        ).then((result) => ({
          result,
          notification: 'reason' in (result ?? {}) ? notificationFor(result as PullRequestCheckJobResult) : null,
        }));
      } finally {
        await meter.close();
      }
    },

    onError: (err, payload) => ({
      level: 'error',
      title: `Check of #${payload.number} failed`,
      body: firstLine(err.message),
      data: { repoFullName: payload.repoFullName, pullRequest: payload.number },
    }),

    async onSettled(ctx, outcome) {
      const checkId = checks.get(ctx.jobId) ?? ctx.payload.checkId;
      checks.delete(ctx.jobId);
      await emitRepoLifecycle(ctx.payload.workspaceOrgId, ctx.payload.repoFullName, 'guard-run');
      // A check the body did not settle itself — a failure that is not the
      // pull request's, a cancel, an empty balance — is settled here with the
      // one word for it, and GitHub's check is moved with it.
      const reason = unsettledReason(outcome);
      if (!reason) return;
      try {
        const check = await deps.pulls.settleCheck(checkId, {
          conclusion: CHECK_CONCLUSION_OF_REASON[reason],
          reason,
        });
        if (!check) return;
        await postCheck(deps.octokitFor(ctx.payload.installationId), check, {
          status: 'completed',
          reason,
          output: renderCheckOutput(reason, null, null),
        });
      } catch (err) {
        log.warn(`[jobs] could not settle check ${checkId}: ${(err as Error).message}`);
      }
    },
  };
}

/** The reason a job outcome settles a check the body left open, or null when the body settled it. */
function unsettledReason(outcome: JobOutcomeStatus): PullRequestCheckReason | null {
  switch (outcome) {
    case 'succeeded':
      return null;
    case 'failed':
      return 'error';
    case 'cancelled':
      return 'cancelled';
    case 'paused':
      return 'credits';
  }
}

function notificationFor(result: PullRequestCheckJobResult) {
  const title = `#${result.number}: ${result.reason.replace(/-/g, ' ')}`;
  return {
    level: result.conclusion === 'failure' ? ('warning' as const) : ('success' as const),
    title,
    data: { repoFullName: result.repoFullName, pullRequest: result.number, checkId: result.checkId },
  };
}

/** Move GitHub's check, when one was posted. A GitHub that refuses is logged, never the check's failure. */
async function postCheck(
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

async function resolveMergeBase(
  octokit: OctokitClient,
  repoFullName: string,
  baseRef: string,
  headSha: string,
): Promise<string> {
  const [owner, repo] = repoFullName.split('/');
  const { data } = await octokit.repos.compareCommitsWithBasehead({
    owner: owner ?? '',
    repo: repo ?? '',
    basehead: `${baseRef}...${headSha}`,
  });
  return data.merge_base_commit.sha;
}

/** Everything a check starts from, stored at the merge-base in the default scope, or null. */
async function storedBase(repoFullName: string, commit: string): Promise<StoredBase | null> {
  const at = { commitSha: commit };
  const [manifest, bundle, run] = await Promise.all([
    readManifest(repoFullName, at),
    loadGuardSetupBundle(repoFullName, at),
    readGuardRunForCommit(repoFullName, commit),
  ]);
  return manifest && bundle && run ? { commit, manifest, bundle, run } : null;
}

/** The newest default-branch commit that has everything a check starts from. */
async function nearestCommitWithBase(repoFullName: string): Promise<string | null> {
  const seen = new Set<string>();
  for (const version of await listGuardVersions(repoFullName, 'scenarios', { limit: 20 })) {
    if (seen.has(version.commitSha)) continue;
    seen.add(version.commitSha);
    if (await storedBase(repoFullName, version.commitSha)) return version.commitSha;
  }
  return null;
}

/** The base run's flows as stored beside it, else derived from its snapshot. */
async function baseFlowSummary(repoFullName: string, run: GuardLatest): Promise<GuardRunFlowSummary> {
  const stored = (await readGuardRunCoverage(repoFullName)).find((r) => r.runId === run.run.runId)?.flows;
  if (stored && Object.keys(stored).length > 0) return stored;
  return (await readGuardRunFlowSummary(repoFullName, run)) ?? {};
}

/** A run that could not start: the head does not build, seed or boot. */
function buildFailed(result: Exclude<RunGuardResult, { status: 'ok' }>): boolean {
  return (
    result.status === 'build-failed' ||
    result.status === 'entry-preflight-failed' ||
    result.status === 'seed-failed'
  );
}

/** Every scenario met a world that never came up, and none ran at all. */
function worldNeverBooted(latest: GuardLatest): boolean {
  if (latest.scenarios.length === 0) return false;
  const ran = latest.scenarios.some((s) => s.outcome === 'pass' || s.outcome === 'fail');
  return !ran && latest.scenarios.some(isWorldBootFailure);
}

function flowTitles(treeDir: string): Map<string, string> {
  return new Map((readGuardFlowsCorpus(treeDir)?.flows ?? []).map((f) => [f.id, f.title]));
}

function scenarioIdsByFlow(manifest: GuardManifest | null): Map<string, string[]> {
  return new Map((manifest?.flows ?? []).map((f) => [f.flowId, f.scenarios.map((s) => s.id)]));
}

// ---------------------------------------------------------------------------
// The spec half
// ---------------------------------------------------------------------------

interface HeadScan {
  half: PullRequestCheckReport['specHalf'];
  corpus: CuratedCorpus | null;
  /** The source the head's documents replaced, when the scan ran. */
  source: { id: string; config: RepositorySourceConfig } | null;
  /** The head's documents of that source, by path. */
  documents: Map<string, string>;
  changed: number;
}

/**
 * Scan the head when the repository is a context source on the pull request's
 * base branch and the head changed a document in the source's scope. The
 * changed files come from GitHub; a file counts when the head's walk yields
 * it as a document or the workspace's ledger held it as one (a deleted or
 * renamed document is a change too). The documents themselves come from the
 * head clone, walked exactly as a sync walks them.
 */
async function scanHead(input: {
  octokit: OctokitClient;
  tree: string;
  pr: { repoFullName: string; number: number; headSha: string; baseRef: string; checkId: string };
  workspaceOrgId: string;
  defaultBranch: string | null;
  workspaceScope: string;
  run: (
    documents: Array<{ docPath: string; body: string }>,
    sourceId: string,
  ) => Promise<{ corpus: CuratedCorpus }>;
}): Promise<HeadScan> {
  const none: HeadScan = { half: 'not-a-source', corpus: null, source: null, documents: new Map(), changed: 0 };
  const source = await repositoryContextSource(input.workspaceOrgId, input.pr.repoFullName);
  if (!source) return none;
  const config = source.config as RepositorySourceConfig;
  const branch = config.branch || input.defaultBranch || '';
  if (branch !== input.pr.baseRef) return none;

  const documents = repositoryDocumentsIn(input.tree, config);
  const headPaths = new Set(documents.map((d) => d.docPath));
  const ledgerPaths = new Set((await listContextDocuments(input.workspaceOrgId, source.id)).map((d) => d.docPath));
  const [owner, repo] = input.pr.repoFullName.split('/');
  const files = await input.octokit.paginate(input.octokit.pulls.listFiles, {
    owner: owner ?? '',
    repo: repo ?? '',
    pull_number: input.pr.number,
    per_page: 100,
  });
  const changed = files.filter(
    (f) =>
      headPaths.has(f.filename) ||
      ledgerPaths.has(f.filename) ||
      (f.previous_filename !== undefined && ledgerPaths.has(f.previous_filename)),
  ).length;
  const bodies = new Map(documents.map((d) => [d.docPath, d.body]));
  const sourceOf = { id: source.id, config };
  if (changed === 0) return { ...none, half: 'no-documents-changed', source: sourceOf, documents: bodies };

  const { corpus } = await input.run(documents, source.id);
  return { half: 'ran', corpus, source: sourceOf, documents: bodies, changed };
}

/**
 * One created conflict as the report carries it: the doc pair with each
 * side's section anchors — this repository's own document first when one
 * side is one, with its path and its heading's line at the head — and the
 * repositories whose slices read either side.
 */
function reportConflict(
  conflict: CorpusConflict,
  source: HeadScan['source'],
  documents: ReadonlyMap<string, string>,
  repos: readonly { repoFullName: string; sourceIds: string[] }[],
): PullRequestCheckReport['conflictsCreated'][number] {
  const headings = (doc: string): string[] =>
    (conflict.sections ?? []).filter((s) => s.doc === doc && s.heading !== null).map((s) => s.heading!);
  const own = [conflict.a, conflict.b]
    .map((doc) => ({ doc, parsed: parseContextDocRef(doc) }))
    .find(({ parsed }) => parsed !== null && source !== null && parsed.sourceId === source.id);
  const docs: [string, string] =
    own?.doc === conflict.b ? [conflict.b, conflict.a] : [conflict.a, conflict.b];
  const path = own?.parsed?.docPath ?? null;
  const body = path !== null ? documents.get(path) : undefined;
  const heading = own ? headings(own.doc)[0] : undefined;
  const line = body !== undefined && heading !== undefined ? headingLine(body, heading) : null;
  const sourcesOf = new Set(
    [conflict.a, conflict.b].map((doc) => parseContextDocRef(doc)?.sourceId).filter((id): id is string => !!id),
  );
  return {
    docs,
    sections: [headings(docs[0]), headings(docs[1])],
    note: conflict.note,
    path,
    line,
    blocksRepositories: repos.filter((r) => r.sourceIds.some((id) => sourcesOf.has(id))).map((r) => r.repoFullName),
  };
}

/** The 1-based line of a markdown heading in a body, or null when it is not there. */
function headingLine(body: string, heading: string): number | null {
  const wanted = heading.replace(/[`*_~]/g, '').trim().toLowerCase();
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(lines[i] ?? '');
    if (match && match[1]!.replace(/[`*_~]/g, '').trim().toLowerCase() === wanted) return i + 1;
  }
  return null;
}

