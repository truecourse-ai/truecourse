import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { getProjectBySlug, touchProject, type RegistryEntry } from '@truecourse/core/config/registry';

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
 * May this caller act on this registry entry? A repository connected through
 * GitHub belongs to exactly one workspace, so it is invisible to every other
 * one — on the list, on `/:id`, and on every project-scoped router.
 *
 * KNOWN GAP: only linked repos are scoped. A repo registered by local path has
 * no link row and no owner, so it stays visible to everyone — the file registry
 * is per-machine and has nowhere to record a workspace. This narrows when the
 * registry itself moves to Postgres.
 */
export async function isVisibleTo(
  links: RepoOwnershipLookup | null | undefined,
  req: Request,
  entry: RegistryEntry,
): Promise<boolean> {
  if (!links) return true;
  const link = await links.getRepo(entry.name);
  return !link || link.workspaceOrgId === (req.user?.organizationId ?? null);
}

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
 * All per-project data reads happen in the route handlers via the file store.
 */
export function createProjectResolver(links: RepoOwnershipLookup | null): RequestHandler {
  return async function projectResolver(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
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
      await touchProject(project.slug);
      next();
    } catch (err) {
      next(err);
    }
  };
}
