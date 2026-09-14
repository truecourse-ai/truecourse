/**
 * The connected repositories, in Postgres. One table for every provider: the
 * GitHub App writes its links here, the local folder provider writes its own,
 * and every workspace-scoped surface reads them through the one contract in
 * `@truecourse/shared`.
 */

import { and, eq } from 'drizzle-orm';
import type {
  RepositoryProviderId,
  RepositoryRecord,
  RepositoryStore,
} from '@truecourse/shared';
import { repositories, type Db } from '@truecourse/db';

type Row = typeof repositories.$inferSelect;

const toIso = (v: string): string => new Date(v).toISOString();

function toRecord(r: Row): RepositoryRecord {
  return {
    repoFullName: r.repoFullName,
    provider: r.provider as RepositoryProviderId,
    accountId: r.accountId,
    workspaceOrgId: r.workspaceOrgId,
    defaultBranch: r.defaultBranch,
    location: r.location,
    blocking: r.blocking,
    enabled: r.enabled,
    notifyEmails: r.notifyEmails,
    notifications: (r.notifications as unknown as RepositoryRecord['notifications']) ?? undefined,
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  };
}

export class PgRepositoryStore implements RepositoryStore {
  constructor(private readonly db: Db) {}

  async linkRepo(rec: RepositoryRecord): Promise<void> {
    await this.db
      .insert(repositories)
      .values({
        repoFullName: rec.repoFullName,
        provider: rec.provider,
        accountId: rec.accountId,
        workspaceOrgId: rec.workspaceOrgId,
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
          location: rec.location ?? null,
          blocking: rec.blocking,
          enabled: rec.enabled,
          notifyEmails: rec.notifyEmails ?? [],
          notifications: (rec.notifications ?? null) as Record<string, boolean> | null,
          updatedAt: rec.updatedAt,
        },
      });
  }

  async unlinkRepo(repoFullName: string): Promise<void> {
    await this.db.delete(repositories).where(eq(repositories.repoFullName, repoFullName));
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
}
