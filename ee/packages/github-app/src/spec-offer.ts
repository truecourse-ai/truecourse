/**
 * Phase 2 orchestration: offer + run the spec scan on a PR.
 *
 * - On `pull_request` (opened/synchronize/reopened): if the PR changes spec
 *   documents, post/refresh a checkbox comment offering to regenerate
 *   contracts.
 * - On `issue_comment.edited`: if a user checked our checkbox, run the scan
 *   (clone → scan → generate → persist server-side) and rewrite the comment
 *   through running → result.
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
import { detectSpecDocChanges } from './spec-detect.js';
import { contractsDashboardUrl } from './links.js';
import type { EmailNotifier } from './email.js';
import { wantsNotification } from './notifications.js';
import {
  SCAN_MARKER,
  renderScanComment,
  isScanComment,
  isScanCheckboxChecked,
  hasScanOffer,
} from './scan-comment.js';

export const PR_OFFER_ACTIONS = ['opened', 'synchronize', 'reopened'];
export const WRITE_PERMISSIONS = ['admin', 'write', 'maintain'];
import {
  runSpecScan,
  type SpecScanPipeline,
  type SpecScanDeps,
  type SpecScanRequest,
  type SpecScanResult,
} from './spec-scan.js';

export interface SpecOfferDeps {
  store: GateStore;
  auth: GithubAuth;
  /** Dashboard base URL, for the "view in dashboard" link in the result comment. */
  appUrl?: string;
  /** Build an installation-scoped REST client (injected for tests). */
  octokitFor: (installationId: number) => OctokitClient;
  /** Optional pipeline override (tests avoid the real LLM scan). */
  pipeline?: SpecScanPipeline;
  /** Scan runner override (tests inject a fake to avoid cloning). */
  runScan?: (
    deps: SpecScanDeps,
    req: SpecScanRequest,
  ) => Promise<SpecScanResult>;
  /**
   * In-process guard against duplicate webhook deliveries / fast re-toggles,
   * keyed by comment id. Single-node dedup; cross-node is out of scope here.
   */
  inFlight?: Set<number>;
  /**
   * In-process guard for the *offer* path, keyed by `${repo}#${pr}#<type>` so
   * concurrent/redelivered PR deliveries don't double-post the offer comment or
   * double-send its email. Mirrors the gate's `gateInFlight`. Shared by scan +
   * infer (distinct type suffixes), so they don't evict each other.
   */
  offerInFlight?: Set<string>;
  /** Email notifier (Resend); set when RESEND_API_KEY is configured. */
  notifier?: EmailNotifier;
}

/** Whether the PR head lives in a different repo (a fork). */
export function isForkPr(
  payload: PullRequestPayload,
  baseFullName: string,
): boolean {
  const headRepo = payload.pull_request.head.repo;
  return !!headRepo && headRepo.full_name !== baseFullName;
}

/** pull_request opened/synchronize/reopened → offer a scan if spec docs changed. */
export async function handlePullRequestSpecOffer(
  deps: SpecOfferDeps,
  payload: PullRequestPayload,
): Promise<void> {
  if (!PR_OFFER_ACTIONS.includes(payload.action)) return;
  if (!payload.installation) return;
  const repoFullName = payload.repository.full_name;
  const link = await deps.store.getRepo(repoFullName);
  if (!link || !link.enabled) return;

  // Collapse concurrent/redelivered deliveries of the same PR: without this, two
  // overlapping deliveries can both observe "no offer yet" and double-post the
  // comment + double-send the email. (Sequential redelivery is already caught by
  // the `existing` check below.)
  const flightKey = `${repoFullName}#${payload.number}#scan`;
  if (deps.offerInFlight?.has(flightKey)) return;
  deps.offerInFlight?.add(flightKey);
  try {
    const coords = splitRepo(repoFullName);
    const octokit = deps.octokitFor(payload.installation.id);

    const specDocs = detectSpecDocChanges(
      await listPrFiles(octokit, coords, payload.number),
    );
    if (specDocs.length === 0) return; // nothing to offer

    const existing = await findComment(octokit, coords, payload.number, SCAN_MARKER);

    // Fork PRs can't be auto-committed; post a one-time explanatory comment.
    if (isForkPr(payload, repoFullName)) {
      const forkBody = renderScanComment('fork');
      if (existing == null) {
        await createComment(octokit, coords, payload.number, forkBody);
      }
      return;
    }

    // Don't clobber a running/finished comment — only (re)offer when there's no
    // comment yet or the existing one is still an actionable offer.
    if (existing && !hasScanOffer(existing.body)) return;

    const body = renderScanComment('offered', { specDocs });
    if (existing == null) {
      await createComment(octokit, coords, payload.number, body);
      // Notify once, when the offer first appears — not on every later refresh.
      const notifyEmails = link.notifyEmails ?? [];
      if (notifyEmails.length > 0 && deps.notifier && wantsNotification(link, 'scanOffer')) {
        void deps.notifier.sendScanOffer(notifyEmails, {
          repoFullName,
          prNumber: payload.number,
          prUrl: `https://github.com/${repoFullName}/pull/${payload.number}`,
          specDocs,
        });
      }
    } else {
      await updateComment(octokit, coords, existing.id, body);
    }
  } finally {
    deps.offerInFlight?.delete(flightKey);
  }
}

/** issue_comment.edited → if our checkbox was checked, run the scan. */
export async function handleCommentEditedScan(
  deps: SpecOfferDeps,
  payload: IssueCommentPayload,
): Promise<void> {
  if (payload.action !== 'edited') return;
  if (!payload.issue.pull_request) return; // PR comments only
  if (!payload.installation) return;
  // Only act on OUR comment (marker), authored by the App bot, with the box checked.
  if (payload.comment.user?.type !== 'Bot') return;
  if (!isScanComment(payload.comment.body)) return;
  if (!isScanCheckboxChecked(payload.comment.body)) return;

  const repoFullName = payload.repository.full_name;
  const link = await deps.store.getRepo(repoFullName);
  if (!link || !link.enabled) return;

  const coords = splitRepo(repoFullName);
  const octokit = deps.octokitFor(payload.installation.id);
  const commentId = payload.comment.id;
  const prNumber = payload.issue.number;
  const installationId = payload.installation.id;

  // Authorize the EDITOR, not the comment author. GitHub already restricts
  // checkbox toggles on a bot comment to write+ users; this enforces it
  // explicitly (defense in depth — never trust comment.user as authorization).
  const perm = await getActorPermission(
    octokit,
    coords,
    payload.sender?.login ?? '',
  );
  if (!WRITE_PERMISSIONS.includes(perm)) {
    log.warn(
      `[github-app] ignoring scan trigger from non-writer ${payload.sender?.login ?? '?'} on ${repoFullName}`,
    );
    return;
  }

  // In-flight guard: drop duplicate deliveries / fast re-toggles for this comment.
  if (deps.inFlight?.has(commentId)) return;
  deps.inFlight?.add(commentId);
  try {
    const pr = await getPullRequest(octokit, coords, prNumber);

    // Fork PR: the installation token can't push to the fork's branch.
    if (pr.headRepoFullName && pr.headRepoFullName !== repoFullName) {
      await updateComment(octokit, coords, commentId, renderScanComment('fork'));
      return;
    }

    // Flip to "running" — removes the checkbox so it can't re-trigger.
    await updateComment(octokit, coords, commentId, renderScanComment('running'));

    const scan = deps.runScan ?? runSpecScan;
    const result = await scan(
      { auth: deps.auth, pipeline: deps.pipeline },
      { repoFullName, installationId, headRef: pr.headRef, headSha: pr.headSha, prNumber },
    );
    const body =
      result.savedFileCount === 0
        ? renderScanComment('nochange')
        : renderScanComment('done', {
            savedFileCount: result.savedFileCount,
            commitSha: result.commitSha,
            openConflicts: result.openConflicts,
            dashboardUrl: await contractsDashboardUrl(deps.appUrl, repoFullName, result.commitSha),
          });
    await updateComment(octokit, coords, commentId, body);
  } catch (err) {
    log.error(
      `[github-app] spec scan failed for ${repoFullName} PR#${prNumber}: ${(err as Error).message}`,
    );
    await updateComment(
      octokit,
      coords,
      commentId,
      renderScanComment('error', { error: (err as Error).message }),
    );
  } finally {
    deps.inFlight?.delete(commentId);
  }
}
