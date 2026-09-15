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
  GithubConnectStatusResponse,
  GithubInstallableRepo,
  GithubInstallationReposResponse,
  GithubInstallOrigin,
} from '@truecourse/shared';
import type { Repo } from './types';

/**
 * The App's installations on this workspace, the repositories already linked,
 * and the App's status for the connect surfaces. `from` names where an install
 * started from this page would return to (it rides the install link's state).
 */
export function fetchGithubStatus(from?: GithubInstallOrigin): Promise<GithubConnectStatusResponse> {
  const query = from ? `?from=${encodeURIComponent(from)}` : '';
  return fetchApi<GithubConnectStatusResponse>(`/api/github/status${query}`);
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
