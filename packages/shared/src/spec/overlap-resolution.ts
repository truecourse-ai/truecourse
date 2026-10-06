/**
 * The SINGLE derivation of "is a within-area overlap resolved?" — ONE copy,
 * imported by core (the guard-generate gate), the dashboard route, and the
 * client (SpecCorpusView / SpecOverlapDetail) alike, so no surface ever
 * disagrees about which overlaps are still open. No I/O: the caller supplies
 * the parsed corpus + decisions; these functions only classify.
 *
 * An overlap is RESOLVED only by a decision on the disagreement itself:
 *   - a matching SECTION-scoped conflict verdict — pick-a-side or dismissal
 *     (`conflictResolutions[]`, matched by dispute identity), OR
 *   - either doc is force-EXCLUDED (dropped from the corpus, so the disagreement
 *     is gone with it).
 * Two docs that textually disagree stay an open conflict until verdicted,
 * dismissed, or fixed.
 *
 * A dispute is identified by its two docs and, per side, the section it points
 * at. A pointer that also carries a PASSAGE key (the fact comparison sets one:
 * the passage it quotes, see {@link passageKey}) is identified by its passage
 * too, so several disagreements between the same two sections are several
 * disputes, each with its own id, verdict and suppressed quote. A pointer
 * without one (the overlap session's, and every corpus stored before passage
 * keys) keeps the section identity, byte for byte, and the two kinds never
 * name one dispute.
 */

/**
 * Normalize text for verbatim-quote matching: strip inline markdown/code MARKERS
 * (backtick, `*`, `_`, `~` — keeping the words inside), collapse every whitespace
 * run to a single space, lowercase, and trim. Whitespace + markdown normalization
 * only — no tokenizing/stemming/stopword removal — so a quote copied verbatim still
 * matches a line-wrapped or backtick-styled source sentence while staying an
 * essentially exact match. The single copy: the consolidator's overlap
 * pointer-verifier imports THIS one (never a second implementation). A
 * dispute's identity is its doc pair, section anchors and passage keys
 * ({@link disputeKey}), not its quotes, so nothing here matches a resolution
 * by quote.
 */
export function normalizeQuote(text: string): string {
  return text
    .replace(/[`*_~]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** FNV-1a 32-bit as hex — short, dependency-free, identical in node and the
 *  browser. NOT cryptographic: it only has to separate the handful of disputes
 *  that share one area + doc pair, or the passages under one heading. */
const shortHash = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

/**
 * The passage key of a pointer that quotes `text`, the whole text of the
 * document unit it quotes from: a short hash of its {@link normalizeQuote}d
 * form. It depends on the words alone, never on the unit's number, so an edit
 * above the passage (which renumbers it) leaves the key, and the verdict
 * recorded against it, in place; an edit to the passage itself is a new one.
 */
export function passageKey(text: string): string {
  return shortHash(normalizeQuote(text));
}

/** A conflicting section pointer — a doc + its heading (`null` = the doc's preamble). */
export interface OverlapSectionLike {
  doc: string;
  heading: string | null;
  /**
   * The verbatim disputed-sentence excerpt, when the model supplied one. Carried
   * for display/transparency only — never part of the identity below, so a
   * quote difference never splits one dispute into two.
   */
  quote?: string;
  /**
   * The {@link passageKey} of the passage the pointer quotes, when the finding
   * named one (the fact comparison does). Part of the identity: two pointers
   * under one heading with different passages name two disputes.
   */
  passage?: string;
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
 * OverlapSectionLike.heading} (`null` = the doc's preamble/lead), and the
 * passages {@link OverlapSectionLike.passage}: a verdict recorded on a
 * conflict whose pointers carry passage keys names them, and matches only the
 * conflict on those two passages.
 */
export interface ConflictResolutionLike {
  docA: string;
  anchorA: string | null;
  quoteA?: string;
  passageA?: string;
  docB: string;
  anchorB: string | null;
  quoteB?: string;
  passageB?: string;
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
  /** The two overlapping docs, by ref (`context/<sourceId>/<docPath>`). */
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
  /**
   * Every overlap merged into this record, the representative first, then in
   * the order the representative was chosen by. A scan reads them to keep what
   * each merged finding said; a read of the corpus needs only the representative.
   */
  members: [O, ...O[]];
}

const PREAMBLE_PTR = '\x00preamble';
const NUL = '\x00';
const unorderedPairKey = (a: string, b: string): string => (a < b ? `${a}${NUL}${b}` : `${b}${NUL}${a}`);
/** One key per pointer: doc + heading, and its passage when it carries one. */
const sectionPointerKeys = (ov: OverlapLike): string[] =>
  (ov.sections ?? []).map(
    (s) => `${s.doc}${NUL}${s.heading ?? PREAMBLE_PTR}${s.passage !== undefined ? `${NUL}${s.passage}` : ''}`,
  );
const preambleCount = (ov: OverlapLike): number =>
  (ov.sections ?? []).filter((s) => s.heading === null || s.heading === undefined).length;

/** Whether an overlap names its passages: any of its pointers carries a passage key. */
export const namesPassages = (ov: Pick<OverlapLike, 'sections'>): boolean =>
  (ov.sections ?? []).some((s) => s.passage !== undefined);

/**
 * The canonical identity of ONE dispute, folded to a single string: the SAME
 * section identity {@link dedupeCrossAreaOverlaps} merges on. Sorted section
 * pointers (each with its passage, when it carries one) when the overlap flags
 * any; the normalized note otherwise — a SECTIONLESS overlap shares no pointer
 * with anything, so it never merges, and without the fallback two of them on
 * one pair would be indistinguishable.
 *
 * The dedup and {@link conflictId} both read THIS, which is what keeps "what
 * makes two disputes the same" from being answered twice and drifting.
 */
const overlapIdentity = (ov: OverlapLike): string => {
  const ptrs = sectionPointerKeys(ov);
  return ptrs.length > 0 ? [...ptrs].sort().join(NUL) : `note${NUL}${normalizeQuote(ov.note ?? '')}`;
};

/** Every conflict id starts with this — the marker a URL/tab layer routes on. */
const CONFLICT_ID_PREFIX = 'overlap::';

/**
 * The addressable id of one dispute: `overlap::<area>::<a>::<b>::<discriminator>`.
 * The trailing discriminator is what the pre-existing area+pair key lacked, so
 * two disputes the dedup deliberately kept apart (disjoint sections on the same
 * pair, or different passages of the same two sections) get distinct,
 * URL-stable ids instead of colliding on one.
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
 * overlap shares no pointer, so it never merges by pair alone. A contradiction
 * inside one doc is that doc paired with itself: it never merges with a dispute
 * between two docs, and merges with another inside the same doc by the same
 * shared-pointer rule.
 *
 * Overlaps that name their passages ({@link namesPassages}) merge on a
 * stricter rule: only with another naming the very same passages (one
 * identity, {@link overlapIdentity}), since the same two sections can hold
 * many separate disagreements. One sharing a single pointer with another is a
 * different point, and an overlap naming passages never merges with one that
 * names none.
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
    // Union-find within the pair: members naming no passages connect when they
    // share a section pointer, members naming passages when they are one identity.
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
    const identityOwner = new Map<string, number>();
    members.forEach((m, i) => {
      const keys = namesPassages(m.overlap) ? [overlapIdentity(m.overlap)] : sectionPointerKeys(m.overlap);
      const owners = namesPassages(m.overlap) ? identityOwner : ptrOwner;
      for (const key of keys) {
        const owner = owners.get(key);
        if (owner === undefined) owners.set(key, i);
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
      const group = idxs
        .map((i) => members[i])
        .sort((x, y) => {
          const px = preambleCount(x.overlap);
          const py = preambleCount(y.overlap);
          if (px !== py) return px - py;
          if (x.area !== y.area) return x.area < y.area ? -1 : 1;
          return (x.overlap.note ?? '') < (y.overlap.note ?? '') ? -1 : 1;
        });
      const [rep, ...rest] = group;
      const span = new Set<string>();
      for (const g of group) {
        span.add(g.area);
        for (const a of g.overlap.areas ?? []) span.add(a);
      }
      merged.push({
        area: rep.area,
        areas: [...span].sort(),
        overlap: rep.overlap,
        members: [rep.overlap, ...rest.map((g) => g.overlap)],
      });
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
 * Each side's section pointers. A dispute between two docs reads each doc's
 * own pointers. A contradiction INSIDE one doc (`a === b`) has no doc to tell
 * its sides apart, so they are positional: the first pointer on the doc is
 * side a, the second side b. That order is what `pick-a`/`pick-b` and a
 * verdict's `a`/`b` mean for such a dispute.
 */
export function disputeSides<S extends OverlapSectionLike>(
  a: string,
  b: string,
  sections: readonly S[] | undefined,
): [S[], S[]] {
  const all = sections ?? [];
  if (a !== b) return [all.filter((s) => s.doc === a), all.filter((s) => s.doc === b)];
  const onDoc = all.filter((s) => s.doc === a);
  return [onDoc.slice(0, 1), onDoc.slice(1, 2)];
}

/**
 * Whether two pointers name ONE passage: the same doc, the same section, and
 * the same passage. Two pointers that both carry a passage key are one
 * passage when the keys are equal, whatever words each quotes; otherwise the
 * quoted words decide (a missing quote counts as empty). A contradiction
 * inside one doc needs two passages that are not one.
 */
export function samePassage(p: OverlapSectionLike, q: OverlapSectionLike): boolean {
  if (p.doc !== q.doc || anchorKey(p.heading) !== anchorKey(q.heading)) return false;
  if (p.passage !== undefined && q.passage !== undefined) return p.passage === q.passage;
  return normalizeQuote(p.quote ?? '') === normalizeQuote(q.quote ?? '');
}

/**
 * A dispute's IDENTITY: the unordered doc pair and, per side, the section
 * anchor the conflict points at (`null` = the doc's lead), with the side's
 * passage key when the conflict names its passages. The quotes are evidence,
 * never identity — the overlap session re-excerpts the same disagreement
 * differently on every scan, and a verdict recorded against one excerpt must
 * still match the dispute when the next scan quotes it anew. A side the
 * conflict flags no section for is its doc's lead, so a sectionless dispute is
 * matched by a `null`-anchor resolution. A dispute inside one doc is keyed on
 * its two sides, unordered: by anchor, then by passage. Without passages, two
 * disputes inside one doc whose passages sit under the same two headings share
 * a key; with them, they do not.
 *
 * A conflict without passages keys exactly as it always has, so a verdict
 * recorded without passages matches only a conflict without them, and one
 * recorded with passages only the conflict on those two passages.
 *
 * Stable across scans, so two corpora's conflicts compare by it. The one key
 * every consumer compares by: the read side matches a resolution to a conflict
 * through it, and the write side ({@link resolutionDisputeKey}) replaces a
 * verdict on the same dispute through it.
 */
export function disputeKey(
  a: string,
  b: string,
  sections: readonly OverlapSectionLike[] | undefined,
): string {
  const [[sideA], [sideB]] = disputeSides(a, b, sections);
  return disputeKeyOf(
    { doc: a, anchor: anchorKey(sideA?.heading), passage: sideA?.passage },
    { doc: b, anchor: anchorKey(sideB?.heading), passage: sideB?.passage },
  );
}

/** {@link disputeKey} for the dispute a stored resolution records. */
export function resolutionDisputeKey(
  r: Pick<ConflictResolutionLike, 'docA' | 'anchorA' | 'passageA' | 'docB' | 'anchorB' | 'passageB'>,
): string {
  return disputeKeyOf(
    { doc: r.docA, anchor: anchorKey(r.anchorA), passage: r.passageA },
    { doc: r.docB, anchor: anchorKey(r.anchorB), passage: r.passageB },
  );
}

/** One side of a dispute as its key reads it. */
interface KeySide {
  doc: string;
  anchor: string | null;
  passage: string | undefined;
}

function disputeKeyOf(a: KeySide, b: KeySide): string {
  // Encoded, not concatenated: a heading may carry any delimiter, and the
  // lead (`null`) is not the same section as an empty heading. A side carries
  // its passage only when the dispute names passages, so a dispute that names
  // none keys as it always has.
  const withPassages = a.passage !== undefined || b.passage !== undefined;
  const encode = (s: KeySide): (string | null)[] =>
    withPassages ? [s.doc, s.anchor, s.passage ?? null] : [s.doc, s.anchor];
  // Ordered by doc, then (inside one doc) by anchor and then passage, so
  // either order of the two sides gives one key.
  const anchorA = JSON.stringify(a.anchor);
  const anchorB = JSON.stringify(b.anchor);
  const inOrder =
    a.doc !== b.doc ? a.doc < b.doc : anchorA !== anchorB ? anchorA < anchorB : (a.passage ?? '') <= (b.passage ?? '');
  const sides = [encode(a), encode(b)];
  return JSON.stringify(inOrder ? sides : sides.reverse());
}

/** Does a stored resolution identify THIS conflict? See {@link disputeKey}. */
function resolutionMatchesConflict(
  r: ConflictResolutionLike,
  a: string,
  b: string,
  sections: readonly OverlapSectionLike[] | undefined,
): boolean {
  return resolutionDisputeKey(r) === disputeKey(a, b, sections);
}

/**
 * The stored resolution that identifies THIS conflict, if any — the exported
 * face of {@link resolutionMatchesConflict} for surfaces that hold a dispute
 * from somewhere other than the corpus (the Activity chat renders findings
 * straight off a session transcript). Never rebuild the identity matching in
 * a consumer.
 */
export function resolutionForConflict(
  resolutions: readonly ConflictResolutionLike[] | undefined,
  a: string,
  b: string,
  sections: readonly OverlapSectionLike[] | undefined,
): ConflictResolutionLike | undefined {
  return (resolutions ?? []).find((r) => resolutionMatchesConflict(r, a, b, sections));
}

/**
 * A stored resolution for THIS doc pair that matches NO current conflict — the
 * pair was re-flagged under other section anchors (a heading renamed, or the
 * disagreement found in another section), its passage was edited, or it was
 * recorded before conflicts named their passages. `conflicts` is every
 * current conflict ({@link buildCorpusConflicts}, resolved ones included): a
 * verdict in force on one conflict of the pair is no hint on the others, since
 * two docs can carry dozens of separate disputes. Surfaces show it as a
 * reapply HINT on an open conflict of the pair; it never resolves anything by
 * itself (a genuinely new dispute must not be swallowed by an old verdict).
 */
export function dormantResolutionForPair(
  decisions: DecisionsLike,
  conflicts: readonly Pick<CorpusConflict, 'a' | 'b' | 'sections'>[],
  a: string,
  b: string,
): ConflictResolutionLike | undefined {
  return orphansAmong(decisions.conflictResolutions ?? [], conflicts).find((r) => samePair(r.docA, r.docB, a, b));
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
 * The verdict record for one dispute: each side's flagged section heading and
 * passage key (the dispute's identity, {@link disputeKey}), its quote as
 * evidence, and the verdict. Built ONCE — the dashboard's verdict buttons and
 * the MCP tool both record through it, and so does the scan's auto-apply.
 * Sides are read by {@link disputeSides}, so inside one doc `a` is the first
 * passage. A side without a passage key records none.
 */
export function conflictVerdictFor(
  overlap: Pick<OverlapLike, 'sections'> | undefined,
  docA: string,
  docB: string,
  verdict: ConflictResolutionLike['verdict'],
): Omit<ConflictResolutionLike, 'resolvedAt' | 'note' | 'resolvedBy'> {
  const [[sideA], [sideB]] = disputeSides(docA, docB, overlap?.sections);
  return {
    docA,
    anchorA: sideA?.heading ?? null,
    quoteA: sideA?.quote,
    ...(sideA?.passage !== undefined ? { passageA: sideA.passage } : {}),
    docB,
    anchorB: sideB?.heading ?? null,
    quoteB: sideB?.quote,
    ...(sideB?.passage !== undefined ? { passageB: sideB.passage } : {}),
    verdict,
  };
}

/**
 * Whether a verdict names one passage on both sides, so it identifies no
 * dispute: the same doc, the same anchor and the same passage twice (see
 * {@link samePassage}). A verdict on a contradiction inside one doc names two
 * passages of it.
 */
export function verdictNamesOnePassage(
  r: Pick<ConflictResolutionLike, 'docA' | 'anchorA' | 'quoteA' | 'passageA' | 'docB' | 'anchorB' | 'quoteB' | 'passageB'>,
): boolean {
  return samePassage(
    { doc: r.docA, heading: r.anchorA, quote: r.quoteA, passage: r.passageA },
    { doc: r.docB, heading: r.anchorB, quote: r.quoteB, passage: r.passageB },
  );
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
  return orphansAmong(resolutions, buildCorpusConflicts(corpus, decisions));
}

/** The resolutions that match none of `conflicts`, in their stored order. */
function orphansAmong(
  resolutions: readonly ConflictResolutionLike[],
  conflicts: readonly Pick<CorpusConflict, 'a' | 'b' | 'sections'>[],
): ConflictResolutionLike[] {
  const current = new Set(conflicts.map((c) => disputeKey(c.a, c.b, c.sections)));
  return resolutions.filter((r) => !current.has(resolutionDisputeKey(r)));
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
 *
 * Each conflict carries its own pointers and matches only the verdict on its
 * own dispute, so where many conflicts share two docs and two headings, each
 * verdict suppresses the losing quote of its own conflict, never another
 * point's.
 */
export function suppressedClaims(corpus: CorpusLike, decisions: DecisionsLike): SuppressedClaim[] {
  const out: SuppressedClaim[] = [];
  for (const c of buildCorpusConflicts(corpus, decisions)) {
    const r = c.resolution;
    if (!r || r.verdict === 'dismissed') continue;
    const loser =
      r.verdict === 'a'
        ? { doc: r.docB, anchor: r.anchorB, quote: r.quoteB, passage: r.passageB }
        : { doc: r.docA, anchor: r.anchorA, quote: r.quoteA, passage: r.passageA };
    // The sentence to drop is the one the CURRENT scan quoted: the verdict
    // matched by section, and the section's text may have moved on since the
    // verdict was recorded. The stored quote stands in only for a conflict
    // flagged without one.
    const quote = currentPointer(c, loser)?.quote?.trim() || loser.quote?.trim();
    if (quote) out.push({ doc: loser.doc, anchor: loser.anchor, quote });
  }
  return out;
}

/**
 * The conflict's current pointer for one side a verdict recorded. Between two
 * docs, the doc says which. Inside one doc the anchor does, and under a
 * single heading the recorded passage, or for a verdict without one the
 * recorded quote: no match there is no pointer, so the caller falls back to
 * the quote the verdict stored.
 */
function currentPointer(
  c: Pick<CorpusConflict, 'a' | 'b' | 'sections'>,
  side: { doc: string; anchor: string | null; quote?: string; passage?: string },
): OverlapSectionLike | undefined {
  const [[sideA], [sideB]] = disputeSides(c.a, c.b, c.sections);
  const onDoc = [sideA, sideB].filter((s): s is OverlapSectionLike => s !== undefined && s.doc === side.doc);
  if (c.a !== c.b) return onDoc[0];
  const atAnchor = onDoc.filter((s) => anchorKey(s.heading) === anchorKey(side.anchor));
  if (atAnchor.length === 1) return atAnchor[0];
  if (side.passage !== undefined) return atAnchor.find((s) => s.passage === side.passage);
  const recorded = normalizeQuote(side.quote ?? '');
  return recorded ? atAnchor.find((s) => normalizeQuote(s.quote ?? '') === recorded) : undefined;
}
