/**
 * Postgres GateStore — the GitHub App's own rows, built on Drizzle ORM. An
 * installation is a PROVIDER ACCOUNT (`provider_accounts`, provider `github`),
 * whose id is text there and a number in GitHub's own language, so the
 * conversion happens at this boundary and nowhere else. The repositories an
 * installation brought live in `repositories` and are written through
 * `PgRepositoryStore`.
 *
 * Takes a ready (migrated) Drizzle db: the server owns the pool and the
 * migrations, and tests inject a PGlite-backed db.
 */

import { eq, and, desc, notInArray, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type {
  GateStore,
  InstallationRecord,
  BaselineRecord,
  GateRunRecord,
  PrRecord,
} from './types.js';
import { providerAccounts, ghBaselines, ghRuns, ghPrs } from '@truecourse/db';
import { GITHUB_PROVIDER } from '../provider.js';

/** Any Drizzle Postgres db (node-postgres in prod, PGlite in tests). */
export type GateDb = PgDatabase<any, any, any>;

/** Per-repo run-history cap (matches the file adapter). */
const RUN_CAP = 200;

const toIso = (v: string): string => new Date(v).toISOString();

type InstallationRow = typeof providerAccounts.$inferSelect;
type BaselineRow = typeof ghBaselines.$inferSelect;
type RunRow = typeof ghRuns.$inferSelect;
type PrRow = typeof ghPrs.$inferSelect;

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

function toRun(r: RunRow): GateRunRecord {
  return {
    id: r.id,
    repoFullName: r.repoFullName,
    prNumber: r.prNumber,
    headSha: r.headSha,
    baseSha: r.baseSha,
    conclusion: r.conclusion as GateRunRecord['conclusion'],
    addedCount: r.addedCount,
    resolvedCount: r.resolvedCount,
    createdAt: toIso(r.createdAt),
  };
}

function toPr(r: PrRow): PrRecord {
  return {
    repoFullName: r.repoFullName,
    prNumber: r.prNumber,
    title: r.title,
    state: r.state as PrRecord['state'],
    headSha: r.headSha,
    updatedAt: toIso(r.updatedAt),
  };
}

export class PostgresGateStore implements GateStore {
  constructor(
    private readonly db: GateDb,
    private readonly onClose?: () => Promise<void>,
  ) {}

  /** One installation's row, in the provider-generic key. */
  private account(installationId: number) {
    return and(
      eq(providerAccounts.provider, GITHUB_PROVIDER),
      eq(providerAccounts.accountId, String(installationId)),
    );
  }

  // --- installations ---

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

  // --- baseline ---

  async saveBaseline(rec: BaselineRecord): Promise<void> {
    // gh_baselines is just the pointer to the last-scanned baseline commit.
    await this.db
      .insert(ghBaselines)
      .values({
        repoFullName: rec.repoFullName,
        commitSha: rec.commitSha,
        capturedAt: rec.capturedAt,
      })
      .onConflictDoUpdate({
        target: ghBaselines.repoFullName,
        set: {
          commitSha: sql`excluded.commit_sha`,
          capturedAt: sql`excluded.captured_at`,
        },
      });
  }

  async getBaseline(repoFullName: string): Promise<BaselineRecord | null> {
    const [row] = await this.db
      .select()
      .from(ghBaselines)
      .where(eq(ghBaselines.repoFullName, repoFullName))
      .limit(1);
    if (!row) return null;
    return {
      repoFullName: row.repoFullName,
      commitSha: row.commitSha,
      capturedAt: toIso(row.capturedAt),
    };
  }

  // --- runs ---

  async recordRun(rec: GateRunRecord): Promise<void> {
    await this.db
      .insert(ghRuns)
      .values(rec)
      .onConflictDoNothing({ target: ghRuns.id });
    // Cap retained runs per repo (matches the file adapter).
    const keep = this.db
      .select({ id: ghRuns.id })
      .from(ghRuns)
      .where(eq(ghRuns.repoFullName, rec.repoFullName))
      .orderBy(desc(ghRuns.createdAt))
      .limit(RUN_CAP);
    await this.db
      .delete(ghRuns)
      .where(
        and(eq(ghRuns.repoFullName, rec.repoFullName), notInArray(ghRuns.id, keep)),
      );
  }

  async listRuns(repoFullName: string, limit = 50): Promise<GateRunRecord[]> {
    const rows = await this.db
      .select()
      .from(ghRuns)
      .where(eq(ghRuns.repoFullName, repoFullName))
      .orderBy(desc(ghRuns.createdAt))
      .limit(limit);
    return rows.map(toRun);
  }

  // --- PR state ---

  async upsertPr(rec: PrRecord): Promise<void> {
    await this.db
      .insert(ghPrs)
      .values(rec)
      .onConflictDoUpdate({
        target: [ghPrs.repoFullName, ghPrs.prNumber],
        set: {
          title: sql`excluded.title`,
          state: sql`excluded.state`,
          headSha: sql`excluded.head_sha`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  async listPrs(repoFullName: string): Promise<PrRecord[]> {
    const rows = await this.db
      .select()
      .from(ghPrs)
      .where(eq(ghPrs.repoFullName, repoFullName));
    return rows.map(toPr);
  }

  async close(): Promise<void> {
    await this.onClose?.();
  }
}
