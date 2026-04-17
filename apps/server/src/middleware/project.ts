import type { Request, Response, NextFunction } from 'express';
import { getProjectBySlug, touchProject } from '../config/registry.js';

/**
 * Middleware for project-scoped routers mounted at `/api/repos`. Each router's
 * own patterns declare the `:id` segment (e.g. `/:id/violations`), so at the
 * time this middleware runs Express hasn't parsed route params yet — we pull
 * the slug from the first path segment directly.
 *
 * Resolves the slug against the registry and rejects with 404 if unknown.
 * All per-project data reads happen in the route handlers via the file store.
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
  touchProject(project.slug);
  next();
}
