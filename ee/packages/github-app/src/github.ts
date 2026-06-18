/**
 * Thin GitHub auth layer. Phase 1 only needs short-lived installation tokens
 * (to clone private repos for baseline/gate runs). REST helpers for Checks
 * and comments arrive in later phases.
 */

import { createAppAuth } from '@octokit/auth-app';
import type { SimpleGit } from 'simple-git';
import type { GithubAppConfig } from './config.js';

export type GithubAuth = ReturnType<typeof createAppAuth>;

export function createGithubAuth(cfg: GithubAppConfig): GithubAuth {
  return createAppAuth({ appId: cfg.appId, privateKey: cfg.privateKey });
}

/** Mint a short-lived installation access token (used to authenticate clones). */
export async function getInstallationToken(
  auth: GithubAuth,
  installationId: number,
): Promise<string> {
  const result = await auth({ type: 'installation', installationId });
  return result.token;
}

/** Bare HTTPS clone URL — no credentials embedded. */
export function cloneUrl(repoFullName: string): string {
  return `https://github.com/${repoFullName}.git`;
}

/**
 * `git -c` args that authenticate the clone via an Authorization header rather
 * than embedding the token in the URL. Keeps the token out of the URL string,
 * git's error output, and the temp clone's `.git/config`.
 */
export function cloneAuthArgs(token: string): string[] {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return [
    '-c',
    `http.https://github.com/.extraheader=Authorization: Basic ${basic}`,
  ];
}

/**
 * Remove the auth header that `git clone -c` persists into the new repo's
 * `.git/config`, so the token never lives at rest in the (short-lived) clone.
 * Call right after cloning. Per-command `-c` on fetch/push is not persisted.
 */
export async function stripEmbeddedAuth(git: SimpleGit): Promise<void> {
  await git
    .raw(['config', '--unset-all', 'http.https://github.com/.extraheader'])
    .catch(() => undefined);
}
