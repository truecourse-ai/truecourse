/**
 * GitHub REST clients — installation-scoped (the usual one) and app-scoped (for
 * the App's own endpoints) — plus the narrow helpers their callers need: an
 * installation's account and repo file contents.
 */

import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import type { GithubAppConfig } from './config.js';

export type OctokitClient = Octokit;

export interface RepoCoords {
  owner: string;
  repo: string;
}

export function splitRepo(fullName: string): RepoCoords {
  const [owner, repo] = fullName.split('/');
  return { owner, repo };
}

export function installationOctokit(
  cfg: GithubAppConfig,
  installationId: number,
): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: cfg.appId,
      privateKey: cfg.privateKey,
      installationId,
    },
  });
}

/**
 * App-level client (JWT auth, no installation). Only the App's own endpoints
 * answer to it — an installation token cannot read the App's installation list.
 */
export function appOctokit(cfg: GithubAppConfig): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: cfg.appId, privateKey: cfg.privateKey },
  });
}

/**
 * The account an installation belongs to — its login and whether it is a user or
 * an organization. Read from the App API so the identity of an installation never
 * depends on the `installation` webhook being delivered (a webhook URL that is
 * misconfigured at install time never delivers at all).
 *
 * Best-effort: null when the installation is gone or the call fails. Callers show
 * the installation id instead; nobody's request fails for want of a display name.
 */
export async function fetchInstallationAccount(
  cfg: GithubAppConfig,
  installationId: number,
): Promise<{ accountLogin: string; accountType: string } | null> {
  try {
    const { data } = await appOctokit(cfg).apps.getInstallation({
      installation_id: installationId,
    });
    // `account` is a user/org (login + type) or an enterprise (slug, no type).
    const account = data.account as
      | { login?: string; slug?: string; type?: string }
      | null;
    const accountLogin = account?.login ?? account?.slug ?? '';
    if (!accountLogin) return null;
    return {
      accountLogin,
      accountType: account?.type ?? (account?.slug ? 'Enterprise' : ''),
    };
  } catch {
    return null;
  }
}
