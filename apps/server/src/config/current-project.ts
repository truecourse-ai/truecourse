import { type RegistryEntry, registerProject, getProjectBySlug } from './registry.js';

/**
 * The server (Chunk 3–5 state) binds to a single project resolved at startup.
 * Chunk 6 will make the server fully multi-project; this module is the
 * intermediate single-project accessor.
 */
let _current: RegistryEntry | null = null;

/**
 * Register `repoPath` in the global registry (if not already present) and
 * stash the resulting entry as the server's active project. Safe to call
 * multiple times — re-registering refreshes `lastOpened`.
 */
export function setCurrentProject(repoPath: string): RegistryEntry {
  _current = registerProject(repoPath);
  return _current;
}

export function getCurrentProject(): RegistryEntry {
  if (!_current) {
    throw new Error('Current project not initialized. Call setCurrentProject() first.');
  }
  return _current;
}

export function maybeGetCurrentProject(): RegistryEntry | null {
  return _current;
}

/**
 * Resolve a `:id` URL param to a `RegistryEntry`. Throws NotFound if the slug
 * is unknown. Throws Forbidden-style error if the slug is not the currently
 * bound project (intermediate state until Chunk 6 makes the server
 * fully multi-project).
 */
export function resolveProjectForRequest(slug: string): RegistryEntry {
  const entry = getProjectBySlug(slug);
  if (!entry) {
    const err = new Error(`Project "${slug}" not found in registry`) as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  const current = getCurrentProject();
  if (entry.slug !== current.slug) {
    const err = new Error(
      `Project "${slug}" is not served by this server instance (bound to "${current.slug}").`,
    ) as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  return entry;
}
