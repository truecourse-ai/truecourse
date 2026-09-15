/**
 * In-memory stores for the connection-layer tests: the GitHub App's own rows
 * and the connected repositories, in one object that satisfies both contracts.
 * The real adapters have their own suites — this one exists so the router tests
 * exercise routing, ownership and payload handling without a filesystem or a
 * database.
 */

import type {
  RepositoryLink,
  RepositoryProviderId,
  RepositoryRecord,
  RepositoryStore,
} from '@truecourse/shared';
import { slugify } from '@truecourse/core/config/registry';
import type {
  InstallationStore,
  InstallationRecord,
} from '../../packages/github-app/src/store/types';

export class MemoryInstallationStore implements InstallationStore, RepositoryStore {
  private installations = new Map<number, InstallationRecord>();
  private repos = new Map<string, RepositoryRecord>();

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

  /** Mints the slug the way the Postgres store does: against the workspace's own slugs. */
  async linkRepo(rec: RepositoryLink): Promise<RepositoryRecord> {
    const existing = this.repos.get(rec.repoFullName);
    const taken = [...this.repos.values()]
      .filter((r) => r.workspaceOrgId === rec.workspaceOrgId)
      .map((r) => r.slug);
    const stored: RepositoryRecord = { ...rec, slug: existing?.slug ?? slugify(rec.repoFullName, taken) };
    this.repos.set(rec.repoFullName, stored);
    return stored;
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
