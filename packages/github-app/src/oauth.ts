/**
 * The App's user OAuth, used for ONE question: which installations of this
 * App can the person in the browser reach? GitHub answers it for a user token,
 * and the token is thrown away as soon as it has answered — nothing here is
 * stored. The code arrives on the App's Callback URL, after an install (with
 * the installation id beside it) or after a plain authorize (Connect on a
 * workspace whose account already has the App installed).
 */

import { Octokit } from '@octokit/rest';
import type { GithubAppConfig } from './config.js';

/** An installation as the user-installations list names it. */
export interface UserInstallation {
  installationId: number;
  accountLogin: string;
  accountType: string;
}

/**
 * Exchange the code GitHub sent to the callback for a user access token. A
 * refusal names GitHub's own reason when the answer is JSON, and the status
 * when it is not (an outage page from GitHub or a proxy is not JSON).
 */
export async function exchangeUserCode(cfg: GithubAppConfig, code: string): Promise<string> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code }),
  });
  const text = await res.text();
  let body: { access_token?: string; error?: string; error_description?: string } = {};
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    // Not JSON: the status is the whole answer.
  }
  if (!res.ok || !body.access_token) {
    const reason =
      body.error_description ?? body.error ?? `${res.status} ${res.statusText}`.trim();
    throw new Error(`GitHub refused the authorization code: ${reason}`);
  }
  return body.access_token;
}

/**
 * The installations of this App the token's user has explicit access to (a
 * read, write or admin grant on at least one repository the installation
 * covers). An enterprise-owned installation has a slug where a user or an
 * organization has a login.
 */
export async function listUserInstallations(token: string): Promise<UserInstallation[]> {
  const octokit = new Octokit({ auth: token });
  const installations = await octokit.paginate(
    octokit.apps.listInstallationsForAuthenticatedUser,
    { per_page: 100 },
  );
  return installations.map((installation) => {
    const account = installation.account as
      | { login?: string; slug?: string; type?: string }
      | null;
    return {
      installationId: installation.id,
      accountLogin: account?.login ?? account?.slug ?? '',
      accountType: account?.type ?? (account?.slug ? 'Enterprise' : ''),
    };
  });
}

/** Both steps as the connect router takes them: a code in, the reachable installations out. */
export async function reachableInstallations(
  cfg: GithubAppConfig,
  code: string,
): Promise<UserInstallation[]> {
  return listUserInstallations(await exchangeUserCode(cfg, code));
}
