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
 * Where a GitHub App install was started from, carried through GitHub's
 * `state` so the return lands there: Settings, Code's connect dialog, or Add
 * context's repository step.
 */
export const GITHUB_INSTALL_ORIGINS = ['settings', 'code-connect', 'context-add'] as const;
export type GithubInstallOrigin = (typeof GITHUB_INSTALL_ORIGINS)[number];

export interface GithubConnectStatusResponse {
  /** Whether the GitHub App is configured server-side. */
  configured: boolean
  /** URL to install the App (carries the workspace id as `state`). */
  installUrl: string
  installations: GithubInstallationSummary[]
  repos: GithubRepoSummary[]
}

/** A repo the installation can access — for the connect drawer's repo picker. */
export interface GithubInstallableRepo {
  fullName: string
  defaultBranch: string
  private: boolean
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
