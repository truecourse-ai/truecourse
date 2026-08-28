/**
 * In-memory GateStore for the connection-layer tests. The real adapters (the ee
 * file store, the Postgres store) have their own suites — this one exists so the
 * router tests exercise routing, ownership and payload handling without a
 * filesystem or a database.
 */

import type {
  GateStore,
  InstallationRecord,
  RepoLinkRecord,
  BaselineRecord,
  GateRunRecord,
  PrRecord,
} from '../../packages/scm-github/src/store/types';

export class MemoryGateStore implements GateStore {
  private installations = new Map<number, InstallationRecord>();
  private repos = new Map<string, RepoLinkRecord>();
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
    for (const [name, repo] of this.repos) {
      if (repo.installationId === installationId) this.repos.delete(name);
    }
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

  async linkRepo(rec: RepoLinkRecord): Promise<void> {
    this.repos.set(rec.repoFullName, { ...rec });
  }

  async unlinkRepo(repoFullName: string): Promise<void> {
    this.repos.delete(repoFullName);
  }

  async getRepo(repoFullName: string): Promise<RepoLinkRecord | null> {
    return this.repos.get(repoFullName) ?? null;
  }

  async listReposForWorkspace(workspaceOrgId: string): Promise<RepoLinkRecord[]> {
    return [...this.repos.values()].filter((r) => r.workspaceOrgId === workspaceOrgId);
  }

  /** Every link row, regardless of workspace — what a derived registry reads. */
  async listRepos(): Promise<RepoLinkRecord[]> {
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
