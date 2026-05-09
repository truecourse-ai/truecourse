/**
 * Logical module detector. Takes a flat list of claims (after merge)
 * and groups them into spec modules. Each module is a coherent
 * surface area — the kind of thing a developer would name in
 * conversation: "auth", "infractions", "memory".
 *
 * Detection is deterministic and cheap (no LLM). Strategy:
 *
 *   - For `endpoints` claims: extract the path, strip common API
 *     prefix segments (api, v1, v2, ...), take the next segment as
 *     the module name. Claims sharing a module name group together.
 *
 *   - For `auth`, `errors`, `effects`, `overview`, `data`: claims
 *     without an explicit module scope go to `_shared`. Claims that
 *     name a specific module via their `subject` (e.g.
 *     "auth scheme for /api/v1/auth/*") get attributed to that
 *     module via the same path-prefix logic.
 *
 *   - Modules with a single endpoint claim still become their own
 *     module (e.g. /health → module "health"). Better to over-split
 *     than under-split — the user can merge in the dashboard.
 *
 * Output: a map of module name → claims, plus a `ModuleManifest` for
 * each module with a derived `scope` selector. Cross-cutting claims
 * land in `_shared`, which doesn't need a `scope` (it applies
 * globally by definition).
 */

import type { Claim, ModuleManifest, Topic } from './types.js';

/** Path segments stripped when deriving a module name from an endpoint path. */
const STRIPPED_PREFIX_SEGMENTS = new Set(['api', 'apis', 'public']);
const VERSION_SEGMENT = /^v\d+$/i;

/** Module reserved for cross-cutting / global claims. */
export const SHARED_MODULE = '_shared';

export interface DetectedModule {
  name: string;
  manifest: ModuleManifest;
  /** Claims this module owns. */
  claims: Claim[];
}

export interface ModuleDetectionResult {
  modules: DetectedModule[];
  /**
   * Claims we couldn't attribute — usually because they had no
   * structural information to work with. Surfaced so the materializer
   * can decide whether to drop them or stash them under `_shared`.
   */
  unattributed: Claim[];
}

export function detectModules(claims: Claim[]): ModuleDetectionResult {
  const byModule = new Map<string, Claim[]>();
  const unattributed: Claim[] = [];

  for (const claim of claims) {
    const moduleName = inferModuleFor(claim);
    if (!moduleName) {
      unattributed.push(claim);
      continue;
    }
    const list = byModule.get(moduleName) ?? [];
    list.push(claim);
    byModule.set(moduleName, list);
  }

  const modules: DetectedModule[] = [];
  // Sort module names so output is deterministic; _shared first because
  // dashboard UIs usually want it pinned at the top.
  const names = [...byModule.keys()].sort((a, b) => {
    if (a === SHARED_MODULE) return -1;
    if (b === SHARED_MODULE) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  for (const name of names) {
    const claimsForModule = byModule.get(name)!;
    modules.push({
      name,
      claims: claimsForModule,
      manifest: buildManifest(name, claimsForModule),
    });
  }

  return { modules, unattributed };
}

// ---------------------------------------------------------------------------
// Per-claim attribution
// ---------------------------------------------------------------------------

function inferModuleFor(claim: Claim): string | null {
  // Endpoints: the most reliable signal — derive from path.
  if (claim.topic === 'endpoints') {
    return moduleFromEndpointClaim(claim);
  }

  // Cross-cutting topics: try the same path-derivation in case the
  // subject is path-shaped (e.g. "auth on /api/v1/admin/*"); else
  // fall back to _shared.
  const fromPath = extractPathFromSubject(claim.subject);
  if (fromPath) {
    const m = moduleFromPath(fromPath);
    if (m) return m;
  }

  if (claim.topic === 'overview') {
    // Module-overview claims often have subject = the module name.
    // Treat the subject as a candidate module name when it's a
    // single, slug-shaped token.
    if (/^[a-z][a-z0-9-]*$/i.test(claim.subject)) {
      return claim.subject.toLowerCase();
    }
  }

  // Default: cross-cutting goes to _shared.
  return SHARED_MODULE;
}

function moduleFromEndpointClaim(claim: Claim): string | null {
  // Try the structured content first (LLM-extracted method+path).
  const path = extractPath(claim.content);
  if (path) {
    const m = moduleFromPath(path);
    if (m) return m;
  }
  // Fallback: parse the subject — usually "<METHOD> <path>" shape.
  const subjectPath = extractPathFromSubject(claim.subject);
  if (subjectPath) {
    const m = moduleFromPath(subjectPath);
    if (m) return m;
  }
  return null;
}

function extractPath(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;
  const obj = content as Record<string, unknown>;
  if (typeof obj.path === 'string') return obj.path;
  return null;
}

function extractPathFromSubject(subject: string): string | null {
  // Accept "GET /foo", "POST /api/x", or just "/foo".
  const trimmed = subject.trim();
  const methodMatch = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/[^\s]*)$/i.exec(trimmed);
  if (methodMatch) return methodMatch[2];
  if (trimmed.startsWith('/')) return trimmed.split(/\s+/)[0];
  return null;
}

/**
 * Strip common prefix segments (api, v1, v2, ...) from a path and
 * return the first remaining segment as the module name. Returns
 * null when the path collapses to nothing after stripping (which
 * shouldn't happen on a real route).
 *
 * Examples:
 *   /api/v1/infractions/{id} → 'infractions'
 *   /api/auth/wallet         → 'auth'
 *   /health                  → 'health'
 *   /v2/users                → 'users'
 *   /                        → null (no module)
 */
function moduleFromPath(rawPath: string): string | null {
  // Drop query string + trailing slash for normalization.
  const path = rawPath.split('?')[0].replace(/\/+$/, '');
  const segments = path.split('/').filter((s) => s.length > 0);
  for (const seg of segments) {
    const lower = seg.toLowerCase();
    if (STRIPPED_PREFIX_SEGMENTS.has(lower)) continue;
    if (VERSION_SEGMENT.test(lower)) continue;
    // Skip dynamic segments — `:id`, `{id}`, etc. — they're never
    // module names.
    if (lower.startsWith(':') || (lower.startsWith('{') && lower.endsWith('}'))) continue;
    return slugify(lower);
  }
  return null;
}

function slugify(s: string): string {
  return s.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Manifest construction
// ---------------------------------------------------------------------------

function buildManifest(name: string, claims: Claim[]): ModuleManifest {
  // Every contributing source — primary provenance file plus any
  // `additionalSources` left by the merger when multiple docs agreed
  // on the same claim.
  const allSources: string[] = [];
  for (const c of claims) {
    allSources.push(c.provenance.file);
    for (const extra of c.provenance.additionalSources ?? []) {
      allSources.push(extra.file);
    }
  }
  const sourceDocs = uniqueSorted(allSources);
  const status = inferModuleStatus(claims);
  const scope = inferScope(name, claims);
  return {
    name,
    status,
    sourceDocs,
    scope,
  };
}

/**
 * Module-level status (Q6): if every claim in the module shares a
 * single explicit status, lift it. Mixed or unset → 'shipped'
 * (the schema default).
 */
function inferModuleStatus(claims: Claim[]): ModuleManifest['status'] {
  const statuses = new Set<string>();
  for (const c of claims) {
    if (c.metadata.status) statuses.add(c.metadata.status);
  }
  if (statuses.size === 1) {
    return [...statuses][0] as ModuleManifest['status'];
  }
  return 'shipped';
}

/**
 * Build a `scope` selector. For modules backed by endpoint claims,
 * derive a glob that captures every endpoint's path. For `_shared`,
 * scope is global (omit paths) and tag-only.
 */
function inferScope(name: string, claims: Claim[]): ModuleManifest['scope'] {
  if (name === SHARED_MODULE) {
    return { tags: ['shared'] };
  }
  const paths = new Set<string>();
  for (const c of claims) {
    if (c.topic !== 'endpoints') continue;
    const p = extractPath(c.content) ?? extractPathFromSubject(c.subject);
    if (p) paths.add(globForModule(p, name));
  }
  if (paths.size === 0) {
    return { tags: [name] };
  }
  return { paths: [...paths].sort() };
}

/**
 * Coarsen a path into a `scope.paths` glob entry. The verifier matches
 * a code-side route against this glob, so we want the broadest glob
 * that still picks the right module.
 *
 * Strategy: keep everything up to and including the segment that
 * matches the module name, then append /** so sub-routes are
 * captured. Falls back to the path itself when the module name isn't
 * a segment (rare).
 */
function globForModule(path: string, moduleName: string): string {
  const cleaned = path.split('?')[0].replace(/\/+$/, '');
  const segments = cleaned.split('/');
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].toLowerCase() === moduleName) {
      return segments.slice(0, i + 1).join('/') + '/**';
    }
  }
  return cleaned;
}

function uniqueSorted(arr: string[]): string[] {
  return [...new Set(arr)].sort();
}

// ---------------------------------------------------------------------------
// Diagnostics — exposed for tests / CLI status
// ---------------------------------------------------------------------------

export function topicsInModule(module: DetectedModule): Topic[] {
  return [...new Set(module.claims.map((c) => c.topic))].sort() as Topic[];
}
