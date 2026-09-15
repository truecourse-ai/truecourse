/**
 * Edition, mode and capability contract for the dashboard.
 *
 * The server reports `edition`, the MODE it runs in and `capabilities` — the
 * feature gates that are currently turned on for this deployment. Capability
 * identifiers are deliberately typed as plain strings so a gate can be added
 * without a shared-schema change.
 */

export type Edition = 'community' | 'enterprise'

/**
 * Deliberately a plain string (see module doc). The one identifier in use is
 * `local-filesystem`, the inverse gate described below, which no deployment
 * advertises.
 */
export type Capability = string

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

export interface CapabilitiesResponse {
  edition: Edition
  /** How this server runs; the client reads it before it has a session. */
  mode: ServerMode
  capabilities: Capability[]
}

/**
 * Capabilities the community build advertises. `local-filesystem` — the inverse
 * gate a feature that reads a live checkout requires — is deliberately NOT here:
 * connected repos have no persistent working copy (runs clone ephemerally and
 * all state lives in the database), so no deployment carries a per-user
 * filesystem to browse. The gate stays in the vocabulary so such a surface
 * vanishes without branching.
 */
export const COMMUNITY_CAPABILITIES: readonly Capability[] = []
