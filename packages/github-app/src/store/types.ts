/**
 * Persistence contract for the GitHub App's own rows: the installations that
 * granted it access, and which workspaces each one is attached to.
 *
 * GitHub allows ONE installation of an App per GitHub account, so two
 * workspaces reading the same account share the installation row; the link is
 * a row of its own per workspace. The REPOSITORIES themselves are not here. A
 * repository can come through any provider, so it is written through
 * `RepositoryStore` (`@truecourse/shared`), which `@truecourse/data-store`
 * implements — the routers below take one alongside this store.
 */

/** A GitHub App installation — an account that installed the App. */
export interface InstallationRecord {
  installationId: number;
  /** Login of the org/user that installed the App. */
  accountLogin: string;
  /** 'Organization' | 'User'. */
  accountType: string;
  /** The TrueCourse workspaces (WorkOS orgs) this installation is attached to. */
  workspaceOrgIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** The account half of an {@link InstallationRecord}: what a save writes. */
export type InstallationAccount = Omit<InstallationRecord, 'workspaceOrgIds'>;

export interface InstallationStore {
  /**
   * Upsert the account. A row that exists keeps its `createdAt`, keeps a
   * known login or type when the save carries an empty one (a list that did
   * not name it must not unname it), and keeps its workspace links.
   */
  saveInstallation(rec: InstallationAccount): Promise<void>;
  getInstallation(installationId: number): Promise<InstallationRecord | null>;
  /** Drop the account and every workspace's link to it. */
  removeInstallation(installationId: number): Promise<void>;
  /** Attach an installation to a workspace; a link that exists is left as is. */
  linkInstallationToWorkspace(
    installationId: number,
    workspaceOrgId: string,
  ): Promise<void>;
  /** Detach one workspace; the account row and the other links stay. */
  unlinkInstallationFromWorkspace(
    installationId: number,
    workspaceOrgId: string,
  ): Promise<void>;
  listInstallationsForWorkspace(
    workspaceOrgId: string,
  ): Promise<InstallationRecord[]>;
}
