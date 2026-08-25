/**
 * COLLISION PAIRING — the deterministic candidate net the overlap sessions
 * check (SPEC_GUARD_PLAN item 119). It replaces the LLM's own retrieval (an
 * area tour over heading outlines, whose recall collapsed as areas grew — the
 * 2026-08-21 documenso field run reached ~25% of a 62-doc area's docs) with
 * pure string work: a disagreement definitionally requires both docs to NAME
 * the same concrete thing, and those names are surface-extractable.
 *
 * Two pair sources, both rarity-weighted against the whole kept corpus:
 *
 * - CLAIM TOKENS — code-shaped identifiers in a section's text: route path
 *   segments (`/envelope/distribute`), UPPER_SNAKE enum/env members
 *   (`LIMIT_EXCEEDED`, `VIEWER`), camel/snake identifiers (`positionX`,
 *   `signing_order`), hyphenated header names (`Retry-After`). Two sections in
 *   DIFFERENT docs sharing a rare claim token are a candidate collision.
 * - HEADINGS — two sections whose headings canonicalize to the same concern
 *   key (`Authentication` and `Auth` both fold to `auth` via
 *   {@link canonicalizeConcern}), the generalization of the retired
 *   `widenedOverlapDocs` heading net from doc level to section level.
 *
 * Rarity does the precision work: a key is idf-weighted (`log2((S+1)/df)` over
 * all S sections), pairs are generated only from keys below a df cap (a token in
 * half the corpus is vocabulary, not a collision signal), and a pair must
 * clear a small score floor. The output is a ranked candidate list the overlap
 * session verifies — spend proportional to real collisions, never corpus size
 * — and a pair nobody checks is recorded in the corpus (`uncheckedPairs`), so
 * a recall gap is data, not an inference from doc lists.
 */

import { createHash } from 'node:crypto';
import { parseHeadings } from '@truecourse/shared';
import { docBody, type DocCandidate } from './discovery.js';
import { canonicalizeConcern, type VocabMap } from './corpus-types.js';

// ---------------------------------------------------------------------------
// Constants — principled, documented, never tuned to a repo
// ---------------------------------------------------------------------------

/**
 * A key generates pairs only while it appears in at most this many sections.
 * Beyond it the key is corpus vocabulary (documenso's `envelope` lives in ~80
 * sections) and pairing on it would recreate the O(n²) matrix this net
 * replaces. 24 keeps worst-case generation per key at C(24,2) = 276 pairs
 * while comfortably passing real collision signals (a disputed endpoint's
 * segment lives in ~a dozen sections).
 */
const PAIR_GEN_DF_CAP = 24;

/**
 * Minimum summed key weight for a pair to survive. On the `log2((S+1)/df)`
 * scale a key in half the sections weighs ~1, so the floor demands at least
 * one key more distinctive than that (or two middling ones) — it exists to
 * drop degenerate pairs whose only shared vocabulary is generic to the corpus,
 * not to rank (the score does that). The `+1` keeps tiny corpora pairable: in
 * a two-doc repo a shared identifier IS the signal even though its df equals
 * S, and `log2(S/df)` would zero it out.
 */
const MIN_PAIR_SCORE = 1;

/** Claim tokens shorter than this are noise (`v2`, `id`, `db`). */
const MIN_TOKEN_CHARS = 3;

/**
 * Hard ceiling on section pairs kept per unordered DOC pair. Selection within
 * a doc pair is NOVELTY-gated (see the derivation): after its best pair, a
 * section pair is kept only when it evidences at least one shared key no kept
 * pair of the same two docs already covers. Two docs with big shared code
 * examples otherwise wall the list (the documenso field corpus had one doc
 * pair with 127 section pairs — the same two workflow examples over and over)
 * while a low-scoring pair carrying a UNIQUE signal — the disputed
 * `/envelope/distribute` route beneath two 50-point example walls — is
 * exactly the one that must survive. The ceiling is the backstop on
 * pathological key diversity; the novelty gate is the rule.
 */
const SECTION_PAIRS_PER_DOC_PAIR = 6;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** One side of a candidate pair: a doc section, addressed the way
 *  `read_section` addresses it (`heading: null` = the doc's lead). */
export interface CollisionSectionRef {
  doc: string;
  heading: string | null;
}

/** A candidate collision: two sections in different docs sharing rare keys. */
export interface CollisionPair {
  a: CollisionSectionRef;
  b: CollisionSectionRef;
  /** The shared signals, display form (`distribute`, `heading:auth`), sorted. */
  keys: string[];
  /** Summed idf weight of the shared keys — the ranking score. */
  score: number;
}

// ---------------------------------------------------------------------------
// Claim-token extraction
// ---------------------------------------------------------------------------

/**
 * Code-shaped identifiers in a section's text, lowercased for matching. Four
 * shapes, chosen because a doc stating a concrete decision names it in one of
 * them; plain prose words are deliberately NOT extracted (headings cover the
 * same-topic-in-prose case).
 *
 * Markdown LINK TARGETS and bare URLs are stripped first: a link names a
 * place, not a claim, and nav sections ("See Also", "Next Steps") would
 * otherwise pair every doc that links to the same page — the documenso field
 * corpus's whole 'eidas'/'getting-started' noise band was link paths.
 */
export function extractClaimTokens(text: string): Set<string> {
  text = text
    .replace(/\]\([^)]*\)/g, '](')
    .replace(/https?:\/\/[^\s)>"']+/g, ' ');
  const out = new Set<string>();
  const add = (raw: string): void => {
    const token = raw.toLowerCase();
    if (token.length < MIN_TOKEN_CHARS) return;
    if (/^\d+$/.test(token)) return;
    out.add(token);
  };
  // Route paths — every alphanumeric segment (`/envelope/{id}/distribute` →
  // `envelope`, `distribute`; placeholder segments carry no name and drop out).
  for (const m of text.matchAll(/(?:^|[\s"'`(=[])(\/[A-Za-z0-9_{}:$*.-]+(?:\/[A-Za-z0-9_{}:$*.-]+)+)/g)) {
    for (const seg of m[1].split('/')) {
      if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(seg)) add(seg);
    }
  }
  // UPPER_SNAKE members and standalone ALL-CAPS words (`LIMIT_EXCEEDED`,
  // `VIEWER`) — enum members, env vars, statuses.
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\b[A-Z]{4,}\b/g)) add(m[0]);
  // camelCase and snake_case identifiers (`positionX`, `signing_order`).
  for (const m of text.matchAll(/\b[a-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+\b|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)) {
    add(m[0]);
  }
  // Hyphenated capitalized names (`Retry-After`, `X-RateLimit-Limit`).
  for (const m of text.matchAll(/\b[A-Z][A-Za-z0-9]*(?:-[A-Z][A-Za-z0-9]*)+\b/g)) add(m[0]);
  return out;
}

// ---------------------------------------------------------------------------
// Pair derivation
// ---------------------------------------------------------------------------

interface IndexedSection {
  doc: string;
  heading: string | null;
  /** Every pairing key this section carries (`t:` claim tokens, `h:` heading). */
  keys: Set<string>;
}

/**
 * A doc's sections for pairing: the lead (content above the first real
 * heading, when any) as `heading: null`, then one section per heading — its
 * line down to the next heading of any level. Every heading here is one
 * `read_section` resolves, because both ride {@link parseHeadings}.
 */
function splitFenceAwareSections(body: string): Array<{ heading: string | null; text: string }> {
  const lines = body.split(/\r?\n/);
  const headings = parseHeadings(lines);
  const out: Array<{ heading: string | null; text: string }> = [];
  const leadEnd = headings.length > 0 ? headings[0].line : lines.length;
  const lead = lines.slice(0, leadEnd).join('\n');
  if (lead.trim()) out.push({ heading: null, text: lead });
  for (let i = 0; i < headings.length; i++) {
    const end = i + 1 < headings.length ? headings[i + 1].line : lines.length;
    out.push({ heading: headings[i].text, text: lines.slice(headings[i].line, end).join('\n') });
  }
  return out;
}

const sideKey = (s: CollisionSectionRef): string => `${s.doc}\u0000${s.heading ?? '\u0001lead'}`;
const pairIdentity = (a: CollisionSectionRef, b: CollisionSectionRef): string =>
  [sideKey(a), sideKey(b)].sort().join('\u0002');

/**
 * Derive the ranked candidate collisions across the whole kept doc set. Pure
 * and deterministic: same docs (and vocab) in, same pairs out — order is
 * score-descending, ties broken by pair identity. Pairs are strictly
 * CROSS-DOC; a doc that shares no rare key (and no canonical heading) with any
 * other doc appears in no pair and costs no session.
 */
export function deriveCollisionPairs(docs: readonly DocCandidate[], vocab?: VocabMap): CollisionPair[] {
  // Split every doc once; keep sections in doc order for determinism. The
  // split rides the shared fence-aware heading scanner (`parseHeadings`) — the
  // same one the session's briefing outlines and `read_section` use — so every
  // pair side is a heading the session can actually open (a `#` comment inside
  // a code fence never becomes a phantom section).
  const sections: IndexedSection[] = [];
  for (const doc of docs) {
    for (const s of splitFenceAwareSections(docBody(doc))) {
      const keys = new Set<string>();
      for (const t of extractClaimTokens(s.text)) keys.add(`t:${t}`);
      if (s.heading !== null) {
        const canon = canonicalizeConcern(s.heading, vocab);
        if (canon) keys.add(`h:${canon}`);
      }
      sections.push({ doc: doc.path, heading: s.heading, keys });
    }
  }
  const S = sections.length;
  if (S < 2) return [];

  // df per key, and the sections carrying it (in insertion order).
  const byKey = new Map<string, IndexedSection[]>();
  for (const s of sections) {
    for (const k of s.keys) {
      const list = byKey.get(k) ?? [];
      list.push(s);
      byKey.set(k, list);
    }
  }
  const weight = (k: string): number => Math.log2((S + 1) / byKey.get(k)!.length);

  // Generate from rare keys spanning ≥ 2 docs; accumulate per section pair,
  // keeping RAW keys so the selection below can re-weigh them.
  interface RawPair {
    a: CollisionSectionRef;
    b: CollisionSectionRef;
    rawKeys: Set<string>;
    score: number;
    id: string;
  }
  const pairs = new Map<string, RawPair>();
  for (const [key, carriers] of byKey) {
    if (carriers.length < 2 || carriers.length > PAIR_GEN_DF_CAP) continue;
    if (new Set(carriers.map((s) => s.doc)).size < 2) continue;
    const w = weight(key);
    for (let i = 0; i < carriers.length; i++) {
      for (let j = i + 1; j < carriers.length; j++) {
        const a = carriers[i];
        const b = carriers[j];
        if (a.doc === b.doc) continue;
        const id = pairIdentity(a, b);
        const existing = pairs.get(id);
        if (existing) {
          if (!existing.rawKeys.has(key)) {
            existing.rawKeys.add(key);
            existing.score += w;
          }
        } else {
          pairs.set(id, {
            a: { doc: a.doc, heading: a.heading },
            b: { doc: b.doc, heading: b.heading },
            rawKeys: new Set([key]),
            score: w,
            id,
          });
        }
      }
    }
  }

  // Per-doc-pair GREEDY MAX-COVERAGE selection: repeatedly keep the pair whose
  // UNCOVERED shared-key weight is largest, until that marginal gain falls
  // below the score floor (or the ceiling binds). This is what lets a modest
  // pair carrying a unique signal — the disputed `/envelope/distribute` route —
  // outlive its doc pair's 50-point example walls: after two walls the third
  // wall's keys are covered (marginal ~0) while the route token is not.
  const byDocPair = new Map<string, RawPair[]>();
  for (const p of pairs.values()) {
    if (p.score < MIN_PAIR_SCORE) continue;
    const docKey = [p.a.doc, p.b.doc].sort().join('\u0000');
    const list = byDocPair.get(docKey) ?? [];
    list.push(p);
    byDocPair.set(docKey, list);
  }
  const display = (k: string): string => (k.startsWith('t:') ? k.slice(2) : `heading:${k.slice(2)}`);
  const selected: CollisionPair[] = [];
  for (const list of byDocPair.values()) {
    const covered = new Set<string>();
    const taken = new Set<RawPair>();
    for (let n = 0; n < SECTION_PAIRS_PER_DOC_PAIR; n++) {
      let best: RawPair | null = null;
      let bestGain = 0;
      for (const p of list) {
        if (taken.has(p)) continue;
        let gain = 0;
        for (const k of p.rawKeys) if (!covered.has(k)) gain += weight(k);
        if (gain > bestGain + 1e-9 || (gain > bestGain - 1e-9 && best !== null && p.id < best.id)) {
          best = p;
          bestGain = gain;
        }
      }
      if (best === null || bestGain < MIN_PAIR_SCORE) break;
      taken.add(best);
      for (const k of best.rawKeys) covered.add(k);
      selected.push({
        a: best.a,
        b: best.b,
        keys: [...best.rawKeys].map(display).sort(),
        score: best.score,
      });
    }
  }
  selected.sort((x, y) => (y.score - x.score) || (pairIdentity(x.a, x.b) < pairIdentity(y.a, y.b) ? -1 : 1));
  return selected;
}

// ---------------------------------------------------------------------------
// Area assignment — each pair belongs to exactly ONE area
// ---------------------------------------------------------------------------

/**
 * The one area a pair is judged (and recorded) under. Deterministic: the
 * lexicographically-first area BOTH docs carry; when they share none (the old
 * widened-net shape — same subject filed under different concerns), the first
 * area either carries. `null` only when neither doc landed in any area — such
 * a pair has no home in the corpus and is dropped.
 */
export function assignPairArea(
  pair: CollisionPair,
  areasByDoc: ReadonlyMap<string, readonly string[]>,
): string | null {
  const a = areasByDoc.get(pair.a.doc) ?? [];
  const b = areasByDoc.get(pair.b.doc) ?? [];
  const bSet = new Set(b);
  const shared = a.filter((id) => bSet.has(id)).sort();
  if (shared.length > 0) return shared[0];
  const union = [...new Set([...a, ...b])].sort();
  return union[0] ?? null;
}

/**
 * Connected components of one area's pairs, over doc refs — each component is
 * one session's worth of work (SPEC_GUARD_PLAN item 119: shard by collision
 * cluster, never by area). Components are ordered by their best pair's rank in
 * `pairs` (which is score-ranked), so cluster 0 is the hottest; within a
 * component pairs keep their given order.
 */
export function clusterPairs(pairs: readonly CollisionPair[]): CollisionPair[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (cur !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (x: string, y: string): void => {
    if (!parent.has(x)) parent.set(x, x);
    if (!parent.has(y)) parent.set(y, y);
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(ry, rx);
  };
  for (const p of pairs) union(p.a.doc, p.b.doc);

  const clusters = new Map<string, CollisionPair[]>();
  for (const p of pairs) {
    const root = find(p.a.doc);
    const list = clusters.get(root) ?? [];
    list.push(p);
    clusters.set(root, list);
  }
  // Map insertion order = order of each root's first (highest-ranked) pair.
  return [...clusters.values()];
}

/**
 * Stable fingerprint of a pair list's IDENTITIES (docs + headings, never
 * scores or keys) — part of the overlap session cache key, so a change in
 * WHICH pairs a cluster must check re-runs it, while a weight shift from an
 * edit elsewhere in the corpus does not.
 */
export function pairsFingerprint(pairs: readonly CollisionPair[]): string {
  const ids = pairs.map((p) => pairIdentity(p.a, p.b)).sort();
  return createHash('sha256').update(ids.join('\n')).digest('hex');
}
