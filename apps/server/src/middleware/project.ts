import type { Request, Response, NextFunction } from 'express';
import { getProjectBySlug, touchProject } from '../config/registry.js';
import { withProjectDb } from '../config/database.js';

/**
 * Middleware for routes mounted under `/api/repos/:id/...`. Resolves the
 * slug in `req.params.id` against the registry, opens (or reuses) that
 * project's PGlite instance, and binds it to the request's async context so
 * handlers can use the shared `db` proxy.
 *
 * Routes that don't need a DB (e.g. the home-page registry list) should NOT
 * use this middleware.
 */
export function projectResolver(req: Request, res: Response, next: NextFunction): void {
  const slugParam = req.params.id;
  const slug = Array.isArray(slugParam) ? slugParam[0] : slugParam;
  if (!slug) {
    res.status(400).json({ error: 'Missing project slug' });
    return;
  }
  const project = getProjectBySlug(slug);
  if (!project) {
    res.status(404).json({ error: `Project "${slug}" not found` });
    return;
  }

  withProjectDb(project, () => {
    touchProject(project.slug);
    return new Promise<void>((resolve) => {
      res.on('finish', resolve);
      res.on('close', resolve);
      next();
    });
  }).catch(next);
}
