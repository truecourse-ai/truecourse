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
  /**
   * What the installation lets the App see, as GitHub's own listing says it:
   * every repository of the account, or the ones picked. Carried on an
   * offered account, which the workspace cannot ask GitHub about yet.
   */
  repositorySelection?: 'all' | 'selected'
  /**
   * How many workspaces hold the installation, this one included. Carried on
   * a held account: at 1, removing it here uninstalls the App on GitHub.
   */
  workspaces?: number
}

/**
 * `DELETE /api/github/installations/:id`: the workspace let go of the
 * installation. An installation no workspace holds any more is uninstalled
 * from GitHub by the App itself (`done`), or stays there when GitHub refused
 * (`failed`, with the reason) — the row is gone either way; one other
 * workspaces still hold is `kept` on GitHub.
 */
export interface GithubDetachResponse {
  ok: true
  /** The repositories this workspace had connected through it, now disconnected. */
  disconnected: string[]
  uninstall: 'done' | 'failed' | 'kept'
  reason?: string
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
 * How a trip to GitHub ended: the `github=<outcome>` flag the callback lands
 * Settings › Repositories with, beside `from=<origin>` naming where the trip
 * started. A trip that attached lands back at its origin, flagged only when
 * that origin is Settings itself; the other origins show what arrived.
 */
export const GITHUB_CONNECT_OUTCOMES = [
  /** Attached, on a trip started from Settings; `accounts` names what, comma-separated. */
  'attached',
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
 * itself is changed on GitHub, on the installation's page. An installation
 * GitHub no longer knows (the App was uninstalled, and the webhook saying so
 * never arrived) answers `installed: false`.
 */
export type GithubInstallationAccessResponse =
  | {
      installed: true
      /** `all`: every repository of the account, now and later; `selected`: the ones picked. */
      repositorySelection: 'all' | 'selected'
      /** How many repositories the installation can see today. */
      repositories: number
    }
  | { installed: false }

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

/**
 * Running on TrueCourse's own key, against a granted credit balance. It is a
 * CHOICE on the Models page, never a provider block: the workspace stores no
 * key, no model and no endpoint for it, and the platform key it runs on is
 * read from the server's environment and never leaves the process.
 */
export const LLM_CREDITS_PROVIDER = 'truecourse'

/** What a workspace can name on the Models page: a provider of its own, or credits. */
export const LLM_PROVIDER_CHOICES = [
  ...LLM_PROVIDER_KINDS,
  LLM_CREDITS_PROVIDER,
] as const

export type LlmProviderChoice = (typeof LLM_PROVIDER_CHOICES)[number]

/** Whether this choice is the platform's own key rather than the workspace's. */
export function isCreditsProvider(choice: string): boolean {
  return choice === LLM_CREDITS_PROVIDER
}

/** Masked, secret-free view of a workspace's LLM provider config. */
export interface LlmProviderConfigView {
  provider: LlmProviderChoice
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
  /** What this server offers. `truecourse` is absent when it holds no platform key. */
  providers: LlmProviderChoice[]
  /** Present only on an instance running on its operator's Claude Code. */
  operator?: LlmOperatorProvider
  /** The workspace's credit balance, when this server offers credits at all. */
  credits?: { balance: number }
}

/** Body of PATCH /api/llm/config. */
export interface LlmConfigUpdate {
  provider: LlmProviderChoice
  /** The provider's model id. Omitted for `truecourse`, whose model is the platform's. */
  model?: string
  fallbackModel?: string
  /** Omit to keep the stored key (same provider only). */
  apiKey?: string
  accessKeyId?: string
  baseURL?: string
  region?: string
  headers?: Record<string, string>
}
