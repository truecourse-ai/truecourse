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

  // ---- Pass 1: attribute endpoints by their path. -------------------
  // Endpoints carry the strongest signal (a real path) so they seed
  // the module set first. Non-endpoint claims (data, effects, auth,
  // errors, overview) get attributed in pass 2 by matching their
  // subject against established modules — that way an "Order entity"
  // data claim follows the module its endpoints already live in.
  const deferred: Claim[] = [];
  for (const claim of claims) {
    if (claim.topic === 'endpoints') {
      const moduleName = moduleFromEndpointClaim(claim);
      if (!moduleName) {
        unattributed.push(claim);
        continue;
      }
      const list = byModule.get(moduleName) ?? [];
      list.push(claim);
      byModule.set(moduleName, list);
    } else {
      deferred.push(claim);
    }
  }

  // ---- Pass 2: attribute non-endpoint claims. -----------------------
  // For each, try the original signals (subject is path-shaped, or
  // overview-style slug) first, then attempt content-based attribution
  // against existing modules. Falls back to _shared.
  const existingModules = [...byModule.keys()].filter((n) => n !== SHARED_MODULE);
  const moduleIndex = buildModuleIndex(byModule, existingModules);
  for (const claim of deferred) {
    const moduleName =
      inferModuleForNonEndpoint(claim) ??
      attributeByContentMatch(claim, existingModules, moduleIndex) ??
      SHARED_MODULE;
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

/**
 * Try the structural signals on a non-endpoint claim's subject —
 * path-shaped subjects (`"auth on /api/v1/admin/*"`) attribute
 * directly; overview claims with single-token subjects treat the
 * subject as the module name. Returns null when no strong signal
 * is present; the caller then tries content-based matching against
 * existing modules.
 */
function inferModuleForNonEndpoint(claim: Claim): string | null {
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

  return null;
}

/**
 * Index every existing module's endpoint claims by the bare nouns
 * mentioned in their path + content + subject. Used to attribute a
 * data/effects claim to the module that's already talking about it.
 *
 * Returns a map: module name → set of lowercased tokens that appear
 * in that module's claims. The matcher then scores each module by
 * how many tokens overlap with the candidate claim's subject.
 */
function buildModuleIndex(
  byModule: Map<string, Claim[]>,
  moduleNames: string[],
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const name of moduleNames) {
    const tokens = new Set<string>();
    // The module name itself is always a high-signal token.
    tokens.add(name);
    // Singularize a trailing 's' (orders → order) so "Order entity"
    // matches the orders module. Pure structural, no domain knowledge.
    if (name.endsWith('s') && name.length > 1) {
      tokens.add(name.slice(0, -1));
    }
    for (const claim of byModule.get(name) ?? []) {
      // Path segments expose related nouns (e.g., /api/orders/:id/pay).
      const path =
        extractPath(claim.content) ?? extractPathFromSubject(claim.subject);
      if (path) {
        for (const seg of path.split('/')) {
          const lower = seg.toLowerCase();
          if (!lower || STRIPPED_PREFIX_SEGMENTS.has(lower)) continue;
          if (VERSION_SEGMENT.test(lower)) continue;
          if (lower.startsWith(':') || lower.startsWith('{')) continue;
          tokens.add(lower);
          if (lower.endsWith('s') && lower.length > 1) {
            tokens.add(lower.slice(0, -1));
          }
        }
      }
    }
    out.set(name, tokens);
  }
  return out;
}

/**
 * Content-based attribution: score each existing module by how many
 * of its indexed tokens appear in the claim's subject (lowercased,
 * split on non-alphanumeric). Top-scoring module wins, ties break by
 * module name. Returns null when no module overlaps at all.
 *
 * Examples (no domain knowledge baked in):
 *   subject "Order entity"          → "order" matches orders module → "orders"
 *   subject "Order / state machine" → "order" matches orders module → "orders"
 *   subject "order.placed"          → "order" matches orders module → "orders"
 *   subject "Customer entity"       → "customer" matches customers module → "customers"
 *   subject "global error envelope" → no token overlap → null (→ _shared)
 *   subject "auth scheme"           → no token overlap → null (→ _shared)
 */
function attributeByContentMatch(
  claim: Claim,
  moduleNames: string[],
  index: Map<string, Set<string>>,
): string | null {
  if (moduleNames.length === 0) return null;
  const subjectTokens = tokenize(claim.subject);
  if (subjectTokens.size === 0) return null;
  let best: { name: string; score: number } | null = null;
  for (const name of moduleNames) {
    const tokens = index.get(name);
    if (!tokens) continue;
    let score = 0;
    for (const t of subjectTokens) {
      if (tokens.has(t)) score++;
    }
    if (score === 0) continue;
    if (!best || score > best.score || (score === best.score && name < best.name)) {
      best = { name, score };
    }
  }
  return best?.name ?? null;
}

/**
 * Tokenize a subject string into normalized lowercase tokens for
 * module-attribution matching. Splits on:
 *   - non-alphanumeric characters (`Order entity` → `order`, `entity`)
 *   - camelCase / PascalCase boundaries (`OrderStatus` → `order`,
 *     `status`)
 *   - letter↔digit boundaries (`v1Auth` → `v1`, `auth`)
 *
 * Also emits a singularized form for each plural-looking token
 * (`orders` → also adds `order`) so subjects with the singular noun
 * match a module named with the plural and vice versa.
 */
function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  // Split on non-alphanumeric AND on camelCase/letter-digit boundaries.
  const raw = s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
    .toLowerCase();
  for (const part of raw.split(/[^a-z0-9]+/)) {
    if (!part || part.length < 2) continue;
    out.add(part);
    if (part.endsWith('s') && part.length > 2) out.add(part.slice(0, -1));
  }
  return out;
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
  // Negative spec (B.9): claims tagged out-of-scope don't render as
  // prose endpoints — they're structural, listed on the manifest so
  // the verifier can flag the opposite drift (code shipped something
  // the spec said was excluded). Status and scope inference still
  // see ALL claims — a module with only OoS claims rightly bubbles
  // status='out-of-scope' to the module level, and its scope is
  // derived from the OoS paths so the manifest still has a target.
  const outOfScope = claims
    .filter((c) => c.metadata.status === 'out-of-scope')
    .map((c) => ({
      id: claimIdSlug(c),
      reason: extractOutOfScopeReason(c),
      source: `${c.provenance.file}:${c.provenance.line}`,
    }));

  const status = inferModuleStatus(claims);
  const scope = inferScope(name, claims);
  const description = inferDescription(name, claims);
  const manifest: ModuleManifest = {
    name,
    status,
    sourceDocs,
    scope,
  };
  if (description) manifest.description = description;
  if (outOfScope.length > 0) manifest.outOfScope = outOfScope;
  return manifest;
}

/**
 * Deterministic one-liner for the manifest's `description`. Lists
 * the module's in-scope HTTP operations so a reader of `module.yaml`
 * can see what it covers without opening the markdown. Returns undefined
 * for `_shared` (no canonical surface to enumerate) and for modules
 * with zero endpoint claims (the field is optional in the schema, so
 * we just omit it).
 */
function inferDescription(name: string, claims: Claim[]): string | undefined {
  if (name === SHARED_MODULE) return undefined;
  const operations: string[] = [];
  const seen = new Set<string>();
  for (const c of claims) {
    if (c.topic !== 'endpoints') continue;
    if (c.metadata.status === 'out-of-scope') continue;
    const path =
      extractPath(c.content) ?? extractPathFromSubject(c.subject);
    if (!path) continue;
    const method = extractMethod(c) ?? '';
    const op = method ? `${method} ${path}` : path;
    if (seen.has(op)) continue;
    seen.add(op);
    operations.push(op);
  }
  if (operations.length === 0) return undefined;
  const MAX_CHARS = 120;
  const lead = `${name} module — `;
  const joined = operations.join(', ');
  if (lead.length + joined.length <= MAX_CHARS) return `${lead}${joined}.`;
  // Truncate by op count instead of by character so the suffix lands
  // cleanly between operations rather than mid-path.
  for (let take = operations.length - 1; take >= 1; take--) {
    const trimmed = operations.slice(0, take).join(', ');
    const more = operations.length - take;
    const suffix = `, and ${more} more.`;
    if (lead.length + trimmed.length + suffix.length <= MAX_CHARS) {
      return `${lead}${trimmed}${suffix}`;
    }
  }
  return `${lead}${operations.length} operations.`;
}

function extractMethod(claim: Claim): string | null {
  if (claim.content && typeof claim.content === 'object') {
    const m = (claim.content as Record<string, unknown>).method;
    if (typeof m === 'string') return m.toUpperCase();
  }
  const match = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+/i.exec(claim.subject);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Subject → slug for the manifest's `outOfScope` list. Strips the
 * leading "<METHOD> /api/v1/..." form down to a path-only slug so
 * the entry reads naturally in YAML.
 */
function claimIdSlug(claim: Claim): string {
  const subject = claim.subject;
  // Try to extract a path from the subject and slugify it.
  const methodMatch = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/.+)$/i.exec(subject);
  const path = methodMatch ? methodMatch[2] : subject;
  return path.replace(/[^a-z0-9-/{}]+/gi, '-').replace(/^-+|-+$/g, '');
}

/**
 * Try to pull a reason from the LLM-supplied content. Many PRDs add
 * a parenthesized reason next to each excluded item ("(no SQL yet)").
 * Falls back to undefined when nothing's available.
 */
function extractOutOfScopeReason(claim: Claim): string | undefined {
  if (!claim.content || typeof claim.content !== 'object') return undefined;
  const obj = claim.content as Record<string, unknown>;
  if (typeof obj.reason === 'string') return obj.reason;
  return undefined;
}

/**
 * Module-level status (Q6): bubble a single status to the module
 * only when EVERY claim agrees. Previously this lifted any singleton
 * over the explicit-status subset, which marked the whole module
 * out-of-scope when even ONE claim was explicitly OoS and the rest
 * had no explicit status (treated implicitly as 'shipped'). Treating
 * undefined as the schema default 'shipped' fixes that.
 */
function inferModuleStatus(claims: Claim[]): ModuleManifest['status'] {
  const statuses = new Set<string>();
  for (const c of claims) {
    statuses.add(c.metadata.status ?? 'shipped');
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
