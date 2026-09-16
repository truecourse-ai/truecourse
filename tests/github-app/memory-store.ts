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
  InstallationAccount,
} from '../../packages/github-app/src/store/types';

export class MemoryInstallationStore implements InstallationStore, RepositoryStore {
  private installations = new Map<number, InstallationAccount>();
  /** installation id → the workspaces attached, in attach order. */
  private links = new Map<number, string[]>();
  private repos = new Map<string, RepositoryRecord>();

  private record(account: InstallationAccount): InstallationRecord {
    return { ...account, workspaceOrgIds: [...(this.links.get(account.installationId) ?? [])] };
  }

  async saveInstallation(rec: InstallationAccount): Promise<void> {
    const { installationId, accountLogin, accountType, createdAt, updatedAt } = rec;
    this.installations.set(installationId, {
      installationId,
      accountLogin,
      accountType,
      createdAt,
      updatedAt,
    });
  }

  async getInstallation(installationId: number): Promise<InstallationRecord | null> {
    const account = this.installations.get(installationId);
    return account ? this.record(account) : null;
  }

  async removeInstallation(installationId: number): Promise<void> {
    this.installations.delete(installationId);
    this.links.delete(installationId);
  }

  async linkInstallationToWorkspace(
    installationId: number,
    workspaceOrgId: string,
  ): Promise<void> {
    if (!this.installations.has(installationId)) return;
    const held = this.links.get(installationId) ?? [];
    if (!held.includes(workspaceOrgId)) this.links.set(installationId, [...held, workspaceOrgId]);
  }

  async unlinkInstallationFromWorkspace(
    installationId: number,
    workspaceOrgId: string,
  ): Promise<void> {
    const held = this.links.get(installationId) ?? [];
    this.links.set(
      installationId,
      held.filter((org) => org !== workspaceOrgId),
    );
  }

  async listInstallationsForWorkspace(
    workspaceOrgId: string,
  ): Promise<InstallationRecord[]> {
    return [...this.installations.values()]
      .filter((account) => (this.links.get(account.installationId) ?? []).includes(workspaceOrgId))
      .map((account) => this.record(account));
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

/** An installation attached to the given workspaces, as the callback writes one. */
export async function seedInstallation(
  store: MemoryInstallationStore,
  installationId: number,
  workspaceOrgIds: string[],
  account: Partial<Pick<InstallationAccount, 'accountLogin' | 'accountType'>> = {},
): Promise<void> {
  await store.saveInstallation({
    installationId,
    accountLogin: account.accountLogin ?? 'acme',
    accountType: account.accountType ?? 'Organization',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  for (const org of workspaceOrgIds) await store.linkInstallationToWorkspace(installationId, org);
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
