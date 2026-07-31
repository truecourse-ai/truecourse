/**
 * The EXTERNAL API ACCOUNTS wire types (item 62) — the shape
 * `GET/PUT /api/repos/:id/guard/externals` speaks.
 *
 * They mirror `packages/core/src/commands/guard-externals.ts` (the engine's
 * `GuardExternalsView` / `GuardExternalPatch`) rather than importing it: the
 * client depends on `@truecourse/shared` only — `@truecourse/core` is a Node
 * package (fs, atomic writes) that must never enter the browser bundle. Keep
 * this file in sync with the engine when its view grows a field.
 */

/** Provided = fully resolved; incomplete = SOME of it resolved (a run hard-stops). */
export type GuardExternalState = 'provided' | 'incomplete' | 'unprovided';

/** One requirement of an external and whether it is satisfied on this machine. */
export interface GuardExternalRequirement {
  /** `base-url` is the `baseUrlEnv` assignment; `env` is one declared extra var. */
  kind: 'base-url' | 'env';
  envVar: string;
  resolved: boolean;
  /** Where the value came from (absent when unresolved). */
  source?: 'recipe' | 'local' | 'process-env';
  /** Why it is unresolved (absent when resolved) — rendered verbatim. */
  reason?: string;
  /** True when the value is a secret, so no UI ever echoes it. */
  secret: boolean;
  /**
   * True when the value came out of the DECLARATION rather than from the user — an
   * extra base-URL variable whose origin `guard setup` copied out of the codebase.
   * Listed like any other requirement, but it never moves the service's state.
   */
  derived?: boolean;
}

/**
 * One detected base-URL override variable: which one, what the app falls back to
 * without it, and whether the source BOUND it to that URL (`literal-fallback`) or
 * its NAME merely reads like a base URL (`name-heuristic`).
 */
export interface GuardExternalBaseUrlEnv {
  envVar: string;
  defaultUrl?: string;
  confidence: 'literal-fallback' | 'name-heuristic';
}

/** One service as the page shows it: detection ∪ declaration ∪ resolution. */
export interface GuardExternalServiceView {
  service: string;
  /** The last `guard generate` saw it in the working tree. */
  detected: boolean;
  /** `recipe.json` declares it under `api.externals`. */
  declared: boolean;
  state: GuardExternalState;
  /** The detector's category (`payment`, `ai`, …) when it was detected. */
  category?: string;
  /** How detection identified it — an SDK import, or a plain HTTP call (item 63). */
  detectedVia?: 'sdk' | 'http';
  baseUrlEnv: string | null;
  /** Whether `baseUrlEnv` is the recipe's declaration or the detector's guess. */
  baseUrlEnvSource: 'recipe' | 'detected' | null;
  /**
   * EVERY base-URL override variable detection saw, best-confidence first — one
   * vendor can be reached through several hosts, each with its own variable and its
   * own default URL (item 63). `baseUrlEnv` is only the first of them.
   */
  baseUrlEnvs: GuardExternalBaseUrlEnv[];
  baseUrl: string | null;
  /**
   * EXTRA base-URL variables the declaration carries (item 64): env var → origin.
   * Each gets its own runner-managed proxy, which is why they are declared as URLs
   * rather than as key-shaped env rows. The primary is not repeated here.
   */
  endpoints: Record<string, string>;
  mode?: 'sandbox' | 'real';
  description?: string;
  requirements: GuardExternalRequirement[];
  /** Flows the last generate settled `blocked-on` naming THIS service. */
  blockedFlows: number;
  evidence: { filePath: string; importSource?: string; url?: string }[];
  /** Overlay env keys the recipe never declared — ignored by the engine, surfaced here. */
  undeclaredLocalEnv: string[];
}

/** The whole externals page in one read. */
export interface GuardExternalsView {
  recipePath: string;
  localPath: string;
  recipeValid: boolean;
  invalidReason: string | null;
  /** Writes need an `api` block — the recipe configures the api driver. */
  hasApiBlock: boolean;
  /** False means "detection has not run", NOT "this repo has no third parties". */
  detectionAvailable: boolean;
  services: GuardExternalServiceView[];
  unknownLocalServices: string[];
}

/**
 * One env var as the page asks for it to be stored — the SECRECY split:
 * `{ value }` lands in the gitignored overlay, `{ valueFromEnv }` (a variable
 * NAME, not a secret) and `{ value, inline: true }` in the committed recipe,
 * `null` drops it.
 */
export type GuardExternalEnvPatch =
  | { value: string }
  | { valueFromEnv: string }
  | { value: string; inline: true }
  | null;

/** One service's desired declaration; `null` removes the service entirely. */
export interface GuardExternalPatch {
  baseUrlEnv: string;
  baseUrl?: string;
  /** Where the base URL is stored — the committed recipe (default) or the overlay. */
  baseUrlTarget?: 'recipe' | 'local';
  /** Extra base-URL variables: env var → origin, or `null` to drop one. Committed. */
  endpoints?: Record<string, string | null>;
  mode?: 'sandbox' | 'real';
  description?: string;
  env?: Record<string, GuardExternalEnvPatch>;
}
