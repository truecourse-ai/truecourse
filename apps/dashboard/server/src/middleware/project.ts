import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { getProjectBySlug, type RegistryEntry } from '@truecourse/core/config/registry';

/**
 * Just enough of the GitHub link store to scope a repository: which workspace
 * owns a connected repository, if any. Structural, so the real `GateStore`
 * satisfies it without the server's routing layer depending on the GitHub
 * package.
 */
export interface RepoOwnershipLookup {
  getRepo(repoFullName: string): Promise<{ workspaceOrgId: string } | null>;
}

/**
 * May this caller act on this registry entry? A repository exists here only by
 * being connected through GitHub, so it belongs to exactly one workspace and
 * is invisible to every other one — on the list, on `/:id`, and on every
 * project-scoped router. CLOSED by construction: no link store (GitHub App
 * unconfigured) or no link row means nobody sees it, never everybody.
 */
export async function isVisibleTo(
  links: RepoOwnershipLookup | null | undefined,
  req: Request,
  entry: RegistryEntry,
): Promise<boolean> {
  if (!links) return false;
  const org = req.user?.organizationId;
  if (!org) return false;
  const link = await links.getRepo(entry.name);
  return link !== null && link.workspaceOrgId === org;
}

/** Marks a request the resolver already admitted, so the twelve project-scoped
 *  mounts sharing it don't re-pay the registry + ownership lookups per mount. */
const RESOLVED = Symbol('projectResolved');

/**
 * Middleware for project-scoped routers mounted at `/api/repos`. Each router's
 * own patterns declare the `:id` segment (e.g. `/:id/violations`), so at the
 * time this middleware runs Express hasn't parsed route params yet — we pull
 * the slug from the first path segment directly.
 *
 * Resolves the slug against the registry and rejects with 404 if unknown, or if
 * it names a repository another workspace connected. 404 rather than 403 on
 * purpose: a 403 would confirm the repository exists to someone who may not
 * know it does.
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
      const project = await getProjectBySlug(slug);
      if (!project || !(await isVisibleTo(links, req, project))) {
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
