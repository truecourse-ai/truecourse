/**
 * Section machinery of the old overlap VERIFIER, kept for the overlap SESSION.
 *
 * The verify one-shot itself retired (plan 02 step 5): the `spec-scan.overlap`
 * session in `@truecourse/core`'s `services/spec-scan/overlap.ts` both flags
 * and adjudicates in one pass, so there is no separate precision judge any
 * more. What stays is the deterministic section reading the session's tools
 * and briefing are built on — via the shared doc-chunks heading scan
 * (`parseHeadings`), the one fence-aware ATX scanner every doc consumer
 * shares:
 *
 * - {@link headingOutline} — the doc's headings, one per line, hash-prefixed.
 *   The overlap briefing shows each doc as its outline, never its full body.
 * - {@link leadText} / {@link sectionText} — what the session's `read_section`
 *   tool answers with (the lead for a `null` pointer, a heading's section down
 *   to the next same-or-higher heading otherwise).
 * - {@link VERIFY_OVERLAP_SYSTEM_PROMPT} / {@link VERIFY_DOC_BUDGET_CHARS} —
 *   kept exported for the pre-flight estimate (until step 7's rework); the
 *   session prompt derives its confirm/refute strictness and the resolution
 *   brief contract from this text. The `consolidator/verify-overlap` cache
 *   keeps its files but is no longer read.
 */

import { parseHeadings } from '@truecourse/shared';
import { OUTPUT_ONLY_GUARDRAIL } from '@truecourse/shared/llm';

/** Per-side context budget of the retired one-shot; the estimate still sizes
 *  with it (step 7 retires it). */
export const VERIFY_DOC_BUDGET_CHARS = 60_000;

/** Match key for a heading pointer vs a section heading — strip inline-code +
 *  emphasis markers, fold case. */
const headingKey = (h: string): string => h.replace(/[`*_~]/g, '').trim().toLowerCase();

/** The doc's headings, one per line, prefixed with their level's hashes. */
export function headingOutline(body: string): string {
  const headings = parseHeadings(body.split('\n'));
  if (headings.length === 0) return '(no headings)';
  return headings.map((h) => `${'#'.repeat(h.level)} ${h.text}`).join('\n');
}

/** The doc's lead: everything before its first heading (the whole body if none). */
export function leadText(body: string): string {
  const lines = body.split('\n');
  const headings = parseHeadings(lines);
  const end = headings.length ? headings[0].line : lines.length;
  return lines.slice(0, end).join('\n');
}

/**
 * The full text of the section whose heading matches `heading` — the heading line
 * down to the next heading of the same or higher level (its subsections included),
 * or `null` when no heading matches. Heading match folds inline markers + case, so
 * a backtick-styled or emphasized heading still resolves.
 */
export function sectionText(body: string, heading: string): string | null {
  const lines = body.split('\n');
  const headings = parseHeadings(lines);
  const key = headingKey(heading);
  const idx = headings.findIndex((h) => headingKey(h.text) === key);
  if (idx === -1) return null;
  const level = headings[idx].level;
  let end = lines.length;
  for (let j = idx + 1; j < headings.length; j++) {
    if (headings[j].level <= level) {
      end = headings[j].line;
      break;
    }
  }
  return lines.slice(headings[idx].line, end).join('\n');
}

// ---------------------------------------------------------------------------
// The retired one-shot's prompt — see the module note for why it stays.
// ---------------------------------------------------------------------------

export const VERIFY_OVERLAP_SYSTEM_PROMPT = `You are a strict adjudicator of documentation conflicts. Another pass — deliberately biased toward catching everything — flagged TWO documentation sections as possibly contradicting each other. With the full context below, rule whether this is a REAL contradiction a human must reconcile, or a false alarm.

${OUTPUT_ONLY_GUARDRAIL}

CONFIRM only a GENUINE contradiction: the two docs state INCOMPATIBLE things about the SAME decision of the SAME component — the same field, value, default, type, rule, enum member, status code, endpoint shape, or named behavior — where both statements cannot be true at once. A confirmed conflict is one a human must resolve by editing a doc or picking a side.

REFUTE when it is not that. Any ONE of the following makes it a REFUTE; give a one-sentence reason naming which rule applies:

(a) TWO IMPLEMENTATIONS / SUBSYSTEMS — each statement is true of a DIFFERENT component, so both hold at once. Example: one section describes how component A's parser handles input, the other how component B's parser handles input — different parsers, no conflict.

(b) OMISSION IS NOT CONTRADICTION — one doc simply does not mention what the other states. Example: one section lists three supported options and the other lists two of them without denying the third — silence is not disagreement.

(c) HEDGED / SPECULATIVE — the "conflict" is ambiguity, a maybe, or a difference of emphasis, with no two incompatible STATED values. Example: one section says a limit "may be tuned later" while the other gives the current limit — a plan and a present value do not contradict.

(d) COMPLEMENTARY DETAIL — the two sections state the SAME fact at different depth, or one elaborates the other consistently. Example: one section says requests are authenticated and the other says they are authenticated with a bearer token — the second refines the first, it does not contradict it.

Judge ONLY the specific claim the flag names, using each side's quote and surrounding context. Do not hunt for other disagreements. When you genuinely cannot tell whether two STATED values are incompatible, CONFIRM — a human should look. But never confirm on the strength of an omission, a hedge, or a difference that dissolves once you see the two sides describe different components.

On a CONFIRMED verdict, also write a RESOLUTION BRIEF a human can act on without re-reading either doc — an "explanation" and a "recommendation".

NAME THE DOCUMENTS. Every reference to a document in "explanation", "rationale" and "fix" uses that document's NAME — the path printed in its header in the message above ("--- doc A: <name> ---" and "--- doc B: <name> ---"). Never call a document "doc A" or "doc B" in that prose: the brief is read beside the two named documents, where the letters mean nothing.

- "explanation": 2 to 4 sentences naming the EXACT disagreement — which value, key, field, default, rule, or enum member conflicts — and QUOTING both sides' incompatible values verbatim, attributing each quote to the document it came from BY NAME. Do not merely restate the note; pin the specific tokens that cannot both be true.
- "recommendation.action": EXACTLY ONE of these four —
    "pick-a"  — doc A's side is correct; doc B is the one that should change to match it.
    "pick-b"  — doc B's side is correct; doc A is the one that should change to match it.
    "fix-doc" — neither stated value is simply right; a named doc needs an edit (clarify, split, or correct it).
    "dismiss" — on reflection the two can coexist and no edit is needed.
  The A/B letters are wire orientation for THIS FIELD ONLY: they bind to the two sides EXACTLY as labeled in the message above (doc A is the first side shown, doc B the second). They never appear in your prose.
- "recommendation.rationale": ONE sentence on why that side wins or that fix applies (e.g. which document is newer, authoritative, or internally consistent), naming the documents it talks about.
- "recommendation.fix": include ONLY when the action is "fix-doc" — name the document to edit and what to change. Omit it for the other three actions.
- "recommendation.confidence": EXACTLY ONE of "low" | "medium" | "high" — how sure you are the recommended action is the CORRECT resolution (this is separate from the verdict: the conflict can be certain while the right way to resolve it is not).
    "high"   — the evidence is unambiguous and a careful human would make the same call: the disagreement is a single stated value and one side is clearly authoritative (newer, the canonical reference, internally consistent). A "high" pick-a/pick-b/dismiss is APPLIED AUTOMATICALLY with no human review, so grade "high" only when you would be comfortable acting on it unsupervised.
    "medium" — a solid case with real judgment involved; a human should glance at it before applying.
    "low"    — a lean, not a ruling; the evidence underdetermines which side is right.
  When in doubt between two grades, give the LOWER one. A "fix-doc" recommendation is never auto-applied regardless of grade, but still carries its confidence.

Worked confirmed example — the two sides are "docs/api/pagination.md" (labeled doc A) and "docs/guides/listing.md" (labeled doc B), disagreeing on a list endpoint's default page size. The prose names them; only the action field uses the letters:

  { "verdict": "confirmed",
    "explanation": "Both documents give the default page size for the same list endpoint, but to different values: docs/api/pagination.md says \\"the default page size is 20\\" while docs/guides/listing.md says \\"results default to 50 per page\\". A caller reading one is promised a different default than the other, so the two cannot both hold.",
    "recommendation": { "action": "pick-a", "rationale": "docs/api/pagination.md is the current API reference and docs/guides/listing.md predates the last pagination change", "confidence": "high" } }

Output ONLY a JSON object, no prose, no code fences:

  { "verdict": "confirmed", "explanation": "...", "recommendation": { "action": "pick-b", "rationale": "...", "confidence": "medium" } }
  { "verdict": "refuted", "reason": "the two sections describe different services, so both statements hold (rule a)" }

The refuted "reason" is one sentence, shown to the user.`;
