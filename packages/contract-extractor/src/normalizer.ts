/**
 * Deterministic post-merge normalization of LLM-produced .tc fragments.
 *
 * The per-slice extractor is non-deterministic in three structural
 * ways that the comparator can't paper over:
 *
 *   1. Cross-artifact entity references are written in the surface form
 *      the slice text used — typically the table name (`Entity:orders`)
 *      rather than the declared entity identity (`Entity:Order`). Repair
 *      would otherwise spend an LLM round-trip "producing" the missing
 *      entity that already exists under a different casing.
 *
 *   2. Query-rule predicates fall back to `raw "<sql-ish>"` even when
 *      the expression is a straight `col OP val` that maps cleanly onto
 *      the structured predicate algebra (`eq`/`in`/`is-null`/...). The
 *      verifier's column-aware drift detection (e.g.
 *      `query.predicate.missing.tenantId.eq`) requires the structured
 *      form — `raw` is a comparator-opaque escape hatch.
 *
 *   3. The same constraint is sometimes emitted as two query-rules with
 *      slightly different identities (tenant-scope / tenant-scoped) from
 *      adjacent slice fragments. Both bind to the same (entity, predicate
 *      set), but downstream stages treat them as independent — one
 *      with an unresolved entity ref drops; one fires drift; markers
 *      can only match one.
 *
 * Each pass is a structural rewrite over `MergedArtifact.winning.tcSource`,
 * applied in order. No LLM round-trips, no fixture-coupled identities,
 * no special-cases for individual rule names.
 */

import type { MergedArtifact } from './merger.js';

// `MergedArtifact.kind` is the resolver's canonical PascalCase `ArtifactKind`
// (`Entity`, `QueryRule`, `ForbiddenArtifact`) — the same value the LLM emits,
// the merger carries through, and the writer routes on. Compare it directly.

// ---------------------------------------------------------------------------
// 1. Entity-ref canonicalization
// ---------------------------------------------------------------------------

/**
 * Build a lookup keyed by every normalized form a declared entity might
 * appear under (table name, snake_case, lowercase, plural). The value is
 * the declared canonical identity.
 */
function buildEntityIndex(artifacts: MergedArtifact[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const a of artifacts) {
    if (a.kind !== 'Entity') continue;
    const id = a.identity;
    const norm = normalizeEntityName(id);
    // Map both singular and plural normalized forms back to the canonical
    // identity. Plural is the common surface form in SQL/ORM prose.
    index.set(norm, id);
    index.set(pluralize(norm), id);
  }
  return index;
}

/**
 * Normalize an entity reference for matching: lowercase, strip a single
 * trailing 's' (plural → singular), collapse separators, drop snake/dash.
 *
 *   Order            → "order"
 *   orders           → "order"
 *   LoyaltyTier      → "loyaltytier"
 *   loyalty_tiers    → "loyaltytier"
 *   loyalty-tier     → "loyaltytier"
 */
function normalizeEntityName(name: string): string {
  let n = name.toLowerCase().replace(/[_-]/g, '');
  if (n.length > 2 && n.endsWith('s')) n = n.slice(0, -1);
  return n;
}

/** Crude plural for index keying — appends 's' when not already plural-ish. */
function pluralize(singular: string): string {
  return singular.endsWith('s') ? singular : singular + 's';
}

/**
 * Rewrite every `Entity:<x>` cross-reference that doesn't resolve to a
 * declared entity but whose normalized form does. Idempotent: refs that
 * already match a declared identity pass through untouched.
 */
export function normalizeEntityRefs(artifacts: MergedArtifact[]): { rewritten: number } {
  const declared = new Set(artifacts.filter((a) => a.kind === 'Entity').map((a) => a.identity));
  const index = buildEntityIndex(artifacts);
  let rewritten = 0;
  for (const a of artifacts) {
    const src = a.winning.tcSource;
    const next = src.replace(/\bEntity:([\w]+)\b/g, (match, ref: string) => {
      if (declared.has(ref)) return match;
      const canon = index.get(normalizeEntityName(ref));
      if (!canon || canon === ref) return match;
      rewritten++;
      return `Entity:${canon}`;
    });
    if (next !== src) a.winning.tcSource = next;
  }
  return { rewritten };
}

// ---------------------------------------------------------------------------
// 2. Structured-predicate lifting for query-rules
// ---------------------------------------------------------------------------

/**
 * Convert a parseable `raw "<expr>"` line into a structured predicate
 * (`eq`, `in`, `is-null`, `is-not-null`). Returns null when the
 * expression isn't a known shape — the caller leaves `raw` in place so
 * genuinely unparseable expressions still surface as `query.unparseable`
 * drift, which is the intended behaviour for those.
 */
function liftRawExpression(expr: string): string | null {
  const trimmed = expr.trim();
  let m: RegExpExecArray | null;

  if ((m = /^([\w.]+)\s+IS\s+NOT\s+NULL$/i.exec(trimmed))) {
    return `is-not-null ${m[1]}`;
  }
  if ((m = /^([\w.]+)\s+IS\s+NULL$/i.exec(trimmed))) {
    return `is-null ${m[1]}`;
  }
  if ((m = /^([\w.]+)\s+IN\s+[(\[]([^)\]]+)[)\]]$/i.exec(trimmed))) {
    const col = m[1];
    const items = m[2]
      .split(',')
      .map((s) => formatValue(s.trim()))
      .filter((v): v is string => v !== null);
    if (items.length === 0) return null;
    return `in ${col} [${items.join(', ')}]`;
  }
  if ((m = /^([\w.]+)\s*(=|!=|<>|<=|>=|<|>)\s*(.+)$/.exec(trimmed))) {
    const col = m[1];
    const op = m[2];
    const val = formatValue(m[3]);
    if (val === null) return null;
    if (op === '=') return `eq ${col} ${val}`;
    if (op === '!=' || op === '<>') return `neq ${col} ${val}`;
    if (op === '<') return `lt ${col} ${val}`;
    if (op === '<=') return `lte ${col} ${val}`;
    if (op === '>') return `gt ${col} ${val}`;
    if (op === '>=') return `gte ${col} ${val}`;
  }
  return null;
}

/**
 * Format a right-hand-side value for the predicate algebra:
 *   - <placeholder>  → "<param>"  (caller/tenant/etc. — runtime-supplied)
 *   - 'string' or "string" → "string"
 *   - bare numeric   → unchanged
 *   - bare identifier (no spaces, looks word-y) → "<identifier>"
 */
function formatValue(rhs: string): string | null {
  const t = rhs.trim();
  if (!t) return null;
  if (/^<.*>$/.test(t)) return '"<param>"';
  if ((/^"[^"]*"$/.test(t)) || /^'[^']*'$/.test(t)) {
    return `"${t.slice(1, -1)}"`;
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return t;
  if (/^[A-Za-z_][\w]*$/.test(t)) return `"${t}"`;
  return null;
}

/**
 * Walk every `query-rule` artifact and rewrite its inline `raw "..."`
 * lines to structured predicates wherever the expression parses.
 */
export function normalizeRawPredicates(artifacts: MergedArtifact[]): { rewritten: number } {
  let rewritten = 0;
  for (const a of artifacts) {
    if (a.kind !== 'QueryRule') continue;
    const src = a.winning.tcSource;
    const next = src.replace(/^(\s*)raw\s+"([^"]+)"\s*$/gm, (full, indent: string, expr: string) => {
      const lifted = liftRawExpression(expr);
      if (!lifted) return full;
      rewritten++;
      return `${indent}${lifted}`;
    });
    if (next !== src) a.winning.tcSource = next;
  }
  return { rewritten };
}

// ---------------------------------------------------------------------------
// 3. Query-rule dedup
// ---------------------------------------------------------------------------

/**
 * Derive a structural key for a query-rule from its tcSource. Two rules
 * with the same key bind to the same entity and assert the same set of
 * predicates — they are the same constraint regardless of identity.
 */
function structuralKey(tcSource: string): string | null {
  const entity = /\bentity\s+(Entity:[\w]+)/.exec(tcSource)?.[1];
  if (!entity) return null;
  const preds: string[] = [];
  collectBlockLines(tcSource, 'required', (line) => preds.push(`R:${line}`));
  collectBlockLines(tcSource, 'forbidden', (line) => preds.push(`F:${line}`));
  for (const m of tcSource.matchAll(/\bdate-range-binding\s+column\s+([\w.]+)/g)) {
    preds.push(`D:${m[1]}`);
  }
  preds.sort();
  return `${entity}|${preds.join('|')}`;
}

function collectBlockLines(src: string, label: string, push: (line: string) => void): void {
  const re = new RegExp(`\\b${label}\\s*\\{([^}]*)\\}`, 'gs');
  for (const m of src.matchAll(re)) {
    for (const raw of m[1].split('\n')) {
      const line = raw.trim();
      if (line) push(line);
    }
  }
}

/**
 * Structural key for a forbidden-artifact: its (category, pattern) — the
 * pair the verifier's presence check keys on. Two forbidden-artifacts
 * with the same pair forbid the same thing regardless of how they were
 * named or worded.
 */
function forbiddenStructuralKey(tcSource: string): string | null {
  const category = /\bcategory\s+([\w-]+)/.exec(tcSource)?.[1];
  const pattern = /\bpattern\s+"([^"]+)"/.exec(tcSource)?.[1];
  if (!category || !pattern) return null;
  return `${category}|${pattern}`;
}

/**
 * Collapse artifacts that assert the same constraint under different
 * identities: query-rules with the same (entity, predicate set), and
 * forbidden-artifacts with the same (category, pattern). Keeps the
 * shortest identity (tie-break alphabetical). Returns the filtered list.
 */
export function dedupArtifacts(artifacts: MergedArtifact[]): {
  artifacts: MergedArtifact[];
  removed: number;
} {
  const groups = new Map<string, MergedArtifact[]>();
  for (const a of artifacts) {
    let key: string | null = null;
    if (a.kind === 'QueryRule') {
      const k = structuralKey(a.winning.tcSource);
      if (k) key = `QueryRule|${k}`;
    } else if (a.kind === 'ForbiddenArtifact') {
      const k = forbiddenStructuralKey(a.winning.tcSource);
      if (k) key = `ForbiddenArtifact|${k}`;
    }
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(a);
    else groups.set(key, [a]);
  }
  const drop = new Set<MergedArtifact>();
  for (const bucket of groups.values()) {
    if (bucket.length <= 1) continue;
    bucket.sort(
      (a, b) =>
        a.identity.length - b.identity.length || a.identity.localeCompare(b.identity),
    );
    for (let i = 1; i < bucket.length; i++) drop.add(bucket[i]);
  }
  return {
    artifacts: artifacts.filter((a) => !drop.has(a)),
    removed: drop.size,
  };
}

// ---------------------------------------------------------------------------
// 4. Deterministic identity assignment
// ---------------------------------------------------------------------------

/** kebab-slug of arbitrary text: lowercase, non-alphanumeric → single dash. */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * For artifact kinds whose identity is otherwise a free-form label the
 * LLM invents (ForbiddenArtifact, QueryRule), derive the identity
 * deterministically from the artifact's own semantic content. Two
 * extractions of the same constraint then carry the same identity
 * regardless of how the model happened to name them — which is what the
 * verifier's per-artifact drift attribution needs to be reproducible.
 *
 *   ForbiddenArtifact → `<category>.<pattern-slug>`
 *   QueryRule         → `<entity-slug>.<predicate-signature>`
 *
 * The convention is content-derived and general; it embeds no
 * project-specific names.
 */
export function assignDeterministicIdentities(artifacts: MergedArtifact[]): { renamed: number } {
  let renamed = 0;
  for (const a of artifacts) {
    let next: string | null = null;
    if (a.kind === 'ForbiddenArtifact') next = forbiddenIdentity(a.winning.tcSource);
    else if (a.kind === 'QueryRule') next = queryRuleIdentity(a.winning.tcSource);
    if (!next || next === a.identity) continue;
    a.winning.tcSource = renameHeader(a.winning.tcSource, a.identity, next);
    a.winning.identity = next;
    a.identity = next;
    renamed++;
  }
  return { renamed };
}

function forbiddenIdentity(src: string): string | null {
  const category = /\bcategory\s+([\w-]+)/.exec(src)?.[1];
  const pattern = /\bpattern\s+"([^"]+)"/.exec(src)?.[1];
  if (!category || !pattern) return null;
  return `${slug(category)}.${slug(pattern)}`;
}

function queryRuleIdentity(src: string): string | null {
  const entity = /\bentity\s+Entity:([\w]+)/.exec(src)?.[1];
  if (!entity) return null;
  const sig: string[] = [];
  const drb = /\bdate-range-binding\s+column\s+(?:[\w]+\.)?([\w]+)/.exec(src);
  if (drb) sig.push(`daterange-${slug(drb[1])}`);
  const predOf = (block: string, prefix: string): void => {
    const m = new RegExp(`\\b${block}\\s*\\{([^}]*)\\}`, 's').exec(src);
    if (!m) return;
    for (const line of m[1].split('\n')) {
      const pm = /^\s*(eq|neq|in|is-null|is-not-null|lt|lte|gt|gte|like|ilike)\s+(?:[\w]+\.)?([\w]+)/.exec(line);
      if (pm) sig.push(`${prefix}${slug(pm[1])}-${slug(pm[2])}`);
    }
  };
  predOf('required', '');
  predOf('forbidden', 'no-');
  if (sig.length === 0) return null;
  sig.sort();
  return `${slug(entity)}.${sig.join('.')}`;
}

/**
 * Collapse artifacts that share a `(kind, identity)` AFTER deterministic
 * identity assignment. `assignDeterministicIdentities` maps each identity to a
 * content-derived slug (e.g. `file-glob.<pattern-slug>`); two structurally
 * DISTINCT artifacts whose slugs coincide therefore arrive here with the SAME
 * identity — the LLM is fond of emitting one out-of-scope route as both
 * `orders-export` (glob `**​/orders/**export*`) and `orders-id-export` (glob
 * `**​/orders/**​/*export*`), which both slug to `orders-export`. `dedupArtifacts`
 * ran earlier on the finer `(category, exact-pattern)` key and couldn't see the
 * collision, so without this pass the duplicate reaches the resolver, which
 * rejects the whole corpus (`duplicate artifact identity`). Keeps the first
 * artifact per key (deterministic merge order); the dropped ones are redundant
 * by the verifier's own identity definition.
 */
function collapseIdentityCollisions(artifacts: MergedArtifact[]): {
  artifacts: MergedArtifact[];
  removed: number;
} {
  const seen = new Set<string>();
  const out: MergedArtifact[] = [];
  let removed = 0;
  for (const a of artifacts) {
    const key = `${a.kind}:${a.identity}`;
    if (seen.has(key)) {
      removed++;
      continue;
    }
    seen.add(key);
    out.push(a);
  }
  return { artifacts: out, removed };
}

/** Rewrite the `<keyword> <oldId> {` header to use the new identity. */
function renameHeader(src: string, oldId: string, newId: string): string {
  const escaped = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return src.replace(
    new RegExp(`(\\b(?:forbidden-artifact|query-rule)\\s+)${escaped}(\\s*\\{)`),
    `$1${newId}$2`,
  );
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface NormalizeStats {
  entityRefsRewritten: number;
  rawPredicatesLifted: number;
  artifactsDeduplicated: number;
  identitiesAssigned: number;
}

/**
 * Apply all post-merge normalizations in the order they depend on each
 * other: entity-refs first (so dedup keys see canonical entities), then
 * raw-predicate lifting (so dedup keys see structured predicates), then
 * the dedup pass itself.
 */
export function normalizeMergedArtifacts(artifacts: MergedArtifact[]): {
  artifacts: MergedArtifact[];
  stats: NormalizeStats;
} {
  const { rewritten: entityRefsRewritten } = normalizeEntityRefs(artifacts);
  const { rewritten: rawPredicatesLifted } = normalizeRawPredicates(artifacts);
  // Dedup by structural content BEFORE assigning deterministic identities:
  // two extractions of the same constraint would otherwise both rename to
  // the same identity and collide (duplicate-identity resolver error).
  const { artifacts: deduped, removed: artifactsDeduplicated } = dedupArtifacts(artifacts);
  // Identity is derived from structured predicates, so this runs after
  // raw→structured lifting.
  const { renamed: identitiesAssigned } = assignDeterministicIdentities(deduped);
  // assignDeterministicIdentities can map structurally-distinct artifacts onto
  // the SAME identity (different glob spellings / free-form names that slug
  // alike). dedupArtifacts ran on the finer structural key and missed those, so
  // collapse the post-assignment collisions here — otherwise the resolver
  // rejects the corpus on a duplicate identity.
  const { artifacts: collapsed, removed: collisionsCollapsed } =
    collapseIdentityCollisions(deduped);
  return {
    artifacts: collapsed,
    stats: {
      entityRefsRewritten,
      rawPredicatesLifted,
      artifactsDeduplicated: artifactsDeduplicated + collisionsCollapsed,
      identitiesAssigned,
    },
  };
}
