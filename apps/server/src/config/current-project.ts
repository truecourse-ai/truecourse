import { type RegistryEntry, getProjectBySlug } from './registry.js';
import { getCurrentProjectDb } from './database.js';

/**
 * Return the `RegistryEntry` for the project currently bound to the request's
 * async context. Throws if called outside a projectResolver-guarded request.
 */
export function getCurrentProject(): RegistryEntry {
  const handle = getCurrentProjectDb();
  if (!handle) {
    throw new Error('No active project. Route is missing the projectResolver middleware.');
  }
  return handle.project;
}

/**
 * Look up a project by `:id` slug. Used for routes that need project metadata
 * without opening its PGlite (e.g. git-only endpoints, config.json writers).
 * Throws a 404-style error if the slug is unknown.
 */
export function resolveProjectForRequest(slug: string): RegistryEntry {
  const entry = getProjectBySlug(slug);
  if (!entry) {
    const err = new Error(`Project "${slug}" not found in registry`) as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  return entry;
}
