/**
 * Edition + capability contract for the dashboard.
 *
 * The server reports `edition` and `capabilities` — the feature gates that are
 * currently turned on for this deployment. Capability identifiers are
 * deliberately typed as plain strings so a gate can be added without a
 * shared-schema change.
 */

export type Edition = 'community' | 'enterprise'

/**
 * Deliberately a plain string (see module doc). The one identifier in use is
 * `local-filesystem`, the inverse gate described below, which no deployment
 * advertises.
 */
export type Capability = string

export interface CapabilitiesResponse {
  edition: Edition
  capabilities: Capability[]
}

/**
 * Capabilities the community build advertises. `local-filesystem` — the
 * inverse gate the features that read a live checkout require (the file
 * explorer, sequence-flow viewer, database schema viewer) — is deliberately
 * NOT here: connected repos have no persistent working copy (runs clone
 * ephemerally and all state lives in the database), so no deployment carries
 * a per-user filesystem to browse. The gate stays in the vocabulary so those
 * surfaces vanish without per-edition branching.
 */
export const COMMUNITY_CAPABILITIES: readonly Capability[] = []
