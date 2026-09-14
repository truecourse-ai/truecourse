/**
 * Postgres InstallationStore — the GitHub App's own rows, built on Drizzle ORM.
 * An installation is a PROVIDER ACCOUNT (`provider_accounts`, provider
 * `github`), whose id is text there and a number in GitHub's own language, so
 * the conversion happens at this boundary and nowhere else. The repositories an
 * installation brought live in `repositories` and are written through
 * `PgRepositoryStore`.
 *
 * Takes a ready (migrated) Drizzle db: the server owns the pool and the
 * migrations, and tests inject a PGlite-backed db.
 */

import { eq, and, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { InstallationStore, InstallationRecord } from './types.js';
import { providerAccounts } from '@truecourse/db';
import { GITHUB_PROVIDER } from '../provider.js';

/** Any Drizzle Postgres db (node-postgres in prod, PGlite in tests). */
export type InstallationDb = PgDatabase<any, any, any>;

const toIso = (v: string): string => new Date(v).toISOString();

type InstallationRow = typeof providerAccounts.$inferSelect;

function toInstallation(r: InstallationRow): InstallationRecord {
  return {
    installationId: Number(r.accountId),
    accountLogin: r.accountLogin,
    accountType: r.accountType,
    workspaceOrgId: r.workspaceOrgId,
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  };
}

export class PostgresInstallationStore implements InstallationStore {
  constructor(
    private readonly db: InstallationDb,
    private readonly onClose?: () => Promise<void>,
  ) {}

  /** One installation's row, in the provider-generic key. */
  private account(installationId: number) {
    return and(
      eq(providerAccounts.provider, GITHUB_PROVIDER),
      eq(providerAccounts.accountId, String(installationId)),
    );
  }

  async saveInstallation(rec: InstallationRecord): Promise<void> {
    await this.db
      .insert(providerAccounts)
      .values({
        provider: GITHUB_PROVIDER,
        accountId: String(rec.installationId),
        accountLogin: rec.accountLogin,
        accountType: rec.accountType,
        workspaceOrgId: rec.workspaceOrgId,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
      })
      .onConflictDoUpdate({
        target: [providerAccounts.provider, providerAccounts.accountId],
        set: {
          accountLogin: sql`excluded.account_login`,
          accountType: sql`excluded.account_type`,
          // Don't wipe an existing link when a re-sent event has no workspace.
          workspaceOrgId: sql`coalesce(excluded.workspace_org_id, ${providerAccounts.workspaceOrgId})`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  async getInstallation(
    installationId: number,
  ): Promise<InstallationRecord | null> {
    const rows = await this.db
      .select()
      .from(providerAccounts)
      .where(this.account(installationId))
      .limit(1);
    return rows[0] ? toInstallation(rows[0]) : null;
  }

  async removeInstallation(installationId: number): Promise<void> {
    await this.db.delete(providerAccounts).where(this.account(installationId));
  }

  async linkInstallationToWorkspace(
    installationId: number,
    workspaceOrgId: string,
  ): Promise<void> {
    await this.db
      .update(providerAccounts)
      .set({ workspaceOrgId, updatedAt: new Date().toISOString() })
      .where(this.account(installationId));
  }

  async listInstallationsForWorkspace(
    workspaceOrgId: string,
  ): Promise<InstallationRecord[]> {
    const rows = await this.db
      .select()
      .from(providerAccounts)
      .where(
        and(
          eq(providerAccounts.provider, GITHUB_PROVIDER),
          eq(providerAccounts.workspaceOrgId, workspaceOrgId),
        ),
      );
    return rows.map(toInstallation);
  }

  async close(): Promise<void> {
    await this.onClose?.();
  }
}
