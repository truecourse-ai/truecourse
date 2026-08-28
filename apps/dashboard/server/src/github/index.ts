/**
 * The GitHub App connection, as this server wires it.
 *
 * `@truecourse/github-app` owns the protocol — the webhook receiver, the connect
 * API, the link store. This module owns what connecting a repository MEANS here:
 * the `gh_repos` row IS the connection. Nothing is cloned at connect time — the
 * work-tree provider installed here clones per run (spec scan now; guard runs
 * later) and the clone is deleted when the run settles. Linking starts the
 * onboarding scan; unlinking cancels any scan of ours and drops the repo's
 * persistent session transcripts.
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
import { slugify } from '@truecourse/core/config/registry';
import {
  createConnectRouter,
  createGithubAuth,
  createWebhookRouter,
  fetchInstallationAccount,
  getInstallationToken,
  installationOctokit,
  loadGithubAppConfig,
  PostgresGateStore,
  type GateStore,
  type GithubAuth,
  type OctokitClient,
  type RepoLinkRecord,
} from '@truecourse/github-app';
import { getDb } from '../db.js';
import { createRunClone } from '../services/run-clone.service.js';
import { setWorkTreeProvider, type WorkTreeProvider } from '../services/work-tree.service.js';
import { startOnboardingScan } from '../services/onboarding-scan.service.js';
import { removeRepoRunState } from '../services/repo-removal.service.js';

/** The routers app.ts mounts, plus the store the repo list scopes itself with. */
export interface GithubMount {
  /** Public receiver — GitHub has no session, so this mounts ABOVE the auth gate. */
  webhook: Router;
  /** Dashboard connect API — workspace-scoped, so it mounts BELOW the gate. */
  connect: Router;
  /** The repo→workspace links, so `GET /api/repos` can hide other workspaces' repos. */
  store: GateStore;
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
  /** Start a repo's onboarding scan. Default: the in-process background scan. */
  scan?: (repoId: string, repoKey: string) => boolean;
}

export function createGithubConnection(
  overrides: GithubConnectionOverrides = {},
): GithubMount | null {
  const cfg = loadGithubAppConfig();
  if (!cfg) return null;

  const store = overrides.store ?? new PostgresGateStore(getDb());
  const octokitFor =
    overrides.octokitFor ?? ((installationId: number) => installationOctokit(cfg, installationId));
  const scan = overrides.scan ?? startOnboardingScan;

  // App auth is built on first use: the private key is only parsed when a token
  // is actually minted, so a test that injects `workTree` never needs a real one.
  let auth: GithubAuth | null = null;
  const workTree: WorkTreeProvider =
    overrides.workTree ??
    (async (repoKey: string) => {
      const link = await store.getRepo(repoKey);
      if (!link) {
        throw new Error(`${repoKey} is not a connected repository`);
      }
      auth ??= createGithubAuth(cfg);
      const token = await getInstallationToken(auth, link.installationId);
      return createRunClone(repoKey, token, {
        workspaceOrgId: link.workspaceOrgId,
        defaultBranch: link.defaultBranch,
      });
    });
  setWorkTreeProvider(workTree);

  const webhook = createWebhookRouter({
    secret: cfg.webhookSecret,
    store,
    // Push-triggered baseline refresh arrives with the PR gate; until then a
    // repo re-scans when someone asks it to, not when its default branch moves.
    onBaseline: () => {},
    // GitHub taking a repo away (app uninstall, repo removed from the
    // installation) disconnects it exactly like an explicit unlink does.
    onRepoRemoved: async (link: RepoLinkRecord) => {
      await removeRepoRunState(link.repoFullName);
      log.info(`[github] ${link.repoFullName} disconnected by GitHub`);
    },
  });

  const connect = createConnectRouter({
    store,
    appSlug: cfg.appSlug,
    appUrl: process.env.WORKOS_APP_URL || 'http://localhost:3000',
    // Back to the connect dialog, so the new installation is pickable at once.
    setupRedirectPath: '/preview?connect=1',
    octokitFor,
    lookupInstallationAccount:
      overrides.lookupInstallationAccount ??
      ((installationId: number) => fetchInstallationAccount(cfg, installationId)),
    onRepoLinked: async (link: RepoLinkRecord) => {
      // The row is the connection — no clone, no registration. The onboarding
      // scan acquires (and disposes) its own ephemeral work tree.
      scan(slugify(link.repoFullName, []), link.repoFullName);
    },
    onRepoUnlinked: async (link: RepoLinkRecord) => {
      await removeRepoRunState(link.repoFullName);
      log.info(`[github] ${link.repoFullName} disconnected`);
    },
  });

  return { webhook, connect, store };
}
