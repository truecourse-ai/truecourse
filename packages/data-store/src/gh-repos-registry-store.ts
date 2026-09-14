/**
 * The registry, backed by the gate's `gh_repos` table. There is no registry
 * table: every entry is DERIVED from `gh_repos` (the single source of truth
 * connect and unlink maintain), so it can neither drift nor accumulate
 * orphans.
 *
 * Slugs use the same `slugify` as core, minted over the whole set in a STABLE
 * ORDER (connection time, then full name): repo full names are globally unique,
 * but slugification is lossy (`acme/data-pipeline`, `acme/data_pipeline` and
 * `acme-data/pipeline` all collapse to `acme-data-pipeline`), so colliding
 * names take deterministic `-2` suffixes instead of racing for one slug. Every
 * lookup derives slugs the same way, so an entry's slug is consistent across
 * `readRegistry` / `getProjectBySlug` / `getProjectByPath`.
 *
 * NOTE: `readRegistry()` is global (the core seam has no org param), which is fine
 * for slug → repo resolution. Workspace-scoped surfaces (the overview) must query
 * `gh_repos` by org directly, not through this seam.
 */

import { ghRepos, type Db } from '@truecourse/db';
import { slugify, type RegistryEntry, type RegistryStore } from '@truecourse/core/config/registry';

type GhRepoRow = typeof ghRepos.$inferSelect;

function toEntries(rows: GhRepoRow[]): RegistryEntry[] {
  // Oldest connection first, full name as the tiebreak — the order is part of
  // slug identity (the earlier repo keeps the base slug on a collision), so it
  // must not depend on whatever order Postgres returned the rows in.
  const ordered = [...rows].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.repoFullName.localeCompare(b.repoFullName),
  );
  const taken: string[] = [];
  return ordered.map((r) => {
    const slug = slugify(r.repoFullName, taken);
    taken.push(slug);
    // `path` is the opaque repo identity every per-repo store keys by (repoKey).
    // `defaultBranch` comes from gh_repos so the repo route never has to shell out
    // to git on a non-path identity (there's no local checkout in hosted mode).
    // `remoteUrl` marks the entry as a connected GitHub repo to the client
    // (the preview shell keys "real" repos off its presence).
    return {
      slug,
      name: r.repoFullName,
      path: r.repoFullName,
      defaultBranch: r.defaultBranch,
      remoteUrl: `https://github.com/${r.repoFullName}`,
    };
  });
}

export class GhReposRegistryStore implements RegistryStore {
  constructor(private readonly db: Db) {}

  async readRegistry(): Promise<RegistryEntry[]> {
    const rows = await this.db.select().from(ghRepos);
    return toEntries(rows);
  }

  async getProjectBySlug(slug: string): Promise<RegistryEntry | null> {
    return (await this.readRegistry()).find((e) => e.slug === slug) ?? null;
  }

  async getProjectByPath(repoPath: string): Promise<RegistryEntry | null> {
    // Derived over the full set (not a single-row select) so the entry carries
    // the same collision-suffixed slug every other lookup would mint for it.
    return (await this.readRegistry()).find((e) => e.path === repoPath) ?? null;
  }
}
