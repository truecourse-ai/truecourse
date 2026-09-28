/**
 * Postgres InstallationStore — the GitHub App's own rows, built on Drizzle ORM.
 * An installation is a PROVIDER ACCOUNT (`provider_accounts`, provider
 * `github`), whose id is text there and a number in GitHub's own language, so
 * the conversion happens at this boundary and nowhere else. The workspaces an
 * installation is attached to are `provider_account_links` rows, one per
 * workspace. The repositories an installation brought live in `repositories`
 * and are written through `PgRepositoryStore`.
 *
 * Every read is ONE query: the account joined to its links, grouped here.
 * The reads sit on every connect request (the ownership check) and on every
 * status read, so a second round trip per installation would add up.
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

/** An account row joined to one of its links, or to none (a left join's null side). */
interface JoinedRow {
  account: InstallationRow;
  workspaceOrgId: string | null;
  linkedAt: string | null;
}

function toInstallation(r: InstallationRow, workspaceOrgIds: string[]): InstallationRecord {
  return {
    installationId: Number(r.accountId),
    accountLogin: r.accountLogin,
    accountType: r.accountType,
    permissions: r.permissions ?? null,
    workspaceOrgIds,
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  };
}

/** Fold joined rows (ordered by link age) into one record per account, links in attach order. */
function group(rows: JoinedRow[]): Map<string, { account: InstallationRow; links: JoinedRow[] }> {
  const byAccount = new Map<string, { account: InstallationRow; links: JoinedRow[] }>();
  for (const row of rows) {
    const entry = byAccount.get(row.account.accountId) ?? { account: row.account, links: [] };
    if (row.workspaceOrgId !== null) entry.links.push(row);
    byAccount.set(row.account.accountId, entry);
  }
  return byAccount;
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

  /** Accounts with every link each carries, oldest link first. */
  private joined() {
    return this.db
      .select({
        account: providerAccounts,
        workspaceOrgId: providerAccountLinks.workspaceOrgId,
        linkedAt: providerAccountLinks.createdAt,
      })
      .from(providerAccounts)
      .leftJoin(
        providerAccountLinks,
        and(
          eq(providerAccountLinks.provider, providerAccounts.provider),
          eq(providerAccountLinks.accountId, providerAccounts.accountId),
        ),
      );
  }

  async saveInstallation(rec: InstallationAccount): Promise<void> {
    await this.db
      .insert(providerAccounts)
      .values({
        provider: GITHUB_PROVIDER,
        accountId: String(rec.installationId),
        accountLogin: rec.accountLogin,
        accountType: rec.accountType,
        permissions: rec.permissions ?? null,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
      })
      .onConflictDoUpdate({
        target: [providerAccounts.provider, providerAccounts.accountId],
        set: {
          accountLogin: sql`coalesce(nullif(excluded.account_login, ''), ${providerAccounts.accountLogin})`,
          accountType: sql`coalesce(nullif(excluded.account_type, ''), ${providerAccounts.accountType})`,
          permissions: sql`coalesce(excluded.permissions, ${providerAccounts.permissions})`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  async getInstallation(
    installationId: number,
  ): Promise<InstallationRecord | null> {
    const rows = await this.joined()
      .where(this.account(installationId))
      .orderBy(providerAccountLinks.createdAt);
    const entry = group(rows).get(String(installationId));
    return entry
      ? toInstallation(entry.account, entry.links.map((l) => l.workspaceOrgId!))
      : null;
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
    // The accounts this workspace holds, with EVERY workspace's link on each,
    // in the order this workspace attached them.
    const held = this.db
      .select({ accountId: providerAccountLinks.accountId })
      .from(providerAccountLinks)
      .where(
        and(
          eq(providerAccountLinks.provider, GITHUB_PROVIDER),
          eq(providerAccountLinks.workspaceOrgId, workspaceOrgId),
        ),
      );
    const rows = await this.joined()
      .where(
        and(
          eq(providerAccounts.provider, GITHUB_PROVIDER),
          inArray(providerAccounts.accountId, held),
        ),
      )
      .orderBy(providerAccountLinks.createdAt);
    return [...group(rows).values()]
      .map((entry) => ({
        record: toInstallation(entry.account, entry.links.map((l) => l.workspaceOrgId!)),
        attachedAt: entry.links.find((l) => l.workspaceOrgId === workspaceOrgId)?.linkedAt ?? '',
      }))
      .sort((a, b) => a.attachedAt.localeCompare(b.attachedAt))
      .map((entry) => entry.record);
  }

  async close(): Promise<void> {
    await this.onClose?.();
  }
}
