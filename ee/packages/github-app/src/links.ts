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

/** Deep link to a PR's Contracts tab (head ref → surfaces its inferred contracts). */
export async function contractsDashboardUrl(
  appUrl: string | undefined,
  repoFullName: string,
  prNumber: number,
): Promise<string | undefined> {
  if (!appUrl) return undefined;
  const slug = await repoSlug(repoFullName);
  if (!slug) return undefined;
  return `${appUrl.replace(/\/$/, '')}/repos/${slug}?pr=${prNumber}&section=verification&tab=contracts`;
}

/** Deep link to a repo's PR view, scoped to a lens (Code Quality / Verification). */
export async function prSectionUrl(
  appUrl: string | undefined,
  repoFullName: string,
  prNumber: number,
  section: 'codequality' | 'verification',
): Promise<string | undefined> {
  if (!appUrl) return undefined;
  const slug = await repoSlug(repoFullName);
  if (!slug) return undefined;
  // Land directly on each lens's analytics tab so the PR opens on the overview
  // rather than the section default (which would flash before redirecting).
  const tab = section === 'codequality' ? 'analytics' : 'driftanalytics';
  return `${appUrl.replace(/\/$/, '')}/repos/${slug}?pr=${prNumber}&section=${section}&tab=${tab}`;
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
