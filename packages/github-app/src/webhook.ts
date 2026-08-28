/**
 * Public webhook receiver. Verifies the GitHub signature against the raw body,
 * acknowledges fast (202), then dispatches event handling asynchronously.
 *
 * Dependencies are injected (store + handlers) so the routing logic is unit
 * testable without a live GitHub or the Octokit auth layer.
 */

import { Router, type Request, type Response } from 'express';
import { log } from '@truecourse/core/lib/logger';
import { verifyWebhookSignature } from './signature.js';
import type { GateStore, RepoLinkRecord } from './store/types.js';

export interface BaselineTrigger {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  commitSha: string;
  /** The repo's workspace org (from the gate link) — scopes the scan job + notifications. */
  workspaceOrgId: string;
}

export interface WebhookDeps {
  secret: string;
  store: GateStore;
  /** Kick a baseline run for a connected repo (fire-and-forget). */
  onBaseline: (trigger: BaselineTrigger) => void;
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
  onRepoRemoved?: (link: RepoLinkRecord) => Promise<void>;
  /** Handle a pull_request event (offer scan in Phase 2, gate in Phase 4). */
  onPullRequest?: (payload: PullRequestPayload) => void;
  /** Handle an issue_comment event (the scan checkbox); fire-and-forget. */
  onCommentEdited?: (payload: IssueCommentPayload) => void;
}

interface InstallationPayload {
  action: string;
  installation: { id: number; account: { login: string; type: string } };
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

export interface PullRequestPayload {
  action: string;
  number: number;
  pull_request: {
    /** PR title (present on every pull_request payload). */
    title?: string;
    head: {
      sha: string;
      ref: string;
      /** Present on the webhook payload; absent → assume same-repo. */
      repo?: { full_name: string; fork: boolean } | null;
    };
    base: { sha: string; ref: string };
    /** Set on a `closed` event: whether the PR merged (vs. closed unmerged). */
    merged?: boolean;
  };
  repository: { full_name: string; default_branch: string };
  installation?: { id: number };
}

export interface IssueCommentPayload {
  action: string;
  comment: {
    id: number;
    body: string;
    /** The comment author (our App bot for the scan comment). */
    user?: { type: string; login: string };
  };
  /** The actor who performed the event (used to authorize the scan trigger). */
  sender?: { login: string; type: string };
  issue: { number: number; pull_request?: unknown };
  repository: { full_name: string };
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

    // Dispatch is lightweight (store writes + triggers); the heavy clone+verify
    // work is fire-and-forget inside `onBaseline`. Awaiting here keeps the ack
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
      deps.onPullRequest?.(payload as PullRequestPayload);
      break;
    case 'issue_comment':
      deps.onCommentEdited?.(payload as IssueCommentPayload);
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
    // Uninstalling the App disconnects every repo it linked. Run the same
    // per-repo cleanup an explicit unlink runs (cancel the running scan, drop
    // the repo's server state) BEFORE the rows go — the cascade below deletes
    // the link rows, and cleanup must not run on repos nobody owns anymore.
    for (const link of await deps.store.listReposForInstallation(installation.id)) {
      await deps.onRepoRemoved?.(link);
      await deps.store.unlinkRepo(link.repoFullName);
      log.info(`[github-app] ${link.repoFullName} disconnected (app uninstalled)`);
    }
    await deps.store.removeInstallation(installation.id);
    log.info(`[github-app] installation ${installation.id} removed`);
    return;
  }
  // created (and other lifecycle events) — upsert the installation. The
  // workspace link is set later when the user completes the connect flow.
  const now = new Date().toISOString();
  const existing = await deps.store.getInstallation(installation.id);
  await deps.store.saveInstallation({
    installationId: installation.id,
    accountLogin: installation.account.login,
    accountType: installation.account.type,
    workspaceOrgId: existing?.workspaceOrgId ?? null,
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
    const link = await deps.store.getRepo(repo.full_name);
    if (!link || link.installationId !== payload.installation.id) continue;
    await deps.onRepoRemoved?.(link);
    await deps.store.unlinkRepo(link.repoFullName);
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

  // Only re-baseline repos that are connected to the gate.
  const link = await deps.store.getRepo(payload.repository.full_name);
  if (!link || !link.enabled) return;

  deps.onBaseline({
    repoFullName: payload.repository.full_name,
    installationId: payload.installation.id,
    defaultBranch: payload.repository.default_branch,
    commitSha: payload.after,
    workspaceOrgId: link.workspaceOrgId,
  });
}
