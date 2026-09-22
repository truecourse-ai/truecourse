/**
 * Public webhook receiver. Verifies the GitHub signature against the raw body,
 * acknowledges fast (202), then dispatches event handling asynchronously.
 *
 * Dependencies are injected (store + handlers) so the routing logic is unit
 * testable without a live GitHub or the Octokit auth layer.
 */

import { Router, type Request, type Response } from 'express';
import { log } from '@truecourse/core/lib/logger';
import type { RepositoryRecord, RepositoryStore } from '@truecourse/shared';
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

export interface WebhookDeps {
  secret: string;
  store: InstallationStore;
  /** The connected repositories, whichever provider brought them. */
  repos: RepositoryStore;
  /** Kick a baseline run for a connected repo (fire-and-forget). */
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
  const now = new Date().toISOString();
  const existing = await deps.store.getInstallation(installation.id);
  await deps.store.saveInstallation({
    installationId: installation.id,
    accountLogin: installation.account.login,
    accountType: installation.account.type,
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

  deps.onBaseline({
    repoFullName: payload.repository.full_name,
    installationId: payload.installation.id,
    defaultBranch: payload.repository.default_branch,
    commitSha: payload.after,
    workspaceOrgId: link.workspaceOrgId,
  });
}
