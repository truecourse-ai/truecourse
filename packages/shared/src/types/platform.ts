/**
 * The wire shapes of the dashboard's platform surfaces: the session the auth
 * gate resolves, the GitHub App connection, and the workspace's LLM provider.
 *
 * They live in @truecourse/shared because the server, the client and the
 * enterprise bundle all speak them, and they are deliberately framework-free so
 * `shared` needs neither express nor react.
 */

/** A user authenticated through the identity provider (WorkOS). */
export interface AuthUser {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  profilePictureUrl?: string | null
  organizationId?: string | null
  /**
   * The organization's display name — the workspace name the shell draws.
   * Resolved server-side on `/me` (the session carries only the id), so it is
   * absent whenever the user belongs to no organization.
   */
  organizationName?: string
  /**
   * Platform operator (TrueCourse staff) — derived server-side from the WorkOS
   * user's `metadata.role === 'operator'`. Org-independent, so it rides user
   * metadata, not the per-org WorkOS role.
   */
  isOperator?: boolean
}

/**
 * Result of verifying a request's session. `setCookie`, when present,
 * is a fully-formed Set-Cookie header value the gate must apply to the
 * response — used when the session was transparently refreshed (the
 * short-lived access token expired and was renewed via the refresh
 * token), so the browser receives the rotated session cookie.
 */
export interface AuthResult {
  user: AuthUser
  setCookie?: string
}

/**
 * Resolves the current session from a request's Cookie header, or null
 * if unauthenticated. Built by the dashboard server's auth module and
 * called by its auth gate. Framework-free so it's trivially unit-testable.
 */
export type AuthVerifier = (
  cookieHeader: string | undefined,
) => Promise<AuthResult | null>

// --- GitHub App (connect + Settings › Repositories) ------------------

/** A GitHub App installation visible to the current workspace. */
export interface GithubInstallationSummary {
  installationId: number
  accountLogin: string
  accountType: string
}

/**
 * One flag per notification type. Stored sparsely (absent on the record = "all
 * on") and returned fully resolved by the connect API. Unused today — nothing
 * sends; kept for the notification design, which is not built yet.
 */
export interface GithubNotificationPrefs {
  gateFailure: boolean
  conflicts: boolean
  specRegen: boolean
}

/** All notification types on by default. */
export const DEFAULT_NOTIFICATION_PREFS: GithubNotificationPrefs = {
  gateFailure: true,
  conflicts: true,
  specRegen: true,
}

/** A repository this workspace has connected through the GitHub App. */
export interface GithubRepoSummary {
  repoFullName: string
  installationId: number
  defaultBranch: string
  /**
   * `blocking`, `notifyEmails` and `notifications` are unused today: nothing
   * reads them and nothing sends. They are kept for the notification design,
   * which is not built yet. `enabled` between them is live — a disabled
   * connection is one a push no longer re-baselines.
   */
  blocking: boolean
  enabled: boolean
  notifyEmails: string[]
  notifications: GithubNotificationPrefs
  /** The repo's dashboard route (`/repos/:slug`), minted when it was connected. */
  slug: string
}

/**
 * Where a trip to GitHub (Connect, or an install) was started from, carried
 * through GitHub's `state` so the return lands there: Settings, Code's connect
 * dialog, or Add context's repository step.
 */
export const GITHUB_INSTALL_ORIGINS = ['settings', 'code-connect', 'context-add'] as const;
export type GithubInstallOrigin = (typeof GITHUB_INSTALL_ORIGINS)[number];

/**
 * How a trip to GitHub ended when it did not simply attach what it set out to:
 * the `github=<outcome>` flag the callback lands Settings › Repositories with,
 * beside `from=<origin>` naming where the trip started. A trip that attached
 * lands back at its origin with no flag at all.
 */
export const GITHUB_CONNECT_OUTCOMES = [
  /** GitHub named accounts this workspace does not hold; `offer` carries them for the person to pick from. */
  'pick',
  /** The person asked an account's owners to install the App; nothing to attach until they approve. */
  'requested',
  /** Back from the install page with nothing new: no reachable installation, or every one attached already. */
  'none',
  /** The trip took too long, or came back to a session other than the one that started it. */
  'expired',
  /** GitHub did not complete the authorization: a stale code, or GitHub itself. */
  'denied',
  /** The installation the trip came back with is not one the person can reach. */
  'unreachable',
  /** Back from an installation's settings page on GitHub, where its repository access was changed. */
  'updated',
] as const;
export type GithubConnectOutcome = (typeof GITHUB_CONNECT_OUTCOMES)[number];

export interface GithubConnectStatusResponse {
  /** Whether the GitHub App is configured server-side. */
  configured: boolean
  /**
   * The one door in: authorize with GitHub, which offers the installations
   * of the App the person can reach and this workspace does not hold yet, or
   * sends them on to GitHub's install page when there is nothing to offer.
   * Carries a signed `state` for this workspace and user.
   */
  connectUrl: string
  installations: GithubInstallationSummary[]
  repos: GithubRepoSummary[]
  /**
   * The installations a `pick` landing's `offer` names, when the read carried
   * one that is still good for this session. Absent otherwise: an offer that
   * expired or belongs to another session offers nothing.
   */
  offered?: GithubInstallationSummary[]
}

/** `POST /api/github/installations/attach`: which of an offer's installations to attach. */
export interface GithubAttachRequest {
  offer: string
  installationIds: number[]
}

/** A repo the installation can access — for the connect drawer's repo picker. */
export interface GithubInstallableRepo {
  fullName: string
  defaultBranch: string
  private: boolean
  /** Connected in another workspace: a repository belongs to one, so not pickable here. */
  connectedElsewhere: boolean
}

/**
 * `GET /api/github/installations/:id/access`: what the App is allowed to see
 * on GitHub through one installation, as GitHub reports it. The setting
 * itself is changed on GitHub, on the installation's page.
 */
export interface GithubInstallationAccessResponse {
  /** `all`: every repository of the account, now and later; `selected`: the ones picked. */
  repositorySelection: 'all' | 'selected'
  /** How many repositories the installation can see today. */
  repositories: number
}

export interface GithubInstallationReposResponse {
  repos: GithubInstallableRepo[]
}

// --- LLM providers (Models settings) --------------------------------

/** The API providers the direct-API LLM transport can talk to. */
export const LLM_PROVIDER_KINDS = [
  'anthropic',
  'openai',
  'bedrock',
  'copilot',
] as const

export type LlmProviderKind = (typeof LLM_PROVIDER_KINDS)[number]

/** Masked, secret-free view of a workspace's LLM provider config. */
export interface LlmProviderConfigView {
  provider: LlmProviderKind
  model: string
  fallbackModel: string | null
  baseURL: string | null
  region: string | null
  accessKeyId: string | null
  /** Whether a key is stored. The key itself is never returned. */
  hasKey: boolean
  /** Masked tail of the stored key, e.g. `••••1234`. */
  keyMask: string | null
  updatedAt: string
}

/**
 * The provider an instance runs on when its operator set
 * `TRUECOURSE_LLM_TRANSPORT=claude-code`: the server's own `claude` login,
 * for every workspace. The Models page is read-only while it is set.
 */
export interface LlmOperatorProvider {
  provider: 'claude-code'
  model: string
}

/** Response of GET /api/llm/config. */
export interface LlmConfigResponse {
  config: LlmProviderConfigView | null
  providers: LlmProviderKind[]
  /** Present only on an instance running on its operator's Claude Code. */
  operator?: LlmOperatorProvider
}

/** Body of PATCH /api/llm/config. */
export interface LlmConfigUpdate {
  provider: LlmProviderKind
  model: string
  fallbackModel?: string
  /** Omit to keep the stored key (same provider only). */
  apiKey?: string
  accessKeyId?: string
  baseURL?: string
  region?: string
  headers?: Record<string, string>
}
