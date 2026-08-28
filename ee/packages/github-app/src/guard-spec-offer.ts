/**
 * The spec-change guard checkbox: a PR that edits spec documents gets a checkbox
 * offer to regenerate the PR head's guard scenarios server-side.
 *
 * - On `pull_request` (opened/synchronize/reopened): if the PR changed any spec
 *   docs (honoring the repo's `spec.include` scope), post/refresh a passive
 *   checkbox comment. It never auto-runs — the auto guard gate already runs the
 *   baseline corpus; this is the opt-in "regenerate for my new specs" action.
 * - On `issue_comment.edited`: if a writer ticked our checkbox, enqueue the
 *   durable `guard.spec-regen` job (clone head → generate → persist under the head
 *   → re-gate) and mark the comment running; the job settles it to done/error.
 */

import { log } from '@truecourse/core/lib/logger';
import {
  type GateStore,
  type PullRequestPayload,
  type IssueCommentPayload,
  splitRepo,
  listPrFiles,
  getFileContent,
  findComment,
  createComment,
  updateComment,
  getPullRequest,
  getActorPermission,
  type OctokitClient,
  wantsNotification,
} from '@truecourse/github-app';
import { detectSpecDocChanges, specScopeFromConfigJson } from './spec-detect.js';
import type { EmailNotifier } from './email.js';
import { PR_TRIGGER_ACTIONS, WRITE_PERMISSIONS } from './pr-events.js';
import {
  GUARD_SPEC_MARKER,
  renderGuardSpecComment,
  isGuardSpecComment,
  isGuardSpecCheckboxChecked,
} from './guard-spec-comment.js';

/** What the checkbox tick hands to the durable regen+re-gate job. */
export interface GuardSpecRegenRequest {
  repoFullName: string;
  installationId: number;
  /** The repo's workspace org — scopes the job + its notifications. */
  workspaceOrgId: string;
  prNumber: number;
  /** The repo default branch (the guard baseline is only valid for this base). */
  defaultBranch: string;
  /** The PR's base branch + head commit (the re-gate clones the base, diffs vs it). */
  baseBranch: string;
  baseSha: string;
  /** The PR head to regenerate scenarios for (fetched via the pull ref). */
  headRef: string;
  headSha: string;
  /** Head lives in a different repo — the regen fetches the base's pull ref. */
  isFork: boolean;
  /** The checkbox comment the job updates to done/error when it settles — null
   *  for a dashboard-triggered regen (a PR dismissal cleared the last active
   *  finding; there is no comment to settle). */
  commentId: number | null;
}

/**
 * Enqueue a guard spec-regen run onto the background job queue. Returns the job
 * id, or null when a regen is already running for that head. Supplied by
 * ee-server; the registration fallback runs it inline so unit tests need no queue.
 */
export type EnqueueGuardSpecRegen = (req: GuardSpecRegenRequest) => Promise<string | null>;

/**
 * Assemble the spec-regen request from the stored repo link + the LIVE pull
 * request — the ONE place the base-branch fallback and fork detection live, so
 * the checkbox trigger and the dashboard's last-PR-dismissal trigger
 * (`createGuardPrRegenEnqueue`) can never drift apart.
 */
export function buildGuardSpecRegenRequest(args: {
  repoFullName: string;
  link: { installationId: number; workspaceOrgId: string; defaultBranch: string };
  prNumber: number;
  /** The live PR, as `getPullRequest` returns it. */
  pr: {
    baseRef: string;
    baseSha: string;
    headRef: string;
    headSha: string;
    headRepoFullName: string | null;
  };
  /** The checkbox comment to settle, or null for a dashboard-triggered regen. */
  commentId: number | null;
}): GuardSpecRegenRequest {
  const { repoFullName, link, prNumber, pr, commentId } = args;
  return {
    repoFullName,
    installationId: link.installationId,
    workspaceOrgId: link.workspaceOrgId,
    prNumber,
    defaultBranch: link.defaultBranch,
    baseBranch: pr.baseRef || link.defaultBranch,
    baseSha: pr.baseSha,
    headRef: pr.headRef,
    headSha: pr.headSha,
    isFork: !!pr.headRepoFullName && pr.headRepoFullName !== repoFullName,
    commentId,
  };
}

export interface GuardSpecOfferDeps {
  store: GateStore;
  octokitFor: (installationId: number) => OctokitClient;
  enqueueGuardSpecRegen: EnqueueGuardSpecRegen;
  /** Emails the notify list a pointer to a FIRST offer (absent = never email). */
  notifier?: EmailNotifier;
  /** Offer-path collapse, keyed `${repo}#${pr}#guard-spec` (concurrent deliveries). */
  offerInFlight?: Set<string>;
  /** Checkbox-path collapse, keyed by comment id (concurrent edits). */
  inFlight?: Set<number>;
}

/**
 * pull_request opened/synchronize/reopened → if the PR changed spec docs, post or
 * refresh the checkbox OFFER (passive: it does not run anything until ticked).
 */
export async function handlePullRequestGuardSpecOffer(
  deps: GuardSpecOfferDeps,
  payload: PullRequestPayload,
): Promise<void> {
  if (!PR_TRIGGER_ACTIONS.includes(payload.action)) return;
  if (!payload.installation) return;
  const repoFullName = payload.repository.full_name;
  const link = await deps.store.getRepo(repoFullName);
  if (!link || !link.enabled) return;

  const flightKey = `${repoFullName}#${payload.number}#guard-spec`;
  if (deps.offerInFlight?.has(flightKey)) return;
  deps.offerInFlight?.add(flightKey);
  try {
    const coords = splitRepo(repoFullName);
    const octokit = deps.octokitFor(payload.installation.id);
    const baseBranch = payload.pull_request.base.ref || link.defaultBranch;

    // Honor the repo's `spec.include` scope (committed on the base branch) so a PR
    // touching only out-of-scope markdown isn't treated as a spec change. A
    // missing/unreadable config → scan everything (detection runs before any clone).
    const scope = specScopeFromConfigJson(
      await getFileContent(octokit, coords, '.truecourse/config.json', baseBranch),
    );
    const changed = detectSpecDocChanges(await listPrFiles(octokit, coords, payload.number), scope);
    if (changed.length === 0) return;

    // Re-arm the offer for the current head (unticked) on each spec-changing event.
    const body = renderGuardSpecComment('offered', { specDocs: changed });
    const existing = await findComment(octokit, coords, payload.number, GUARD_SPEC_MARKER);
    if (existing) {
      await updateComment(octokit, coords, existing.id, body);
    } else {
      const commentId = await createComment(octokit, coords, payload.number, body);
      // Email the notify list a pointer to the offer — FIRST offer per PR only
      // (re-arms are already known to the recipients). Best-effort: gated on the
      // repo's specRegen pref, fire-and-forget, never fails the offer.
      const notifyEmails = link.notifyEmails ?? [];
      if (deps.notifier && notifyEmails.length > 0 && wantsNotification(link, 'specRegen')) {
        void deps.notifier
          .sendGuardSpecRegenOffer(notifyEmails, {
            repoFullName,
            prNumber: payload.number,
            commentUrl: `https://github.com/${repoFullName}/pull/${payload.number}#issuecomment-${commentId}`,
            specDocs: changed,
          })
          .catch((err) =>
            log.warn(
              `[github-app] guard spec-regen offer email failed for ${repoFullName} PR#${payload.number}: ${(err as Error).message}`,
            ),
          );
      }
    }
  } finally {
    deps.offerInFlight?.delete(flightKey);
  }
}

/**
 * issue_comment.edited → if a writer ticked our checkbox, enqueue the durable
 * regen+re-gate job for the PR head and mark the comment running. The job (which
 * carries the comment id) settles it to done/error.
 */
export async function handleCommentEditedGuardSpec(
  deps: GuardSpecOfferDeps,
  payload: IssueCommentPayload,
): Promise<void> {
  if (payload.action !== 'edited') return;
  if (!payload.issue.pull_request) return;
  if (!payload.installation) return;
  if (payload.comment.user?.type !== 'Bot') return;
  if (!isGuardSpecComment(payload.comment.body)) return;
  if (!isGuardSpecCheckboxChecked(payload.comment.body)) return;

  const repoFullName = payload.repository.full_name;
  const link = await deps.store.getRepo(repoFullName);
  if (!link || !link.enabled) return;

  const coords = splitRepo(repoFullName);
  const octokit = deps.octokitFor(payload.installation.id);
  const commentId = payload.comment.id;
  const prNumber = payload.issue.number;
  const installationId = payload.installation.id;

  // Only a repo writer may trigger server-side LLM work (same rule as the spec-scan checkbox).
  const perm = await getActorPermission(octokit, coords, payload.sender?.login ?? '');
  if (!WRITE_PERMISSIONS.includes(perm)) {
    log.warn(
      `[github-app] ignoring guard spec-regen trigger from non-writer ${payload.sender?.login ?? '?'} on ${repoFullName}`,
    );
    return;
  }

  if (deps.inFlight?.has(commentId)) return;
  deps.inFlight?.add(commentId);
  try {
    // Resolve the live head (the comment may be older than the latest push) —
    // scenarios regenerate for the CURRENT head. Fork PRs are fetched via the
    // base repo's pull ref (read-only), so they are offered + regenerated too.
    const pr = await getPullRequest(octokit, coords, prNumber);

    await updateComment(octokit, coords, commentId, renderGuardSpecComment('running'));
    await deps.enqueueGuardSpecRegen(
      buildGuardSpecRegenRequest({
        repoFullName,
        // The webhook's live installation id (the same octokit that resolved the
        // PR above), not the stored link's — they only differ across a reinstall.
        link: { installationId, workspaceOrgId: link.workspaceOrgId, defaultBranch: link.defaultBranch },
        prNumber,
        pr,
        commentId,
      }),
    );
  } catch (err) {
    log.error(
      `[github-app] guard spec-regen enqueue failed for ${repoFullName} PR#${prNumber}: ${(err as Error).message}`,
    );
    await updateComment(
      octokit,
      coords,
      commentId,
      renderGuardSpecComment('error', { error: (err as Error).message }),
    );
  } finally {
    deps.inFlight?.delete(commentId);
  }
}
