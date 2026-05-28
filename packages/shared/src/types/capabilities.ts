/**
 * Edition + capability contract for the dashboard.
 *
 * The server reports `edition` (community for OSS, enterprise for the
 * commercial build with a valid license key) and `capabilities` — the
 * feature gates that are currently turned on for this deployment.
 *
 * Capability identifiers are deliberately typed as plain strings so
 * the `ee/` packages (and any third-party plugins) can register their
 * own gates without forcing a shared-schema change for every feature.
 * Both the OSS dashboard and `ee/` agree on this vocabulary via this
 * single module.
 */

export type Edition = 'community' | 'enterprise'

export type Capability = string

export interface CapabilitiesResponse {
  edition: Edition
  capabilities: Capability[]
}

/** OSS ships with no capabilities turned on. */
export const COMMUNITY_CAPABILITIES: readonly Capability[] = []
