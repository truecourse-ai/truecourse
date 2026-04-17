import type { Request, Response, NextFunction } from 'express';
import { getProjectBySlug, touchProject } from '../config/registry.js';
import { withProjectDb } from '../config/database.js';

/**
 * Middleware for project-scoped routers mounted at `/api/repos`. Each router's
 * own patterns declare the `:id` segment (e.g. `/:id/violations`), so at the
 * time this middleware runs Express hasn't parsed route params yet — we pull
 * the slug from the first path segment directly.
 *
 * Opens (or reuses) the project's PGlite instance and binds it to the
 * request's async context so handlers can use the shared `db` proxy.
 */
export function projectResolver(req: Request, res: Response, next: NextFunction): void {
  const slug = req.path.split('/').filter(Boolean)[0];
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
  }).catch((err: Error & { code?: string; statusCode?: number }) => {
    if (err.code === 'NO_PROJECT_DB') {
      res.status(404).json({ error: err.message, code: 'NO_PROJECT_DB' });
      return;
    }
    next(err);
  });
}
