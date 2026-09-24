/**
 * The connected repositories, in Postgres. One table for every provider: the
 * GitHub App writes its links here, the local folder provider writes its own,
 * and every workspace-scoped surface reads them through the one contract in
 * `@truecourse/shared`.
 */

import { and, eq } from 'drizzle-orm';
import type {
  RepositoryLink,
  RepositoryProviderId,
  RepositoryRecord,
  RepositoryStore,
} from '@truecourse/shared';
import { repositories, type Db } from '@truecourse/db';
import { iso } from './iso.js';
import { slugify } from '@truecourse/core/config/registry';

type Row = typeof repositories.$inferSelect;


function toRecord(r: Row): RepositoryRecord {
  return {
    repoFullName: r.repoFullName,
    provider: r.provider as RepositoryProviderId,
    accountId: r.accountId,
    workspaceOrgId: r.workspaceOrgId,
    slug: r.slug,
    defaultBranch: r.defaultBranch,
    defaultBranchSha: r.defaultBranchSha,
    mainChainSha: r.mainChainSha,
    location: r.location,
    blocking: r.blocking,
    enabled: r.enabled,
    notifyEmails: r.notifyEmails,
    notifications: (r.notifications as unknown as RepositoryRecord['notifications']) ?? undefined,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export class PgRepositoryStore implements RepositoryStore {
  constructor(private readonly db: Db) {}

  /**
   * A new connection is given its slug here, from its name against the slugs
   * its workspace already holds (a collision inside the workspace takes a `-2`
   * suffix; another workspace's slugs do not count). A re-link at a name the
   * workspace already connected keeps the slug it has: the row is updated, the
   * URL never moves.
   */
  async linkRepo(rec: RepositoryLink): Promise<RepositoryRecord> {
    const taken = await this.db
      .select({ slug: repositories.slug })
      .from(repositories)
      .where(eq(repositories.workspaceOrgId, rec.workspaceOrgId));
    const [row] = await this.db
      .insert(repositories)
      .values({
        repoFullName: rec.repoFullName,
        provider: rec.provider,
        accountId: rec.accountId,
        workspaceOrgId: rec.workspaceOrgId,
        slug: slugify(rec.repoFullName, taken.map((r) => r.slug)),
        defaultBranch: rec.defaultBranch,
        location: rec.location ?? null,
        blocking: rec.blocking,
        enabled: rec.enabled,
        notifyEmails: rec.notifyEmails ?? [],
        notifications: (rec.notifications ?? null) as Record<string, boolean> | null,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
      })
      .onConflictDoUpdate({
        target: repositories.repoFullName,
        set: {
          provider: rec.provider,
          accountId: rec.accountId,
          workspaceOrgId: rec.workspaceOrgId,
          defaultBranch: rec.defaultBranch,
          // A reconnect starts afresh: the last push the old connection saw
          // says nothing about the branch now.
          defaultBranchSha: null,
          mainChainSha: null,
          location: rec.location ?? null,
          blocking: rec.blocking,
          enabled: rec.enabled,
          notifyEmails: rec.notifyEmails ?? [],
          notifications: (rec.notifications ?? null) as Record<string, boolean> | null,
          updatedAt: rec.updatedAt,
        },
      })
      .returning();
    if (!row) throw new Error(`linking ${rec.repoFullName} wrote no row`);
    return toRecord(row);
  }

  async unlinkRepo(repoFullName: string): Promise<void> {
    await this.db.delete(repositories).where(eq(repositories.repoFullName, repoFullName));
  }

  async recordDefaultBranchSha(repoFullName: string, commitSha: string): Promise<void> {
    await this.db
      .update(repositories)
      .set({ defaultBranchSha: commitSha })
      .where(eq(repositories.repoFullName, repoFullName));
  }

  async recordMainChainSha(repoFullName: string, commitSha: string): Promise<void> {
    await this.db
      .update(repositories)
      .set({ mainChainSha: commitSha })
      .where(eq(repositories.repoFullName, repoFullName));
  }

  async getRepo(repoFullName: string): Promise<RepositoryRecord | null> {
    const rows = await this.db
      .select()
      .from(repositories)
      .where(eq(repositories.repoFullName, repoFullName))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async listReposForWorkspace(workspaceOrgId: string): Promise<RepositoryRecord[]> {
    const rows = await this.db
      .select()
      .from(repositories)
      .where(eq(repositories.workspaceOrgId, workspaceOrgId))
      .orderBy(repositories.repoFullName);
    return rows.map(toRecord);
  }

  async listReposForAccount(
    provider: RepositoryProviderId,
    accountId: string,
  ): Promise<RepositoryRecord[]> {
    const rows = await this.db
      .select()
      .from(repositories)
      .where(and(eq(repositories.provider, provider), eq(repositories.accountId, accountId)))
      .orderBy(repositories.repoFullName);
    return rows.map(toRecord);
  }

  async moveReposToAccount(
    provider: RepositoryProviderId,
    fromAccountId: string,
    toAccountId: string,
  ): Promise<RepositoryRecord[]> {
    const rows = await this.db
      .update(repositories)
      .set({ accountId: toAccountId, updatedAt: new Date().toISOString() })
      .where(and(eq(repositories.provider, provider), eq(repositories.accountId, fromAccountId)))
      .returning();
    return rows.map(toRecord).sort((a, b) => a.repoFullName.localeCompare(b.repoFullName));
  }
}
