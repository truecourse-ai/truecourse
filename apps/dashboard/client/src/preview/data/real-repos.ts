/**
 * The repository registry: the workspace's connected repositories, and the
 * GitHub App flow that connects one.
 *
 * A repository exists by being connected on the server, so this list is the
 * whole of Code. A row just connected carries no coverage, no runs and no
 * corpus until something has run on it, and every surface reads that state
 * from the server rather than assuming it.
 *
 * Only repos with a `remoteUrl` are shown. A developer's own path-registered
 * repos are their local dashboard's business, not this product's.
 *
 * The GitHub App is how one gets there: the status read says which installations
 * this workspace has and which repositories are already linked, an installation
 * lists what it can see, and linking one CLONES IT INSIDE THE REQUEST — minutes,
 * not milliseconds, which is why its caller has to say so.
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
} from '@truecourse/shared';
import type { ProviderId, Repo } from './types';

/**
 * The App's installations on this workspace, and the repositories already
 * linked. `slim` because the dialog only needs the names: the full read walks
 * each repo's spec store, which the dialog would pay for on every open.
 */
export function fetchGithubStatus(): Promise<GithubConnectStatusResponse> {
  return fetchApi<GithubConnectStatusResponse>('/api/github/status?slim=1');
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

/** The provider of a remote, by host. An unknown host reads as github: there is no fourth icon. */
function providerOf(host: string): ProviderId {
  const lower = host.toLowerCase();
  if (lower.includes('gitlab')) return 'gitlab';
  if (lower === 'dev.azure.com' || lower.endsWith('.visualstudio.com')) return 'azure';
  return 'github';
}

/** `https://github.com/acme/orders-api.git` reads as `acme/orders-api` on github. */
export function parseRemote(remoteUrl: string): { fullName: string; provider: ProviderId } {
  let parsed: URL;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    return { fullName: remoteUrl, provider: 'github' };
  }
  const segments = parsed.pathname
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean)
    .map((s) => decodeURIComponent(s));
  const fullName = segments.length >= 2 ? segments.slice(-2).join('/') : (segments[0] ?? remoteUrl);
  return { fullName, provider: providerOf(parsed.hostname) };
}

/** A registry entry as a shell `Repo`: connected, with nothing run on it yet. */
export function toPreviewRepo(entry: RepoResponse): Repo {
  const { fullName, provider } = parseRemote(entry.remoteUrl ?? '');
  return {
    id: entry.id,
    fullName,
    provider,
    defaultBranch: entry.defaultBranch ?? 'main',
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
    return entries.filter((e) => Boolean(e.remoteUrl)).map(toPreviewRepo);
  } catch {
    return [];
  }
}

/**
 * Disconnect a real repo. REJECTS with the server's reason (an `ApiError`
 * carrying its message): the server refuses a disconnect it cannot make safely
 * — a spec scan another process is running holds the tree — and a caller that
 * swallowed that would show the row snap back with nothing said.
 */
export function disconnectRealRepo(id: string): Promise<void> {
  return deleteRepo(id);
}
