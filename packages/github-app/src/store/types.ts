/**
 * Persistence contract for the GitHub App's own rows: the installations that
 * granted it access.
 *
 * The REPOSITORIES themselves are not here. A repository can come through any
 * provider, so it is written through `RepositoryStore`
 * (`@truecourse/shared`), which `@truecourse/data-store` implements — the
 * routers below take one alongside this store.
 */

/** A GitHub App installation — an account that installed the App. */
export interface InstallationRecord {
  installationId: number;
  /** Login of the org/user that installed the App. */
  accountLogin: string;
  /** 'Organization' | 'User'. */
  accountType: string;
  /** TrueCourse workspace (WorkOS org) this installation belongs to, once connected. */
  workspaceOrgId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InstallationStore {
  saveInstallation(rec: InstallationRecord): Promise<void>;
  getInstallation(installationId: number): Promise<InstallationRecord | null>;
  removeInstallation(installationId: number): Promise<void>;
  /** Associate an installation with a TrueCourse workspace (set on connect). */
  linkInstallationToWorkspace(
    installationId: number,
    workspaceOrgId: string,
  ): Promise<void>;
  listInstallationsForWorkspace(
    workspaceOrgId: string,
  ): Promise<InstallationRecord[]>;
}
