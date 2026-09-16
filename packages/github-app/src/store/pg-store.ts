/**
 * Postgres InstallationStore — the GitHub App's own rows, built on Drizzle ORM.
 * An installation is a PROVIDER ACCOUNT (`provider_accounts`, provider
 * `github`), whose id is text there and a number in GitHub's own language, so
 * the conversion happens at this boundary and nowhere else. The workspaces an
 * installation is attached to are `provider_account_links` rows, one per
 * workspace. The repositories an installation brought live in `repositories`
 * and are written through `PgRepositoryStore`.
 *
 * Takes a ready (migrated) Drizzle db: the server owns the pool and the
 * migrations, and tests inject a PGlite-backed db.
 */

import { eq, and, sql, inArray } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { InstallationStore, InstallationRecord, InstallationAccount } from './types.js';
import { providerAccounts, providerAccountLinks } from '@truecourse/db';
import { GITHUB_PROVIDER } from '../provider.js';

/** Any Drizzle Postgres db (node-postgres in prod, PGlite in tests). */
export type InstallationDb = PgDatabase<any, any, any>;

const toIso = (v: string): string => new Date(v).toISOString();

type InstallationRow = typeof providerAccounts.$inferSelect;

function toInstallation(r: InstallationRow, workspaceOrgIds: string[]): InstallationRecord {
  return {
    installationId: Number(r.accountId),
    accountLogin: r.accountLogin,
    accountType: r.accountType,
    workspaceOrgIds,
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

  /** The workspaces attached to each of the given accounts, keyed by account id. */
  private async linksOf(accountIds: string[]): Promise<Map<string, string[]>> {
    const links = new Map<string, string[]>();
    if (accountIds.length === 0) return links;
    const rows = await this.db
      .select({
        accountId: providerAccountLinks.accountId,
        workspaceOrgId: providerAccountLinks.workspaceOrgId,
      })
      .from(providerAccountLinks)
      .where(
        and(
          eq(providerAccountLinks.provider, GITHUB_PROVIDER),
          inArray(providerAccountLinks.accountId, accountIds),
        ),
      )
      .orderBy(providerAccountLinks.createdAt);
    for (const row of rows) {
      links.set(row.accountId, [...(links.get(row.accountId) ?? []), row.workspaceOrgId]);
    }
    return links;
  }

  async saveInstallation(rec: InstallationAccount): Promise<void> {
    await this.db
      .insert(providerAccounts)
      .values({
        provider: GITHUB_PROVIDER,
        accountId: String(rec.installationId),
        accountLogin: rec.accountLogin,
        accountType: rec.accountType,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
      })
      .onConflictDoUpdate({
        target: [providerAccounts.provider, providerAccounts.accountId],
        set: {
          accountLogin: sql`excluded.account_login`,
          accountType: sql`excluded.account_type`,
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
    if (!rows[0]) return null;
    const links = await this.linksOf([rows[0].accountId]);
    return toInstallation(rows[0], links.get(rows[0].accountId) ?? []);
  }

  async removeInstallation(installationId: number): Promise<void> {
    // The links cascade with the account row.
    await this.db.delete(providerAccounts).where(this.account(installationId));
  }

  async linkInstallationToWorkspace(
    installationId: number,
    workspaceOrgId: string,
  ): Promise<void> {
    await this.db
      .insert(providerAccountLinks)
      .values({
        provider: GITHUB_PROVIDER,
        accountId: String(installationId),
        workspaceOrgId,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing();
  }

  async unlinkInstallationFromWorkspace(
    installationId: number,
    workspaceOrgId: string,
  ): Promise<void> {
    await this.db
      .delete(providerAccountLinks)
      .where(
        and(
          eq(providerAccountLinks.provider, GITHUB_PROVIDER),
          eq(providerAccountLinks.accountId, String(installationId)),
          eq(providerAccountLinks.workspaceOrgId, workspaceOrgId),
        ),
      );
  }

  async listInstallationsForWorkspace(
    workspaceOrgId: string,
  ): Promise<InstallationRecord[]> {
    const rows = await this.db
      .select({ account: providerAccounts })
      .from(providerAccountLinks)
      .innerJoin(
        providerAccounts,
        and(
          eq(providerAccounts.provider, providerAccountLinks.provider),
          eq(providerAccounts.accountId, providerAccountLinks.accountId),
        ),
      )
      .where(
        and(
          eq(providerAccountLinks.provider, GITHUB_PROVIDER),
          eq(providerAccountLinks.workspaceOrgId, workspaceOrgId),
        ),
      )
      .orderBy(providerAccountLinks.createdAt);
    const links = await this.linksOf(rows.map((r) => r.account.accountId));
    return rows.map((r) => toInstallation(r.account, links.get(r.account.accountId) ?? []));
  }

  async close(): Promise<void> {
    await this.onClose?.();
  }
}
