/**
 * Edition, mode and entitlement contract for the dashboard.
 *
 * Two questions, answered in two places because they are asked at two
 * different moments. HOW THIS SERVER RUNS is public (`GET /api/capabilities`):
 * the sign-in screen itself differs in local mode, so the client needs it
 * before it has a session. WHAT THIS WORKSPACE MAY USE rides the authenticated
 * answer (`GET /api/auth/me`), because it is a fact about the workspace and not
 * about the deployment — the same hosted server opens Atlassian to one customer
 * and keeps it closed for the next.
 */

export type Edition = 'community' | 'enterprise'

/**
 * The enterprise features a workspace can be granted. They are INDEPENDENT —
 * one grant each, and a workspace may hold any of them without the others.
 */
export const ENTERPRISE_FEATURES = [
  'connections',
  'repository-providers',
  'workspaces',
] as const

export type EnterpriseFeature = (typeof ENTERPRISE_FEATURES)[number]

/** What each grant is called in the product. */
export const ENTERPRISE_FEATURE_LABEL: Record<EnterpriseFeature, string> = {
  connections: 'Connections',
  'repository-providers': 'Repository providers',
  workspaces: 'Workspaces',
}

export function isEnterpriseFeature(value: string): value is EnterpriseFeature {
  return (ENTERPRISE_FEATURES as readonly string[]).includes(value)
}

/**
 * The one word for a set of grants. A workspace holding none of them is the
 * open product, whatever bundle the server it reached was built with.
 */
export function editionOf(features: readonly EnterpriseFeature[]): Edition {
  return features.length > 0 ? 'enterprise' : 'community'
}

/**
 * How the server runs.
 *
 * `hosted` is a deployment: WorkOS signs people in, and a workspace is their
 * organization. `local` is one developer's machine: one implicit person, one
 * implicit workspace, no sign-in, and repositories may be folders on that
 * machine. A deployment never becomes local by accident — the server is told
 * which it is, and answers `hosted` when it is told nothing.
 */
export type ServerMode = 'hosted' | 'local'

export const DEFAULT_SERVER_MODE: ServerMode = 'hosted'

/**
 * `GET /api/capabilities`: how this server runs, and nothing about a caller.
 * Anything that depends on WHO is asking belongs on the authenticated answer.
 */
export interface CapabilitiesResponse {
  mode: ServerMode
}

/** One workspace, as the operator's entitlements console lists it. */
export interface OperatorEntitlementRow {
  workspaceOrgId: string
  /** The identity provider's name for it; null when nobody could name it. */
  workspaceName: string | null
  features: EnterpriseFeature[]
}

export interface OperatorEntitlementsResponse {
  workspaces: OperatorEntitlementRow[]
}

/** What a grant or a revoke left behind. */
export interface OperatorEntitlementMovementResponse {
  workspaceOrgId: string
  features: EnterpriseFeature[]
  /** The context sources a revoke paused, if any. */
  paused?: string[]
}
