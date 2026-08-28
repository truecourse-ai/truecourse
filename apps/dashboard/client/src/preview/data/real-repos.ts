// PREVIEW: the repo list here is REAL (it talks to the dashboard server);
// everything else in the preview is fake data.

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
 * Every call degrades to nothing: with no server behind it (a static preview, a
 * test) the list is simply empty rather than an error the mock has no place for.
 */

import { deleteRepo, fetchApi, getRepos, type RepoResponse } from '@/lib/api';
import type { ProviderId, Repo } from './types';

/**
 * DEAD ROUTE. Connect-by-URL is gone from the server: repositories arrive
 * through the GitHub App now, and this call 404s. It stays only to keep the
 * preview's URL form compiling until that form is rebuilt around the App.
 */
export function connectRepo(url: string): Promise<RepoResponse> {
  return fetchApi<RepoResponse>('/api/repos/connect', {
    method: 'POST',
    body: JSON.stringify({ url }),
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

/** The URL-connected repos of the real registry. Empty when there is no server to ask. */
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
