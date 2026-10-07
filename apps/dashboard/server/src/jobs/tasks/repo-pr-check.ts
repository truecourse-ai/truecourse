/**
 * `repo.pr-check` — the head of one pull request's check. It opens the check
 * and decides whether the head's code is checked at all; the checking itself
 * is the repository's own chain (setup → generate → run), carrying the pull
 * request, and that chain's end settles the check (see `../pr-check-chain.ts`).
 *
 * What this job does, in order: find the base (the exact merge-base, and the
 * scenario set, setup bundle and run stored there — with none of them the
 * check settles `no-base`); fetch the head; and, when the repository is a
 * context source and the head changed a document in that source's scope, scan
 * the head's documents into the pull request's corpus, stored under the pull
 * request's scope and never promoted. A conflict the head creates, or one open
 * in the repository's slice, stops the check here, linked to Context's
 * conflicts filtered to the pull request, as an open conflict stops a generate
 * on main. Otherwise the report's first half (the base, the scan, the
 * conflicts) goes on the check's row and the setup is enqueued.
 *
 * A check the balance stopped stays open while its job is paused, and the
 * resume carries the same check on. A newer head, a close or a draft settles
 * it meanwhile, as it settles any open check, and the resume then does
 * nothing. A cancelled check is neutral.
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
import { splitRepo, type OctokitClient } from '@truecourse/github-app';
import {
  conflictSides,
  isForkPullRequest,
  openConflicts,
  headingKey,
  parseHeadings,
  pullRequestWorkspaceScope,
  type CorpusConflict,
  type NotificationLevel,
  type ConflictSideLike,
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
import { checkLinks, pauseCheck, postCheck, settleCheck, type CheckOutcome, type PullRequestCheckPort } from '../pr-check-chain.js';
import { firstLine, pipelineTracker, type OnboardingJobRequest } from './onboarding.js';

export const REPO_PR_CHECK_TASK = 'repo.pr-check';

/** The check's own phases. */
export const PR_CHECK_STEPS = [
  { key: 'base', label: 'Finding the base' },
  { key: 'clone', label: 'Cloning the head' },
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

  return {
    type: REPO_PR_CHECK_TASK,
    title: 'Checking a pull request',
    steps: [...PR_CHECK_STEPS],
    org: (payload) => payload.workspaceOrgId,
    traceMeta: (payload) => ({ repoFullName: payload.repoFullName, commitSha: payload.headSha }),

    async run(ctx) {
      const { repoFullName, number, headSha, installationId, workspaceOrgId } = ctx.payload;
      const pr = await deps.pulls.getPullRequest(repoFullName, number);
      if (!pr) throw new Error(`${repoFullName}#${number} is not a pull request this workspace holds.`);
      const link = await deps.repos.getRepo(repoFullName);
      if (!link) throw new Error(`${repoFullName} is no longer connected in Code.`);
      const octokit = deps.octokitFor(installationId);
      // Settled while this job waited (a newer head, a close, a draft, most
      // often during a pause for credits): nothing is left to do.
      const opened = await deps.pulls.getCheck(ctx.payload.checkId);
      if (!opened || opened.status === 'settled') return { notification: null };
      const meter = createUsageMeter({ workspaceOrgId, repoFullName, jobType: REPO_PR_CHECK_TASK, jobId: ctx.jobId });
      const fork = isForkPullRequest(pr);
      const workspaceScope = pullRequestWorkspaceScope(repoFullName, number);
      const decide = async (outcome: CheckOutcome, detailsUrl: string | null) => {
        await settleCheck(deps, opened.id, installationId, outcome, detailsUrl);
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
        // A write refused is a check settled since it was read: nothing to do.
        const running = await deps.pulls.updateCheck(opened.id, {
          status: 'running',
          jobId: ctx.jobId,
          startedAt: opened.startedAt ?? new Date().toISOString(),
        });
        if (!running) return { notification: null };
        await postCheck(octokit, running, {
          status: 'in_progress',
          output: { title: 'Checking', summary: `Checking ${headSha.slice(0, 8)} against its base.` },
        });

        // The base: the exact merge-base, and everything stored there. Found
        // before the clone, which a check with no base never reads.
        await ctx.phase('base');
        const mergeBase = await resolveMergeBase(octokit, repoFullName, pr.baseRef, headSha);
        const base = (await hasStoredBase(repoFullName, mergeBase)) ? mergeBase : null;
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
        if (!base) {
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

        // The head is checked out under its own branch name.
        await ctx.phase('clone');
        const tree = await acquireWorkTree(repoFullName, {
          workspaceOrgId,
          installationId,
          commitSha: headSha,
          defaultBranch: pr.headRef,
        });
        try {
          // The spec half: the head's documents, when it changed any in scope.
          await ctx.phase('scan');
          const spec = await scanHead({
            octokit,
            tree: tree.dir,
            pr: { repoFullName, number, baseRef: pr.baseRef },
            workspaceOrgId,
            defaultBranch: link.defaultBranch ?? null,
            run: async (documents, sourceId) => {
              const llm = await startLlm(workspaceOrgId, meter);
              return withCredits(meter, () =>
                runScan({
                  workspaceOrgId,
                  driver: llm.driver(),
                  transportMode: llm.mode,
                  // On Claude Code the scan reviews the head's documents on
                  // disk and finds conflicts by comparing facts; in API mode it pairs.
                  ...(llm.mode === 'claude-code' ? { computer: true } : {}),
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
            conflictsCreated: created.map((c) => reportConflict(c, spec, repos)),
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
          if (!(await deps.pulls.updateCheck(opened.id, { report }))) return { notification: null };
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
      const { checkId, installationId } = ctx.payload;
      await emitRepoLifecycle(ctx.payload.workspaceOrgId, ctx.payload.repoFullName, 'guard-run');
      try {
        // An empty balance leaves the check open for the resume.
        if (outcome === 'paused') {
          const check = await deps.pulls.getCheck(checkId);
          if (check && check.status !== 'settled') await pauseCheck(deps, check, installationId, null);
          return;
        }
        // A check the body did not settle or hand over — a failure that is
        // not the pull request's, a cancel — is settled here with the one
        // word for it, and GitHub's check is moved with it.
        const reason = unsettledReason(outcome);
        if (reason) await settleCheck(deps, checkId, installationId, { reason }, null);
      } catch (err) {
        log.warn(`[jobs] could not settle check ${checkId}: ${(err as Error).message}`);
      }
    },
  };
}

/** The reason a job outcome settles a check the body left open, or null when the body settled it. */
function unsettledReason(outcome: Exclude<JobOutcomeStatus, 'paused'>): PullRequestCheckReason | null {
  switch (outcome) {
    case 'succeeded':
      return null;
    case 'failed':
      return 'error';
    case 'cancelled':
      return 'cancelled';
  }
}

/** A failure warns, a success is one, and a check that neither passed nor failed is news. */
const NOTIFICATION_LEVEL_OF_CONCLUSION = {
  failure: 'warning',
  success: 'success',
  neutral: 'info',
} as const satisfies Record<PullRequestCheckConclusion, NotificationLevel>;

function notificationFor(result: Required<PullRequestCheckJobResult>) {
  const title = `#${result.number}: ${result.reason.replace(/-/g, ' ')}`;
  return {
    level: NOTIFICATION_LEVEL_OF_CONCLUSION[result.conclusion],
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
  const { data } = await octokit.repos.compareCommitsWithBasehead({
    ...splitRepo(repoFullName),
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
  /** The documents of that source the pull request changed, by path at the head. */
  changed: Set<string>;
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
  const none: HeadScan = { half: 'not-a-source', corpus: null, source: null, documents: new Map(), changed: new Set() };
  const source = await repositoryContextSource(input.workspaceOrgId, input.pr.repoFullName);
  if (!source) return none;
  const config = source.config as RepositorySourceConfig;
  const branch = config.branch || input.defaultBranch || '';
  if (branch !== input.pr.baseRef) return none;

  const documents = repositoryDocumentsIn(input.tree, config);
  const headPaths = new Set(documents.map((d) => d.docPath));
  const ledgerPaths = new Set((await listContextDocuments(input.workspaceOrgId, source.id)).map((d) => d.docPath));
  const files = await input.octokit.paginate(input.octokit.pulls.listFiles, {
    ...splitRepo(input.pr.repoFullName),
    pull_number: input.pr.number,
    per_page: 100,
  });
  const changed = new Set(
    files
      .filter(
        (f) =>
          headPaths.has(f.filename) ||
          ledgerPaths.has(f.filename) ||
          (f.previous_filename !== undefined && ledgerPaths.has(f.previous_filename)),
      )
      .map((f) => f.filename),
  );
  const bodies = new Map(documents.map((d) => [d.docPath, d.body]));
  const sourceOf = { id: source.id, config };
  if (changed.size === 0) return { ...none, half: 'no-documents-changed', source: sourceOf, documents: bodies };

  const { corpus } = await input.run(documents, source.id);
  return { half: 'ran', corpus, source: sourceOf, documents: bodies, changed };
}

/**
 * One created conflict as the report carries it: the doc pair with each
 * side's section anchors — this repository's own document first when one
 * side is one (the one the pull request changed, when both are), with its
 * path and its heading's line at the head, which is where the check's
 * annotation goes — and the repositories whose slices read either side.
 */
function reportConflict(
  conflict: CorpusConflict,
  scan: Pick<HeadScan, 'source' | 'documents' | 'changed'>,
  repos: readonly { repoFullName: string; sourceIds: string[] }[],
): PullRequestCheckReport['conflictsCreated'][number] {
  const { source, documents } = scan;
  const headings = (side: readonly ConflictSideLike[]): string[] =>
    side.flatMap((s) => (s.heading !== null ? [s.heading] : []));
  const [sideA, sideB] = conflictSides(conflict.a, conflict.b, conflict.sections);
  const ownSides = [conflict.a, conflict.b]
    .map((doc) => ({ doc, parsed: parseContextDocRef(doc) }))
    .filter(({ parsed }) => parsed !== null && source !== null && parsed.sourceId === source.id);
  const own = ownSides.find(({ parsed }) => scan.changed.has(parsed!.docPath)) ?? ownSides[0];
  // A conflict inside one doc keeps its sentences in order: there is no other doc to put first.
  const flip = own?.doc === conflict.b && conflict.a !== conflict.b;
  const docs: [string, string] = flip ? [conflict.b, conflict.a] : [conflict.a, conflict.b];
  const sections: [string[], string[]] = flip
    ? [headings(sideB), headings(sideA)]
    : [headings(sideA), headings(sideB)];
  const path = own?.parsed?.docPath ?? null;
  const body = path !== null ? documents.get(path) : undefined;
  const heading = own ? sections[0][0] : undefined;
  const line = body !== undefined && heading !== undefined ? headingLine(body, heading) : null;
  const sourcesOf = new Set(
    [conflict.a, conflict.b].map((doc) => parseContextDocRef(doc)?.sourceId).filter((id): id is string => !!id),
  );
  return {
    docs,
    sections,
    note: conflict.note,
    area: conflict.area,
    path,
    line,
    blocksRepositories: repos.filter((r) => r.sourceIds.some((id) => sourcesOf.has(id))).map((r) => r.repoFullName),
  };
}

/**
 * The 1-based line of a markdown heading in a body, or null when it is not
 * there. Headings are the ones the doc's outline lists, so a `#` comment inside
 * a fenced block is never one.
 */
function headingLine(body: string, heading: string): number | null {
  const key = headingKey(heading);
  const found = parseHeadings(body.split('\n')).find((h) => headingKey(h.text) === key);
  return found ? found.line + 1 : null;
}

