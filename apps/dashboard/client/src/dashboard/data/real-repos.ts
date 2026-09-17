/**
 * The repository registry: the workspace's connected repositories, and the
 * GitHub App flow that connects one. The other provider, a folder on this
 * machine, owns its own calls (`dashboard/providers/local-folder`).
 *
 * A repository exists by being connected on the server, so this list is the
 * whole of Code. A row just connected carries no coverage, no runs and no
 * corpus until something has run on it, and every surface reads that state
 * from the server rather than assuming it. Its identity is the row's: the
 * provider it came through and its name, nothing is read out of a URL.
 *
 * The GitHub App is how one gets there: the status read says which installations
 * this workspace has and which repositories are already linked, an installation
 * lists what it can see, and linking one writes the row and returns; the
 * onboarding chain clones for itself in the background.
 *
 * The registry reads degrade to nothing: with no server behind them (a static
 * static page, a test) the list is simply empty, which is the honest answer:
 * a workspace with nothing connected. The GitHub calls reject, because the reason is
 * the whole answer — an unconfigured server names the variables it wants.
 */

import { deleteRepo, fetchApi, getRepos, type RepoResponse } from '@/lib/api';
import type {
  GithubAttachRequest,
  GithubConnectStatusResponse,
  GithubInstallableRepo,
  GithubInstallationAccessResponse,
  GithubInstallationReposResponse,
  GithubInstallationSummary,
  GithubInstallOrigin,
} from '@truecourse/shared';
import type { Repo } from './types';

/**
 * The App's installations on this workspace, the repositories already linked,
 * and the App's status for the connect surfaces. `from` names where an install
 * started from this page would return to (it rides the install link's state).
 * `offer` is the token a `pick` landing carries: the read answers the
 * installations it names, when it is still good for this session.
 */
export function fetchGithubStatus(
  from?: GithubInstallOrigin,
  offer?: string,
): Promise<GithubConnectStatusResponse> {
  const query = new URLSearchParams({
    ...(from ? { from } : {}),
    ...(offer ? { offer } : {}),
  }).toString();
  return fetchApi<GithubConnectStatusResponse>(`/api/github/status${query ? `?${query}` : ''}`);
}

/** Attach the installations picked out of an offer. Rejects with the server's reason. */
export async function attachGithubInstallations(request: GithubAttachRequest): Promise<void> {
  await fetchApi<{ ok: boolean }>('/api/github/installations/attach', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

/**
 * GitHub's settings page for one installation: where the repositories the App
 * can see are granted and revoked. A user's installation lives under the
 * user's settings and an organization's under the organization's; an account
 * of any other kind (an enterprise, a row nothing named) goes to the person's
 * own installations list, which GitHub filters to what they can reach.
 */
export function installationSettingsUrl(installation: GithubInstallationSummary): string {
  const { accountType, accountLogin, installationId } = installation;
  if (accountType === 'Organization' && accountLogin) {
    return `https://github.com/organizations/${encodeURIComponent(accountLogin)}/settings/installations/${installationId}`;
  }
  if (accountType === 'User') return `https://github.com/settings/installations/${installationId}`;
  return 'https://github.com/settings/installations';
}

/** What the App may see through one installation, as GitHub reports it. */
export function fetchInstallationAccess(
  installationId: number,
): Promise<GithubInstallationAccessResponse> {
  return fetchApi<GithubInstallationAccessResponse>(
    `/api/github/installations/${installationId}/access`,
  );
}

/** Everything one installation can see, linked or not. */
export async function fetchInstallationRepos(
  installationId: number,
): Promise<GithubInstallableRepo[]> {
  const body = await fetchApi<GithubInstallationReposResponse>(
    `/api/github/installations/${installationId}/repos`,
  );
  return body.repos;
}

/**
 * Detach an installation from this workspace. The repositories connected
 * through it here are disconnected with it; other workspaces keep theirs.
 * Rejects with the server's reason, which may be a repository that would not
 * disconnect: the rest are gone and the account stays, so a retry finishes.
 */
export async function detachGithubInstallation(installationId: number): Promise<void> {
  await fetchApi<{ ok: boolean }>(`/api/github/installations/${installationId}`, {
    method: 'DELETE',
  });
}

/** Link one repository. The row is the connection — the onboarding scan clones
 *  for itself in the background, so this returns as soon as the row is written. */
export async function linkGithubRepo(link: {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
}): Promise<void> {
  await fetchApi<{ ok: boolean }>('/api/github/repos/link', {
    method: 'POST',
    body: JSON.stringify(link),
  });
}

/** A registry entry as a shell `Repo`: connected, with nothing run on it yet. */
export function toDashboardRepo(entry: RepoResponse): Repo {
  return {
    id: entry.id,
    fullName: entry.name,
    provider: entry.provider,
    // A provider that tracks a branch says which; a folder on this machine
    // tracks none — a run reads whatever is checked out — so nothing is drawn
    // rather than a branch it might not be on.
    defaultBranch: entry.defaultBranch ?? (entry.provider ? '' : 'main'),
    lastCheck: {
      conclusion: 'neutral',
      word: 'Neutral',
      summary: 'Connected, nothing has run yet',
      at: 'just now',
    },
    onboarding: false,
  };
}

/** The connected repos of the registry. Empty when there is no server to ask. */
export async function fetchRealRepos(): Promise<Repo[]> {
  try {
    const entries = await getRepos();
    return entries.map(toDashboardRepo);
  } catch {
    return [];
  }
}

/**
 * Disconnect a real repo. REJECTS with the server's reason (an `ApiError`
 * carrying its message): the server refuses a disconnect while a job it cannot
 * stop is still running, and a caller that swallowed that would show the row
 * snap back with nothing said.
 */
export function disconnectRealRepo(id: string): Promise<void> {
  return deleteRepo(id);
}
