import { type RegistryEntry, getProjectBySlug } from './registry.js';

/**
 * Look up a repository by its `:id` slug within the caller's workspace. Used by
 * every project-scoped route handler. Throws a 404-style error when the
 * workspace holds no repository at that slug.
 */
export async function resolveProjectForRequest(workspaceOrgId: string, slug: string): Promise<RegistryEntry> {
  const entry = await getProjectBySlug(workspaceOrgId, slug);
  if (!entry) {
    const err = new Error(`Project "${slug}" not found in registry`) as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  return entry;
}
