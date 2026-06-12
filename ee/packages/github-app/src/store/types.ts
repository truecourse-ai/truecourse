/**
 * Persistence contract for the GitHub App gate.
 *
 * Two adapters implement this: a file-based one (default, local/dev — keeps
 * the file-only storage model unchanged) and a Postgres one (hosted, selected
 * when DATABASE_URL is set). Callers depend only on this interface.
 */

import type { VerifyState } from '@truecourse/core/commands/spec-in-process';
import type { GithubNotificationPrefs } from '@truecourse/shared';

/** A single contract drift (re-typed from core's verify output). */
export type GateDrift = VerifyState['drifts'][number];

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

/** A repository connected to the gate. */
export interface RepoLinkRecord {
  /** 'owner/name'. */
  repoFullName: string;
  installationId: number;
  /** Owning TrueCourse workspace (WorkOS org). */
  workspaceOrgId: string;
  defaultBranch: string;
  /** When true (default) a PR with new drift fails a required Check; false = advisory. */
  blocking: boolean;
  enabled: boolean;
  /** Addresses notified (via Resend) when the gate fails. */
  notifyEmails?: string[];
  /** Per-type email toggles. Absent = every type on (the default). */
  notifications?: GithubNotificationPrefs;
  createdAt: string;
  updatedAt: string;
}

/** The saved baseline for a repo's default branch (refreshed on merge). */
export interface BaselineRecord {
  repoFullName: string;
  commitSha: string;
  /** null when the repo had no contracts to verify (neutral baseline). */
  drifts: GateDrift[] | null;
  capturedAt: string;
}

/** A recorded gate run on a PR (Phase 4 fills in inline-comment details). */
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

  // --- repo links ---
  linkRepo(rec: RepoLinkRecord): Promise<void>;
  unlinkRepo(repoFullName: string): Promise<void>;
  getRepo(repoFullName: string): Promise<RepoLinkRecord | null>;
  listReposForWorkspace(workspaceOrgId: string): Promise<RepoLinkRecord[]>;

  // --- baseline ---
  saveBaseline(rec: BaselineRecord): Promise<void>;
  getBaseline(repoFullName: string): Promise<BaselineRecord | null>;

  // --- runs ---
  recordRun(rec: GateRunRecord): Promise<void>;
  /** Most-recent-first, capped at `limit` (default 50). */
  listRuns(repoFullName: string, limit?: number): Promise<GateRunRecord[]>;
}
