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
  /**
   * The `:id` the routes and the client address it by. The store mints it
   * when the repository is connected, from its name against the slugs the
   * workspace already holds, and it never changes afterwards. Unique within
   * the workspace only: two workspaces may both hold `acme-api`.
   */
  slug: string
  /** The branch the provider tracks. Null for a local folder: it has whatever is checked out. */
  defaultBranch: string | null
  /**
   * The newest commit the provider reported pushed to that branch. What the
   * main chain compares its own commit against when it settles, to run once
   * more for pushes that landed while it worked. Null until the first push
   * the server saw; a local folder has none.
   */
  defaultBranchSha?: string | null
  /** Where the provider finds it when the name is not enough: a local folder's absolute path. */
  location?: string | null
  /**
   * `blocking`, `notifyEmails` and `notifications` are unused today: nothing
   * reads them and nothing sends. They are kept for the notification design,
   * which is not built yet. `enabled` between them is live — a disabled
   * connection is one a push no longer re-baselines.
   */
  blocking: boolean
  enabled: boolean
  notifyEmails?: string[]
  notifications?: GithubNotificationPrefs
  createdAt: string
  updatedAt: string
}

/** What a provider writes to connect a repository: the record minus the slug the store mints. */
export type RepositoryLink = Omit<RepositoryRecord, 'slug'>

/** Reading and writing the connected repositories. */
export interface RepositoryStore {
  /**
   * Connect a repository, or update the one already at this name. Answers the
   * stored row: a new connection carries the slug minted for it, a re-link the
   * slug it already had.
   */
  linkRepo(rec: RepositoryLink): Promise<RepositoryRecord>
  /** Disconnect it. */
  unlinkRepo(repoFullName: string): Promise<void>
  /** The provider reported a push to the default branch: remember its commit. */
  recordDefaultBranchSha(repoFullName: string, commitSha: string): Promise<void>
  getRepo(repoFullName: string): Promise<RepositoryRecord | null>
  listReposForWorkspace(workspaceOrgId: string): Promise<RepositoryRecord[]>
  /** Every repository connected through one provider account (uninstall cleanup). */
  listReposForAccount(provider: RepositoryProviderId, accountId: string): Promise<RepositoryRecord[]>
  /**
   * Re-key every repository of one provider account to another, answering the
   * rows moved: how an App reinstalled on the same account (a new installation
   * id for the same repositories) keeps its connections.
   */
  moveReposToAccount(
    provider: RepositoryProviderId,
    fromAccountId: string,
    toAccountId: string,
  ): Promise<RepositoryRecord[]>
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
