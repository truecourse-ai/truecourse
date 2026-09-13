/**
 * The GitHub App connection, as this server wires it.
 *
 * `@truecourse/github-app` owns the protocol — the webhook receiver, the connect
 * API, the link store. This module owns what connecting a repository MEANS here:
 * the `gh_repos` row IS the connection. Nothing is cloned at connect time — the
 * work-tree provider installed here clones per run (a source's sync, a guard
 * run) and the clone is deleted when the run settles. Linking creates the
 * repository's Context source and ENQUEUES its sync, which is the first link of
 * the onboarding chain; unlinking cancels the repo's in-flight jobs and drops
 * its persistent session transcripts.
 *
 * The factory reads its configuration from the environment and returns `null`
 * when the App is not configured, so a server with no GITHUB_APP_* still boots
 * (app.ts answers those routes with a 503 that names the missing vars).
 *
 * Every side effect goes through an injectable seam so route tests can drive the
 * real mount with no network, no database and no LLM.
 */

import type { Router } from 'express';
import { log } from '@truecourse/core/lib/logger';
import {
  createConnectRouter,
  createGithubAuth,
  createWebhookRouter,
  fetchInstallationAccount,
  getInstallationToken,
  installationOctokit,
  loadGithubAppConfig,
  PostgresGateStore,
  splitRepo,
  type GateStore,
  type GithubAuth,
  type OctokitClient,
  type RepoLinkRecord,
} from '@truecourse/github-app';
import { getDb } from '../db.js';
import { createRunClone } from '../services/run-clone.service.js';
import { setWorkTreeProvider, type WorkTreeProvider } from '../services/work-tree.service.js';
import type { ContextGithubAccess } from '../routes/context.js';
import { removeRepoRunState } from '../services/repo-removal.service.js';
import {
  removeRepositoryContext,
  repositoryContextSource,
} from '../services/context-lifecycle.service.js';

/** How a repository's Repository source is refreshed (on connect, and on a push). */
export type ContextSyncStart = (
  orgId: string,
  sourceId: string,
  source: 'add' | 'push',
) => Promise<'queued' | 'busy' | 'failed'>;

/** The routers app.ts mounts, plus the store the repo list scopes itself with. */
export interface GithubMount {
  /** Public receiver — GitHub has no session, so this mounts ABOVE the auth gate. */
  webhook: Router;
  /** Dashboard connect API — workspace-scoped, so it mounts BELOW the gate. */
  connect: Router;
  /** The repo→workspace links, so `GET /api/repos` can hide other workspaces' repos. */
  store: GateStore;
  /** How Context resolves the installation a repository source reads through. */
  access: ContextGithubAccess;
}

export interface GithubConnectionOverrides {
  /** Link store. Default: Postgres, on the server's one connection. */
  store?: GateStore;
  /** Installation-scoped GitHub client. Default: a real Octokit. */
  octokitFor?: (installationId: number) => OctokitClient;
  /** Who an installation belongs to. Default: the App API (app-level auth). */
  lookupInstallationAccount?: (
    installationId: number,
  ) => Promise<{ accountLogin: string; accountType: string } | null>;
  /** Per-run work trees. Default: a token clone into the workspace's run dir. */
  workTree?: WorkTreeProvider;
  /**
   * Sync a context source. Boot passes the job enqueue; without one a push
   * leaves the source for a Sync now.
   */
  contextSync?: ContextSyncStart;
  /**
   * Start a connected repository's Flow setup. Boot passes the job enqueue;
   * without one the repository is linked and left for a Set up.
   */
  startSetup?: SetupStart;
}

/** How connect starts a repository's setup: the queue's answer, as a word. */
export type SetupStart = (link: RepoLinkRecord) => Promise<'queued' | 'busy' | 'failed'>;

const noSetupRunner: SetupStart = async (link) => {
  log.warn(`[github] background jobs are not running — ${link.repoFullName} was not set up`);
  return 'failed';
};

const noContextSyncRunner: ContextSyncStart = async (_orgId, sourceId) => {
  log.warn(`[github] background jobs are not running — ${sourceId} was not synced`);
  return 'failed';
};

export function createGithubConnection(
  overrides: GithubConnectionOverrides = {},
): GithubMount | null {
  const cfg = loadGithubAppConfig();
  if (!cfg) return null;

  const store = overrides.store ?? new PostgresGateStore(getDb());
  const octokitFor =
    overrides.octokitFor ?? ((installationId: number) => installationOctokit(cfg, installationId));
  const contextSync = overrides.contextSync ?? noContextSyncRunner;
  const startSetup = overrides.startSetup ?? noSetupRunner;

  // App auth is built on first use: the private key is only parsed when a token
  // is actually minted, so a test that injects `workTree` never needs a real one.
  let auth: GithubAuth | null = null;
  const tokenFor = async (installationId: number): Promise<string> => {
    auth ??= createGithubAuth(cfg);
    return getInstallationToken(auth, installationId);
  };
  const workTree: WorkTreeProvider =
    overrides.workTree ??
    (async (repoKey, via) => {
      // A caller that already knows its installation is cloned through it, with
      // no link read at all: this is how a context source reads a repository
      // Code has not connected.
      if (via) {
        return createRunClone(repoKey, await tokenFor(via.installationId), {
          workspaceOrgId: via.workspaceOrgId,
          defaultBranch: via.defaultBranch ?? null,
        });
      }
      const link = await store.getRepo(repoKey);
      if (!link) {
        throw new Error(`${repoKey} is not a connected repository`);
      }
      return createRunClone(repoKey, await tokenFor(link.installationId), {
        workspaceOrgId: link.workspaceOrgId,
        defaultBranch: link.defaultBranch,
      });
    });
  setWorkTreeProvider(workTree);

  /**
   * What Context needs of GitHub to store a source for a repository Code has
   * not connected: which installations this workspace has, which installation a
   * connected repository already syncs through, and whether one installation
   * can actually reach a repository (which is also where its default branch
   * comes from).
   */
  const access: ContextGithubAccess = {
    listInstallations: async (workspaceOrgId) =>
      (await store.listInstallationsForWorkspace(workspaceOrgId)).map(
        (installation) => installation.installationId,
      ),
    linkFor: async (repoFullName) => {
      const link = await store.getRepo(repoFullName);
      return link
        ? { installationId: link.installationId, defaultBranch: link.defaultBranch }
        : null;
    },
    reachRepository: async (installationId, repoFullName) => {
      const { owner, repo } = splitRepo(repoFullName);
      try {
        const { data } = await octokitFor(installationId).repos.get({ owner, repo });
        return { defaultBranch: data.default_branch };
      } catch {
        return null;
      }
    },
  };

  /**
   * A push to the default branch is what re-reads a repository's own
   * documentation: its Repository source syncs, and the workspace corpus goes
   * stale from there. A repository with no source of its own has nothing to do
   * here.
   */
  const syncSourceAfterPush = (workspaceOrgId: string, repoFullName: string): void => {
    void (async () => {
      try {
        const source = await repositoryContextSource(workspaceOrgId, repoFullName);
        if (!source) return;
        const outcome = await contextSync(workspaceOrgId, source.id, 'push');
        if (outcome !== 'queued') {
          log.info(`[github] ${repoFullName} pushed, context sync ${outcome}`);
        }
      } catch (err) {
        log.warn(
          `[github] could not sync ${repoFullName}'s context after a push: ${(err as Error).message}`,
        );
      }
    })();
  };

  const webhook = createWebhookRouter({
    secret: cfg.webhookSecret,
    store,
    // A connected repository's push. (The gate's baseline refresh arrives
    // separately.)
    onBaseline: (trigger) => {
      syncSourceAfterPush(trigger.workspaceOrgId, trigger.repoFullName);
    },
    // A push to a repository this installation reaches that Code has NOT
    // connected. It has no baseline and no repository page, but the workspace
    // may read it as a context source, and that source just moved.
    onSourcePush: (trigger) => {
      syncSourceAfterPush(trigger.workspaceOrgId, trigger.repoFullName);
    },
    // GitHub taking a repo away (app uninstall, repo removed from the
    // installation) disconnects it exactly like an explicit unlink does.
    onRepoRemoved: async (link: RepoLinkRecord) => {
      await removeRepoRunState(link.repoFullName, link.workspaceOrgId);
      await removeRepositoryContext(link.workspaceOrgId, link.repoFullName);
      log.info(`[github] ${link.repoFullName} disconnected by GitHub`);
    },
  });

  const connect = createConnectRouter({
    store,
    appSlug: cfg.appSlug,
    appUrl: process.env.WORKOS_APP_URL || 'http://localhost:3000',
    // Back to the connect dialog, so the new installation is pickable at once.
    setupRedirectPath: '/preview/settings/repositories',
    setupRedirectPaths: {
      settings: '/preview/settings/repositories',
      'code-connect': '/preview/code?connect=1',
      'context-add': '/preview/context?add=repository',
    },
    octokitFor,
    lookupInstallationAccount:
      overrides.lookupInstallationAccount ??
      ((installationId: number) => fetchInstallationAccount(cfg, installationId)),
    onRepoLinked: async (link: RepoLinkRecord) => {
      // Connecting starts the repository's Flow setup, which derives its recipe,
      // dependencies and interfaces from the CODE. What the repository reads is
      // Context's side: sources are made there, and the connect dialog's Context
      // step links the ones that exist. The row is the connection: no clone, no
      // registration, nothing awaited but the enqueue.
      try {
        const outcome = await startSetup(link);
        if (outcome !== 'queued') {
          log.info(`[github] ${link.repoFullName} connected — setup ${outcome}`);
        }
      } catch (err) {
        // A setup that could not start is not a reason to refuse the
        // connection: the repository is linked, and Set up still works.
        log.error(`[github] could not start ${link.repoFullName}'s setup: ${(err as Error).message}`);
      }
    },
    onRepoUnlinked: async (link: RepoLinkRecord) => {
      await removeRepoRunState(link.repoFullName, link.workspaceOrgId);
      await removeRepositoryContext(link.workspaceOrgId, link.repoFullName);
      log.info(`[github] ${link.repoFullName} disconnected`);
    },
  });

  return { webhook, connect, store, access };
}
