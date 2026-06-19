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
  /**
   * Platform operator (TrueCourse staff) — derived server-side from the WorkOS
   * user's `metadata.role === 'operator'`. Operators see the cross-org Admin
   * console (all workspaces' traces + jobs); regular members never do. Org-
   * independent, so it rides user metadata, not the per-org WorkOS role.
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
  /** Per-user gate: only for platform operators (`AuthUser.isOperator`). */
  requiresOperator?: boolean
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
  /** Per-user gate: only shown to platform operators (`AuthUser.isOperator`). */
  requiresOperator?: boolean
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
  /** Optional app-shell chrome (a live-state provider + sidebar widgets). */
  shell?: EeShell
}

/**
 * Persistent console chrome contributed by the ee module. Unlike routes (which
 * mount/unmount per navigation), the `provider` is mounted ONCE high in the tree
 * so app-wide state (e.g. the live notifications SSE connection) survives route
 * changes; `headerWidget` is a sidebar widget that reads that state (the
 * notifications bell). Both lazily imported; default exports are React
 * components typed `unknown` and cast at the single render point.
 */
export interface EeShell {
  /** Wraps the whole enterprise app. Default export: `ComponentType<{ children }>`. */
  provider?: () => Promise<{ default: unknown }>
  /** Rendered in the console sidebar. Default export: `ComponentType<{ collapsed?: boolean }>`. */
  headerWidget?: () => Promise<{ default: unknown }>
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

/** Per-workspace feature settings (GET/PATCH /api/ee/workspace/settings). */
export interface WorkspaceSettingsResponse {
  /** Run the LLM (semantic) code-analysis rules in Code Quality. Off by default. */
  codeAnalysisLlm: boolean
}

// --- Integrations (knowledge connectors) ----------------------------
// Connector-generic so the settings UI needs no per-connector code: the server
// describes each connector's fields, the client renders the form + Test button.

/** A credential/config field the settings form renders. */
export interface IntegrationFieldMeta {
  key: string
  label: string
  type: 'text' | 'email' | 'password'
  placeholder?: string
  /** The one secret field — encrypted at rest, shown masked. */
  secret?: boolean
}

/** Masked, secret-free view of a stored connection (the token is never sent). */
export interface IntegrationConnectionView {
  /** Non-secret field values (e.g. baseUrl/spaceKey/accountEmail). */
  config: Record<string, string>
  hasToken: boolean
  tokenMask: string | null
  updatedAt: string
}

/** One connector: metadata + the current connection (or null when unconfigured). */
export interface IntegrationConnectorStatus {
  kind: string
  name: string
  description: string
  fields: IntegrationFieldMeta[]
  connection: IntegrationConnectionView | null
}

export interface IntegrationsResponse {
  connectors: IntegrationConnectorStatus[]
}

/** Save/test payload; the secret field omitted ⇒ keep the stored token. */
export interface IntegrationSaveRequest {
  kind: string
  values: Record<string, string>
}

// --- GitHub App (PR gate) -------------------------------------------

/** A GitHub App installation visible to the current workspace. */
export interface GithubInstallationSummary {
  installationId: number
  accountLogin: string
  accountType: string
}

/**
 * Which gate emails a repo wants — one flag per notification type the gate
 * sends. Stored sparsely (absent on the record = "all on"); the API always
 * returns a fully-resolved object.
 */
export interface GithubNotificationPrefs {
  /** A PR's gate failed on new drift. */
  gateFailure: boolean
  /** Inference captured undocumented decisions. */
  inferResult: boolean
  /** Spec conflicts need resolution before contracts can regenerate. */
  conflicts: boolean
}

/** All notification types on by default. */
export const DEFAULT_NOTIFICATION_PREFS: GithubNotificationPrefs = {
  gateFailure: true,
  inferResult: true,
  conflicts: true,
}

/** A repository connected to the PR gate. */
export interface GithubRepoSummary {
  repoFullName: string
  installationId: number
  defaultBranch: string
  /** true = new drift fails a required Check; false = advisory only. */
  blocking: boolean
  /** Code Quality gate: true (default) = new violations at/above
   *  `codeQualityMinSeverity` fail a required Check; false = advisory only. */
  codeQualityBlocking?: boolean
  /** Min new-violation severity that fails the Code Quality Check (default `high`). */
  codeQualityMinSeverity?: 'info' | 'low' | 'medium' | 'high' | 'critical'
  enabled: boolean
  /** Addresses emailed when the gate fails. */
  notifyEmails: string[]
  /** Per-type email notification toggles (defaults applied). */
  notifications: GithubNotificationPrefs
  /** Project slug for the repo's dashboard detail route (`/repos/:slug`); null until registered. */
  slug: string | null
  /** Unresolved spec conflicts on the latest scan; `>0` ⇒ needs review (no contracts yet). */
  openConflicts: number
  /** Whether the repo has any generated contracts. Scanned + no conflicts + no
   *  contracts ⇒ generation failed/empty (status "Failed"). */
  hasContracts: boolean
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

/** One reverse-engineered undocumented decision (an inferred contract). */
export interface InferredDecisionView {
  kind: string
  identity: string
  /** Code location the decision was inferred from (repo-relative). */
  path?: string
  line?: number
  /** One-line human rationale. */
  reason?: string
  /** Extraction confidence (`high` | `medium` | `low`). */
  confidence?: string
  /** Rendered `.tc` — the full reverse-engineered contract, shown in the detail pane. */
  tc?: string
  /** PR-diff only: this decision existed at the base but its contract changed. */
  changed?: boolean
  /** PR-diff only: undocumented at the base, but the PR documents it → gone at the head. */
  resolved?: boolean
}

/** A repo's inferred (undocumented) decisions at its baseline commit. */
export interface GithubInferredResponse {
  decisions: InferredDecisionView[]
  /** Baseline commit the decisions were inferred at; null when no baseline yet. */
  commitSha: string | null
}

/** One canonical claim, identified for a PR diff. */
export interface ClaimRef {
  /** Stable logical identity `module topic subject`. */
  id: string
  module: string
  topic: string
  subject: string
}

/** The PR delta of the spec: claims added/removed + the new conflicts introduced. */
export interface SpecDiffResponse {
  /** Claims new on the PR head. */
  added: ClaimRef[]
  /** Claims removed on the PR head (shown struck-through). */
  removed: ClaimRef[]
  /** All open conflicts at the head (for context). */
  openConflicts: Array<{ id: string; topic: string; subject: string }>
  /** Head open conflicts not present at the baseline — the actionable, gate-blocking count. */
  newConflictCount: number
}

/** The PR delta of authored contracts (head-at-ref vs the default-branch baseline). */
export interface ContractsDiffResponse {
  /** Contract paths new on the PR head. */
  added: string[]
  /** Contract paths removed on the PR head (shown struck-through). */
  removed: string[]
  /** Contract paths present in both whose `.tc` content changed. */
  modified: string[]
}

/** The PR delta of inferred decisions (head-at-ref vs the default-branch baseline). */
export interface InferredDiffResponse {
  /** Undocumented decisions new on the PR head. */
  added: InferredDecisionView[]
  /** Decisions present in both but whose inferred contract changed. */
  changed: InferredDecisionView[]
  /** Undocumented at the base but documented by the PR (gone at the head) — shown struck-through. */
  resolved: InferredDecisionView[]
  /** No baseline inferred set existed → `added` is the full head set, not a delta. */
  fellBack: boolean
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

/** A gate run tagged with its repo — for the cross-repo workspace activity feed. */
export interface WorkspaceRunItem extends GithubRunSummary {
  repoFullName: string
  /** The repo's registered dashboard slug, for deep-linking to /repos/:slug?pr=N. Null when unregistered. */
  slug: string | null
}

export interface WorkspaceRunsResponse {
  runs: WorkspaceRunItem[]
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
