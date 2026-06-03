/**
 * Extension contracts between the OSS dashboard and the enterprise
 * (`ee/`) packages.
 *
 * These live in @truecourse/shared so both sides agree on the same
 * shapes without OSS ever importing `ee/`. They are deliberately
 * framework-free: an Express Router and a React component are typed as
 * `unknown` at the boundary and cast on the OSS side at the single
 * mount/render point. This keeps `shared` free of express/react deps.
 */

import type { Capability } from './capabilities.js'

// --- Server seam ----------------------------------------------------

/** A user authenticated via the enterprise auth provider (WorkOS). */
export interface AuthUser {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  profilePictureUrl?: string | null
  organizationId?: string | null
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
 * if unauthenticated. Supplied by the ee auth plugin; called by the OSS
 * auth gate. Framework-free so it's trivially unit-testable.
 */
export type EeAuthVerifier = (
  cookieHeader: string | undefined,
) => Promise<AuthResult | null>

/**
 * The narrow registration API the OSS server seam hands to an ee
 * plugin at boot. `router` is an Express Router, typed `unknown` here
 * and cast at the OSS mount point.
 */
export interface EeServerRegistry {
  /**
   * Mount an Express Router at `basePath`. By default routers are
   * protected — they sit behind the enterprise auth gate. Pass
   * `{ public: true }` for endpoints that must be reachable without a
   * session (login, callback, logout, the `me` probe).
   */
  registerRouter(
    basePath: string,
    router: unknown,
    opts?: { public?: boolean },
  ): void
  setAuthVerifier(verify: EeAuthVerifier): void
}

export interface EePlugin {
  /** Capabilities this plugin lights up (e.g. 'sso', 'workspace'). */
  capabilities: Capability[]
  register(registry: EeServerRegistry): void | Promise<void>
}

// --- Client seam ----------------------------------------------------

/**
 * A route contributed by the ee client module. `load` lazily imports a
 * module whose default export is a React component (typed `unknown`;
 * the OSS route registry casts at render, enabling code-splitting).
 */
export interface EeRoute {
  path: string
  load: () => Promise<{ default: unknown }>
  /** Only mounted when this capability is enabled. */
  requiredCapability?: Capability
}

/**
 * A nav entry contributed by the ee client module. Pure data — the OSS
 * renderer maps `iconName` to an icon and `to` to a router link.
 */
export interface EeNavItem {
  id: string
  label: string
  to: string
  iconName?: string
  requiredCapability?: Capability
}

export interface EeClientModule {
  routes: EeRoute[]
  navItems: EeNavItem[]
  /**
   * Optional replacement for the OSS home page at "/" when running as
   * enterprise (e.g. the workspace dashboard instead of the local-CLI
   * onboarding screen). Lazily imported; default export is a React
   * component (typed `unknown`, cast at render).
   */
  homeComponent?: () => Promise<{ default: unknown }>
}

// --- Workspace overview (enterprise home dashboard) -----------------

export type SeverityCounts = {
  critical: number
  high: number
  medium: number
  low: number
  info: number
}

export interface WorkspaceRepoSummary {
  id: string
  name: string
  lastAnalyzed: string | null
  violations: number
  drift: number
}

export interface WorkspaceStats {
  repoCount: number
  violationCount: number
  driftCount: number
  /** Repos never analyzed or not analyzed within the freshness window. */
  staleCount: number
  severity: SeverityCounts
}

export interface WorkspaceOverviewResponse {
  organizationName: string | null
  stats: WorkspaceStats
  repos: WorkspaceRepoSummary[]
}

// --- Workspace data (enterprise) ------------------------------------

export interface SsoConnectionInfo {
  id: string
  name: string
  /** SAML / OIDC / etc. */
  type: string
  /** draft | active | inactive | validating */
  state: string
}

export interface SsoStatusResponse {
  configured: boolean
  connections: SsoConnectionInfo[]
}

export interface WorkspaceMember {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
}

export interface WorkspaceMembersResponse {
  members: WorkspaceMember[]
}

// --- GitHub App (PR gate) -------------------------------------------

/** A GitHub App installation visible to the current workspace. */
export interface GithubInstallationSummary {
  installationId: number
  accountLogin: string
  accountType: string
}

/** A repository connected to the PR gate. */
export interface GithubRepoSummary {
  repoFullName: string
  installationId: number
  defaultBranch: string
  /** true = new drift fails a required Check; false = advisory only. */
  blocking: boolean
  enabled: boolean
  /** Addresses emailed when the gate fails. */
  notifyEmails: string[]
}

/** Summary of one gate run on a PR. */
export interface GithubRunSummary {
  id: string
  prNumber: number
  headSha: string
  conclusion: 'success' | 'failure' | 'neutral'
  addedCount: number
  resolvedCount: number
  createdAt: string
}

/** Everything the Connect page needs in one call. */
export interface GithubConnectStatusResponse {
  /** Whether the GitHub App is configured server-side. */
  configured: boolean
  /** URL to install the App (carries the workspace id as `state`). */
  installUrl: string
  installations: GithubInstallationSummary[]
  repos: GithubRepoSummary[]
}

export interface GithubRunsResponse {
  runs: GithubRunSummary[]
}

// --- LLM providers (Models settings) --------------------------------

export type LlmProviderKind = 'anthropic' | 'openai' | 'bedrock' | 'copilot'

/** Masked, secret-free view of the instance LLM provider config. */
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

/** Response of GET /api/ee/llm/config. */
export interface LlmConfigResponse {
  config: LlmProviderConfigView | null
  /** True when a provider is set via env (the in-app form still overrides it). */
  envManaged: boolean
  providers: LlmProviderKind[]
}

/** Body of PATCH /api/ee/llm/config. */
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
