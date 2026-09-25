/**
 * `repo.pr-check` — the head of one pull request's check. It opens the check
 * and decides whether the head's code is checked at all; the checking itself
 * is the repository's own chain (setup → generate → run), carrying the pull
 * request, and that chain's end settles the check (see `../pr-check-chain.ts`).
 *
 * What this job does, in order: fetch the head; find the base (the exact
 * merge-base, and the scenario set, setup bundle and run stored there — with
 * none of them the check settles `no-base`); and, when the repository is a
 * context source and the head changed a document in that source's scope, scan
 * the head's documents into the pull request's corpus, stored under the pull
 * request's scope and never promoted. A conflict the head creates, or one open
 * in the repository's slice, stops the check here, linked to Context's
 * conflicts filtered to the pull request, as an open conflict stops a generate
 * on main. Otherwise the report's first half (the base, the scan, the
 * conflicts) goes on the check's row and the setup is enqueued.
 *
 * A check the balance stopped pauses, and its resume is a new attempt on the
 * same head. A cancelled check is neutral.
 */

import { CURATE_STEPS } from '@truecourse/core/commands/spec-in-process';
import { getWorkspaceDecisions } from '@truecourse/core/commands/spec-in-process';
import { workspaceContextScanInProcess } from '@truecourse/core/commands/context-scan';
import {
  listGuardVersions,
  loadGuardSetupBundle,
  readGuardRunForCommit,
  readManifest,
} from '@truecourse/core/lib/guard-store';
import { contextBindings, listContextDocuments } from '@truecourse/core/lib/context-store';
import { loadWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import { emitRepoLifecycle } from '@truecourse/core/lib/repo-lifecycle';
import { log } from '@truecourse/core/lib/logger';
import { parseContextDocRef } from '@truecourse/core/lib/context-ref';
import { repositoryDocumentsIn, sliceCorpus } from '@truecourse/core/services/context';
import { conflictsCreated } from '@truecourse/core/services/pr-check/compare';
import { createCheck, renderCheckOutput, type OctokitClient } from '@truecourse/github-app';
import {
  isForkPullRequest,
  openConflicts,
  pullRequestWorkspaceScope,
  type CorpusConflict,
  type PullRequestCheckConclusion,
  type PullRequestCheckReason,
  type PullRequestCheckReport,
  type PullRequestStore,
  type RepositorySourceConfig,
  type RepositoryStore,
  CHECK_CONCLUSION_OF_REASON,
} from '@truecourse/shared';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';
import type { JobDefinition, JobOutcomeStatus, JobPayload } from '@truecourse/jobs';
import { repositoryContextSource } from '../../services/context-lifecycle.service.js';
import { workspaceRepositories } from '../../services/context-scan.service.js';
import { startWorkspaceLlm, type WorkspaceLlm } from '../../services/workspace-llm.service.js';
import { createUsageMeter, withCredits, type UsageMeter } from '../../services/usage-meter.service.js';
import { acquireWorkTree } from '../../services/work-tree.service.js';
import { sliceChanged } from '../context-ripple.js';
import { checkLinks, postCheck, settleCheck, type CheckOutcome, type PullRequestCheckPort } from '../pr-check-chain.js';
import { firstLine, pipelineTracker, type OnboardingJobRequest } from './onboarding.js';

export const REPO_PR_CHECK_TASK = 'repo.pr-check';

/** The check's own phases, after the clone. */
export const PR_CHECK_STEPS = [
  { key: 'base', label: 'Finding the base' },
  { key: 'scan', label: 'Scanning changed documents' },
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

/** The stores, the engine and the enqueue the body drives — production wires the real ones. */
export interface RepoPullRequestCheckTaskDeps extends PullRequestCheckPort {
  repos: RepositoryStore;
  /** Start the check's chain: the repository's setup, carrying the pull request. */
  chainGuardSetup?: (request: OnboardingJobRequest) => Promise<{ status: 'queued' | 'busy' }>;
  startLlm?: (orgId: string, meter?: UsageMeter) => Promise<WorkspaceLlm>;
  runScan?: typeof workspaceContextScanInProcess;
}

/** What the job row records about a check it settled, or handed to its chain. */
export interface PullRequestCheckJobResult {
  repoFullName: string;
  number: number;
  checkId: string;
  /** Absent when the chain carries the check on. */
  reason?: PullRequestCheckReason;
  conclusion?: PullRequestCheckConclusion;
}

export function createRepoPullRequestCheckTask(
  deps: RepoPullRequestCheckTaskDeps,
): JobDefinition<PullRequestCheckJobPayload> {
  const startLlm = deps.startLlm ?? startWorkspaceLlm;
  const runScan = deps.runScan ?? workspaceContextScanInProcess;
  /** The check row each job works on: its payload's, or the new attempt a resume made. */
  const checks = new Map<string, string>();

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
      const opened = check;
      const meter = createUsageMeter({ workspaceOrgId, repoFullName, jobType: REPO_PR_CHECK_TASK, jobId: ctx.jobId });
      const fork = isForkPullRequest(pr);
      const workspaceScope = pullRequestWorkspaceScope(repoFullName, number);
      const decide = async (outcome: CheckOutcome, detailsUrl: string | null) => {
        await settleCheck(deps, opened, installationId, outcome, detailsUrl);
        const result: Required<PullRequestCheckJobResult> = {
          repoFullName,
          number,
          checkId: opened.id,
          reason: outcome.reason,
          conclusion: outcome.conclusion ?? CHECK_CONCLUSION_OF_REASON[outcome.reason],
        };
        return { result, notification: notificationFor(result) };
      };

      try {
        await deps.pulls.updateCheck(opened.id, { status: 'running', jobId: ctx.jobId, startedAt: new Date().toISOString() });
        await postCheck(octokit, opened, {
          status: 'in_progress',
          output: { title: 'Checking', summary: `Checking ${headSha.slice(0, 8)} against its base.` },
        });

        // Through the installation the check reads GitHub with, so a
        // repository only a context source reads clones too, and the head is
        // checked out under its own branch name.
        await ctx.phase('clone');
        const tree = await acquireWorkTree(repoFullName, {
          workspaceOrgId,
          installationId,
          commitSha: headSha,
          defaultBranch: pr.headRef,
        });
        try {
          // The base: the exact merge-base, and everything stored there.
          await ctx.phase('base');
          const mergeBase = await resolveMergeBase(octokit, repoFullName, pr.baseRef, headSha);
          const link = await deps.repos.getRepo(repoFullName);
          const connected = link?.enabled === true;
          const base = connected && (await hasStoredBase(repoFullName, mergeBase)) ? mergeBase : null;
          const emptyReport = (parts: Partial<PullRequestCheckReport> = {}): PullRequestCheckReport => ({
            base: { mergeBase, commit: base, nearestWithBase: null },
            fork,
            conflictsCreated: [],
            sectionsMoved: [],
            repositoriesAffected: [],
            run: null,
            specHalf: 'not-a-source',
            codeHalf: 'not-run',
            ...parts,
          });
          await deps.pulls.updateCheck(opened.id, { mergeBaseSha: mergeBase, baseCommitSha: base });
          if (connected && !base) {
            return await decide(
              {
                reason: 'no-base',
                report: emptyReport({
                  base: { mergeBase, commit: null, nearestWithBase: await nearestCommitWithBase(repoFullName) },
                }),
              },
              null,
            );
          }

          // The spec half: the head's documents, when it changed any in scope.
          await ctx.phase('scan');
          const spec = await scanHead({
            octokit,
            tree: tree.dir,
            pr: { repoFullName, number, baseRef: pr.baseRef },
            workspaceOrgId,
            defaultBranch: link?.defaultBranch ?? null,
            run: async (documents, sourceId) => {
              const llm = await startLlm(workspaceOrgId, meter);
              return withCredits(meter, () =>
                runScan({
                  workspaceOrgId,
                  driver: llm.driver(),
                  transportMode: llm.mode,
                  tracker: pipelineTracker(ctx, 'scan', CURATE_STEPS),
                  pullRequest: { repoFullName, number, headSha, checkId: opened.id, scope: workspaceScope, sourceId, documents },
                  ...(ctx.signal ? { signal: ctx.signal } : {}),
                }),
              );
            },
          });
          // A supersede that landed during the scan: nothing more is worth doing.
          if (ctx.signal?.aborted) return { notification: null };

          // The conflicts: created against the workspace, and open in this
          // repository's slice, which stops the code half as it does on main.
          const defaultCorpus = await loadWorkspaceSpec<CuratedCorpus>({ workspaceOrgId }, 'corpus');
          const decisions = await getWorkspaceDecisions(workspaceOrgId);
          const corpus = spec.corpus ?? defaultCorpus;
          const created = spec.corpus ? conflictsCreated(defaultCorpus, openConflicts(spec.corpus, decisions), decisions) : [];
          const sourceIds = await contextBindings(workspaceOrgId, repoFullName);
          const slice = corpus ? sliceCorpus(corpus, sourceIds) : null;
          const sliceOpen = slice ? openConflicts(slice, decisions) : [];
          const repos = await workspaceRepositories(workspaceOrgId);
          const report = emptyReport({
            specHalf: spec.half,
            conflictsCreated: created.map((c) => reportConflict(c, spec.source, spec.documents, repos)),
            repositoriesAffected: spec.corpus
              ? repos
                  .filter((r) => r.repoFullName !== repoFullName && sliceChanged(defaultCorpus, spec.corpus!, r.sourceIds))
                  .map((r) => ({ repoFullName: r.repoFullName, slug: r.repoId }))
              : [],
          });
          const conflictsUrl = checkLinks.conflicts(deps.appUrl, repoFullName, number);
          const specOutcome = (codeHalf: PullRequestCheckReport['codeHalf']): CheckOutcome => ({
            reason: created.length > 0 ? 'conflict' : 'clean',
            report: { ...report, codeHalf },
          });
          if (!connected || !base) return await decide(specOutcome('not-connected'), created.length > 0 ? conflictsUrl : null);
          if (sliceOpen.length > 0) {
            // Open conflicts the pull request did not create still block
            // generation, but are not its failure.
            return await decide(
              created.length > 0
                ? specOutcome('stopped-by-conflict')
                : { reason: 'conflict', conclusion: 'neutral', report: { ...report, codeHalf: 'stopped-by-conflict' } },
              conflictsUrl,
            );
          }

          // The code half is the repository's own chain, carrying the check.
          await deps.pulls.updateCheck(opened.id, { report });
          const started = await deps.chainGuardSetup?.({
            repoId: ctx.payload.repoId,
            repoFullName,
            workspaceOrgId,
            source: 'pull-request',
            commitSha: headSha,
            pullRequest: { number, checkId: opened.id, installationId, headRef: pr.headRef, baseCommit: base, fork },
          });
          if (started?.status !== 'queued') {
            log.warn(`[jobs] ${repoFullName}#${number} at ${headSha.slice(0, 8)} could not start its chain: ${started?.status ?? 'no chain'}`);
            return await decide({ reason: 'error', report }, null);
          }
          const result: PullRequestCheckJobResult = { repoFullName, number, checkId: opened.id };
          return { result, notification: null };
        } finally {
          tree.dispose();
        }
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
      // A check the body did not settle or hand over — a failure that is not
      // the pull request's, a cancel, an empty balance — is settled here with
      // the one word for it, and GitHub's check is moved with it.
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

function notificationFor(result: Required<PullRequestCheckJobResult>) {
  const title = `#${result.number}: ${result.reason.replace(/-/g, ' ')}`;
  return {
    level: result.conclusion === 'failure' ? ('warning' as const) : ('success' as const),
    title,
    data: { repoFullName: result.repoFullName, pullRequest: result.number, checkId: result.checkId },
  };
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

/** Whether everything a check starts from is stored at `commit` in the default scope. */
async function hasStoredBase(repoFullName: string, commit: string): Promise<boolean> {
  const at = { commitSha: commit };
  const [manifest, bundle, run] = await Promise.all([
    readManifest(repoFullName, at),
    loadGuardSetupBundle(repoFullName, at),
    readGuardRunForCommit(repoFullName, commit),
  ]);
  return manifest !== null && bundle !== null && run !== null;
}

/** The newest default-branch commit that has everything a check starts from. */
async function nearestCommitWithBase(repoFullName: string): Promise<string | null> {
  const seen = new Set<string>();
  for (const version of await listGuardVersions(repoFullName, 'scenarios', { limit: 20 })) {
    if (seen.has(version.commitSha)) continue;
    seen.add(version.commitSha);
    if (await hasStoredBase(repoFullName, version.commitSha)) return version.commitSha;
  }
  return null;
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
  pr: { repoFullName: string; number: number; baseRef: string };
  workspaceOrgId: string;
  defaultBranch: string | null;
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

