/**
 * Postgres GateStore — the hosted, multi-tenant adapter, built on Drizzle ORM.
 * Selected only when DATABASE_URL is set; local/dev keeps using the file
 * adapter unchanged. Takes a ready (migrated) Drizzle db — `createPostgresGateStore`
 * builds + migrates it for production; tests inject a PGlite-backed db.
 */

import { eq, and, desc, inArray, notInArray, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type {
  GateStore,
  InstallationRecord,
  RepoLinkRecord,
  BaselineRecord,
  GateRunRecord,
} from './types.js';
import { ghInstallations, ghRepos, ghBaselines, ghRuns } from '@truecourse/ee-db';

/** Any Drizzle Postgres db (node-postgres in prod, PGlite in tests). */
export type GateDb = PgDatabase<any, any, any>;

/** Per-repo run-history cap (matches the file adapter). */
const RUN_CAP = 200;

const toIso = (v: string): string => new Date(v).toISOString();

type InstallationRow = typeof ghInstallations.$inferSelect;
type RepoRow = typeof ghRepos.$inferSelect;
type BaselineRow = typeof ghBaselines.$inferSelect;
type RunRow = typeof ghRuns.$inferSelect;

function toInstallation(r: InstallationRow): InstallationRecord {
  return {
    installationId: r.installationId,
    accountLogin: r.accountLogin,
    accountType: r.accountType,
    workspaceOrgId: r.workspaceOrgId,
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  };
}

function toRepo(r: RepoRow): RepoLinkRecord {
  return {
    repoFullName: r.repoFullName,
    installationId: r.installationId,
    workspaceOrgId: r.workspaceOrgId,
    defaultBranch: r.defaultBranch,
    blocking: r.blocking,
    enabled: r.enabled,
    notifyEmails: r.notifyEmails,
    notifications: (r.notifications as unknown as RepoLinkRecord['notifications']) ?? undefined,
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
  };
}

function toBaseline(r: BaselineRow): BaselineRecord {
  return {
    repoFullName: r.repoFullName,
    commitSha: r.commitSha,
    // `drifts` is `unknown[]` at the ee-db layer; cast back to the domain type.
    drifts: (r.drifts as BaselineRecord['drifts']) ?? null,
    capturedAt: toIso(r.capturedAt),
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

export class PostgresGateStore implements GateStore {
  constructor(
    private readonly db: GateDb,
    private readonly onClose?: () => Promise<void>,
  ) {}

  // --- installations ---

  async saveInstallation(rec: InstallationRecord): Promise<void> {
    await this.db
      .insert(ghInstallations)
      .values(rec)
      .onConflictDoUpdate({
        target: ghInstallations.installationId,
        set: {
          accountLogin: sql`excluded.account_login`,
          accountType: sql`excluded.account_type`,
          // Don't wipe an existing link when a re-sent event has no workspace.
          workspaceOrgId: sql`coalesce(excluded.workspace_org_id, ${ghInstallations.workspaceOrgId})`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  async getInstallation(
    installationId: number,
  ): Promise<InstallationRecord | null> {
    const rows = await this.db
      .select()
      .from(ghInstallations)
      .where(eq(ghInstallations.installationId, installationId))
      .limit(1);
    return rows[0] ? toInstallation(rows[0]) : null;
  }

  async removeInstallation(installationId: number): Promise<void> {
    // Cascade baselines + runs for this installation's repos, then the repos,
    // then the installation itself — atomically, so a mid-cascade failure can't
    // orphan a repo or baseline.
    await this.db.transaction(async (tx) => {
      const repos = await tx
        .select({ name: ghRepos.repoFullName })
        .from(ghRepos)
        .where(eq(ghRepos.installationId, installationId));
      const names = repos.map((r) => r.name);
      if (names.length > 0) {
        await tx
          .delete(ghBaselines)
          .where(inArray(ghBaselines.repoFullName, names));
        await tx.delete(ghRuns).where(inArray(ghRuns.repoFullName, names));
      }
      await tx
        .delete(ghRepos)
        .where(eq(ghRepos.installationId, installationId));
      await tx
        .delete(ghInstallations)
        .where(eq(ghInstallations.installationId, installationId));
    });
  }

  async linkInstallationToWorkspace(
    installationId: number,
    workspaceOrgId: string,
  ): Promise<void> {
    await this.db
      .update(ghInstallations)
      .set({ workspaceOrgId, updatedAt: new Date().toISOString() })
      .where(eq(ghInstallations.installationId, installationId));
  }

  async listInstallationsForWorkspace(
    workspaceOrgId: string,
  ): Promise<InstallationRecord[]> {
    const rows = await this.db
      .select()
      .from(ghInstallations)
      .where(eq(ghInstallations.workspaceOrgId, workspaceOrgId));
    return rows.map(toInstallation);
  }

  // --- repo links ---

  async linkRepo(rec: RepoLinkRecord): Promise<void> {
    await this.db
      .insert(ghRepos)
      .values({
        ...rec,
        notifyEmails: rec.notifyEmails ?? [],
        notifications: (rec.notifications ?? null) as Record<string, boolean> | null,
      })
      .onConflictDoUpdate({
        target: ghRepos.repoFullName,
        set: {
          installationId: sql`excluded.installation_id`,
          workspaceOrgId: sql`excluded.workspace_org_id`,
          defaultBranch: sql`excluded.default_branch`,
          blocking: sql`excluded.blocking`,
          enabled: sql`excluded.enabled`,
          notifyEmails: sql`excluded.notify_emails`,
          notifications: sql`excluded.notifications`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  async unlinkRepo(repoFullName: string): Promise<void> {
    await this.db.delete(ghRepos).where(eq(ghRepos.repoFullName, repoFullName));
  }

  async getRepo(repoFullName: string): Promise<RepoLinkRecord | null> {
    const rows = await this.db
      .select()
      .from(ghRepos)
      .where(eq(ghRepos.repoFullName, repoFullName))
      .limit(1);
    return rows[0] ? toRepo(rows[0]) : null;
  }

  async listReposForWorkspace(
    workspaceOrgId: string,
  ): Promise<RepoLinkRecord[]> {
    const rows = await this.db
      .select()
      .from(ghRepos)
      .where(eq(ghRepos.workspaceOrgId, workspaceOrgId))
      .orderBy(ghRepos.repoFullName);
    return rows.map(toRepo);
  }

  // --- baseline ---

  async saveBaseline(rec: BaselineRecord): Promise<void> {
    await this.db
      .insert(ghBaselines)
      .values(rec)
      .onConflictDoUpdate({
        target: ghBaselines.repoFullName,
        set: {
          commitSha: sql`excluded.commit_sha`,
          drifts: sql`excluded.drifts`,
          capturedAt: sql`excluded.captured_at`,
        },
      });
  }

  async getBaseline(repoFullName: string): Promise<BaselineRecord | null> {
    const rows = await this.db
      .select()
      .from(ghBaselines)
      .where(eq(ghBaselines.repoFullName, repoFullName))
      .limit(1);
    return rows[0] ? toBaseline(rows[0]) : null;
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

  async close(): Promise<void> {
    await this.onClose?.();
  }
}
