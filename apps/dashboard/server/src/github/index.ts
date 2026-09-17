/**
 * The GitHub App connection, as this server wires it.
 *
 * `@truecourse/github-app` owns the protocol — the webhook receiver, the connect
 * API, the link store. This module owns what connecting a repository MEANS here:
 * the `repositories` row IS the connection. Nothing is cloned at connect time — the
 * work-tree provider installed here clones per run (a source's sync, a guard
 * run) and the clone is deleted when the run settles. Linking starts the
 * repository's Flow setup, the first link of the onboarding chain; its
 * documentation is a Context source, made in Context and linked by the connect
 * dialog. Unlinking cancels the repo's in-flight jobs and drops its persistent
 * session transcripts.
 *
 * The factory reads its configuration from the environment and returns `null`
 * when the App is not configured, so a server with no GITHUB_APP_* still boots
 * (app.ts answers those routes with a 503 that names the missing vars).
 *
 * Every side effect goes through an injectable seam so route tests can drive the
 * real mount with no network, no database and no LLM.
 */

import type { Router } from 'express';
import { createAppError } from '@truecourse/core/lib/errors';
import { log } from '@truecourse/core/lib/logger';
import {
  createConnectRouter,
  createGithubAuth,
  createWebhookRouter,
  fetchInstallationAccount,
  getInstallationToken,
  installationOctokit,
  loadGithubAppConfig,
  installationOf,
  PostgresInstallationStore,
  reachableInstallations,
  splitRepo,
  type InstallationStore,
  type GithubAuth,
  type OctokitClient,
  type UserInstallation,
} from '@truecourse/github-app';
import type { RepositoryRecord, RepositoryStore } from '@truecourse/shared';
import { getDb } from '../db.js';
import { createRunClone } from '../services/run-clone.service.js';
import { setWorkTreeProvider, type WorkTreeProvider } from '../services/work-tree.service.js';
import type { ContextGithubAccess } from '../routes/context.js';
import { removeRepoRunState } from '../services/repo-removal.service.js';
import {
  removeRepositoryContext,
  syncRepositorySource,
  type ContextSyncStart,
} from '../services/context-lifecycle.service.js';

export type { ContextSyncStart };

/** The routers app.ts mounts, plus the store the repo list scopes itself with. */
export interface GithubMount {
  /** Public receiver — GitHub has no session, so this mounts ABOVE the auth gate. */
  webhook: Router;
  /** Dashboard connect API — workspace-scoped, so it mounts BELOW the gate. */
  connect: Router;
  /** The App's own rows: its installations. */
  store: InstallationStore;
  /** How Context resolves the installation a repository source reads through. */
  access: ContextGithubAccess;
}

export interface GithubConnectionOverrides {
  /** The connected repositories, whichever provider brought them. */
  repos: RepositoryStore;
  /** The App's own store. Default: Postgres, on the server's one connection. */
  store?: InstallationStore;
  /** Installation-scoped GitHub client. Default: a real Octokit. */
  octokitFor?: (installationId: number) => OctokitClient;
  /** Who an installation belongs to. Default: the App API (app-level auth). */
  lookupInstallationAccount?: (
    installationId: number,
  ) => Promise<{ accountLogin: string; accountType: string } | null>;
  /**
   * The installations the person behind an OAuth code can reach. Default: the
   * code exchanged with GitHub for a user token, asked once.
   */
  userInstallationsFor?: (code: string) => Promise<UserInstallation[]>;
  /** Signs the connect `state`. Default: `TRUECOURSE_SECRET_KEY`. */
  stateSecret?: string;
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
export type SetupStart = (link: RepositoryRecord) => Promise<'queued' | 'busy' | 'failed'>;

const noSetupRunner: SetupStart = async (link) => {
  log.warn(`[github] background jobs are not running — ${link.repoFullName} was not set up`);
  return 'failed';
};

const noContextSyncRunner: ContextSyncStart = async (_orgId, sourceId) => {
  log.warn(`[github] background jobs are not running — ${sourceId} was not synced`);
  return 'failed';
};

export function createGithubConnection(
  overrides: GithubConnectionOverrides,
): GithubMount | null {
  const cfg = loadGithubAppConfig();
  if (!cfg) return null;

  const store = overrides.store ?? new PostgresInstallationStore(getDb());
  const repos = overrides.repos;
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
      // Code has not connected. The workspace has to HOLD that installation
      // still: a source made while the account was attached keeps naming it
      // after the account is removed, and must not go on minting clones of a
      // repository the workspace can no longer reach.
      if (via?.installationId !== undefined) {
        const installation = await store.getInstallation(via.installationId);
        if (!installation?.workspaceOrgIds.includes(via.workspaceOrgId)) {
          throw createAppError(
            `${repoKey} is read through a GitHub account this workspace no longer holds (installation ${via.installationId}). Connect the account again in Settings › Repositories, or remove the source.`,
            403,
          );
        }
        return createRunClone(repoKey, await tokenFor(via.installationId), {
          workspaceOrgId: via.workspaceOrgId,
          defaultBranch: via.defaultBranch ?? null,
        });
      }
      const link = await repos.getRepo(repoKey);
      const installationId = link ? installationOf(link) : null;
      if (!link || installationId === null) {
        throw new Error(`${repoKey} is not a repository connected through the GitHub App`);
      }
      return createRunClone(repoKey, await tokenFor(installationId), {
        workspaceOrgId: link.workspaceOrgId,
        defaultBranch: link.defaultBranch,
      });
    });
  setWorkTreeProvider('github', workTree);

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
      const link = await repos.getRepo(repoFullName);
      const installationId = link ? installationOf(link) : null;
      return link && installationId !== null
        ? { installationId, defaultBranch: link.defaultBranch ?? '' }
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
   * stale from there.
   */
  const syncSourceAfterPush = (workspaceOrgId: string, repoFullName: string): void =>
    syncRepositorySource(workspaceOrgId, repoFullName, contextSync);

  const webhook = createWebhookRouter({
    secret: cfg.webhookSecret,
    store,
    repos,
    // A connected repository's push.
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
    onRepoRemoved: async (link: RepositoryRecord) => {
      await removeRepoRunState(link.repoFullName, link.workspaceOrgId);
      await removeRepositoryContext(link.workspaceOrgId, link.repoFullName);
      log.info(`[github] ${link.repoFullName} disconnected by GitHub`);
    },
  });

  // The connect `state` is signed with the server's own secret, the one boot
  // already requires for the workspace's encrypted rows.
  const stateSecret = overrides.stateSecret ?? process.env.TRUECOURSE_SECRET_KEY;
  if (!stateSecret) {
    throw new Error('TRUECOURSE_SECRET_KEY is required to sign the GitHub connect state');
  }

  const connect = createConnectRouter({
    store,
    repos,
    appSlug: cfg.appSlug,
    clientId: cfg.clientId,
    stateSecret,
    userInstallationsFor:
      overrides.userInstallationsFor ?? ((code: string) => reachableInstallations(cfg, code)),
    appUrl: process.env.WORKOS_APP_URL || 'http://localhost:3000',
    // Back to the connect dialog, so the new installation is pickable at once.
    setupRedirectPath: '/settings/repositories',
    setupRedirectPaths: {
      settings: '/settings/repositories',
      'code-connect': '/code?connect=1',
      'context-add': '/context?add=repository',
    },
    octokitFor,
    lookupInstallationAccount:
      overrides.lookupInstallationAccount ??
      ((installationId: number) => fetchInstallationAccount(cfg, installationId)),
    onRepoLinked: async (link: RepositoryRecord) => {
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
    onRepoUnlinked: async (link: RepositoryRecord) => {
      await removeRepoRunState(link.repoFullName, link.workspaceOrgId);
      await removeRepositoryContext(link.workspaceOrgId, link.repoFullName);
      log.info(`[github] ${link.repoFullName} disconnected`);
    },
  });

  return { webhook, connect, store, access };
}
