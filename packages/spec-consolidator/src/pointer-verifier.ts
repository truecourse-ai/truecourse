/**
 * Deterministic re-anchoring of overlap SECTION POINTERS at assembly. Overlap
 * pointers are model-chosen and UNVALIDATED — the judge names "the nearest
 * heading above the conflicting passage" and can mis-anchor: it once pointed the
 * README side of taskline's `rm` dispute at `## Storage` when the disputed
 * sentence lives in the doc's LEAD (the intro before any `##`). Nothing
 * downstream noticed, and the cross-area dedup's representative rule (fewest null
 * pointers) then systematically PREFERS a wrong-but-named anchor over a correct
 * null (lead) one.
 *
 * This stage re-derives each pointer from the doc's own content, with NO LLM and
 * NO prompt change (it runs at assembly, downstream of the overlap cache, so it
 * corrects fresh AND cached verdicts, and old committed corpora self-heal on the
 * next rescan). It is a pure function of the overlap NOTE + the pointed doc's
 * text: score every section of the pointed doc (the LEAD counted as a
 * null-heading candidate, per the lead definition below) by weighted token
 * overlap with the note, then KEEP the model's pointer when its section carries
 * meaningful signal and RE-ANCHOR only when the pointed section shares ~none of
 * the note's distinctive tokens while another section clearly does. When nothing
 * scores, the pointer is left untouched (least surprise). Verification runs
 * BEFORE dedup so duplicate records that disagreed on an anchor converge on the
 * verified one and the representative choice is trustworthy.
 */

import { normalizeQuote } from '@truecourse/shared';
import type { OverlapSection } from './corpus-types.js';

// ---------------------------------------------------------------------------
// Scoring / decision constants — principled, documented, never tuned to a repo
// ---------------------------------------------------------------------------

/**
 * A candidate section "carries meaningful signal" once its weighted overlap with
 * the note reaches this floor. On the idf scale below a token present in EVERY
 * section scores 0 and a token in ~one of eight sections scores ~2.17, so 1.5 is
 * roughly "one distinctive token, or two middling ones". Below it the note and
 * the section share only vocabulary generic to the doc — not enough to trust a
 * pointer, nor to justify moving one. Used as an absolute floor on BOTH sides:
 * the target must clear it to be a re-anchor destination, and the pointed section
 * is kept the moment it clears it (verification, not override-happiness).
 */
const MIN_MEANINGFUL_SCORE = 1.5;

/**
 * Re-anchor only when the pointed section's score is at most this fraction of the
 * best candidate's — it shares almost none of what makes the best section match
 * the note. A pointed section holding its own (a third of the best, half) is kept.
 * A quarter is deliberately strict: we move a pointer only when it is clearly
 * wrong, not merely beaten.
 */
const NEGLIGIBLE_RATIO = 0.25;

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

/**
 * Generic English function words + a few markdown-noise words, dropped before
 * scoring so only content-bearing tokens are compared. Not tuned to any repo —
 * these carry no topical signal in any document.
 */
const STOPWORDS = new Set<string>([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'to', 'in',
  'on', 'at', 'by', 'for', 'with', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'it', 'its', 'this', 'that', 'these', 'those', 'they', 'them', 'their',
  'there', 'here', 'no', 'not', 'yes', 'so', 'than', 'too', 'very', 'can', 'could',
  'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'do', 'does', 'did',
  'done', 'has', 'have', 'had', 'from', 'up', 'out', 'down', 'over', 'under', 'again',
  'we', 'you', 'your', 'our', 'us', 'i', 'he', 'she', 'his', 'her', 'each', 'any',
  'all', 'both', 'some', 'such', 'only', 'own', 'same', 'more', 'most', 'other',
  'into', 'about', 'when', 'where', 'which', 'who', 'whom', 'what', 'how', 'why',
  'per', 'via', 'also',
]);

/**
 * Content tokens from text: lowercase, strip markdown/code MARKERS (the backtick,
 * `*`, `_`, `~`, `#`, `>` characters — NOT the words inside them, so `` `rm` ``
 * keeps `rm`), split on any run of non-alphanumerics, then drop single-character
 * tokens, stopwords, and the supplied `drop` set (the doc-path words). Pure and
 * order-preserving; callers dedupe as needed.
 */
function tokenize(text: string, drop: Set<string>): string[] {
  const lowered = text.toLowerCase().replace(/[`*_~#>]/g, ' ');
  const out: string[] = [];
  for (const raw of lowered.split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue; // lone letters/digits are noise, not signal
    if (STOPWORDS.has(raw)) continue;
    if (drop.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

/**
 * The words in a doc path (`docs/SPEC.md` → `docs`, `spec`, `md`). Dropped from
 * scoring because the note names each doc by its filename ("README.md states…"),
 * so those tokens are addressing, not content.
 */
function pathWords(p: string): string[] {
  return p
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

// ---------------------------------------------------------------------------
// Section splitting — the lead definition
// ---------------------------------------------------------------------------

export interface DocSection {
  /**
   * The section's own heading text (verbatim), or `null` when it has none — a
   * true preamble section 0 (content before the first heading). An H1-lead keeps
   * its H1 text here so a pointer that correctly NAMES the opening heading still
   * resolves to section 0.
   */
  realHeading: string | null;
  /** All tokens in the section, heading included. */
  tokens: Set<string>;
  /** The section's raw text (heading line + body), for verbatim-quote location. */
  text: string;
}

const HEADING_RE = /^ {0,3}#{1,6}\s+(.*)$/;

/**
 * Split a doc into sections, each = a heading line + its body up to the next
 * heading. Section 0 is the doc's LEAD: the content before the first heading when
 * the doc has such a preamble, else the opening heading's own section (the common
 * README shape that starts with an H1). A pointer with a `null` heading targets
 * this section 0; a re-anchor TO section 0 is emitted as `null` — the canonical
 * lead pointer the viewer bands.
 *
 * Mirrors the viewer's `splitSections` so the anchor this stage picks is exactly
 * the band the viewer will highlight.
 *
 * Exported (with {@link locateQuote}) for the overlap session's in-session
 * anchor validation (`check_findings` in core's `services/spec-scan/`), which
 * refuses a fabricated heading or a non-verbatim quote before the outcome.
 * `drop` is the doc-path word set — pass `new Set()` when only structure (not
 * token scoring) is needed.
 */
export function splitDocSections(body: string, drop: Set<string>): DocSection[] {
  interface Raw { heading: string; text: string }
  const raws: Raw[] = [];
  let cur: Raw = { heading: '', text: '' };
  for (const line of body.split(/\r?\n/)) {
    const m = HEADING_RE.exec(line);
    if (m) {
      if (cur.text.trim() || cur.heading) raws.push(cur);
      cur = { heading: m[1].trim(), text: `${line}\n` };
    } else {
      cur.text += `${line}\n`;
    }
  }
  if (cur.text.trim() || cur.heading) raws.push(cur);

  return raws.map((r) => ({
    realHeading: r.heading === '' ? null : r.heading,
    tokens: new Set(tokenize(r.text, drop)),
    text: r.text,
  }));
}

/** Match key for a heading pointer vs a section heading — strip inline-code + emphasis markers, fold case. */
function headingKey(h: string): string {
  return h.replace(/[`*_~]/g, '').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Verbatim-quote location — the exact-match anchor
// ---------------------------------------------------------------------------

/**
 * Indices of the sections whose normalized text CONTAINS the normalized quote —
 * the exact locations of the disputed sentence. Empty when the quote is blank
 * after normalization or found nowhere (caller then falls back to token scoring).
 * Normalization is the shared {@link normalizeQuote} (one copy — the same key the
 * conflict-resolution dispute identity matches through).
 */
export function locateQuote(sections: DocSection[], quote: string): number[] {
  const needle = normalizeQuote(quote);
  if (!needle) return [];
  const hits: number[] = [];
  for (let i = 0; i < sections.length; i++) {
    if (normalizeQuote(sections[i].text).includes(needle)) hits.push(i);
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Weighted token-overlap score for each section against the note. The weight is
 * an idf-ish `log2((N+1)/(df+1))` clamped at 0, where N is the section count and
 * `df` the number of sections a token appears in: a token generic to the doc
 * (present in every section) scores 0, a distinctive one (in a single section)
 * scores highest. This is what down-weights "tasks" in a task tracker's README
 * so a Storage section that merely mentions `tasks.json` cannot masquerade as the
 * anchor for a note about deletion. Base 2 is arbitrary — it rescales every score
 * uniformly and the thresholds live on the same scale.
 */
function scoreSections(sections: DocSection[], noteTokens: Set<string>): number[] {
  const N = sections.length;
  const df = new Map<string, number>();
  for (const s of sections) for (const t of s.tokens) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string): number => {
    const d = df.get(t) ?? 0;
    if (d === 0) return 0;
    return Math.max(0, Math.log2((N + 1) / (d + 1)));
  };
  return sections.map((s) => {
    let score = 0;
    for (const t of noteTokens) if (s.tokens.has(t)) score += idf(t);
    return score;
  });
}

// ---------------------------------------------------------------------------
// Public: verify + re-anchor an overlap's section pointers
// ---------------------------------------------------------------------------

export interface VerifyPointersInput {
  /** The overlap's two docs, by ref — their filenames become drop tokens. */
  docs: readonly [string, string];
  /** The overlap note (the query the pointers are scored against). */
  note: string;
  /** The model's section pointers to verify. */
  sections: readonly OverlapSection[];
  /** Resolve a doc ref to its full markdown body; `undefined` when unresolvable. */
  bodyOf: (docRef: string) => string | undefined;
}

/**
 * Return the overlap's section pointers with each re-anchored where the model
 * clearly mis-anchored, and every other pointer left exactly as given. A pointer
 * is re-anchored to the best-scoring section only when its own section is BOTH
 * below the meaningful floor AND a negligible fraction of the best; a pointer
 * that carries real signal, or a doc where nothing scores, is kept untouched.
 * The lead is a candidate for every side (a `null` pointer's own candidate is the
 * lead), so a mis-anchored named pointer can move to the lead and vice versa.
 *
 * When the pointer carries a verbatim `quote`, verification FIRST tries to LOCATE
 * that quote by normalized substring across the sections. An exact hit anchors
 * with certainty — the pointer is kept when the model's own section is a hit
 * (keep-bias), else re-anchored to the hit — and the token scoring below is
 * skipped entirely. No quote, or a quote found nowhere, falls back to the token
 * overlap path unchanged.
 */
export function verifyOverlapSections(input: VerifyPointersInput): OverlapSection[] {
  const { docs, note, sections, bodyOf } = input;
  if (sections.length === 0) return [...sections];

  const drop = new Set<string>([...pathWords(docs[0]), ...pathWords(docs[1])]);
  const noteTokens = new Set(tokenize(note, drop));

  return sections.map((ptr) => {
    const body = bodyOf(ptr.doc);
    if (body === undefined) return { ...ptr };

    const candidates = splitDocSections(body, drop);
    if (candidates.length === 0) return { ...ptr };

    // The candidate the model pointed at: the lead (section 0) for a null pointer,
    // else the first section whose heading matches (which can be the lead when it
    // is an H1 named correctly). A named pointer to a section that doesn't exist
    // (a hallucinated heading) resolves to -1.
    let pointedIdx: number;
    if (ptr.heading === null) {
      pointedIdx = 0;
    } else {
      const key = headingKey(ptr.heading);
      pointedIdx = candidates.findIndex((c) => c.realHeading !== null && headingKey(c.realHeading) === key);
    }

    // Quote-first: an exact verbatim location beats token scoring. The pointed
    // section winning a tie (it holds the quote) keeps the pointer; otherwise
    // anchor to the first hit in document order (deterministic).
    if (ptr.quote !== undefined) {
      const hits = locateQuote(candidates, ptr.quote);
      if (hits.length > 0) {
        if (pointedIdx >= 0 && hits.includes(pointedIdx)) return { ...ptr };
        const target = hits[0];
        return { ...ptr, heading: target === 0 ? null : candidates[target].realHeading };
      }
      // Quote found nowhere → fall through to token scoring.
    }

    if (noteTokens.size === 0) return { ...ptr };
    const scores = scoreSections(candidates, noteTokens);

    let bestIdx = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[bestIdx]) bestIdx = i;
    const bestScore = scores[bestIdx];
    const pointedScore = pointedIdx >= 0 ? scores[pointedIdx] : 0;

    const reanchor =
      bestIdx !== pointedIdx &&
      bestScore >= MIN_MEANINGFUL_SCORE &&
      pointedScore < MIN_MEANINGFUL_SCORE &&
      pointedScore <= NEGLIGIBLE_RATIO * bestScore;

    if (!reanchor) return { ...ptr };
    // Re-anchor. Section 0 is the lead → the canonical `null` pointer; every other
    // section carries a real heading. The quote (if any) rides along unchanged.
    return { ...ptr, heading: bestIdx === 0 ? null : candidates[bestIdx].realHeading };
  });
}
