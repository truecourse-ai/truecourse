/**
 * Public webhook receiver. Verifies the GitHub signature against the raw body,
 * acknowledges fast (202), then dispatches event handling asynchronously.
 *
 * Dependencies are injected (store + handlers) so the routing logic is unit
 * testable without a live GitHub or the Octokit auth layer.
 */

import { Router, type Request, type Response } from 'express';
import { log } from '@truecourse/core/lib/logger';
import type {
  PullRequestRecord,
  PullRequestStore,
  RepositoryRecord,
  RepositoryStore,
} from '@truecourse/shared';
import { verifyWebhookSignature } from './signature.js';
import { GITHUB_PROVIDER, installationOf } from './provider.js';
import type { InstallationStore } from './store/types.js';

export interface BaselineTrigger {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  commitSha: string;
  /** The repo's workspace org (from its connection row) — scopes the scan job + notifications. */
  workspaceOrgId: string;
}

/**
 * A push to the default branch of a repository this installation reaches but
 * Code has NOT connected. Nothing is baselined for it, since there is no link
 * and no repository page, but ONE workspace may still read its documentation
 * as a context source, so that source's owner is told to re-read it.
 */
export interface SourcePushTrigger {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  commitSha: string;
  /** The workspace whose source reads the repository. */
  workspaceOrgId: string;
}

/**
 * A pull request event, with what it means for its check. The row is already
 * written when this fires. `effect`: `check` — judge the head (a new head, a
 * reopen, a base change, ready for review); `draft` — cancel what is in
 * flight and say the draft is checked when ready; `close` — cancel what is in
 * flight; `none` — the row moved, nothing to do (a title edit).
 */
export interface PullRequestTrigger {
  pr: PullRequestRecord;
  installationId: number;
  effect: 'check' | 'draft' | 'close' | 'none';
}

/**
 * Someone asked GitHub to re-run a check. `checkId` names ours (the check
 * run's `external_id`) for one check; null for a whole suite, meaning every
 * check of that head.
 */
export interface CheckRerunTrigger {
  repoFullName: string;
  workspaceOrgId: string;
  installationId: number;
  headSha: string;
  checkId: string | null;
}

export interface WebhookDeps {
  secret: string;
  store: InstallationStore;
  /** The connected repositories, whichever provider brought them. */
  repos: RepositoryStore;
  /**
   * The pull requests. Without it the pull request and check events are
   * acknowledged and ignored, as every unhandled event is.
   */
  pulls?: PullRequestStore;
  /** A pull request event, after its row was written (fire-and-forget). */
  onPullRequest?: (trigger: PullRequestTrigger) => void;
  /** A re-run asked for on GitHub (fire-and-forget). */
  onCheckRerun?: (trigger: CheckRerunTrigger) => void;
  /**
   * A push to the default branch of a connected repository (fire-and-forget).
   * The pushed commit is already on the repository's row when this fires.
   */
  onBaseline: (trigger: BaselineTrigger) => void;
  /**
   * The workspace whose context source reads a repository, or null when none
   * does. A repository is one workspace's source, so this is one lookup by
   * name.
   */
  sourceWorkspaceOf: (repoFullName: string) => Promise<string | null>;
  /**
   * A push to the default branch of an UNCONNECTED repository that a
   * workspace reads as a context source. Fire-and-forget.
   */
  onSourcePush?: (trigger: SourcePushTrigger) => void;
  /**
   * Per-repo cleanup when GitHub takes a linked repo away — the App is
   * uninstalled, or the repo is removed from the installation. The webhook is
   * the only notice we get, so this must run the same cleanup the connect
   * router's unlink hook runs (cancel the running scan, drop the repo's server
   * state); it runs BEFORE the link row is deleted, mirroring that hook's
   * ordering. A throw fails the delivery (500), and GitHub redelivers —
   * already-cleaned repos are no longer linked, so the retry only re-attempts
   * what actually failed.
   */
  onRepoRemoved?: (link: RepositoryRecord) => Promise<void>;
}

interface InstallationPayload {
  action: string;
  installation: {
    id: number;
    account: { login: string; type: string };
    permissions?: Record<string, string>;
  };
}

interface PullRequestPayload {
  action: string;
  number: number;
  pull_request: {
    number: number;
    title: string;
    state: 'open' | 'closed';
    draft: boolean;
    merged: boolean;
    user: { login: string };
    head: { sha: string; ref: string; repo: { full_name: string } | null };
    base: { ref: string; repo: { full_name: string } };
    created_at: string;
    closed_at: string | null;
    updated_at: string;
  };
  /** On `edited`, the fields that changed with their previous values. */
  changes?: { base?: { ref: { from: string } } };
  repository: { full_name: string };
  installation?: { id: number };
}

interface CheckRerunPayload {
  action: string;
  check_run?: { external_id: string | null; head_sha: string };
  check_suite?: { head_sha: string };
  repository: { full_name: string };
  installation?: { id: number };
}

interface InstallationRepositoriesPayload {
  action: string;
  installation: { id: number };
  repositories_removed?: { full_name: string }[];
}

interface PushPayload {
  ref: string;
  after: string;
  repository: { full_name: string; default_branch: string };
  installation?: { id: number };
}

/**
 * The exact bytes GitHub signed, captured by the `express.json({ verify })`
 * hook. Returns undefined when absent (wrong content-type, or the parser
 * rejected the body) so the caller fails closed rather than HMAC-ing a
 * re-serialized object that can never match.
 */
function rawBodyOf(req: Request): Buffer | undefined {
  return (req as Request & { rawBody?: Buffer }).rawBody;
}

export function createWebhookRouter(deps: WebhookDeps): Router {
  const router = Router();

  router.post('/webhook', async (req: Request, res: Response) => {
    const signature = req.header('x-hub-signature-256');
    const event = req.header('x-github-event');

    const raw = rawBodyOf(req);
    if (!raw || !verifyWebhookSignature(deps.secret, raw, signature)) {
      res.status(401).json({ error: 'invalid signature' });
      return;
    }

    // Dispatch is lightweight (store writes + triggers); the work itself is a
    // background job the handler enqueues. Awaiting here keeps the ack
    // fast while making handling deterministic. A handler error returns 500 so
    // GitHub retries (handlers are idempotent).
    try {
      await dispatch(deps, event, req.body);
      res.status(202).json({ ok: true });
    } catch (err) {
      log.error(
        `[github-app] webhook handler error (${event ?? '?'}): ${(err as Error).message}`,
      );
      res.status(500).json({ error: 'handler error' });
    }
  });

  return router;
}

async function dispatch(
  deps: WebhookDeps,
  event: string | undefined,
  payload: unknown,
): Promise<void> {
  switch (event) {
    case 'installation':
      await handleInstallation(deps, payload as InstallationPayload);
      break;
    case 'installation_repositories':
      await handleInstallationRepositories(
        deps,
        payload as InstallationRepositoriesPayload,
      );
      break;
    case 'push':
      await handlePush(deps, payload as PushPayload);
      break;
    case 'pull_request':
      await handlePullRequest(deps, payload as PullRequestPayload);
      break;
    case 'check_run':
    case 'check_suite':
      await handleCheckRerun(deps, payload as CheckRerunPayload);
      break;
    default:
      // Unhandled event — ignore.
      break;
  }
}

async function handleInstallation(
  deps: WebhookDeps,
  payload: InstallationPayload,
): Promise<void> {
  const { action, installation } = payload;
  if (action === 'deleted') {
    // Uninstalling the App disconnects every repo it linked, in every
    // workspace the installation was attached to. Run the same per-repo
    // cleanup an explicit unlink runs (cancel the running scan, drop the
    // repo's server state) BEFORE the rows go — the cascade below deletes the
    // link rows, and cleanup must not run on repos nobody owns anymore.
    for (const link of await deps.repos.listReposForAccount(
      GITHUB_PROVIDER,
      String(installation.id),
    )) {
      await deps.onRepoRemoved?.(link);
      await deps.repos.unlinkRepo(link.repoFullName);
      log.info(`[github-app] ${link.repoFullName} disconnected (app uninstalled)`);
    }
    await deps.store.removeInstallation(installation.id);
    log.info(`[github-app] installation ${installation.id} removed`);
    return;
  }
  // created (and other lifecycle events) — upsert the installation's account.
  // Its workspace links are the connect callback's to write, and a re-sent
  // event never touches them.
  // Every event carries the permissions as granted now, `new_permissions_accepted`
  // included; a payload without them keeps what the row knows.
  const now = new Date().toISOString();
  const existing = await deps.store.getInstallation(installation.id);
  await deps.store.saveInstallation({
    installationId: installation.id,
    accountLogin: installation.account.login,
    accountType: installation.account.type,
    ...(installation.permissions ? { permissions: installation.permissions } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  log.info(
    `[github-app] installation ${installation.id} (${installation.account.login}) saved`,
  );
}

/**
 * Repos granted to / revoked from an existing installation. A revoked repo we
 * hold a link for is disconnected exactly like an explicit unlink — the grant
 * is gone, so the connection cannot outlive it. Additions need nothing: repos
 * become connected through the connect flow, not by being installable.
 */
async function handleInstallationRepositories(
  deps: WebhookDeps,
  payload: InstallationRepositoriesPayload,
): Promise<void> {
  if (payload.action !== 'removed') return;
  for (const repo of payload.repositories_removed ?? []) {
    const link = await deps.repos.getRepo(repo.full_name);
    if (!link || installationOf(link) !== payload.installation.id) continue;
    await deps.onRepoRemoved?.(link);
    await deps.repos.unlinkRepo(link.repoFullName);
    log.info(
      `[github-app] ${link.repoFullName} disconnected (removed from installation ${payload.installation.id})`,
    );
  }
}

async function handlePush(
  deps: WebhookDeps,
  payload: PushPayload,
): Promise<void> {
  const defaultRef = `refs/heads/${payload.repository.default_branch}`;
  if (payload.ref !== defaultRef) return;
  if (!payload.installation) return;

  // Only act for repositories Code has connected.
  const link = await deps.repos.getRepo(payload.repository.full_name);
  if (!link || !link.enabled) {
    // Not connected in Code, so nothing is baselined. The one workspace that
    // reads the repository as a context source, if any, is told its
    // documents just moved — provided it holds the installation that pushed:
    // a source keeps naming the installation it was made through, and one
    // its workspace no longer holds cannot sync, so telling it would only
    // queue a sync that fails.
    if (link || !deps.onSourcePush) return;
    const workspaceOrgId = await deps.sourceWorkspaceOf(payload.repository.full_name);
    if (workspaceOrgId === null) return;
    const installation = await deps.store.getInstallation(payload.installation.id);
    if (!installation?.workspaceOrgIds.includes(workspaceOrgId)) return;
    deps.onSourcePush({
      repoFullName: payload.repository.full_name,
      installationId: payload.installation.id,
      defaultBranch: payload.repository.default_branch,
      commitSha: payload.after,
      workspaceOrgId,
    });
    return;
  }

  // The row remembers the newest push BEFORE anything is started for it, so a
  // chain already running finds this commit when it ends and follows up.
  await deps.repos.recordDefaultBranchSha(link.repoFullName, payload.after);
  deps.onBaseline({
    repoFullName: payload.repository.full_name,
    installationId: payload.installation.id,
    defaultBranch: payload.repository.default_branch,
    commitSha: payload.after,
    workspaceOrgId: link.workspaceOrgId,
  });
}

/**
 * The workspace a repository's pull requests belong to: the one that
 * connected it in Code, when the event came through the installation the
 * connection reads through; else the one whose context source reads it (the
 * spec half alone applies then), when that workspace holds the installation.
 * Null when nobody does, and the event is ignored.
 */
async function workspaceOfRepository(
  deps: WebhookDeps,
  repoFullName: string,
  installationId: number,
): Promise<string | null> {
  const link = await deps.repos.getRepo(repoFullName);
  if (link) {
    return link.enabled && installationOf(link) === installationId ? link.workspaceOrgId : null;
  }
  const workspaceOrgId = await deps.sourceWorkspaceOf(repoFullName);
  if (workspaceOrgId === null) return null;
  const installation = await deps.store.getInstallation(installationId);
  return installation?.workspaceOrgIds.includes(workspaceOrgId) ? workspaceOrgId : null;
}

/**
 * A pull request opened, moved, redrafted or closed. The row is written as
 * GitHub last saw it and the host is told what that means for the check;
 * an action about labels, reviewers or the like changes nothing here.
 */
async function handlePullRequest(deps: WebhookDeps, payload: PullRequestPayload): Promise<void> {
  if (!deps.pulls || !payload.installation) return;
  const effect = pullRequestEffect(payload);
  if (effect === null) return;
  const repoFullName = payload.repository.full_name;
  const workspaceOrgId = await workspaceOfRepository(deps, repoFullName, payload.installation.id);
  if (workspaceOrgId === null) return;

  const p = payload.pull_request;
  const pr: PullRequestRecord = {
    repoFullName,
    number: p.number,
    workspaceOrgId,
    provider: GITHUB_PROVIDER,
    title: p.title,
    authorLogin: p.user.login,
    headSha: p.head.sha,
    headRef: p.head.ref,
    baseRef: p.base.ref,
    headRepoFullName: p.head.repo?.full_name ?? null,
    draft: p.draft,
    state: p.state === 'closed' ? (p.merged ? 'merged' : 'closed') : 'open',
    // GitHub's stamps, in the shape the store hands them back.
    openedAt: new Date(p.created_at).toISOString(),
    closedAt: p.closed_at === null ? null : new Date(p.closed_at).toISOString(),
    updatedAt: new Date(p.updated_at).toISOString(),
  };
  await deps.pulls.savePullRequest(pr);
  log.info(`[github-app] ${repoFullName}#${pr.number} ${payload.action} → ${effect}`);
  deps.onPullRequest?.({ pr, installationId: payload.installation.id, effect });
}

/** What an action means for the check, or null for one that means nothing here. */
function pullRequestEffect(payload: PullRequestPayload): PullRequestTrigger['effect'] | null {
  const draft = payload.pull_request.draft;
  switch (payload.action) {
    case 'opened':
    case 'reopened':
    case 'synchronize':
    case 'ready_for_review':
      return draft ? 'draft' : 'check';
    case 'converted_to_draft':
      return 'draft';
    case 'edited':
      // A new base is a new comparison; a new title is just a new title.
      return payload.changes?.base ? (draft ? 'draft' : 'check') : 'none';
    case 'closed':
      return 'close';
    default:
      return null;
  }
}

/**
 * "Re-run" pressed on GitHub: on one check run (ours is the one whose
 * `external_id` we minted) or on the whole suite of a head.
 */
async function handleCheckRerun(deps: WebhookDeps, payload: CheckRerunPayload): Promise<void> {
  if (!deps.pulls || !deps.onCheckRerun || !payload.installation) return;
  if (payload.action !== 'rerequested') return;
  const headSha = payload.check_run?.head_sha ?? payload.check_suite?.head_sha;
  if (!headSha) return;
  const repoFullName = payload.repository.full_name;
  const workspaceOrgId = await workspaceOfRepository(deps, repoFullName, payload.installation.id);
  if (workspaceOrgId === null) return;
  deps.onCheckRerun({
    repoFullName,
    workspaceOrgId,
    installationId: payload.installation.id,
    headSha,
    checkId: payload.check_run?.external_id || null,
  });
}
