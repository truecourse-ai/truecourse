/**
 * The registry, backed by the `repositories` table. There is no registry
 * table: every entry is a connected repository's row (the single source of
 * truth connect and unlink maintain), so it can neither drift nor accumulate
 * orphans. The slug is the row's own column, minted when the repository was
 * connected, so a lookup is one indexed select and never re-derives anything.
 *
 * Every read is scoped to a workspace: a slug is unique within its workspace
 * only, and a repository another workspace connected is not found here rather
 * than found and filtered out.
 */

import { and, eq } from 'drizzle-orm';
import { repositories, type Db } from '@truecourse/db';
import type { RegistryEntry, RegistryStore } from '@truecourse/core/config/registry';

type RepositoryRow = typeof repositories.$inferSelect;

function toEntry(r: RepositoryRow): RegistryEntry {
  // `path` is the opaque repo identity every per-repo store keys by (repoKey).
  // `defaultBranch` comes from the row so the repo route never has to shell
  // out to git on a non-path identity (a run works on a copy, and nothing is
  // checked out between runs). `remoteUrl` is where the provider serves it,
  // which the client reads as the mark of a connected repository — a local
  // folder's is the path it was connected from.
  return {
    slug: r.slug,
    name: r.repoFullName,
    path: r.repoFullName,
    provider: r.provider,
    ...(r.defaultBranch ? { defaultBranch: r.defaultBranch } : {}),
    remoteUrl:
      r.provider === 'local'
        ? (r.location ?? r.repoFullName)
        : `https://github.com/${r.repoFullName}`,
  };
}

export class RepositoriesRegistryStore implements RegistryStore {
  constructor(private readonly db: Db) {}

  async readRegistry(workspaceOrgId: string): Promise<RegistryEntry[]> {
    // Oldest connection first, full name as the tiebreak: the order the
    // workspace connected them in, which is how the home page lists them.
    const rows = await this.db
      .select()
      .from(repositories)
      .where(eq(repositories.workspaceOrgId, workspaceOrgId))
      .orderBy(repositories.createdAt, repositories.repoFullName);
    return rows.map(toEntry);
  }

  async getProjectBySlug(workspaceOrgId: string, slug: string): Promise<RegistryEntry | null> {
    const rows = await this.db
      .select()
      .from(repositories)
      .where(and(eq(repositories.workspaceOrgId, workspaceOrgId), eq(repositories.slug, slug)))
      .limit(1);
    return rows[0] ? toEntry(rows[0]) : null;
  }

  async getProjectByPath(workspaceOrgId: string, repoPath: string): Promise<RegistryEntry | null> {
    const rows = await this.db
      .select()
      .from(repositories)
      .where(and(eq(repositories.workspaceOrgId, workspaceOrgId), eq(repositories.repoFullName, repoPath)))
      .limit(1);
    return rows[0] ? toEntry(rows[0]) : null;
  }
}
