/**
 * The SINGLE derivation of "is a within-area overlap resolved?" — ONE copy,
 * imported by core (the guard-generate gate), the CLI (`spec conflicts` /
 * `spec status`), the dashboard route, and the client (SpecCorpusView /
 * SpecOverlapDetail) alike, so no surface ever disagrees about which overlaps
 * are still open. No I/O: the caller supplies the parsed corpus + decisions;
 * these functions only classify.
 *
 * An overlap is RESOLVED only by a decision on the disagreement itself:
 *   - a matching SECTION-scoped conflict verdict — pick-a-side or dismissal
 *     (`conflictResolutions[]`, matched by dispute identity), OR
 *   - either doc is force-EXCLUDED (dropped from the corpus, so the disagreement
 *     is gone with it).
 * Two docs that textually disagree stay an open conflict until verdicted,
 * dismissed, or fixed.
 */

/**
 * Normalize text for verbatim-quote matching: strip inline markdown/code MARKERS
 * (backtick, `*`, `_`, `~` — keeping the words inside), collapse every whitespace
 * run to a single space, lowercase, and trim. Whitespace + markdown normalization
 * only — no tokenizing/stemming/stopword removal — so a quote copied verbatim still
 * matches a line-wrapped or backtick-styled source sentence while staying an
 * essentially exact match. The single copy: the consolidator's overlap
 * pointer-verifier imports THIS one (never a second implementation), and the
 * conflict-resolution dispute identity below matches quotes through it.
 */
export function normalizeQuote(text: string): string {
  return text
    .replace(/[`*_~]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** A conflicting section pointer — a doc + its heading (`null` = the doc's preamble). */
export interface OverlapSectionLike {
  doc: string;
  heading: string | null;
  /**
   * The verbatim disputed-sentence excerpt, when the model supplied one. Carried
   * for display/transparency only — NOT part of the dedup identity below, which
   * stays doc + heading so a quote difference never splits one dispute into two.
   */
  quote?: string;
}

/** The minimal overlap shape — the two docs, the note, and (for dedup) its sections. */
export interface OverlapLike {
  docs: readonly [string, string];
  note?: string;
  /** Conflicting section pointers per doc — the dedup key across shared areas. */
  sections?: readonly OverlapSectionLike[];
  /**
   * Areas this (possibly cross-area-merged) dispute spans. A fresh scan stores it
   * on the single merged record; older corpora leave it empty and the read layer
   * recomputes the span from the per-area placement of the duplicate records.
   */
  areas?: readonly string[];
}

/** The minimal area shape — its id and the within-area overlaps it flags. */
export interface AreaLike<O extends OverlapLike = OverlapLike> {
  id: string;
  overlaps: readonly O[];
}

/** The minimal corpus shape — the areas with the overlaps they flag. */
export interface CorpusLike<O extends OverlapLike = OverlapLike> {
  areas: readonly AreaLike<O>[];
}

/**
 * A SECTION-scoped conflict verdict as the derivation reads it —
 * an unordered doc pair, each side's section anchor + optional verbatim quote, and
 * the verdict. `verdict` 'a'/'b' picks a side (the loser's quoted claim is
 * suppressed at extraction); 'dismissed' is a detector false-positive that
 * resolves the gate but suppresses nothing. Anchors mirror {@link
 * OverlapSectionLike.heading} (`null` = the doc's preamble/lead).
 */
export interface ConflictResolutionLike {
  docA: string;
  anchorA: string | null;
  quoteA?: string;
  docB: string;
  anchorB: string | null;
  quoteB?: string;
  verdict: 'a' | 'b' | 'dismissed';
  resolvedAt?: string;
  note?: string;
  /** `auto` = the scan applied a high-confidence recommendation; absent/`user` = a human verdict. */
  resolvedBy?: 'user' | 'auto';
}

/** The minimal decisions shape — the force-excludes and conflict verdicts. */
export interface DecisionsLike {
  manualExcludes?: readonly string[];
  /** Section-scoped conflict verdicts, matched by dispute identity. */
  conflictResolutions?: readonly ConflictResolutionLike[];
}

/**
 * One within-area overlap classified as open or resolved, carrying HOW it
 * resolved so a surface can render the right badge (the verdict, or the
 * excluded doc) without re-deriving.
 */
export interface CorpusConflict<O extends OverlapLike = OverlapLike> {
  /**
   * The dispute's ADDRESSABLE identity — stable, unique per record, and safe in a
   * URL. Built by {@link conflictId} from the SAME section identity the dedup
   * merges on, so a surface keying rows on it can never collide two records the
   * derivation deliberately kept apart. Resolve one back with
   * {@link resolveConflictId}; never rebuild it in a consumer.
   */
  id: string;
  /**
   * The representative overlap this record stands for — the one the merge chose.
   * Carried so a surface reads the dispute's note / sections / review (and any
   * field the corpus's own overlap type adds) WITHOUT re-finding it by doc pair,
   * which is exactly the search that cannot tell two same-pair disputes apart.
   */
  overlap: O;
  /** The representative area the record surfaces under. */
  area: string;
  /**
   * Every area the dispute spans (≥1). Detection runs per area, so one dispute on
   * a doc pair sharing several areas is flagged in each; the merge collapses them
   * to one record but keeps the full span here.
   */
  areas: string[];
  /** The two overlapping docs, by ref (repo-relative path in OSS). */
  a: string;
  b: string;
  /** The disagreement note from the overlap. */
  note: string;
  /**
   * The conflicting section pointers per doc (heading + optional quote), carried
   * from the overlap so a surface can render the dispute and the resolution
   * matcher can key on it.
   */
  sections?: OverlapSectionLike[];
  /** True when a decision resolves the overlap. */
  resolved: boolean;
  /**
   * The matched SECTION-scoped resolution, when one exists for this
   * dispute. Carries the verdict so a surface renders "resolved — <winner> is
   * right" / "dismissed" without re-deriving; a side verdict ('a'/'b') also drives
   * extraction suppression of the loser's quoted claim.
   */
  resolution?: ConflictResolutionLike;
  /** The force-excluded doc, when the overlap is resolved by an exclude. */
  excludedRef?: string;
}

// ---------------------------------------------------------------------------
// Cross-area dedup — one dispute = one record, however many areas share the pair
// ---------------------------------------------------------------------------

/** One flagged overlap tagged with the area it was flagged in. */
export interface AreaOverlap<O extends OverlapLike> {
  area: string;
  overlap: O;
}

/** A merged dispute: one representative record plus every area it spans. */
export interface MergedOverlap<O extends OverlapLike> {
  /** Representative area the single record surfaces under (deterministic). */
  area: string;
  /** Every area the dispute spans (sorted, unique). */
  areas: string[];
  /** The representative overlap (its docs order / note / sections). */
  overlap: O;
}

const PREAMBLE_PTR = '\x00preamble';
const NUL = '\x00';
const unorderedPairKey = (a: string, b: string): string => (a < b ? `${a}${NUL}${b}` : `${b}${NUL}${a}`);
const sectionPointerKeys = (ov: OverlapLike): string[] =>
  (ov.sections ?? []).map((s) => `${s.doc}${NUL}${s.heading ?? PREAMBLE_PTR}`);
const preambleCount = (ov: OverlapLike): number =>
  (ov.sections ?? []).filter((s) => s.heading === null || s.heading === undefined).length;

/**
 * The canonical identity of ONE dispute, folded to a single string: the SAME
 * section identity {@link dedupeCrossAreaOverlaps} merges on. Sorted section
 * pointers when the overlap flags any; the normalized note otherwise — a
 * SECTIONLESS overlap shares no pointer with anything, so it never merges, and
 * without the fallback two of them on one pair would be indistinguishable.
 *
 * The dedup and {@link conflictId} both read THIS, which is what keeps "what
 * makes two disputes the same" from being answered twice and drifting.
 */
const overlapIdentity = (ov: OverlapLike): string => {
  const ptrs = sectionPointerKeys(ov);
  return ptrs.length > 0 ? [...ptrs].sort().join(NUL) : `note${NUL}${normalizeQuote(ov.note ?? '')}`;
};

/** FNV-1a 32-bit as hex — short, dependency-free, identical in node and the
 *  browser. NOT cryptographic: it only has to separate the handful of disputes
 *  that share one area + doc pair. */
const shortHash = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

/** Every conflict id starts with this — the marker a URL/tab layer routes on. */
const CONFLICT_ID_PREFIX = 'overlap::';

/**
 * The addressable id of one dispute: `overlap::<area>::<a>::<b>::<discriminator>`.
 * The trailing discriminator is what the pre-existing area+pair key lacked, so
 * two disputes the dedup deliberately kept apart (disjoint sections on the same
 * pair) get distinct, URL-stable ids instead of colliding on one.
 */
export function conflictId(area: string, a: string, b: string, overlap: OverlapLike): string {
  return `${CONFLICT_ID_PREFIX}${area}::${a}::${b}::${shortHash(overlapIdentity(overlap))}`;
}

/** Is this a conflict id (rather than a plain doc ref)? The tab/URL layers route on it. */
export const isConflictId = (id: string): boolean => id.startsWith(CONFLICT_ID_PREFIX);

/**
 * The conflict an id addresses, or `undefined`. An exact id resolves to exactly
 * one record. A LEGACY key minted before the discriminator existed
 * (`overlap::<area>::<a>::<b>`) names only the pair, so it cannot tell siblings
 * apart: it lands on the first — the row it always landed on — rather than 404ing.
 */
export function resolveConflictId<O extends OverlapLike>(
  conflicts: readonly CorpusConflict<O>[],
  id: string,
): CorpusConflict<O> | undefined {
  const exact = conflicts.find((c) => c.id === id);
  if (exact || !isConflictId(id)) return exact;
  const [, area, a, b, discriminator] = id.split('::');
  if (discriminator !== undefined) return undefined;
  return conflicts.find(
    (c) => c.area === area && ((c.a === a && c.b === b) || (c.a === b && c.b === a)),
  );
}

/**
 * Collapse the SAME disagreement flagged across shared areas into ONE record.
 * Detection runs per AREA, so a doc pair that co-occurs in several areas can have
 * one dispute flagged once per area (README + SPEC's `rm` dispute flagged in both
 * core/persistence and core/tasks-entity). The DETERMINISTIC rule — never
 * note-text similarity: overlaps on the SAME unordered doc pair that share ≥1
 * section pointer (doc + heading; a `null` heading is the preamble) on at least
 * one side are the same dispute and merge. Two GENUINE disputes on a pair point
 * at disjoint sections (no shared pointer) and stay separate; a sectionless
 * overlap shares no pointer, so it never merges by pair alone.
 *
 * The representative (which record survives) is deterministic: fewest preamble
 * (null) pointers first — the most bandable in the viewer — then area then note.
 * The span (`areas`) unions each member's tagged area with any `overlap.areas`
 * the record already carries, so a fresh single merged record and older duplicate
 * records both recover the full set.
 */
export function dedupeCrossAreaOverlaps<O extends OverlapLike>(
  entries: readonly AreaOverlap<O>[],
): MergedOverlap<O>[] {
  const byPair = new Map<string, AreaOverlap<O>[]>();
  for (const e of entries) {
    const key = unorderedPairKey(e.overlap.docs[0], e.overlap.docs[1]);
    const list = byPair.get(key);
    if (list) list.push(e);
    else byPair.set(key, [e]);
  }

  const merged: MergedOverlap<O>[] = [];
  for (const members of byPair.values()) {
    // Union-find within the pair, connecting members that share a section pointer.
    const parent = members.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (i: number, j: number): void => {
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
    };
    const ptrOwner = new Map<string, number>();
    members.forEach((m, i) => {
      for (const ptr of sectionPointerKeys(m.overlap)) {
        const owner = ptrOwner.get(ptr);
        if (owner === undefined) ptrOwner.set(ptr, i);
        else union(owner, i);
      }
    });

    const components = new Map<number, number[]>();
    members.forEach((_, i) => {
      const root = find(i);
      const list = components.get(root);
      if (list) list.push(i);
      else components.set(root, [i]);
    });

    for (const idxs of components.values()) {
      const group = idxs.map((i) => members[i]);
      const rep = [...group].sort((x, y) => {
        const px = preambleCount(x.overlap);
        const py = preambleCount(y.overlap);
        if (px !== py) return px - py;
        if (x.area !== y.area) return x.area < y.area ? -1 : 1;
        return (x.overlap.note ?? '') < (y.overlap.note ?? '') ? -1 : 1;
      })[0];
      const span = new Set<string>();
      for (const g of group) {
        span.add(g.area);
        for (const a of g.overlap.areas ?? []) span.add(a);
      }
      merged.push({ area: rep.area, areas: [...span].sort(), overlap: rep.overlap });
    }
  }

  // Deterministic output order: representative area, then pair.
  merged.sort((x, y) => {
    if (x.area !== y.area) return x.area < y.area ? -1 : 1;
    return unorderedPairKey(x.overlap.docs[0], x.overlap.docs[1]) <
      unorderedPairKey(y.overlap.docs[0], y.overlap.docs[1])
      ? -1
      : 1;
  });
  return merged;
}

// ---------------------------------------------------------------------------
// Section-scoped conflict resolutions — dispute identity + matching
// ---------------------------------------------------------------------------

/** True when two doc pairs are the same set (either order). */
const samePair = (a1: string, b1: string, a2: string, b2: string): boolean =>
  (a1 === a2 && b1 === b2) || (a1 === b2 && b1 === a2);

/** Anchor match key for a heading pointer (`null` = preamble/lead). Strips inline
 *  markers + folds case so a backtick-styled heading still matches its plain form. */
const anchorKey = (h: string | null | undefined): string | null =>
  h === null || h === undefined ? null : h.replace(/[`*_~]/g, '').trim().toLowerCase();

/**
 * Does a stored resolution identify THIS conflict? Dispute identity = the same
 * unordered doc pair AND, per doc, either matching normalized quotes (used when
 * BOTH the resolution and the conflict carry a quote on each side — the precise,
 * rescan-surviving key) or matching section anchors (the fallback when a quote is
 * missing; a doc the conflict flags no section for is treated as a `null`/preamble
 * anchor, so a sectionless dispute is matched by a `null`-anchor resolution).
 */
function resolutionMatchesConflict(
  r: ConflictResolutionLike,
  a: string,
  b: string,
  sections: readonly OverlapSectionLike[] | undefined,
): boolean {
  if (!samePair(r.docA, r.docB, a, b)) return false;
  const rSide = (doc: string): { anchor: string | null; quote?: string } =>
    doc === r.docA ? { anchor: r.anchorA, quote: r.quoteA } : { anchor: r.anchorB, quote: r.quoteB };
  const cSide = (doc: string): OverlapSectionLike | undefined => (sections ?? []).find((s) => s.doc === doc);

  const bothHaveQuotes =
    !!r.quoteA && !!r.quoteB && !!cSide(a)?.quote && !!cSide(b)?.quote;
  if (bothHaveQuotes) {
    const quoteMatch = (doc: string): boolean =>
      normalizeQuote(rSide(doc).quote ?? '') === normalizeQuote(cSide(doc)?.quote ?? '');
    return quoteMatch(a) && quoteMatch(b);
  }
  const anchorMatch = (doc: string): boolean => anchorKey(rSide(doc).anchor) === anchorKey(cSide(doc)?.heading);
  return anchorMatch(a) && anchorMatch(b);
}

/** The first stored resolution matching this conflict, or `undefined`. */
function matchResolution(
  decisions: DecisionsLike,
  a: string,
  b: string,
  sections: readonly OverlapSectionLike[] | undefined,
): ConflictResolutionLike | undefined {
  return (decisions.conflictResolutions ?? []).find((r) => resolutionMatchesConflict(r, a, b, sections));
}

/**
 * Classify every flagged within-area overlap as open or resolved (with how).
 * This is the full list the conflict surfaces render; {@link openConflicts} is
 * the gate's unresolved subset. A conflict is resolved only by a matching
 * verdict/dismissal or a covering exclude.
 */
export function buildCorpusConflicts<O extends OverlapLike>(
  corpus: CorpusLike<O>,
  decisions: DecisionsLike,
): CorpusConflict<O>[] {
  const excludes = new Set(decisions.manualExcludes ?? []);

  // Collapse the same dispute flagged across shared areas into ONE record, so a
  // pair co-occurring in several areas is one conflict — the same deterministic
  // rule a fresh scan applies at assembly, re-applied here so older corpora that
  // persisted the per-area duplicates still surface (and count) once.
  const entries: AreaOverlap<O>[] = [];
  for (const area of corpus.areas) for (const ov of area.overlaps) entries.push({ area: area.id, overlap: ov });
  const mergedOverlaps = dedupeCrossAreaOverlaps(entries);

  const flagged: CorpusConflict<O>[] = [];
  for (const m of mergedOverlaps) {
    const [a, b] = m.overlap.docs;
    const sections = m.overlap.sections ? [...m.overlap.sections] : undefined;
    const excludedRef = excludes.has(a) ? a : excludes.has(b) ? b : undefined;
    // A section-scoped verdict (pick-a-side OR dismissal) resolves the dispute.
    const resolution = matchResolution(decisions, a, b, sections);
    flagged.push({
      id: conflictId(m.area, a, b, m.overlap),
      overlap: m.overlap,
      area: m.area,
      areas: m.areas,
      a,
      b,
      note: m.overlap.note ?? '',
      ...(sections ? { sections } : {}),
      resolved: excludedRef !== undefined || resolution !== undefined,
      ...(excludedRef ? { excludedRef } : {}),
      ...(resolution ? { resolution } : {}),
    });
  }
  return flagged;
}

/**
 * The unresolved conflicts — the guard-generate gate's blocker set. Extracting
 * both sides of one of these births a red finding that is really the unresolved
 * dispute, so generate must fail until they are resolved.
 */
export function openConflicts<O extends OverlapLike>(
  corpus: CorpusLike<O>,
  decisions: DecisionsLike,
): CorpusConflict<O>[] {
  return buildCorpusConflicts(corpus, decisions).filter((c) => !c.resolved);
}

/**
 * Stored section-scoped resolutions that match NO current flagged conflict —
 * ORPHANED. Docs change over time; a resolution whose dispute the corpus no longer
 * flags (the section moved, the quote vanished, the docs reconciled) is surfaced
 * honestly by the conflict surfaces rather than silently honored.
 */
export function orphanedConflictResolutions(
  corpus: CorpusLike,
  decisions: DecisionsLike,
): ConflictResolutionLike[] {
  const resolutions = decisions.conflictResolutions ?? [];
  if (resolutions.length === 0) return [];
  const conflicts = buildCorpusConflicts(corpus, decisions);
  return resolutions.filter(
    (r) => !conflicts.some((c) => resolutionMatchesConflict(r, c.a, c.b, c.sections)),
  );
}

/** One claim the extraction stage must suppress: the losing side of a side-verdict
 *  resolution, named by its doc and the verbatim disputed sentence to drop. */
export interface SuppressedClaim {
  /** The losing doc (the side the verdict rejected). */
  doc: string;
  /** The losing section's heading (`null` = preamble/lead). */
  anchor: string | null;
  /** The verbatim disputed sentence — no claim asserting it may be extracted. */
  quote: string;
}

/**
 * The claims extraction must suppress under the current resolutions: for every
 * flagged conflict resolved by a side verdict ('a'/'b'), the LOSER's disputed
 * sentence (the side the verdict rejected). A 'dismissed' verdict suppresses
 * NOTHING; an orphaned resolution (no matching conflict) suppresses nothing (it is
 * surfaced via {@link orphanedConflictResolutions} instead); a side verdict whose
 * loser carries no quote yields nothing to suppress (the gate still counts it
 * resolved). The guard generator injects each entry into the losing section's
 * extraction context so no claim asserting the stale sentence is authored.
 */
export function suppressedClaims(corpus: CorpusLike, decisions: DecisionsLike): SuppressedClaim[] {
  const out: SuppressedClaim[] = [];
  for (const c of buildCorpusConflicts(corpus, decisions)) {
    const r = c.resolution;
    if (!r || r.verdict === 'dismissed') continue;
    const loser =
      r.verdict === 'a'
        ? { doc: r.docB, anchor: r.anchorB, quote: r.quoteB }
        : { doc: r.docA, anchor: r.anchorA, quote: r.quoteA };
    if (loser.quote && loser.quote.trim()) out.push({ doc: loser.doc, anchor: loser.anchor, quote: loser.quote });
  }
  return out;
}
