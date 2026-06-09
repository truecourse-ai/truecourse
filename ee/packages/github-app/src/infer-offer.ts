/**
 * Phase 3 orchestration: offer + run inference on a PR. Mirrors spec-offer.
 *
 * - On `pull_request` (opened/synchronize/reopened): if the PR touches code,
 *   post/refresh a checkbox comment offering to infer undocumented decisions.
 * - On `issue_comment.edited`: if a writer checked our checkbox, run inference
 *   (clone → infer → persist inferred contracts server-side) and rewrite the comment.
 */

import { log } from '@truecourse/core/lib/logger';
import type { GateStore } from './store/types.js';
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
} from './octokit.js';
import { hasCodeChanges } from './spec-detect.js';
import type { EmailNotifier } from './email.js';
import {
  INFER_MARKER,
  renderInferComment,
  isInferComment,
  isInferCheckboxChecked,
  hasInferOffer,
} from './infer-comment.js';
import {
  PR_OFFER_ACTIONS,
  WRITE_PERMISSIONS,
  isForkPr,
} from './spec-offer.js';
import {
  runInfer,
  type InferPipeline,
  type InferDeps,
  type InferRequest,
  type InferResultSummary,
} from './infer-scan.js';
import { contractsDashboardUrl } from './links.js';
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

/** pull_request opened/synchronize/reopened → offer inference if code changed. */
export async function handlePullRequestInferOffer(
  deps: InferOfferDeps,
  payload: PullRequestPayload,
): Promise<void> {
  if (!PR_OFFER_ACTIONS.includes(payload.action)) return;
  if (!payload.installation) return;
  const repoFullName = payload.repository.full_name;
  const link = await deps.store.getRepo(repoFullName);
  if (!link || !link.enabled) return;

  // Collapse concurrent/redelivered deliveries of the same PR (see spec-offer).
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

    if (existing && !hasInferOffer(existing.body)) return;

    const body = renderInferComment('offered');
    if (existing == null) {
      await createComment(octokit, coords, payload.number, body);
    } else {
      await updateComment(octokit, coords, existing.id, body);
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

    await updateComment(octokit, coords, commentId, renderInferComment('running'));

    const infer = deps.runInfer ?? runInfer;
    const result = await infer(
      { auth: deps.auth, pipeline: deps.pipeline },
      { repoFullName, installationId, headRef: pr.headRef, headSha: pr.headSha, prNumber },
    );
    // Branch on whether any decisions were inferred and stored.
    const body =
      result.decisions.length === 0
        ? renderInferComment('nochange')
        : renderInferComment('done', {
            decisions: result.decisions,
            commitSha: result.commitSha,
            dashboardUrl: await contractsDashboardUrl(deps.appUrl, repoFullName, result.commitSha),
          });
    await updateComment(octokit, coords, commentId, body);

    // Notify only when inference actually captured decisions (mirrors the
    // comment's "done" vs "nochange" branch, so no email on an empty re-run).
    const notifyEmails = link.notifyEmails ?? [];
    if (
      result.decisions.length > 0 &&
      notifyEmails.length > 0 &&
      deps.notifier &&
      wantsNotification(link, 'inferResult')
    ) {
      void deps.notifier.sendInferResult(notifyEmails, {
        repoFullName,
        prNumber,
        prUrl: `https://github.com/${repoFullName}/pull/${prNumber}`,
        decisions: result.decisions,
        commitSha: result.commitSha,
      });
    }
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
