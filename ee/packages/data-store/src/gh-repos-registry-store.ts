/**
 * Registry store backed by the gate's `gh_repos` table — the enterprise edition
 * keeps NO separate project registry. The "registry" is a LIVE VIEW of connected
 * repos: every entry is derived from `gh_repos` (the single source of truth that
 * connect/unlink maintain), so it can never drift or accumulate orphans the way a
 * standalone `registry` table did.
 *
 * Slugs use the same `slugify` as core, so `/repos/:slug` deep-links resolve
 * identically. Repo full names are globally unique, so no collision suffixes are
 * needed (and a repo that isn't connected simply doesn't resolve — which is what
 * we want). Mutations are no-ops: `gh_repos` owns the set.
 *
 * NOTE: `readRegistry()` is global (the core seam has no org param), which is fine
 * for slug → repo resolution. Workspace-scoped surfaces (the overview) must query
 * `gh_repos` by org directly, not through this seam.
 */

import { eq } from 'drizzle-orm';
import { ghRepos, type EeDb } from '@truecourse/ee-db';
import { slugify, type RegistryEntry, type RegistryStore } from '@truecourse/core/config/registry';

type GhRepoRow = typeof ghRepos.$inferSelect;

function toEntry(r: GhRepoRow): RegistryEntry {
  // `path` is the opaque repo identity every per-repo store keys by (repoKey).
  return { slug: slugify(r.repoFullName, []), name: r.repoFullName, path: r.repoFullName };
}

export class GhReposRegistryStore implements RegistryStore {
  constructor(private readonly db: EeDb) {}

  async readRegistry(): Promise<RegistryEntry[]> {
    const rows = await this.db.select().from(ghRepos);
    return rows.map(toEntry);
  }

  async pruneStaleProjects(): Promise<RegistryEntry[]> {
    return this.readRegistry(); // a derived view has nothing to prune
  }

  async getProjectBySlug(slug: string): Promise<RegistryEntry | null> {
    return (await this.readRegistry()).find((e) => e.slug === slug) ?? null;
  }

  async getProjectByPath(repoPath: string): Promise<RegistryEntry | null> {
    const [row] = await this.db
      .select()
      .from(ghRepos)
      .where(eq(ghRepos.repoFullName, repoPath))
      .limit(1);
    return row ? toEntry(row) : null;
  }

  async registerProject(repoPath: string): Promise<RegistryEntry> {
    // `gh_repos` (maintained by connect/unlink) is the source of truth; just
    // reflect the derived entry. Fall back to a path-derived entry if the row
    // isn't present yet (shouldn't happen — link writes gh_repos first).
    return (
      (await this.getProjectByPath(repoPath)) ?? {
        slug: slugify(repoPath, []),
        name: repoPath,
        path: repoPath,
      }
    );
  }

  async unregisterProject(): Promise<boolean> {
    return true; // unlinkRepo deletes the gh_repos row — nothing else to remove
  }

  async touchProject(): Promise<void> {
    /* no-op — last-opened isn't tracked in the gate store */
  }

  async setLastAnalyzed(): Promise<void> {
    /* no-op — the EE gate doesn't run code analysis */
  }
}
