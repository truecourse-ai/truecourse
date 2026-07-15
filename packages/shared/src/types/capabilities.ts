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

/**
 * Deliberately a plain string (see module doc). Identifiers currently in use:
 * OSS advertises `local-filesystem` (below); the enterprise plugin advertises
 * `sso`, `workspace`, `jobs`, `knowledge`, `github-gate`, `llm-config`, and
 * `guard` — the last one only when the guard subsystem is wired AND the
 * background job worker actually started (hosted guard generation runs on the
 * job queue, so a dead queue must not light up guard actions).
 */
export type Capability = string

export interface CapabilitiesResponse {
  edition: Edition
  capabilities: Capability[]
}

/**
 * Capabilities the OSS (community) build advertises. `local-filesystem` is an
 * INVERSE gate: OSS runs against the user's repo on local disk, so it carries
 * this capability and the hosted (EE) edition — which has no per-user filesystem
 * — does NOT. Features that need local files (the file explorer, sequence-flow
 * viewer, database schema viewer) require it, so they appear in OSS and vanish
 * in EE without any per-edition branching.
 */
export const COMMUNITY_CAPABILITIES: readonly Capability[] = ['local-filesystem']
