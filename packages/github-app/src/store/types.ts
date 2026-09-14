/**
 * Persistence contract for the GitHub App's own rows: the installations that
 * granted it access, and the pull request gate's baselines, runs and PR state.
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

/**
 * The saved baseline pointer for a repo's default branch (refreshed on merge).
 * Records which commit was last scanned — the anchor for idempotency + re-scan.
 */
export interface BaselineRecord {
  repoFullName: string;
  commitSha: string;
  capturedAt: string;
}

/** Open/closed/merged lifecycle of a PR (`merged` = closed after merging). */
export type PrState = 'open' | 'closed' | 'merged';

/** A PR's tracked state, upserted from every pull_request webhook. */
export interface PrRecord {
  repoFullName: string;
  prNumber: number;
  /** PR title at the last webhook; null when the payload carried none. */
  title: string | null;
  state: PrState;
  headSha: string;
  updatedAt: string;
}

/** A recorded gate run on a PR. */
export interface GateRunRecord {
  id: string;
  repoFullName: string;
  prNumber: number;
  headSha: string;
  baseSha: string | null;
  conclusion: 'success' | 'failure' | 'neutral';
  addedCount: number;
  resolvedCount: number;
  createdAt: string;
}

export interface GateStore {
  // --- installations ---
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

  // --- baseline ---
  saveBaseline(rec: BaselineRecord): Promise<void>;
  getBaseline(repoFullName: string): Promise<BaselineRecord | null>;

  // --- runs ---
  recordRun(rec: GateRunRecord): Promise<void>;
  /** Most-recent-first, capped at `limit` (default 50). */
  listRuns(repoFullName: string, limit?: number): Promise<GateRunRecord[]>;

  // --- PR state ---
  /** Insert or update a PR's tracked state (keyed by repo + number). */
  upsertPr(rec: PrRecord): Promise<void>;
  /** Every tracked PR for a repo (used to annotate the runs feed with state). */
  listPrs(repoFullName: string): Promise<PrRecord[]>;
}
