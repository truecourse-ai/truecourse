/**
 * The RETIRED overlap detector's prompt constants. Two generations of this
 * module's machinery are gone:
 *
 * - the LLM pair-matrix runner (`flagOverlaps` + the window matrix) retired
 *   when the `spec-scan.overlap` SESSION took over flag-and-adjudicate in one pass;
 * - the heading-widened doc net (`hasConcernHeading` / `widenedOverlapDocs`)
 *   retired — the deterministic collision
 *   pairing (`collision-pairing.ts`) applies the same canonical-heading fold at
 *   SECTION level across the whole kept corpus, which subsumes doc-level
 *   widening entirely.
 *
 * What remains is documentary: {@link OVERLAP_DETECTOR_SYSTEM_PROMPT} /
 * {@link OVERLAP_WINDOW_CHARS}, the text the session prompt's disagreement
 * rules were derived from. The `consolidator/overlap` cache keeps its files but
 * is no longer read.
 */

import { OUTPUT_ONLY_GUARDRAIL } from '@truecourse/shared/llm';

/** Max chars of one doc shown per judge call in the retired one-shot; the
 *  estimate still models the old window matrix with it (step 7 retires it). */
export const OVERLAP_WINDOW_CHARS = 24_000;

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
