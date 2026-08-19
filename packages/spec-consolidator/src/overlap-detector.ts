/**
 * OVERLAP candidate widening — the deterministic net of the old per-pair
 * overlap detector, which the `spec-scan.overlap` SESSION (plan 02 step 5, in
 * `@truecourse/core`'s `services/spec-scan/overlap.ts`) now judges against.
 *
 * The LLM pair-matrix runner retired with the sessions: one session per AREA
 * reads the area's docs (plus the widened candidates below) itself, section by
 * section, and both flags AND adjudicates in one pass — replacing this stage's
 * flagOverlaps and the verifier's verifyFlaggedOverlaps.
 *
 * What stays is what was never a call:
 * - {@link widenedOverlapDocs} — the heading-widened candidate net. The tagger
 *   labels each doc independently, so the same subject can land under
 *   different concerns across docs (a broad PRD's `## Pagination` tagged
 *   `core/api-conventions`, a focused note tagged `core/pagination`), and the
 *   pair would never share an area to be compared. Any OUTSIDE doc whose
 *   markdown heading slug-matches an area's concern joins that area's overlap
 *   briefing. Pure string work, feeds the session briefing.
 * - {@link OVERLAP_DETECTOR_SYSTEM_PROMPT} / {@link OVERLAP_WINDOW_CHARS} —
 *   kept exported for the pre-flight estimate (until step 7's rework); the
 *   session prompt derives its disagreement rules from this text. The
 *   `consolidator/overlap` cache keeps its files but is no longer read.
 */

import { OUTPUT_ONLY_GUARDRAIL } from '@truecourse/shared/llm';
import { docBody, type DocCandidate } from './discovery.js';
import { canonicalizeConcern, isProcessArea } from './corpus-types.js';
import type { VocabMap } from './corpus-types.js';

/** Max chars of one doc shown per judge call in the retired one-shot; the
 *  estimate still models the old window matrix with it (step 7 retires it). */
export const OVERLAP_WINDOW_CHARS = 24_000;

/**
 * ATX markdown heading texts (`#`…`######` lines) from a doc body. The leading
 * (and optional trailing) hashes are dropped and inline emphasis / code markers
 * stripped, so `## \`Pagination\` ##` and `### **Auth**` yield `Pagination` /
 * `Auth`. Setext (underline) headings and fenced-code `#` lines are ignored.
 */
function extractHeadings(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[1].replace(/[`*_~]/g, '').trim();
    if (text) out.push(text);
  }
  return out;
}

/**
 * Whether any of the doc's headings canonicalizes to `concern` — the same
 * slug/alias/vocab fold the grouper applies to an area's concern axis, so a
 * heading `Authentication` matches the `auth` concern and `Pagination` matches
 * `pagination`.
 */
export function hasConcernHeading(doc: DocCandidate, concern: string, vocab?: VocabMap): boolean {
  for (const heading of extractHeadings(docBody(doc))) {
    if (canonicalizeConcern(heading, vocab) === concern) return true;
  }
  return false;
}

/**
 * The OUTSIDE docs an area's overlap session must also read: every doc NOT in
 * the area whose markdown heading slug-matches the area's concern. Empty for
 * process areas, whose concerns (overview/goals/…) name generic structural
 * sections, not behavior. Order follows `docs` (discovery order), so briefings
 * are deterministic.
 */
export function widenedOverlapDocs(
  area: { id: string; concern: string; docRefs: readonly string[] },
  docs: readonly DocCandidate[],
  vocab?: VocabMap,
): DocCandidate[] {
  if (isProcessArea(area.id)) return [];
  const inArea = new Set(area.docRefs);
  return docs.filter((d) => !inArea.has(d.path) && hasConcernHeading(d, area.concern, vocab));
}

// ---------------------------------------------------------------------------
// The retired one-shot's prompt — see the module note for why it stays.
// ---------------------------------------------------------------------------

export const OVERLAP_DETECTOR_SYSTEM_PROMPT = `You compare TWO documentation files that both cover the same AREA of a software system and decide whether they may DISAGREE.

${OUTPUT_ONLY_GUARDRAIL}

DISAGREE = the two docs state different things about the SAME specific decision: a different value, field name, type, default, rule, enum member, status code, endpoint shape, or named behavior. That is something a human must reconcile.

SCOPE — judge ONLY disagreements that belong to THIS area (the "Area:" named in the message below). These docs usually span several areas and may also disagree on topics that belong ELSEWHERE; ignore those here — each is flagged in the area it belongs to, not twice. If the only contradiction you find is outside this area's concern, return overlap:false.

NOT a disagreement (do NOT flag):
  - Complementary coverage — each doc specs different parts of the area (different fields, different endpoints) with no contradiction.
  - One doc is a high-level summary and the other adds detail, consistently.
  - Identical or trivially compatible statements.

Bias: when there is a PLAUSIBLE contradiction a human should check, flag it. When the docs are clearly complementary or agree, do not.

When you flag an overlap, point at WHERE each side's disputed claim lives. Below each doc you are given a CLOSED list of that doc's section options — its headings, plus a "lead" option. Do NOT recall or guess a heading; SELECT from the list. For EACH side output a pointer with two fields:
  - \`heading\`: EXACTLY one of that doc's listed section headings, copied verbatim — OR the JSON literal \`null\` (not the string "null", not "") for the LEAD, the text ABOVE its first heading (or, when the doc opens straight with a title, that opening title block). Never emit a heading that is not one of the listed options.
  - \`quote\`: a SHORT verbatim excerpt (≤ 25 words) of the disputed sentence, copied EXACTLY from that doc — the words that state the claim in dispute. This is your evidence for the heading you picked; copy it, do not paraphrase.
List one entry per side; omit a side only when it genuinely has no conflicting passage.

PREAMBLE: use \`heading\`: \`null\` ONLY for that lead/preamble block; whenever the disputed passage is under a listed heading, select that heading verbatim.

PARTS — a long doc is shown to you ONE SLICE at a time; a header reading "(part k/n)" means other parts of that doc EXIST but are NOT shown here. When either doc is labeled "part k/n":
  - NEVER flag that it omits, lacks, is missing, or stops short of something — the rest may live in a part you cannot see.
  - Flag ONLY when BOTH shown texts EXPLICITLY STATE things that differ (a different value, name, or rule). Silence in one part is never a disagreement.

In the NOTE, refer to each doc by its FILENAME (the basename shown in the header, e.g. \`users.md\`) — NEVER "doc A" / "doc B", which mean nothing to the reader.

Output ONLY a JSON object, no prose, no code fences:

{ "overlap": true,
  "note": "users.md uses auth0_id; identity.md uses auth0_sub for the same user column",
  "sections": [
    { "side": "A", "heading": "User model", "quote": "the auth0_id column stores the Auth0 subject" },
    { "side": "B", "heading": "Identity", "quote": "we persist the Auth0 subject in auth0_sub" }
  ] }

Preamble example — doc A's disputed claim is a README tagline ABOVE its first heading, so its side uses \`heading\`: null and quotes that tagline verbatim:

{ "overlap": true,
  "note": "README.md lists C# as a supported language in the preamble; plan.md's Tech Stack omits it",
  "sections": [
    { "side": "A", "heading": null, "quote": "Supports TypeScript, Python, and C# out of the box" },
    { "side": "B", "heading": "Tech Stack", "quote": "The stack is TypeScript and Python" }
  ] }

Use { "overlap": false, "note": "", "sections": [] } when they are complementary or agree. The note is shown to the user — name the specific thing that differs.`;
