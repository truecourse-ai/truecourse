/**
 * In-memory stores for the connection-layer tests: the GitHub App's own rows
 * and the connected repositories, in one object that satisfies both contracts.
 * The real adapters have their own suites — this one exists so the router tests
 * exercise routing, ownership and payload handling without a filesystem or a
 * database.
 */

import type {
  RepositoryProviderId,
  RepositoryRecord,
  RepositoryStore,
} from '@truecourse/shared';
import type {
  GateStore,
  InstallationRecord,
  BaselineRecord,
  GateRunRecord,
  PrRecord,
} from '../../packages/github-app/src/store/types';

export class MemoryGateStore implements GateStore, RepositoryStore {
  private installations = new Map<number, InstallationRecord>();
  private repos = new Map<string, RepositoryRecord>();
  private baselines = new Map<string, BaselineRecord>();
  private runs: GateRunRecord[] = [];
  private prs = new Map<string, PrRecord>();

  async saveInstallation(rec: InstallationRecord): Promise<void> {
    this.installations.set(rec.installationId, { ...rec });
  }

  async getInstallation(installationId: number): Promise<InstallationRecord | null> {
    return this.installations.get(installationId) ?? null;
  }

  async removeInstallation(installationId: number): Promise<void> {
    this.installations.delete(installationId);
  }

  async linkInstallationToWorkspace(
    installationId: number,
    workspaceOrgId: string,
  ): Promise<void> {
    const existing = this.installations.get(installationId);
    if (existing) existing.workspaceOrgId = workspaceOrgId;
  }

  async listInstallationsForWorkspace(
    workspaceOrgId: string,
  ): Promise<InstallationRecord[]> {
    return [...this.installations.values()].filter(
      (i) => i.workspaceOrgId === workspaceOrgId,
    );
  }

  async linkRepo(rec: RepositoryRecord): Promise<void> {
    this.repos.set(rec.repoFullName, { ...rec });
  }

  async unlinkRepo(repoFullName: string): Promise<void> {
    this.repos.delete(repoFullName);
  }

  async getRepo(repoFullName: string): Promise<RepositoryRecord | null> {
    return this.repos.get(repoFullName) ?? null;
  }

  async listReposForWorkspace(workspaceOrgId: string): Promise<RepositoryRecord[]> {
    return [...this.repos.values()].filter((r) => r.workspaceOrgId === workspaceOrgId);
  }

  async listReposForAccount(
    provider: RepositoryProviderId,
    accountId: string,
  ): Promise<RepositoryRecord[]> {
    return [...this.repos.values()].filter(
      (r) => r.provider === provider && r.accountId === accountId,
    );
  }

  /** Every repository row, regardless of workspace — what a derived registry reads. */
  async listRepos(): Promise<RepositoryRecord[]> {
    return [...this.repos.values()];
  }

  async saveBaseline(rec: BaselineRecord): Promise<void> {
    this.baselines.set(rec.repoFullName, { ...rec });
  }

  async getBaseline(repoFullName: string): Promise<BaselineRecord | null> {
    return this.baselines.get(repoFullName) ?? null;
  }

  async recordRun(rec: GateRunRecord): Promise<void> {
    this.runs.push({ ...rec });
  }

  async listRuns(repoFullName: string, limit = 50): Promise<GateRunRecord[]> {
    return this.runs
      .filter((r) => r.repoFullName === repoFullName)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async upsertPr(rec: PrRecord): Promise<void> {
    this.prs.set(`${rec.repoFullName}#${rec.prNumber}`, { ...rec });
  }

  async listPrs(repoFullName: string): Promise<PrRecord[]> {
    return [...this.prs.values()].filter((p) => p.repoFullName === repoFullName);
  }
}

/** A connected GitHub repository, as the connect flow writes one. */
export function githubRepoRecord(
  repoFullName: string,
  installationId: number,
  workspaceOrgId: string,
  overrides: Partial<RepositoryRecord> = {},
): RepositoryRecord {
  const now = new Date().toISOString();
  return {
    repoFullName,
    provider: 'github',
    accountId: String(installationId),
    workspaceOrgId,
    defaultBranch: 'main',
    blocking: true,
    enabled: true,
    notifyEmails: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
