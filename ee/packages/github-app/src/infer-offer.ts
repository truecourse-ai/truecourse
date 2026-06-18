/**
 * Phase 3 orchestration: offer + run inference on a PR.
 *
 * - On `pull_request` (opened/synchronize/reopened): if the PR touches code,
 *   post/refresh a checkbox comment offering to infer undocumented decisions.
 * - On `issue_comment.edited`: if a writer checked our checkbox, run inference
 *   (clone → infer → persist inferred contracts server-side) and rewrite the comment.
 */

import { log } from '@truecourse/core/lib/logger';
import type { GateStore, RepoLinkRecord } from './store/types.js';
import type { GithubAuth } from './github.js';
import type { PullRequestPayload, IssueCommentPayload } from './webhook.js';
import {
  splitRepo,
  listPrFiles,
  findComment,
  createComment,
  updateComment,
  getPullRequest,
  getActorPermission,
  type OctokitClient,
  type RepoCoords,
} from './octokit.js';
import { hasCodeChanges } from './spec-detect.js';
import type { EmailNotifier } from './email.js';
import {
  INFER_MARKER,
  renderInferComment,
  isInferComment,
  isInferCheckboxChecked,
} from './infer-comment.js';
import {
  PR_OFFER_ACTIONS,
  WRITE_PERMISSIONS,
  isForkPr,
} from './pr-events.js';
import {
  runInfer,
  type InferPipeline,
  type InferDeps,
  type InferRequest,
  type InferResultSummary,
} from './infer-scan.js';
import { contractsDashboardUrl } from './links.js';
import { diffDecisions, applyInferredActions, readInferredDecisionsAt } from '@truecourse/core/lib/inferred-decisions';
import { listInferredActions } from '@truecourse/core/lib/inferred-action-store';
import { wantsNotification } from './notifications.js';

export interface InferOfferDeps {
  store: GateStore;
  auth: GithubAuth;
  /** Dashboard base URL, for the "view in dashboard" link in the result comment. */
  appUrl?: string;
  octokitFor: (installationId: number) => OctokitClient;
  pipeline?: InferPipeline;
  runInfer?: (deps: InferDeps, req: InferRequest) => Promise<InferResultSummary>;
  /** Shared in-flight guard for the comment-edited run (keyed by comment id). */
  inFlight?: Set<number>;
  /**
   * In-process guard for the *offer* path, keyed by `${repo}#${pr}#<type>` so
   * concurrent/redelivered PR deliveries don't double-post the offer comment.
   * Shared with the scan offer (distinct type suffixes). Mirrors the gate.
   */
  offerInFlight?: Set<string>;
  /** Email notifier (Resend); set when RESEND_API_KEY is configured. */
  notifier?: EmailNotifier;
}

/**
 * Run inference for a PR head, diff it against the default-branch baseline, and
 * report on `commentId` (running → done/nochange) + the `inferResult` email.
 * Shared by the checkbox trigger and the auto-run path. Throws on failure — the
 * caller renders the `error` comment.
 */
async function runInferReport(
  deps: InferOfferDeps,
  args: {
    octokit: OctokitClient;
    coords: RepoCoords;
    repoFullName: string;
    prNumber: number;
    installationId: number;
    headRef: string;
    headSha: string;
    commentId: number;
    link: RepoLinkRecord;
  },
): Promise<void> {
  const { octokit, coords, repoFullName, prNumber, installationId, headRef, headSha, commentId, link } =
    args;

  await updateComment(octokit, coords, commentId, renderInferComment('running'));

  // The default-branch baseline both supplies coverage for a warm-path PR head (one
  // that stored no contracts of its own) and is the diff base below — fetch it once.
  const baseline = await deps.store.getBaseline(repoFullName);

  const infer = deps.runInfer ?? runInfer;
  const result = await infer(
    { auth: deps.auth, pipeline: deps.pipeline },
    {
      repoFullName,
      installationId,
      headRef,
      headSha,
      prNumber,
      contractsRef: baseline
        ? { repoKey: repoFullName, commitSha: baseline.commitSha }
        : undefined,
    },
  );
  // Diff the head's inferred decisions against the default-branch baseline so the
  // comment shows only what the PR newly leaves undocumented (and what it
  // resolved). Both sides come from the shared spec-store source, overlay-filtered;
  // no baseline-inferred set yet ⇒ fall back to the full head set.
  const headDecisions = applyInferredActions(
    result.decisions,
    await listInferredActions(repoFullName),
  );
  const baselineDecisions = baseline
    ? await readInferredDecisionsAt({ repoKey: repoFullName, commitSha: baseline.commitSha })
    : null;
  const { added, resolved, fellBack } = diffDecisions(headDecisions, baselineDecisions);
  const body =
    added.length === 0
      ? renderInferComment('nochange')
      : renderInferComment('done', {
          added,
          resolved,
          fellBack,
          commitSha: result.commitSha,
          dashboardUrl: await contractsDashboardUrl(deps.appUrl, repoFullName, prNumber),
        });
  await updateComment(octokit, coords, commentId, body);

  // Notify only when the PR captured NEW decisions (mirrors the comment's
  // "done" vs "nochange" branch — no email on a no-new-decisions run).
  const notifyEmails = link.notifyEmails ?? [];
  if (
    added.length > 0 &&
    notifyEmails.length > 0 &&
    deps.notifier &&
    wantsNotification(link, 'inferResult')
  ) {
    void deps.notifier.sendInferResult(notifyEmails, {
      repoFullName,
      prNumber,
      prUrl: `https://github.com/${repoFullName}/pull/${prNumber}`,
      decisions: added,
      commitSha: result.commitSha,
    });
  }
}

/** pull_request opened/synchronize/reopened → auto-run inference if code changed. */
export async function handlePullRequestInferOffer(
  deps: InferOfferDeps,
  payload: PullRequestPayload,
): Promise<void> {
  if (!PR_OFFER_ACTIONS.includes(payload.action)) return;
  if (!payload.installation) return;
  const repoFullName = payload.repository.full_name;
  const link = await deps.store.getRepo(repoFullName);
  if (!link || !link.enabled) return;

  // Collapse concurrent/redelivered deliveries of the same PR.
  const flightKey = `${repoFullName}#${payload.number}#infer`;
  if (deps.offerInFlight?.has(flightKey)) return;
  deps.offerInFlight?.add(flightKey);
  try {
    const coords = splitRepo(repoFullName);
    const octokit = deps.octokitFor(payload.installation.id);

    if (!hasCodeChanges(await listPrFiles(octokit, coords, payload.number))) return;

    const existing = await findComment(octokit, coords, payload.number, INFER_MARKER);

    if (isForkPr(payload, repoFullName)) {
      if (existing == null) {
        await createComment(octokit, coords, payload.number, renderInferComment('fork'));
      }
      return;
    }

    // Run inference automatically on every PR event (no checkbox) — the same
    // cadence as the verify/code-quality gates. Reuses the existing comment as the
    // running → result surface, or creates one. `offerInFlight` collapses
    // concurrent redeliveries.
    const { sha: headSha, ref: headRef } = payload.pull_request.head;
    const commentId =
      existing != null
        ? existing.id
        : await createComment(octokit, coords, payload.number, renderInferComment('running'));
    try {
      await runInferReport(deps, {
        octokit,
        coords,
        repoFullName,
        prNumber: payload.number,
        installationId: payload.installation.id,
        headRef,
        headSha,
        commentId,
        link,
      });
    } catch (err) {
      log.error(
        `[github-app] auto-infer failed for ${repoFullName} PR#${payload.number}: ${(err as Error).message}`,
      );
      await updateComment(
        octokit,
        coords,
        commentId,
        renderInferComment('error', { error: (err as Error).message }),
      );
    }
  } finally {
    deps.offerInFlight?.delete(flightKey);
  }
}

/** issue_comment.edited → if our infer checkbox was checked, run inference. */
export async function handleCommentEditedInfer(
  deps: InferOfferDeps,
  payload: IssueCommentPayload,
): Promise<void> {
  if (payload.action !== 'edited') return;
  if (!payload.issue.pull_request) return;
  if (!payload.installation) return;
  if (payload.comment.user?.type !== 'Bot') return;
  if (!isInferComment(payload.comment.body)) return;
  if (!isInferCheckboxChecked(payload.comment.body)) return;

  const repoFullName = payload.repository.full_name;
  const link = await deps.store.getRepo(repoFullName);
  if (!link || !link.enabled) return;

  const coords = splitRepo(repoFullName);
  const octokit = deps.octokitFor(payload.installation.id);
  const commentId = payload.comment.id;
  const prNumber = payload.issue.number;
  const installationId = payload.installation.id;

  const perm = await getActorPermission(octokit, coords, payload.sender?.login ?? '');
  if (!WRITE_PERMISSIONS.includes(perm)) {
    log.warn(
      `[github-app] ignoring infer trigger from non-writer ${payload.sender?.login ?? '?'} on ${repoFullName}`,
    );
    return;
  }

  if (deps.inFlight?.has(commentId)) return;
  deps.inFlight?.add(commentId);
  try {
    const pr = await getPullRequest(octokit, coords, prNumber);
    if (pr.headRepoFullName && pr.headRepoFullName !== repoFullName) {
      await updateComment(octokit, coords, commentId, renderInferComment('fork'));
      return;
    }

    await runInferReport(deps, {
      octokit,
      coords,
      repoFullName,
      prNumber,
      installationId,
      headRef: pr.headRef,
      headSha: pr.headSha,
      commentId,
      link,
    });
  } catch (err) {
    log.error(
      `[github-app] infer failed for ${repoFullName} PR#${prNumber}: ${(err as Error).message}`,
    );
    await updateComment(
      octokit,
      coords,
      commentId,
      renderInferComment('error', { error: (err as Error).message }),
    );
  } finally {
    deps.inFlight?.delete(commentId);
  }
}
