// PREVIEW: the repository list and the GitHub connect flow here are REAL (they
// talk to the dashboard server); everything else in the preview is fake data.

/**
 * The one seam where the preview touches the real server.
 *
 * A repository connected on the server is a real row on the real registry. The
 * preview shows those rows beside its fixtures: they carry no coverage, no runs
 * and no corpus (the fixture lookups all fall back to empty), so they render as
 * a freshly connected repository would.
 *
 * Only repos with a `remoteUrl` are shown. A developer's own path-registered
 * repos are their local dashboard's business, not the product preview's.
 *
 * The GitHub App is how one gets there: the status read says which installations
 * this workspace has and which repositories are already linked, an installation
 * lists what it can see, and linking one CLONES IT INSIDE THE REQUEST — minutes,
 * not milliseconds, which is why its caller has to say so.
 *
 * The registry reads degrade to nothing: with no server behind them (a static
 * preview, a test) the list is simply empty rather than an error the mock has no
 * place for. The GitHub calls do the opposite and reject, because the reason is
 * the whole answer — an unconfigured server names the variables it wants.
 */

import { deleteRepo, fetchApi, getRepos, type RepoResponse } from '@/lib/api';
import type {
  GithubConnectStatusResponse,
  GithubInstallableRepo,
  GithubInstallationReposResponse,
} from '@truecourse/shared';
import type { ProviderId, Repo } from './types';

/** The App's installations on this workspace, and the repositories already linked. */
export function fetchGithubStatus(): Promise<GithubConnectStatusResponse> {
  return fetchApi<GithubConnectStatusResponse>('/api/github/status');
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

/** Link one repository. Slow by design: the server clones it before answering. */
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

/** The provider of a remote, by host. An unknown host reads as github: the preview has no fourth icon. */
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

/** A registry entry as the preview's Repo: connected, with nothing run on it yet. */
export function toPreviewRepo(entry: RepoResponse): Repo {
  const { fullName, provider } = parseRemote(entry.remoteUrl ?? '');
  return {
    id: entry.id,
    fullName,
    provider,
    visibility: 'public',
    defaultBranch: entry.defaultBranch ?? 'main',
    policy: 'advisory',
    baselineSha: 'no baseline yet',
    baselineAt: 'no baseline yet',
    notifyEmails: [],
    lastCheck: {
      conclusion: 'neutral',
      word: 'Neutral',
      summary: 'Connected, nothing has run yet',
      at: 'just now',
    },
    onboarding: false,
    real: true,
  };
}

/** The connected repos of the real registry. Empty when there is no server to ask. */
export async function fetchRealRepos(): Promise<Repo[]> {
  try {
    const entries = await getRepos();
    return entries.filter((e) => Boolean(e.remoteUrl)).map(toPreviewRepo);
  } catch {
    return [];
  }
}

/** Disconnect a real repo. Failure is swallowed: the caller refreshes either way. */
export async function disconnectRealRepo(id: string): Promise<void> {
  try {
    await deleteRepo(id);
  } catch {
    // The refresh that follows shows whether it actually went.
  }
}
