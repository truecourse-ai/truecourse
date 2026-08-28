/**
 * The GitHub App connection, as this server wires it.
 *
 * `@truecourse/scm-github` owns the protocol — the webhook receiver, the connect
 * API, the link store. This module owns what connecting a repository MEANS here:
 * clone it with an installation token, register the clone as a project, start
 * its onboarding scan; and on disconnect, undo all three.
 *
 * The factory reads its configuration from the environment and returns `null`
 * when the App is not configured, so a server with no GITHUB_APP_* still boots
 * (app.ts answers those routes with a 503 that names the missing vars).
 *
 * Every side effect goes through an injectable seam so route tests can drive the
 * real mount with no network, no database and no LLM.
 */

import path from 'node:path';
import type { Router } from 'express';
import { log } from '@truecourse/core/lib/logger';
import { getProjectByPath, registerProject } from '@truecourse/core/config/registry';
import {
  createConnectRouter,
  createGithubAuth,
  createWebhookRouter,
  fetchInstallationAccount,
  getInstallationToken,
  installationOctokit,
  loadGithubAppConfig,
  PostgresGateStore,
  repoWebUrl,
  type GateStore,
  type GithubAuth,
  type OctokitClient,
  type RepoLinkRecord,
} from '@truecourse/scm-github';
import { getDb } from '../db.js';
import { cloneDirName, cloneGithubRepo, getClonesDir } from '../services/repo-clone.service.js';
import { startOnboardingScan } from '../services/onboarding-scan.service.js';
import { removeProject } from '../services/repo-removal.service.js';

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
  /** Clone a connected repo, returning the path. Default: token clone into the managed dir. */
  clone?: (link: RepoLinkRecord) => Promise<string>;
  /** Start a repo's onboarding scan. Default: the in-process background scan. */
  scan?: (repoId: string, repoPath: string) => boolean;
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
  // is actually minted, so a test that injects `clone` never needs a real one.
  let auth: GithubAuth | null = null;
  const clone =
    overrides.clone ??
    (async (link: RepoLinkRecord): Promise<string> => {
      auth ??= createGithubAuth(cfg);
      const token = await getInstallationToken(auth, link.installationId);
      return cloneGithubRepo(link.repoFullName, token);
    });

  const webhook = createWebhookRouter({
    secret: cfg.webhookSecret,
    store,
    // Push-triggered baseline refresh arrives with the PR gate; until then a
    // repo re-scans when someone asks it to, not when its default branch moves.
    onBaseline: () => {},
  });

  const connect = createConnectRouter({
    store,
    appSlug: cfg.appSlug,
    appUrl: process.env.WORKOS_APP_URL ?? 'http://localhost:3000',
    // Back to the connect dialog, so the new installation is pickable at once.
    setupRedirectPath: '/preview?connect=1',
    octokitFor,
    lookupInstallationAccount:
      overrides.lookupInstallationAccount ??
      ((installationId: number) => fetchInstallationAccount(cfg, installationId)),
    onRepoLinked: async (link) => {
      const clonePath = await clone(link);
      const entry = await registerProject(clonePath, link.repoFullName, {
        remoteUrl: repoWebUrl(link.repoFullName),
      });
      scan(entry.slug, entry.path);
    },
    onRepoUnlinked: async (link) => {
      // The project this repo was registered as, found where the clone lives:
      // the managed directory name is derived from the full name and is the
      // registry's primary key, so no string has to be rebuilt and matched.
      const clonePath = path.join(getClonesDir(), cloneDirName(link.repoFullName));
      const entry = await getProjectByPath(clonePath);
      if (!entry) {
        log.info(`[github] ${link.repoFullName} was not registered — nothing to clean up`);
        return;
      }
      await removeProject(entry);
    },
  });

  return { webhook, connect, store };
}
