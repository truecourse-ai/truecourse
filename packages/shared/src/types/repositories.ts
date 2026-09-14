/**
 * The connected repositories, as every provider writes them.
 *
 * A repository reaches TrueCourse through a PROVIDER — the GitHub App, or a
 * folder on the machine the server runs on — and whichever one brought it, the
 * row is the connection: one table, one workspace scope, one identity
 * (`repoFullName`) that every per-repository store keys by. The contract lives
 * here, in the leaf package, because the three sides need it and none of them
 * owns it: `@truecourse/data-store` implements it over Postgres, the GitHub App
 * writes through it, and the server's routes read through it.
 */

import type { GithubNotificationPrefs } from './platform.js'

/** The providers a repository can come through. */
export const REPOSITORY_PROVIDERS = ['github', 'local'] as const
export type RepositoryProviderId = (typeof REPOSITORY_PROVIDERS)[number]

/** A repository this installation has connected. */
export interface RepositoryRecord {
  /** `owner/name` from a provider, `local/<folder>` for a folder on this machine. */
  repoFullName: string
  provider: RepositoryProviderId
  /**
   * The provider account it came through (a GitHub App installation id, as
   * text). Null for a provider with no accounts.
   */
  accountId: string | null
  /** Owning workspace (its WorkOS organization, or the local one). */
  workspaceOrgId: string
  /** The branch the provider tracks. Null for a local folder: it has whatever is checked out. */
  defaultBranch: string | null
  /** Where the provider finds it when the name is not enough: a local folder's absolute path. */
  location?: string | null
  /** When true (default) a PR with newly failing scenarios fails a required Check; false = advisory. */
  blocking: boolean
  enabled: boolean
  /** Addresses notified when the gate fails. */
  notifyEmails?: string[]
  /** Per-type email toggles. Absent = every type on (the default). */
  notifications?: GithubNotificationPrefs
  createdAt: string
  updatedAt: string
}

/** Reading and writing the connected repositories. */
export interface RepositoryStore {
  /** Connect a repository, or update the one already at this name. */
  linkRepo(rec: RepositoryRecord): Promise<void>
  /** Disconnect it. */
  unlinkRepo(repoFullName: string): Promise<void>
  getRepo(repoFullName: string): Promise<RepositoryRecord | null>
  listReposForWorkspace(workspaceOrgId: string): Promise<RepositoryRecord[]>
  /** Every repository connected through one provider account (uninstall cleanup). */
  listReposForAccount(provider: RepositoryProviderId, accountId: string): Promise<RepositoryRecord[]>
}

/** One folder on this machine, as Settings and the connect dialog list it. */
export interface LocalRepositorySummary {
  /** `local/<folder>` — the identity every per-repository store keys it by. */
  repoFullName: string
  /** The absolute path it was connected from. */
  path: string
  connectedAt: string
}

export interface LocalRepositoriesResponse {
  repos: LocalRepositorySummary[]
}
