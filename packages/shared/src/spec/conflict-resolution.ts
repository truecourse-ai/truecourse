/**
 * The SINGLE derivation of "is a conflict resolved?" — ONE copy, imported by
 * core (the guard-generate gate), the dashboard route, and the client
 * (SpecCorpusView / SpecConflictDetail) alike, so no surface ever disagrees
 * about which conflicts are still open. No I/O: the caller supplies the parsed
 * corpus + decisions; these functions only classify.
 *
 * A conflict is two sentences, of two documents or of one, that state
 * incompatible things. It is RESOLVED only by a decision on the disagreement
 * itself:
 *   - a matching conflict verdict — pick-a-side or dismissal
 *     (`conflictResolutions[]`, matched by conflict identity), OR
 *   - either doc is force-EXCLUDED (dropped from the corpus, so the disagreement
 *     is gone with it).
 * Two sentences that disagree stay an open conflict until verdicted,
 * dismissed, or fixed.
 *
 * A conflict's identity is its two SIDES, each a doc and the key of the
 * sentence it points at ({@link sentenceKey}). The quote a side also carries
 * is for a reader, never part of the identity: anything else changing in the
 * doc around the sentence leaves the conflict and the verdict recorded against
 * it in place. Several disagreements between the same two docs are several
 * conflicts, each with its own id and verdict.
 */

/**
 * Normalize text for verbatim-quote matching: strip inline markdown/code MARKERS
 * (backtick, `*`, `_`, `~` — keeping the words inside), collapse every whitespace
 * run to a single space, lowercase, and trim. Whitespace + markdown normalization
 * only — no tokenizing/stemming/stopword removal — so a quote copied verbatim still
 * matches a line-wrapped or backtick-styled source sentence while staying an
 * essentially exact match. The single copy: the consolidator's pointer-verifier
 * and sentence splitter import THIS one (never a second implementation).
 */
export function normalizeQuote(text: string): string {
  return text
    .replace(/[`*_~]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** FNV-1a 32-bit as hex — short, dependency-free, identical in node and the
 *  browser. NOT cryptographic: it only has to separate the sentences of one
 *  document, the claims read from one, and the conflicts that share one
 *  area + doc pair. */
export const shortHash = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

/**
 * The key of one sentence of a document: a short hash of its
 * {@link normalizeQuote}d words, and of `repeat` when the document states the
 * same words more than once (0 for the first, 1 for the second occurrence,
 * …), so two identical table rows under different headings stay two
 * sentences. It depends on the words alone, never on the sentence's number,
 * so an edit above the sentence (which renumbers it) leaves the key, and the
 * verdict recorded against it, in place; an edit to the sentence itself is a
 * new one.
 */
export function sentenceKey(text: string, repeat = 0): string {
  return shortHash(repeat > 0 ? `${normalizeQuote(text)}\x00${repeat}` : normalizeQuote(text));
}

/** One side of a conflict — a doc and the sentence of it the side points at. */
export interface ConflictSideLike {
  doc: string;
  /** The verbatim disputed words. Carried for display; never part of the identity. */
  quote?: string;
  /** The {@link sentenceKey} of the sentence: with the doc, the side's identity. */
  sentence: string;
}

/** The minimal conflict shape — the two docs, the note, and its two sides. */
export interface ConflictLike {
  docs: readonly [string, string];
  note?: string;
  /** The sides, one per sentence — the identity. */
  sections: readonly ConflictSideLike[];
  /**
   * Areas this (possibly cross-area-merged) conflict spans. The scan stores it
   * on the single merged record.
   */
  areas?: readonly string[];
}

/** The minimal area shape — its id and the conflicts it holds. */
export interface AreaLike<O extends ConflictLike = ConflictLike> {
  id: string;
  conflicts: readonly O[];
}

/** The minimal corpus shape — the areas with the conflicts they hold. */
export interface CorpusLike<O extends ConflictLike = ConflictLike> {
  areas: readonly AreaLike<O>[];
}

/**
 * A conflict verdict as the derivation reads it — the two sides as a doc and
 * a sentence key each, the quote carried for display, and the verdict. `verdict` 'a'/'b' picks a side (the loser's quoted claim is
 * suppressed at extraction); 'dismissed' says this is no conflict, which
 * resolves the gate but suppresses nothing.
 */
export interface ConflictResolutionLike {
  docA: string;
  quoteA?: string;
  sentenceA: string;
  docB: string;
  quoteB?: string;
  sentenceB: string;
  verdict: 'a' | 'b' | 'dismissed';
  resolvedAt?: string;
  note?: string;
  /** `auto` = the scan applied a high-confidence recommendation; absent/`user` = a human verdict. */
  resolvedBy?: 'user' | 'auto';
}

/** The minimal decisions shape — the force-excludes and conflict verdicts. */
export interface DecisionsLike {
  manualExcludes?: readonly string[];
  /** Conflict verdicts, matched by conflict identity. */
  conflictResolutions?: readonly ConflictResolutionLike[];
}

/**
 * One conflict classified as open or resolved, carrying HOW it resolved so a
 * surface can render the right badge (the verdict, or the excluded doc)
 * without re-deriving. The record is the stored conflict itself (its docs,
 * note, sides, review and whatever else the corpus's own type adds) with the
 * read layer's fields beside them, so a surface reads the note / sides /
 * review straight off the row and never re-finds the record by doc pair, which
 * is exactly the search that cannot tell two same-pair conflicts apart.
 */
export type CorpusConflict<O extends ConflictLike = ConflictLike> = Omit<O, 'areas' | 'note'> & {
  /**
   * The conflict's ADDRESSABLE identity — stable, unique per record, and safe in
   * a URL. Built by {@link conflictId} from the SAME identity the dedup merges
   * on. Resolve one back with {@link resolveConflictId}; never rebuild it in a
   * consumer.
   */
  id: string;
  /** The representative area the record surfaces under. */
  area: string;
  /**
   * Every area the conflict spans (≥1). Detection runs per area, so one
   * conflict on a doc pair sharing several areas is flagged in each; the merge
   * collapses them to one record but keeps the full span here.
   */
  areas: string[];
  /** The two docs, by ref (`context/<sourceId>/<docPath>`). */
  a: string;
  b: string;
  /** The disagreement note. */
  note: string;
  /** True when a decision resolves the conflict. */
  resolved: boolean;
  /**
   * The matched resolution, when one exists for this conflict. Carries the
   * verdict so a surface renders "resolved — <winner> is right" / "dismissed"
   * without re-deriving; a side verdict ('a'/'b') also drives extraction
   * suppression of the loser's quoted claim.
   */
  resolution?: ConflictResolutionLike;
  /** The force-excluded doc, when the conflict is resolved by an exclude. */
  excludedRef?: string;
};

// ---------------------------------------------------------------------------
// Cross-area dedup — one conflict = one record, however many areas share the pair
// ---------------------------------------------------------------------------

/** One conflict tagged with the area it was flagged in. */
export interface AreaConflict<O extends ConflictLike> {
  area: string;
  conflict: O;
}

/** A merged conflict: one representative record plus every area it spans. */
export interface MergedConflict<O extends ConflictLike> {
  /** Representative area the single record surfaces under (deterministic). */
  area: string;
  /** Every area the conflict spans (sorted, unique). */
  areas: string[];
  /** The representative record (its docs order / note / sides). */
  conflict: O;
  /**
   * Every record merged into this one, the representative first, then in the
   * order the representative was chosen by. A scan reads them to keep what each
   * merged record said; a read of the corpus needs only the representative.
   */
  members: [O, ...O[]];
}

const NUL = '\x00';
const unorderedPairKey = (a: string, b: string): string => (a < b ? `${a}${NUL}${b}` : `${b}${NUL}${a}`);

/** One side of a conflict as its key reads it. */
interface KeySide {
  doc: string;
  sentence: string;
}

/**
 * The canonical identity of ONE conflict, folded to a single string: its two
 * sides as doc and sentence key, in one order whichever way the sides came.
 * The dedup, {@link conflictId} and {@link conflictKey} all read THIS, which
 * is what keeps "what makes two conflicts the same" from being answered twice
 * and drifting.
 */
const identityOf = (sides: readonly [KeySide, KeySide]): string => {
  const encoded = sides.map((s) => `${s.doc}${NUL}${s.sentence}`);
  return [...encoded].sort().join(NUL);
};

const conflictIdentity = (c: ConflictLike): string => identityOf(keySides(c.docs[0], c.docs[1], c.sections));

/** Every conflict id starts with this — the marker a URL/tab layer routes on. */
const CONFLICT_ID_PREFIX = 'conflict::';

/**
 * The addressable id of one conflict: `conflict::<area>::<a>::<b>::<discriminator>`.
 * The trailing discriminator is what an area+pair key lacks, so two conflicts
 * between the same two docs get distinct, URL-stable ids instead of colliding
 * on one.
 */
export function conflictId(area: string, a: string, b: string, conflict: ConflictLike): string {
  return `${CONFLICT_ID_PREFIX}${area}::${a}::${b}::${shortHash(conflictIdentity(conflict))}`;
}

/** Is this a conflict id (rather than a plain doc ref)? The tab/URL layers route on it. */
export const isConflictId = (id: string): boolean => id.startsWith(CONFLICT_ID_PREFIX);

/** The conflict an id addresses, or `undefined`: an exact match on exactly one record. */
export function resolveConflictId<C extends Pick<CorpusConflict, 'id'>>(conflicts: readonly C[], id: string): C | undefined {
  return conflicts.find((c) => c.id === id);
}

/**
 * Collapse the SAME conflict flagged across shared areas into ONE record.
 * Detection runs per AREA, so a doc pair that co-occurs in several areas can
 * have one conflict flagged once per area. Two records are the same conflict
 * exactly when they have one identity: the same two sentences. The same two
 * sections holding another disagreement is another conflict.
 *
 * The representative (which record survives) is deterministic: by area then
 * note. The span (`areas`) unions each member's tagged area with any `areas` the
 * record already carries.
 */
export function dedupeCrossAreaConflicts<O extends ConflictLike>(
  entries: readonly AreaConflict<O>[],
): MergedConflict<O>[] {
  const byIdentity = new Map<string, AreaConflict<O>[]>();
  for (const e of entries) {
    const key = conflictIdentity(e.conflict);
    const list = byIdentity.get(key);
    if (list) list.push(e);
    else byIdentity.set(key, [e]);
  }

  const merged: MergedConflict<O>[] = [];
  for (const group of byIdentity.values()) {
    group.sort((x, y) => {
      if (x.area !== y.area) return x.area < y.area ? -1 : 1;
      return (x.conflict.note ?? '') < (y.conflict.note ?? '') ? -1 : 1;
    });
    const [rep, ...rest] = group as [AreaConflict<O>, ...AreaConflict<O>[]];
    const span = new Set<string>();
    for (const g of group) {
      span.add(g.area);
      for (const a of g.conflict.areas ?? []) span.add(a);
    }
    merged.push({
      area: rep.area,
      areas: [...span].sort(),
      conflict: rep.conflict,
      members: [rep.conflict, ...rest.map((g) => g.conflict)],
    });
  }

  // Deterministic output order: representative area, then pair; records on one
  // pair keep the order they were given (the sort is stable).
  merged.sort((x, y) => {
    if (x.area !== y.area) return x.area < y.area ? -1 : 1;
    const px = unorderedPairKey(x.conflict.docs[0], x.conflict.docs[1]);
    const py = unorderedPairKey(y.conflict.docs[0], y.conflict.docs[1]);
    return px === py ? 0 : px < py ? -1 : 1;
  });
  return merged;
}

// ---------------------------------------------------------------------------
// Conflict identity + resolution matching
// ---------------------------------------------------------------------------

/** True when two doc pairs are the same set (either order). */
const samePair = (a1: string, b1: string, a2: string, b2: string): boolean =>
  (a1 === a2 && b1 === b2) || (a1 === b2 && b1 === a2);

/**
 * Each doc's sides. A conflict between two docs reads each doc's own sides. A
 * contradiction INSIDE one doc (`a === b`) has no doc to tell its sides apart,
 * so they are positional: the first side on the doc is side a, the second
 * side b. That order is what `pick-a`/`pick-b` and a verdict's `a`/`b` mean
 * for such a conflict.
 */
export function conflictSides<S extends ConflictSideLike>(
  a: string,
  b: string,
  sections: readonly S[],
): [S[], S[]] {
  if (a !== b) return [sections.filter((s) => s.doc === a), sections.filter((s) => s.doc === b)];
  const onDoc = sections.filter((s) => s.doc === a);
  return [onDoc.slice(0, 1), onDoc.slice(1, 2)];
}

/** The two sides as the identity reads them. A doc with no side is keyed on an empty sentence. */
function keySides(a: string, b: string, sections: readonly ConflictSideLike[]): [KeySide, KeySide] {
  const [[sideA], [sideB]] = conflictSides(a, b, sections);
  return [
    { doc: a, sentence: sideA?.sentence ?? '' },
    { doc: b, sentence: sideB?.sentence ?? '' },
  ];
}

/** Whether two sides name ONE sentence: the same doc and the same sentence key. */
export function sameSentence(p: ConflictSideLike, q: ConflictSideLike): boolean {
  return p.doc === q.doc && p.sentence === q.sentence;
}

/**
 * A conflict's IDENTITY: its two sides, each a doc and a sentence key, in one
 * order whichever way they came. Headings and quotes are display, never
 * identity — a session re-excerpts the same disagreement differently on every
 * scan, and a heading may be renamed, while the verdict recorded must still
 * match. Stable across scans, so two corpora's conflicts compare by it. The
 * one key every consumer compares by: the read side matches a resolution to a
 * conflict through it, and the write side ({@link resolutionConflictKey})
 * replaces a verdict on the same conflict through it.
 */
export function conflictKey(a: string, b: string, sections: readonly ConflictSideLike[]): string {
  return identityOf(keySides(a, b, sections));
}

/** {@link conflictKey} for the conflict a stored resolution records. */
export function resolutionConflictKey(
  r: Pick<ConflictResolutionLike, 'docA' | 'sentenceA' | 'docB' | 'sentenceB'>,
): string {
  return identityOf([
    { doc: r.docA, sentence: r.sentenceA },
    { doc: r.docB, sentence: r.sentenceB },
  ]);
}

/** Does a stored resolution identify THIS conflict? See {@link conflictKey}. */
function resolutionMatchesConflict(
  r: ConflictResolutionLike,
  a: string,
  b: string,
  sections: readonly ConflictSideLike[],
): boolean {
  return resolutionConflictKey(r) === conflictKey(a, b, sections);
}

/**
 * The stored resolution that identifies THIS conflict, if any — the exported
 * face of {@link resolutionMatchesConflict} for surfaces that hold a conflict
 * from somewhere other than the corpus (the Activity chat renders conflict
 * cards straight off a session transcript). Never rebuild the identity
 * matching in a consumer.
 */
export function resolutionForConflict(
  resolutions: readonly ConflictResolutionLike[] | undefined,
  a: string,
  b: string,
  sections: readonly ConflictSideLike[],
): ConflictResolutionLike | undefined {
  return (resolutions ?? []).find((r) => resolutionMatchesConflict(r, a, b, sections));
}

/**
 * A stored resolution for THIS doc pair that matches NO current conflict — a
 * disputed sentence was reworded, or the disagreement found in other
 * sentences. `conflicts` is every current conflict ({@link buildCorpusConflicts},
 * resolved ones included): a verdict in force on one conflict of the pair is
 * no hint on the others, since two docs can carry dozens of separate
 * conflicts. Surfaces show it as a reapply HINT on an open conflict of the
 * pair; it never resolves anything by itself (a genuinely new conflict must
 * not be swallowed by an old verdict).
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
  sections: readonly ConflictSideLike[],
): ConflictResolutionLike | undefined {
  return (decisions.conflictResolutions ?? []).find((r) => resolutionMatchesConflict(r, a, b, sections));
}

/**
 * Classify every conflict as open or resolved (with how). This is the full
 * list the conflict surfaces render; {@link openConflicts} is the gate's
 * unresolved subset. A conflict is resolved only by a matching
 * verdict/dismissal or a covering exclude.
 */
export function buildCorpusConflicts<O extends ConflictLike>(
  corpus: CorpusLike<O>,
  decisions: DecisionsLike,
): CorpusConflict<O>[] {
  const excludes = new Set(decisions.manualExcludes ?? []);

  // Collapse the same conflict flagged across shared areas into ONE record, so
  // a pair co-occurring in several areas is one conflict — the same
  // deterministic rule a fresh scan applies at assembly.
  const entries: AreaConflict<O>[] = [];
  for (const area of corpus.areas) for (const c of area.conflicts) entries.push({ area: area.id, conflict: c });

  const flagged: CorpusConflict<O>[] = [];
  for (const m of dedupeCrossAreaConflicts(entries)) {
    const [a, b] = m.conflict.docs;
    const excludedRef = excludes.has(a) ? a : excludes.has(b) ? b : undefined;
    // A verdict (pick-a-side OR dismissal) resolves the conflict.
    const resolution = matchResolution(decisions, a, b, m.conflict.sections);
    flagged.push({
      ...m.conflict,
      id: conflictId(m.area, a, b, m.conflict),
      area: m.area,
      areas: m.areas,
      a,
      b,
      note: m.conflict.note ?? '',
      resolved: excludedRef !== undefined || resolution !== undefined,
      ...(excludedRef ? { excludedRef } : {}),
      ...(resolution ? { resolution } : {}),
    });
  }
  return flagged;
}

/**
 * The verdict record for one conflict: each side's doc and sentence key (the
 * conflict's identity, {@link conflictKey}), its quote for display, and the
 * verdict. Built ONCE — the dashboard's verdict buttons and
 * the MCP tool both record through it, and so does the scan's auto-apply.
 * Sides are read by {@link conflictSides}, so inside one doc `a` is the first
 * sentence.
 */
export function conflictVerdictFor(
  conflict: Pick<ConflictLike, 'sections'>,
  docA: string,
  docB: string,
  verdict: ConflictResolutionLike['verdict'],
): Omit<ConflictResolutionLike, 'resolvedAt' | 'note' | 'resolvedBy'> {
  const [[sideA], [sideB]] = conflictSides(docA, docB, conflict.sections);
  return {
    docA,
    quoteA: sideA?.quote,
    sentenceA: sideA?.sentence ?? '',
    docB,
    quoteB: sideB?.quote,
    sentenceB: sideB?.sentence ?? '',
    verdict,
  };
}

/**
 * Whether a verdict names one sentence on both sides, so it identifies no
 * conflict: the same doc and the same sentence key twice. A verdict on a
 * contradiction inside one doc names two sentences of it.
 */
export function verdictNamesOneSentence(
  r: Pick<ConflictResolutionLike, 'docA' | 'sentenceA' | 'docB' | 'sentenceB'>,
): boolean {
  return r.docA === r.docB && r.sentenceA === r.sentenceB;
}

/**
 * The unresolved conflicts — the guard-generate gate's blocker set. Extracting
 * both sides of one of these births a red test that is really the unresolved
 * conflict, so generate must fail until they are resolved.
 */
export function openConflicts<O extends ConflictLike>(
  corpus: CorpusLike<O>,
  decisions: DecisionsLike,
): CorpusConflict<O>[] {
  return buildCorpusConflicts(corpus, decisions).filter((c) => !c.resolved);
}

/**
 * Stored resolutions that match NO current conflict — ORPHANED. Docs change
 * over time; a resolution whose conflict the corpus no longer flags (the
 * sentence reworded, the docs reconciled) is surfaced honestly by the
 * conflict surfaces rather than silently honored.
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
  const current = new Set(conflicts.map((c) => conflictKey(c.a, c.b, c.sections)));
  return resolutions.filter((r) => !current.has(resolutionConflictKey(r)));
}

/** One claim the extraction stage must suppress: the losing side of a side-verdict
 *  resolution, named by its doc and the verbatim disputed sentence to drop. */
export interface SuppressedClaim {
  /** The losing doc (the side the verdict rejected). */
  doc: string;
  /** The verbatim disputed sentence — no claim asserting it may be extracted. */
  quote: string;
  /** The losing sentence's key: a claim read from it is suppressed. */
  sentence: string;
}

/**
 * The claims extraction must suppress under the current resolutions: for every
 * conflict resolved by a side verdict ('a'/'b'), the LOSER's disputed sentence
 * (the side the verdict rejected). A 'dismissed' verdict suppresses NOTHING;
 * an orphaned resolution (no matching conflict) suppresses nothing (it is
 * surfaced via {@link orphanedConflictResolutions} instead); a side verdict
 * whose loser carries no quote yields nothing to suppress (the gate still
 * counts it resolved). The guard generator drops every claim read from the
 * losing sentence before it composes flows, so no test asserts the stale
 * sentence.
 *
 * Each conflict carries its own sides and matches only the verdict on itself,
 * so where many conflicts share two docs, each verdict suppresses the losing
 * quote of its own conflict, never another point's.
 */
export function suppressedClaims(corpus: CorpusLike, decisions: DecisionsLike): SuppressedClaim[] {
  const out: SuppressedClaim[] = [];
  for (const c of buildCorpusConflicts(corpus, decisions)) {
    const r = c.resolution;
    if (!r || r.verdict === 'dismissed') continue;
    const loser =
      r.verdict === 'a'
        ? { doc: r.docB, quote: r.quoteB, sentence: r.sentenceB }
        : { doc: r.docA, quote: r.quoteA, sentence: r.sentenceA };
    // The words to drop are the ones the CURRENT scan carries: the verdict
    // matched by sentence key, and the quote window may have moved on since
    // the verdict was recorded.
    const current = c.sections.find((s) => s.doc === loser.doc && s.sentence === loser.sentence);
    const quote = current?.quote?.trim() || loser.quote?.trim();
    if (quote) out.push({ doc: loser.doc, quote, sentence: loser.sentence });
  }
  return out;
}
