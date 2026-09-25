import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { getProjectBySlug, type RegistryEntry } from '@truecourse/core/config/registry';

/**
 * Just enough of the repository store to scope a repository: which workspace
 * owns a connected repository, through which provider, and where that provider
 * finds it. Structural, so the real store satisfies it without the server's
 * routing layer depending on where it lives.
 */
export interface RepoOwnershipLookup {
  getRepo(repoFullName: string): Promise<{
    workspaceOrgId: string;
    provider?: string;
    /** Where the provider finds it, when the name is not enough (a folder's path). */
    location?: string | null;
  } | null>;
}

/**
 * May this workspace act on this registry entry? A repository exists here only
 * by being connected, so it belongs to exactly one workspace and is invisible
 * to every other one — on the list, on `/:id`, on every project-scoped router
 * and on every MCP tool. CLOSED by construction: no store and no row both mean
 * nobody sees it, never everybody.
 */
export async function isVisibleTo(
  links: RepoOwnershipLookup | null | undefined,
  org: string | null | undefined,
  entry: RegistryEntry,
): Promise<boolean> {
  if (!links || !org) return false;
  const link = await links.getRepo(entry.name);
  return link !== null && link.workspaceOrgId === org;
}

/**
 * The entry a slug names in this workspace, when the workspace may act on it;
 * null otherwise. Another workspace's slug is not found in this workspace's
 * registry, and `isVisibleTo` then asserts the row's own workspace agrees.
 */
export async function resolveVisibleProject(
  links: RepoOwnershipLookup | null | undefined,
  org: string | null | undefined,
  slug: string,
): Promise<RegistryEntry | null> {
  if (!org) return null;
  const entry = await getProjectBySlug(org, slug);
  if (!entry || !(await isVisibleTo(links, org, entry))) return null;
  return entry;
}

/** Marks a request the resolver already admitted, so the project-scoped
 *  mounts sharing it don't re-pay the registry + ownership lookups per mount. */
const RESOLVED = Symbol('projectResolved');

/**
 * Middleware for project-scoped routers mounted at `/api/repos`. Each router's
 * own patterns declare the `:id` segment (e.g. `/:id/guard/status`), so at the
 * time this middleware runs Express hasn't parsed route params yet — we pull
 * the slug from the first path segment directly.
 *
 * Resolves the slug against the caller's workspace's registry and rejects with
 * 404 if unknown there: a repository another workspace connected is not found,
 * not fetched and refused. 404 rather than 403 on purpose: a 403 would confirm
 * the repository exists to someone who may not know it does.
 *
 * All per-project data reads happen in the route handlers via the stores.
 */
export function createProjectResolver(links: RepoOwnershipLookup | null): RequestHandler {
  return async function projectResolver(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if ((req as Request & { [RESOLVED]?: true })[RESOLVED]) {
        next();
        return;
      }
      const slug = req.path.split('/').filter(Boolean)[0];
      if (!slug) {
        res.status(400).json({ error: 'Missing project slug' });
        return;
      }
      const project = await resolveVisibleProject(links, req.user?.organizationId, slug);
      if (!project) {
        res.status(404).json({ error: `Project "${slug}" not found` });
        return;
      }
      (req as Request & { [RESOLVED]?: true })[RESOLVED] = true;
      next();
    } catch (err) {
      next(err);
    }
  };
}
