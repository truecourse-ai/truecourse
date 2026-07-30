/**
 * Global target reconciliation (spec-scan redesign, Phase 2 — over-generation fix).
 *
 * Each area enumerates its targets independently, so a cross-cutting decision
 * (the outbox pattern, the bearer-auth requirement) gets enumerated in several
 * areas, often under a DIFFERENT identity each time (`outbox-pattern` vs
 * `transactional-outbox`). Generating per-area then produces the same artifact
 * many times, and because the identities differ, `merge` can't collapse them and
 * the completeness gate's retries amplify the duplication.
 *
 * This pass runs AFTER enumeration and BEFORE generate. It:
 *   (a) de-dups targets across areas deterministically by coverage key (same
 *       identity in N areas → generated once, in the first area), and
 *   (b) reconciles SEMANTIC duplicates (different identities, same artifact) via
 *       one LLM clustering call that assigns a canonical (kind, identity) per
 *       cluster — so each real artifact is generated exactly once.
 *
 * Net effect: each artifact is generated once with a stable identity → no
 * cross-area bloat, merge dedups cleanly, fewer generate calls. Mirrors the
 * `vocab-normalizer` pattern (cached, sanitized, best-effort). No hardcoding.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getCacheEntry, setCacheEntry } from '@truecourse/llm';
import { cliTransport, jsonSchemaHint, stripCodeFences, type LlmTransport } from '@truecourse/shared/llm';
import { parserOhm, resolver, type ArtifactRef } from '@truecourse/contract-verifier';
import { coverageKey, type TargetSpec } from './corpus-prompt.js';
import { slugIdentity } from './identity.js';
import type { AreaGenInput } from './corpus-reader.js';
// Type-only (erased at runtime → no cycle; merger imports nothing from here).
import type { MergedArtifact } from './merger.js';

/** Per-area enumerated targets — the input and output shape of reconciliation. */
export interface AreaTargets {
  area: AreaGenInput;
  targets: TargetSpec[];
}

export interface ReconcileRunnerInput {
  /** Distinct targets across all areas (deduped by coverage key). */
  targets: { kind: string; identity: string; hint?: string }[];
}
/** Returns merges: each non-canonical `coverageKey` → its canonical kind+identity. */
export type ReconcileRunner = (input: ReconcileRunnerInput) => Promise<{
  merges: Record<string, { kind: string; identity: string }>;
}>;

export interface TargetReconcilerOptions {
  runner?: ReconcileRunner;
  transport?: LlmTransport;
  /** When false, only the deterministic cross-area de-dup runs (no LLM). */
  enabled?: boolean;
  /**
   * Existing artifact identities (kind + identity) from the prior generation.
   * When a candidate cluster contains exactly one of these incumbents, that
   * spelling is forced canonical deterministically (incumbent-wins) — so a
   * reviewed identity never flips run-to-run just because the LLM re-judged it.
   */
  priorTargets?: readonly { kind: string; identity: string }[];
  model?: string;
  fallbackModel?: string;
}

/** Output of {@link reconcileTargets}: the reassigned per-area target lists plus
 *  the merge map (non-canonical coverage key → canonical kind+identity, chain-
 *  resolved) so the generate tail can rewrite cross-references onto canonicals. */
export interface ReconcileResult {
  byArea: AreaTargets[];
  merges: Record<string, { kind: string; identity: string }>;
}

/**
 * Reconcile the enumerated targets globally. Returns per-area target lists where
 * each unique artifact appears exactly once (assigned to the lexicographically
 * smallest area that enumerated it — a deterministic origin), with canonical
 * identities, plus the merge map that produced them.
 */
export async function reconcileTargets(
  scope: string,
  byArea: AreaTargets[],
  opts: TargetReconcilerOptions = {},
): Promise<ReconcileResult> {
  // Flatten. For each coverage key remember the LEXICOGRAPHICALLY SMALLEST area id
  // that enumerated it — a deterministic origin, so a shared target's home area
  // (and therefore its generated `origin` line) can't flip when the corpus
  // re-groups and area order changes.
  const originArea = new Map<string, string>(); // coverageKey → min areaId
  const distinct = new Map<string, TargetSpec>(); // coverageKey → target (first seen)
  for (const { area, targets } of byArea) {
    for (const t of targets) {
      const k = coverageKey(t.kind, t.identity);
      if (!distinct.has(k)) distinct.set(k, t);
      const cur = originArea.get(k);
      if (cur === undefined || area.areaId < cur) originArea.set(k, area.areaId);
    }
  }

  // (b) Semantic reconciliation — map duplicate identities onto a canonical one.
  // Two layers, DETERMINISTIC first:
  //   1–3. Per-cluster deterministic rules (incumbent-wins, token-set equal,
  //        singleton-kind subset) collapse near-duplicates with NO LLM and NO
  //        cache — a pure function of the cluster's identities plus the prior
  //        artifacts, so a reviewed identity can't flip run-to-run just because
  //        the model re-judged it.
  //   4.   Whatever a cluster can't resolve deterministically (≥2 members left)
  //        goes to the LLM, cached on EXACTLY the members it saw.
  // SCOPED + CACHED PER CLUSTER: only same-kind targets that share a token are
  // candidates to merge, so we form small deterministic clusters and reconcile
  // each on its own, cached by that cluster's own members. Editing one doc only
  // busts the cluster(s) its targets join — every other cluster is a cache hit,
  // so unchanged targets keep their canonical identity and unchanged areas keep
  // hitting the extract cache. (The old single global call re-clustered the whole
  // corpus on any edit, which is what churned unrelated areas.)
  const merges: Record<string, { kind: string; identity: string }> = {};
  if (opts.enabled !== false && distinct.size >= 2) {
    const prior = buildPriorSet(opts.priorTargets);
    const runner =
      opts.runner ?? spawnReconcileRunner({ transport: opts.transport, model: opts.model, fallbackModel: opts.fallbackModel });
    for (const cluster of clusterCandidates(distinct)) {
      const { merges: deterministic, remaining } = resolveClusterDeterministically(cluster, prior);
      Object.assign(merges, deterministic);
      if (remaining.length < 2) continue; // fully resolved deterministically — no LLM, no cache
      const input: ReconcileRunnerInput = {
        targets: remaining.map((t) => ({ kind: t.kind, identity: t.identity, hint: t.hint })),
      };
      const key = computeCacheKey(input);
      const cached = await readCache(scope, key);
      if (cached) {
        Object.assign(merges, cached);
        continue;
      }
      try {
        const m = sanitize((await runner(input)).merges, distinct);
        await writeCache(scope, key, m);
        Object.assign(merges, m);
      } catch {
        // best-effort — a failed cluster just falls back to deterministic de-dup
      }
    }
  }

  // Chain-resolve (A→B, B→C ⇒ A→C) so every non-canonical maps in one hop to its
  // final canonical — the reassignment below and the reference rewrite both want
  // a one-hop map.
  const resolved = chainResolveMerges(merges);

  // Apply merges: rewrite each distinct target to its canonical identity, then
  // collapse again by the NEW coverage key (so `outbox-pattern` and
  // `transactional-outbox` both land on one canonical target in one area).
  const canonByArea = new Map<string, Map<string, TargetSpec>>(); // areaId → (coverageKey → target)
  for (const [k, t] of distinct) {
    const canon = resolved[k];
    const target: TargetSpec = canon ? { kind: canon.kind, identity: canon.identity, hint: t.hint } : t;
    const ck = coverageKey(target.kind, target.identity);
    const areaId = originArea.get(canon ? coverageKey(canon.kind, canon.identity) : k) ?? originArea.get(k)!;
    const m = canonByArea.get(areaId) ?? new Map<string, TargetSpec>();
    if (!m.has(ck)) m.set(ck, target);
    canonByArea.set(areaId, m);
  }

  // Rebuild per-area lists in the original area order.
  const rebuilt = byArea.map(({ area }) => ({ area, targets: [...(canonByArea.get(area.areaId)?.values() ?? [])] }));
  return { byArea: rebuilt, merges: resolved };
}

/**
 * Estimate support: how many LLM calls {@link reconcileTargets} would make for
 * these targets — the same flatten → cluster → deterministic-resolve pipeline,
 * checking each cluster's LLM-bound remainder against the same per-cluster cache.
 * `clusters` counts only the clusters that actually reach the LLM (≥2 members
 * survive the deterministic rules); `misses` is the exact cold-run call count.
 * No LLM, no cache writes.
 */
export async function planReconcileCalls(
  scope: string,
  byArea: AreaTargets[],
  priorTargets?: readonly { kind: string; identity: string }[],
): Promise<{ clusters: number; misses: number }> {
  const distinct = new Map<string, TargetSpec>();
  for (const { targets } of byArea) {
    for (const t of targets) {
      const k = coverageKey(t.kind, t.identity);
      if (!distinct.has(k)) distinct.set(k, t);
    }
  }
  if (distinct.size < 2) return { clusters: 0, misses: 0 };
  const prior = buildPriorSet(priorTargets);
  let clusters = 0;
  let misses = 0;
  for (const cluster of clusterCandidates(distinct)) {
    const { remaining } = resolveClusterDeterministically(cluster, prior);
    if (remaining.length < 2) continue; // resolved deterministically — no LLM call
    clusters++;
    const input: ReconcileRunnerInput = {
      targets: remaining.map((t) => ({ kind: t.kind, identity: t.identity, hint: t.hint })),
    };
    if ((await readCache(scope, computeCacheKey(input))) === null) misses++;
  }
  return { clusters, misses };
}

/**
 * Group distinct targets into deterministic candidate clusters for the semantic
 * merge: same KIND, connected (transitively) by a shared significant token
 * (>=3 chars). Only clusters with >=2 members are returned — a lone target has
 * nothing to merge, so it never reaches the LLM. A cluster's membership is a pure
 * function of its own targets' identities, so an unrelated edit can't reshape it.
 */
function clusterCandidates(distinct: Map<string, TargetSpec>): TargetSpec[][] {
  const byKind = new Map<string, TargetSpec[]>();
  for (const t of distinct.values()) {
    const k = t.kind.trim().toLowerCase();
    const bucket = byKind.get(k);
    if (bucket) bucket.push(t);
    else byKind.set(k, [t]);
  }

  const significantTokens = (t: TargetSpec): Set<string> =>
    new Set(slugIdentity(t.identity).split(/[.-]+/).filter((tok) => tok.length >= 3));

  const clusters: TargetSpec[][] = [];
  for (const targets of byKind.values()) {
    if (targets.length < 2) continue;
    // Union-find over "shares a significant token".
    const parent = targets.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const toks = targets.map(significantTokens);
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        let shared = false;
        for (const tok of toks[i]) {
          if (toks[j].has(tok)) {
            shared = true;
            break;
          }
        }
        if (shared) parent[find(i)] = find(j);
      }
    }
    const groups = new Map<number, TargetSpec[]>();
    for (let i = 0; i < targets.length; i++) {
      const r = find(i);
      const g = groups.get(r);
      if (g) g.push(targets[i]);
      else groups.set(r, [targets[i]]);
    }
    for (const g of groups.values()) if (g.length >= 2) clusters.push(g);
  }

  // Stable order — doesn't affect correctness, keeps the pass reproducible.
  clusters.sort((a, b) =>
    coverageKey(a[0].kind, a[0].identity).localeCompare(coverageKey(b[0].kind, b[0].identity)),
  );
  return clusters;
}

/** Keep only safe merges: canonical must itself be one of the input targets; drop self-merges. */
function sanitize(
  merges: Record<string, { kind: string; identity: string }> | undefined,
  distinct: Map<string, TargetSpec>,
): Record<string, { kind: string; identity: string }> {
  const out: Record<string, { kind: string; identity: string }> = {};
  for (const [fromRaw, to] of Object.entries(merges ?? {})) {
    if (!to || typeof to.kind !== 'string' || typeof to.identity !== 'string') continue;
    // The LLM emits keys as "<Kind>:<identity>" (PascalCase kind); normalize both
    // sides through coverageKey so they match `distinct` (keyed by coverage key).
    const colon = fromRaw.indexOf(':');
    if (colon === -1) continue;
    const fromKey = coverageKey(fromRaw.slice(0, colon), fromRaw.slice(colon + 1));
    const toKey = coverageKey(to.kind, to.identity);
    const canon = distinct.get(toKey);
    if (!distinct.has(fromKey) || !canon) continue; // both sides must be real targets
    if (fromKey === toKey) continue; // identity merge
    // Store the real canonical target's spelling (not the LLM's echo) so downstream
    // reassignment + reference rewriting use the exact enumerated identity.
    out[fromKey] = { kind: canon.kind, identity: canon.identity };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic per-cluster reconciliation (rules 1–3, run before the LLM)
// ---------------------------------------------------------------------------

/**
 * The conceptually-singleton cross-cutting concerns: a repo has essentially ONE
 * of each, so collapsing near-duplicate spellings (a subset/superset relation,
 * or absorbing a lone-incumbent cluster) is safe. Distinct Entities / Operations
 * / decisions that merely share a token are NOT duplicates (§4.6), so the subset
 * and lone-incumbent rules deliberately do NOT apply to them — only the exact
 * token-multiset rule does, which can't conflate `POST` and `GET` of one path.
 */
const SINGLETON_KINDS: ReadonlySet<string> = new Set([
  'authrequirement',
  'errorenvelope',
  'paginationcontract',
  'idempotencycontract',
]);

function isSingletonKind(kind: string): boolean {
  return SINGLETON_KINDS.has(kind.trim().toLowerCase());
}

/** Prior artifact identities → a coverage-key set for fast incumbency checks. */
function buildPriorSet(priorTargets?: readonly { kind: string; identity: string }[]): ReadonlySet<string> {
  const set = new Set<string>();
  for (const t of priorTargets ?? []) set.add(coverageKey(t.kind, t.identity));
  return set;
}

/** Significant identity tokens (full set — no length filter, unlike clustering:
 *  a 2-char token like `v2` distinguishes `api.v2` from `api.v3`, so it must count). */
function identityTokens(identity: string): string[] {
  return slugIdentity(identity).split(/[.-]+/).filter(Boolean);
}

/** Order-insensitive token multiset key (rule 2). */
function tokenMultisetKey(identity: string): string {
  return identityTokens(identity).slice().sort().join('\x00');
}

/** Strict subset test over token SETS (rule 3). */
function isStrictTokenSubset(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size >= b.size) return false;
  for (const tok of a) if (!b.has(tok)) return false;
  return true;
}

/**
 * Deterministic reconciliation of one candidate cluster (all same kind), run
 * BEFORE any LLM call. Returns the merges it can prove plus the members it can't
 * resolve (which the caller sends to the LLM). Rules, in order:
 *
 *   1. Incumbent-wins — for a SINGLETON kind, a cluster with exactly one prior
 *      artifact (incumbent) collapses entirely onto that incumbent: the reviewed
 *      spelling is locked. (Not applied to Entity/Operation/… — a lone incumbent
 *      there would swallow genuinely-distinct siblings sharing a path token.)
 *   2. Token-set dedupe (all kinds) — identical token multiset ⇒ the same
 *      artifact reordered/re-punctuated (`error.envelope.standard` ↔
 *      `standard-error-envelope`).
 *   3. Singleton-kind subset — one token set ⊂ the other ⇒ the more specific
 *      superset is the same concern (`bearer-api` ⊂ `auth.bearer.api`).
 *
 * Canonical per merge group: prefer an incumbent; then the most specific (most
 * tokens — the superset of rule 3); tie-break lexicographically (rule 2). When
 * both spellings are incumbents (the observed flip case) this is still fully
 * deterministic, which is the whole point.
 */
function resolveClusterDeterministically(
  cluster: TargetSpec[],
  prior: ReadonlySet<string>,
): { merges: Record<string, { kind: string; identity: string }>; remaining: TargetSpec[] } {
  const singleton = isSingletonKind(cluster[0].kind);
  const keys = cluster.map((t) => coverageKey(t.kind, t.identity));
  const incumbent = keys.map((k) => prior.has(k));
  const sets = cluster.map((t) => new Set(identityTokens(t.identity)));
  const multis = cluster.map((t) => tokenMultisetKey(t.identity));

  const parent = cluster.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < cluster.length; i++) {
    for (let j = i + 1; j < cluster.length; j++) {
      if (multis[i] === multis[j]) union(i, j); // rule 2 (all kinds)
      else if (singleton && (isStrictTokenSubset(sets[i], sets[j]) || isStrictTokenSubset(sets[j], sets[i]))) union(i, j); // rule 3
    }
  }
  // Rule 1: a singleton-kind cluster with a single incumbent collapses onto it.
  if (singleton && incumbent.filter(Boolean).length === 1) {
    const inc = incumbent.indexOf(true);
    for (let i = 0; i < cluster.length; i++) if (i !== inc) union(i, inc);
  }

  const components = new Map<number, number[]>();
  for (let i = 0; i < cluster.length; i++) {
    const root = find(i);
    const members = components.get(root);
    if (members) members.push(i);
    else components.set(root, [i]);
  }

  const merges: Record<string, { kind: string; identity: string }> = {};
  const remaining: TargetSpec[] = [];
  for (const members of components.values()) {
    if (members.length < 2) {
      remaining.push(cluster[members[0]]);
      continue;
    }
    const incumbents = members.filter((i) => incumbent[i]);
    const candidates = incumbents.length > 0 ? incumbents : members;
    const canonical = candidates.slice().sort((a, b) => {
      if (sets[a].size !== sets[b].size) return sets[b].size - sets[a].size; // most specific first
      return cluster[a].identity.localeCompare(cluster[b].identity); // then lexicographically smallest
    })[0];
    for (const i of members) {
      if (i === canonical) continue;
      merges[keys[i]] = { kind: cluster[canonical].kind, identity: cluster[canonical].identity };
    }
  }
  return { merges, remaining };
}

/** Follow value→key edges to a fixpoint so a merged non-canonical maps straight
 *  to its final canonical (cycle-guarded — a cycle stops at the first repeat). */
function chainResolveMerges(
  merges: Record<string, { kind: string; identity: string }>,
): Record<string, { kind: string; identity: string }> {
  const out: Record<string, { kind: string; identity: string }> = {};
  for (const [from, to0] of Object.entries(merges)) {
    let to = to0;
    const seen = new Set<string>([from]);
    let key = coverageKey(to.kind, to.identity);
    while (merges[key] && !seen.has(key)) {
      seen.add(key);
      to = merges[key];
      key = coverageKey(to.kind, to.identity);
    }
    out[from] = to;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cross-reference rewrite (typed `.tc` reference tokens → canonical identity)
// ---------------------------------------------------------------------------

/** identCont chars per the `.tc` grammar: letter | digit | `_` | `$` | `-` | `.`. */
const IDENT_CONT = /[A-Za-z0-9_$.\-]/;
/** A bare identity that needs no quoting as a reference tail. */
const BARE_IDENTITY = /^[A-Za-z_$][A-Za-z0-9_$.\-]*$/;

interface RefMatch {
  kind: string;
  identity: string;
  quoted: boolean;
  end: number;
}

/** Match a single `.tc` reference token — `Kind:ident` or `Kind:"identity"` — at
 *  `start`, per the grammar `reference = upper identCont* ":" (refQuoted | ident)`. */
function matchReferenceAt(src: string, start: number): RefMatch | null {
  if (!/[A-Z]/.test(src[start])) return null;
  let i = start + 1;
  while (i < src.length && IDENT_CONT.test(src[i])) i++;
  const kind = src.slice(start, i);
  if (src[i] !== ':') return null;
  i++;
  if (src[i] === '"') {
    const close = src.indexOf('"', i + 1);
    if (close === -1) return null;
    return { kind, identity: src.slice(i + 1, close), quoted: true, end: close + 1 };
  }
  if (i >= src.length || !/[A-Za-z_$]/.test(src[i])) return null;
  const idStart = i;
  i++;
  while (i < src.length && IDENT_CONT.test(src[i])) i++;
  return { kind, identity: src.slice(idStart, i), quoted: false, end: i };
}

function formatReference(kind: string, identity: string, wasQuoted: boolean): string {
  const quote = wasQuoted || !BARE_IDENTITY.test(identity);
  return quote ? `${kind}:"${identity}"` : `${kind}:${identity}`;
}

/**
 * Rewrite every typed cross-reference in a `.tc` body whose (kind, identity)
 * matches a merged non-canonical → its canonical spelling. `merges` is the
 * chain-resolved map from {@link reconcileTargets} (coverage key → canonical).
 *
 * Only whole reference TOKENS are touched — matched at a token boundary and
 * compared by coverage key, so a partial identity (`Entity:Order` inside
 * `Entity:Order.total`) and any occurrence inside a string literal or comment
 * are left verbatim. Quoting is preserved (operations keep their quotes) and
 * forced only when a canonical identity isn't a bare ident.
 */
export function rewriteReferencesToCanonical(
  tcSource: string,
  merges: Record<string, { kind: string; identity: string }>,
): string {
  if (Object.keys(merges).length === 0) return tcSource;
  const n = tcSource.length;
  let out = '';
  let i = 0;
  while (i < n) {
    const c = tcSource[i];
    // Comments are free text — copy through untouched.
    if (c === '/' && tcSource[i + 1] === '/') {
      const nl = tcSource.indexOf('\n', i);
      const end = nl === -1 ? n : nl;
      out += tcSource.slice(i, end);
      i = end;
      continue;
    }
    if (c === '/' && tcSource[i + 1] === '*') {
      const close = tcSource.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      out += tcSource.slice(i, end);
      i = end;
      continue;
    }
    // A reference starts on an uppercase letter at a token boundary. Consume the
    // whole token (including a quoted identity) so a quoted ref's `"` is never
    // seen as a standalone string below.
    if (/[A-Z]/.test(c) && (i === 0 || !IDENT_CONT.test(tcSource[i - 1]))) {
      const m = matchReferenceAt(tcSource, i);
      if (m) {
        const canon = merges[coverageKey(m.kind, m.identity)];
        out += canon ? formatReference(canon.kind, canon.identity, m.quoted) : tcSource.slice(i, m.end);
        i = m.end;
        continue;
      }
    }
    // A standalone string literal is free text — skip its contents verbatim.
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (tcSource[j] === '\\') {
          j += 2;
          continue;
        }
        if (tcSource[j] === '"') {
          j++;
          break;
        }
        j++;
      }
      out += tcSource.slice(i, j);
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dangling-reference snapping (deterministic ref → declared-identity resolution)
// ---------------------------------------------------------------------------

/** One deterministic snap: a dangling cross-reference rewritten onto a declared
 *  identity of the SAME kind, plus which ladder rung matched (for provenance). */
export interface ReferenceSnap {
  /** The reference as the LLM wrote it (dangling). */
  from: { kind: string; identity: string };
  /** The declared identity it was snapped onto. */
  to: { kind: string; identity: string };
  via: 'canonical-fold' | 'token-set' | 'unique-token';
}

interface DeclaredIdentity {
  identity: string;
  ck: string;
  multiset: string;
  tokens: Set<string>;
}

/**
 * Minimal singular/plural fold for ONE identity token — the identity-token analog
 * of spec-consolidator's trailing-`s` alias fold (`corpus-types.applyAlias`),
 * kept local because identities aren't the tagger's product/concern vocabulary.
 * Normalizes a token to a comparison form so `customers` matches `customer` and
 * `categories` matches `category`. Deliberately conservative — it never touches
 * `class`/`ss` words or tokens too short to safely singularize.
 */
function foldToken(tok: string): string {
  if (tok.length > 3 && tok.endsWith('ies')) return `${tok.slice(0, -3)}y`;
  if (tok.length > 3 && tok.endsWith('s') && !tok.endsWith('ss')) return tok.slice(0, -1);
  return tok;
}

/** Order-insensitive folded token-multiset key (rung b). */
function foldedMultisetKey(identity: string): string {
  return identityTokens(identity).map(foldToken).sort().join(' ');
}

/** Folded meaningful tokens (≥3 chars, like the clustering token filter) — rung c. */
function foldedMeaningfulTokens(identity: string): Set<string> {
  return new Set(identityTokens(identity).map(foldToken).filter((t) => t.length >= 3));
}

function sharesToken(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const t of a) if (b.has(t)) return true;
  return false;
}

/**
 * The resolution ladder for one dangling reference against the declared identities
 * of its kind. Each rung requires a UNIQUE declared candidate; ambiguity (or a
 * looser-but-non-unique match) stops the ladder — a wrong snap is worse than a
 * tolerated soft dangling ref. Rungs, most-precise first:
 *
 *   a. coverage-key equality — folds the benign drift the resolver's exact match
 *      misses (HTTP method case, trailing slash, `:id`↔`{id}`, whitespace).
 *   b. folded token-multiset equality — the same identity reordered/re-punctuated
 *      (`order-line` ↔ `line.order`), plural-folded.
 *   c. unique meaningful-token overlap (plural-folded) — the conservative rung that
 *      catches the observed `core.customers` → `Customer` case, snapping only when
 *      exactly one declared identity of the kind shares a meaningful token.
 */
function snapCandidate(
  ref: ArtifactRef,
  declared: readonly DeclaredIdentity[],
): { to: DeclaredIdentity; via: ReferenceSnap['via'] } | null {
  const byCk = declared.filter((d) => d.ck === coverageKey(ref.type, ref.identity));
  if (byCk.length === 1) return { to: byCk[0], via: 'canonical-fold' };
  if (byCk.length > 1) return null;

  const refMulti = foldedMultisetKey(ref.identity);
  const byMulti = declared.filter((d) => d.multiset === refMulti);
  if (byMulti.length === 1) return { to: byMulti[0], via: 'token-set' };
  if (byMulti.length > 1) return null;

  const refTokens = foldedMeaningfulTokens(ref.identity);
  if (refTokens.size === 0) return null;
  const overlapping = declared.filter((d) => sharesToken(refTokens, d.tokens));
  return overlapping.length === 1 ? { to: overlapping[0], via: 'unique-token' } : null;
}

/**
 * Snap dangling cross-references onto the corpus's DECLARED identities,
 * deterministically. The extract LLM sometimes writes a reference from whole
 * cloth — a regenerated `Order` emitting `references Entity:core.customers` while
 * the customer entity is declared `entity Customer`. Reconcile's rewrite only
 * covers references to MERGED enumerated targets, so an invented dangling ref
 * used to sail through as a tolerated soft "unresolved reference" and never got
 * checked at verify. This closes that hole before repair: the resolver is the
 * single source of truth for both the declared index and the unresolved refs, and
 * every snap goes through the same token-accurate rewriter {@link
 * rewriteReferencesToCanonical} uses, so quoting and token boundaries are honored.
 *
 * Guards (references left verbatim, never snapped): a ref to a kind with no
 * lifter (`Unknown`, e.g. a `PerformanceSLA` forward ref) and a ref to a kind with
 * no declared artifacts at all — both are legitimate forward refs to as-yet-
 * unmodelled artifacts. What can't be snapped stays dangling for repair / the
 * soft-issue tolerance. Mutates each artifact's winning body in place; returns the
 * snaps for provenance.
 */
export function snapReferencesToDeclared(artifacts: MergedArtifact[]): ReferenceSnap[] {
  const fileNodes: ReturnType<typeof parserOhm.parseTcFile>[] = [];
  for (const a of artifacts) {
    try {
      fileNodes.push(parserOhm.parseTcFile(`<llm:${a.kind}:${a.identity}>`, a.winning.tcSource));
    } catch {
      // Unparseable artifacts contribute no refs; validate/repair handle them.
    }
  }
  const resolution = resolver.resolve(fileNodes);
  if (resolution.unresolvedRefs.length === 0) return [];

  const declaredByKind = new Map<string, DeclaredIdentity[]>();
  for (const art of resolution.index.values()) {
    const kind = art.ref.type;
    const bucket = declaredByKind.get(kind) ?? [];
    bucket.push({
      identity: art.ref.identity,
      ck: coverageKey(kind, art.ref.identity),
      multiset: foldedMultisetKey(art.ref.identity),
      tokens: foldedMeaningfulTokens(art.ref.identity),
    });
    declaredByKind.set(kind, bucket);
  }

  const snapMap: Record<string, { kind: string; identity: string }> = {};
  const snaps: ReferenceSnap[] = [];
  const seen = new Set<string>();
  for (const { ref } of resolution.unresolvedRefs) {
    if (ref.type === 'Unknown') continue; // forward ref to an unmodelled kind
    const declared = declaredByKind.get(ref.type);
    if (!declared || declared.length === 0) continue; // kind not declared at all
    const refCk = coverageKey(ref.type, ref.identity);
    if (seen.has(refCk)) continue;
    seen.add(refCk);
    const match = snapCandidate(ref, declared);
    if (!match) continue;
    snapMap[refCk] = { kind: ref.type, identity: match.to.identity };
    snaps.push({
      from: { kind: ref.type, identity: ref.identity },
      to: { kind: ref.type, identity: match.to.identity },
      via: match.via,
    });
  }

  if (snaps.length === 0) return [];
  for (const a of artifacts) {
    const rewritten = rewriteReferencesToCanonical(a.winning.tcSource, snapMap);
    if (rewritten !== a.winning.tcSource) a.winning = { ...a.winning, tcSource: rewritten };
  }
  return snaps;
}

// ---------------------------------------------------------------------------
// Prompt + subprocess runner
// ---------------------------------------------------------------------------

export const RECONCILE_SYSTEM_PROMPT = `You are given the list of contract TARGETS enumerated from ONE repository's docs (kind + identity). Some are DUPLICATES — the SAME artifact named differently because different docs/sections described it. Your job: find duplicate clusters and pick ONE canonical (kind, identity) per cluster.

Duplicates are the same KIND describing the same thing, e.g.:
  - ArchitectureDecision: "outbox-pattern" / "transactional-outbox" / "transactional-outbox-event-delivery" → one decision.
  - AuthRequirement: "bearer-jwt" / "customer-bearer-jwt" / "booking-bearer-jwt" → one requirement.
  - NamedConstant: "max-reschedule-count" / "reschedule-max-count-3" → one constant.

NOT duplicates (never merge):
  - Different kinds.
  - Distinct Operations (different method+path), distinct Entities/Enums by name.
  - Two genuinely different decisions/requirements that merely sound similar.

Cross-cutting kinds (ArchitectureDecision, AuthRequirement, AuthorizationRule, EffectGroup, ErrorEnvelope, NamedConstant, PaginationContract, IdempotencyContract, FieldExposure, Fallback, ValidationRule) duplicate most often across docs — scrutinize those. When unsure, DO NOT merge.

Output ONLY a JSON object mapping each NON-canonical "<kind>:<identity>" to its canonical {kind, identity}. The canonical MUST be one of the input targets. Omit canonical entries (a target that is its own canonical).

{ "merges": {
    "ArchitectureDecision:outbox-pattern": { "kind": "ArchitectureDecision", "identity": "transactional-outbox" },
    "AuthRequirement:customer-bearer-jwt": { "kind": "AuthRequirement", "identity": "bearer-jwt" }
} }

Use an empty "merges" object when nothing is a duplicate.`;

export function buildReconcileUserPrompt(input: ReconcileRunnerInput): string {
  const list = input.targets.map((t) => `  - ${t.kind}: ${t.identity}${t.hint ? ` — ${t.hint}` : ''}`).join('\n');
  return ['Targets enumerated from this repository:', '', list, '', 'Return the merges JSON as specified.'].join('\n');
}

const ReconcileResultSchema = z.object({
  merges: z.record(z.string(), z.object({ kind: z.string(), identity: z.string() })).default({}),
});

/** The response schema sent on the request — the API transport enforces it via
 *  structured output; the cli transport ignores it. */
const RECONCILE_RESPONSE_SCHEMA = jsonSchemaHint(ReconcileResultSchema);

function spawnReconcileRunner(
  opts: { transport?: LlmTransport; bin?: string; timeoutMs?: number; model?: string; fallbackModel?: string } = {},
): ReconcileRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  // One clustering call over the whole target list — give it room. Output scales
  // with the target count (one entry per duplicate), so a large corpus (~100
  // targets) needs well past the 300s that sufficed for ~50. A timeout degrades
  // safely to deterministic-only de-dup, but we'd rather get the semantic merge.
  const timeoutMs = opts.timeoutMs ?? 600_000;
  return async (input) => {
    const raw = await transport({
      id: 'contract.reconcile',
      stage: 'contract.reconcile',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: RECONCILE_SYSTEM_PROMPT,
      user: buildReconcileUserPrompt(input),
      responseFormat: 'json',
      schema: RECONCILE_RESPONSE_SCHEMA,
      // `merges` is a record (loser identity → winner), which strict structured
      // output can't express — the schema stays a prompt hint, Zod validates.
      enforceSchema: false,
      timeoutMs,
    });
    return ReconcileResultSchema.parse(JSON.parse(stripCodeFences(raw)));
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_NAME = 'contract/reconcile';
const PROMPT_FINGERPRINT = createHash('sha256').update(RECONCILE_SYSTEM_PROMPT).digest('hex').slice(0, 16);

function computeCacheKey(input: ReconcileRunnerInput): string {
  const material = input.targets.map((t) => coverageKey(t.kind, t.identity)).sort().join(',');
  return createHash('sha256').update(`${PROMPT_FINGERPRINT}::${material}`).digest('hex');
}

async function readCache(scope: string, key: string): Promise<Record<string, { kind: string; identity: string }> | null> {
  const raw = await getCacheEntry(scope, CACHE_NAME, key);
  if (raw === null) return null;
  const parsed = ReconcileResultSchema.safeParse(raw);
  return parsed.success ? parsed.data.merges : null;
}

async function writeCache(scope: string, key: string, merges: Record<string, { kind: string; identity: string }>): Promise<void> {
  await setCacheEntry(scope, CACHE_NAME, key, { merges });
}
