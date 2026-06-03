/**
 * Dashboard deep links for PR comments. The hosted dashboard routes repos by
 * slug, so we resolve the repo's ACTUAL registered slug (linked repos are
 * registered by `owner/repo`) rather than recomputing it — `slugify` is lossy
 * and collisions get a `-2` suffix, so a recomputed base slug could point at the
 * wrong repo. `appUrl` is the dashboard base; when it's unset, or the repo isn't
 * registered yet, we return `undefined` and the comment omits the link.
 */

import { getProjectByPath } from '@truecourse/core/config/registry';

async function repoSlug(repoFullName: string): Promise<string | null> {
  const entry = await getProjectByPath(repoFullName);
  return entry?.slug ?? null;
}

/** Deep link to a repo's stored contracts (optionally pinned to a commit). */
export async function contractsDashboardUrl(
  appUrl: string | undefined,
  repoFullName: string,
  commitSha?: string,
): Promise<string | undefined> {
  if (!appUrl) return undefined;
  const slug = await repoSlug(repoFullName);
  if (!slug) return undefined;
  const base = `${appUrl.replace(/\/$/, '')}/repos/${slug}/contracts`;
  return commitSha ? `${base}?commit=${commitSha}` : base;
}

/** Link to a repo's dashboard page (drift/overview). */
export async function repoDashboardUrl(
  appUrl: string | undefined,
  repoFullName: string,
): Promise<string | undefined> {
  if (!appUrl) return undefined;
  const slug = await repoSlug(repoFullName);
  return slug ? `${appUrl.replace(/\/$/, '')}/repos/${slug}` : undefined;
}
