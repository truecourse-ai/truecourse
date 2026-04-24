import { type RegistryEntry, getProjectBySlug } from './registry.js';

/**
 * Look up a project by `:id` slug. Used by every project-scoped route
 * handler. Throws a 404-style error if the slug is unknown.
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
