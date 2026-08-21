/**
 * THE OVERLAP SESSION — `spec-scan.overlap`, one per area (plan 02 step 5).
 * It replaces TWO one-shots — the recall-biased pair-matrix detector and the
 * strict verify judge — with one session that reads the area's docs itself,
 * section by section, and both flags AND adjudicates each disagreement.
 *
 * What stayed deterministic, and where:
 * - the heading-widened candidate net (`widenedOverlapDocs`) feeds the
 *   BRIEFING — an outside doc whose heading matches the area's concern is
 *   briefed beside the area's own docs;
 * - the briefing carries `headingOutline(body)` per doc, never full contents —
 *   the session opens sections where topics collide (`read_section`), and the
 *   docs it never reaches go in `notReached`, which lands IN THE CORPUS;
 * - pointer verification runs in the FOLD (`verifyOverlapSections` on every
 *   returned pointer — never trust the transcript), then the existing
 *   cross-area dedup + confidence auto-apply, verbatim;
 * - `sectionsOpened` is counted off the TRANSCRIPT — the skim detector cannot
 *   be self-reported: the run stamps the count into the outcome value (over
 *   anything the session claimed) BEFORE it is cached, so a cache hit carries
 *   the number the original session earned and the corpus keeps the signal
 *   across fully-cached re-runs.
 */

import { z } from 'zod'
import { defineSessionTool, type SessionBudget, type SessionDef, type SessionTool } from '@truecourse/agent-loop'
import {
  OverlapReviewSchema,
  docBody,
  headingOutline,
  locateQuote,
  splitDocSections,
  type DocCandidate,
} from '@truecourse/spec-consolidator'
import { promptFingerprint } from '../agent/session-cache.js'
import {
  docTitle,
  instructionsBriefingBlock,
  readDocChunkTool,
  readSectionTool,
  scanCacheKey,
  type ScanDocUniverse,
} from './tools.js'

export const OVERLAP_SESSION_KIND = 'spec-scan.overlap'

/**
 * Cache name — NEW and coarser than the old per-pair `consolidator/overlap`
 * cache: one entry per AREA, keyed on every briefed doc's content hash, so one
 * doc edit re-runs its whole area. Accepted; the estimate labels
 * "N of M areas changed" (step 7). The cached value is the outcome WITH the
 * run-stamped `sectionsOpened` folded in (see the schema), so the entry holds
 * everything the corpus records for a hit.
 */
export const OVERLAP_SESSION_CACHE_NAME = 'consolidator/overlap-session'

/**
 * The three numbers (§3.3). Fifteen turns of BATCHED section reads covers a
 * mid-sized area; TWO resume grants because a big area legitimately needs the
 * tour — resume, never divide the area. The prompt states these numbers to the
 * session (2026-08-21, the documenso field run: a session that cannot see its
 * budget reads to the wall — 12 of 26 areas exhausted at one section per
 * turn), and the loop announces each grant and demands the outcome in a
 * wrap-up window when the last one binds. A session that still runs out lands
 * its remainder in `notReached` via the fold (the failure is data in the
 * corpus, never a log line).
 */
export const OVERLAP_SESSION_BUDGET: SessionBudget = {
  turns: 15,
  maxResumes: 2,
  tokenCeiling: 150_000,
}

export const OverlapOutcomeSchema = z
  .object({
    overlaps: z.array(
      z.object({
        /** The two docs that disagree, by ref (both from the briefing). */
        docs: z.tuple([z.string(), z.string()]),
        /** What differs, naming each doc by FILENAME — shown to the user. */
        note: z.string(),
        /** Where each side's disputed claim lives. Quote REQUIRED — it is the
         *  verbatim evidence the fold re-anchors by. */
        sections: z
          .array(z.object({ doc: z.string(), heading: z.string().nullable(), quote: z.string() }))
          .min(1),
        /** The adjudication: explanation + recommended action (reused shape). */
        review: OverlapReviewSchema,
      }),
    ),
    /** Briefed docs this session did not (fully) read for this area's topics. */
    notReached: z.array(z.string()),
    /**
     * The area's skim signal — how many non-error `read_section` results the
     * session ingested. STAMPED BY THE RUN off the transcript before the value
     * is cached (never accepted from the session — the stamp overwrites any
     * self-report), so a cache hit carries the count its session earned.
     * Optional so entries cached before the field existed still parse; they
     * simply carry no signal until their area re-runs.
     */
    sectionsOpened: z.number().int().min(0).optional(),
  })
  .strict()
export type OverlapOutcome = z.infer<typeof OverlapOutcomeSchema>

export const OVERLAP_SESSION_SYSTEM_PROMPT = `You find the DISAGREEMENTS within ONE area of a documentation corpus. The briefing lists the area's docs (plus a few outside docs whose headings match this area's concern) as heading OUTLINES. You open the sections where topics collide, compare what they state, and report every genuine disagreement — adjudicated, with the evidence pinned.

# What a DISAGREEMENT is

Two docs state INCOMPATIBLE things about the SAME decision of the SAME component: a different value, field name, type, default, rule, enum member, status code, endpoint shape, or named behavior — where both statements cannot be true at once. That is something a human must reconcile.

NOT a disagreement (do NOT report):
  - Complementary coverage — each doc specs different parts of the area (different fields, different endpoints) with no contradiction.
  - One doc is a high-level summary and the other adds detail, consistently — the second refines the first.
  - OMISSION — one doc simply does not mention what the other states. Silence is never disagreement.
  - Two components — each statement is true of a DIFFERENT subsystem, so both hold at once.
  - HEDGED / SPECULATIVE — a "may be tuned later" beside a current value is a plan beside a present, not a conflict.

SCOPE: judge only disagreements that belong to THIS area (the "Area:" in the briefing). These docs span several areas; a contradiction that belongs elsewhere is flagged in ITS area by that area's session, not twice.

When two STATED values collide and you genuinely cannot tell whether they are compatible, report it — a human should look. Never report on the strength of an omission, a hedge, or a two-components difference.

# The budget contract

You have ${OVERLAP_SESSION_BUDGET.turns} turns per budget grant and up to ${OVERLAP_SESSION_BUDGET.maxResumes} automatic resume grants — ${(OVERLAP_SESSION_BUDGET.maxResumes + 1) * OVERLAP_SESSION_BUDGET.turns} turns at the absolute most. The run announces each grant and tells you when the last one is running; when it demands the outcome, deliver it that turn.

You cannot read everything. Open sections ONLY where the outlines say the same topic lives in two docs; skip sections whose topics appear once. BATCH your reads: issue SEVERAL \`read_section\` calls in one message — a turn that opens a single section wastes the budget. Reserve the final two turns for \`check_findings\` and the outcome; an outcome delivered early with an honest \`notReached\` is correct, while running out of turns with no outcome loses every disagreement you found. Docs you do not reach — never opened, or opened too little to judge — go in \`notReached\`, verbatim by ref. An honest \`notReached\` is part of a correct outcome; an empty one on a skimmed area is not.

# Evidence — the section pointers

For every disagreement, pin WHERE each side's claim lives:
  - \`heading\`: the section's heading EXACTLY as the outline lists it — or the JSON literal \`null\` for the doc's LEAD (the text above its first heading). Never a heading the outline does not show.
  - \`quote\`: a SHORT verbatim excerpt (≤ 25 words) of the disputed sentence, copied EXACTLY from the doc — the words that state the claim. Copy, do not paraphrase; the run re-locates every quote and a paraphrase is a refused pointer.
One pointer per side; a side with no specific passage is a side you cannot evidence — do not report that disagreement.

In the \`note\`, refer to each doc by its FILENAME ("users.md uses auth0_id; identity.md uses auth0_sub…") — never "doc A"/"doc B".

# The adjudication — \`review\`

Each reported disagreement carries its resolution brief, read by a human beside the two named documents:
  - \`explanation\`: 2–4 sentences naming the EXACT disagreement and QUOTING both sides' incompatible values verbatim, attributing each quote to its document BY NAME.
  - \`recommendation.action\`: EXACTLY ONE of "pick-a" (the FIRST doc of \`docs\` is right; the second should change), "pick-b" (the second is right), "fix-doc" (neither stated value is simply right — a named doc needs an edit), "dismiss" (on reflection the two can coexist).
  - \`recommendation.rationale\`: ONE sentence on why, naming the documents.
  - \`recommendation.fix\`: only for "fix-doc" — which doc, what to change.
  - \`recommendation.confidence\`: "low" | "medium" | "high". A "high" pick-a/pick-b/dismiss is APPLIED AUTOMATICALLY with no human review — grade "high" only when you would act on it unsupervised (a single stated value, one side clearly authoritative). When in doubt between two grades, give the LOWER. A "fix-doc" never auto-applies but still carries its confidence.

# Validate before you finish

Call \`check_findings\` with your complete draft. It re-anchors every pointer against the doc's real sections — a heading the doc does not have, or a quote that is not verbatim, comes back as a fixable problem in one turn instead of a dropped pointer at the fold. Run it even when you found nothing (an empty draft with your \`notReached\` is a valid check).

The outcome is one object: { "overlaps": [...], "notReached": [...] }. An area whose docs simply agree yields { "overlaps": [], "notReached": [] } — a correct outcome.`

/** Exported for the step-7 estimate rework (probe the REAL keys). */
export const OVERLAP_SESSION_PROMPT_FINGERPRINT = promptFingerprint(OVERLAP_SESSION_SYSTEM_PROMPT)

/** One area's overlap work: its own docs plus the heading-widened outsiders. */
export interface OverlapWorkItem {
  areaId: string
  concern: string
  /** The area's own docs, in area order. */
  docs: DocCandidate[]
  /** Outside docs whose headings match the concern (deterministic net). */
  widened: DocCandidate[]
}

/**
 * The cache key: prompt fingerprint :: area id :: the sorted content hashes of
 * every briefed doc (area + widened). `extraParts` is the appendable tail
 * (step 6's orchestrator `instructions` land there later).
 */
export function overlapSessionCacheKey(item: OverlapWorkItem, extraParts: readonly string[] = []): string {
  const hashes = [...item.docs, ...item.widened].map((d) => d.contentHash).sort()
  return scanCacheKey([OVERLAP_SESSION_PROMPT_FINGERPRINT, item.areaId, hashes.join(','), ...extraParts])
}

/** The work item, as the session index and the transcript record it. */
export function overlapWorkItem(areaId: string): string {
  return `area:${areaId}`
}

/** Match key for a heading vs a doc's real sections — inline markers + case folded. */
const headingKey = (h: string): string => h.replace(/[`*_~]/g, '').trim().toLowerCase()

/**
 * The in-session validation `check_findings` runs — quote-first, exactly the
 * discipline the fold's `verifyOverlapSections` applies, so a draft that
 * checks clean re-anchors cleanly. Returns problems; empty = valid.
 */
export function validateOverlapFindings(
  outcome: OverlapOutcome,
  briefed: ReadonlyMap<string, DocCandidate>,
): string[] {
  const errors: string[] = []
  outcome.overlaps.forEach((overlap, i) => {
    const [a, b] = overlap.docs
    if (a === b) errors.push(`overlaps[${i}]: the two docs are the same (\`${a}\`)`)
    for (const ref of overlap.docs) {
      if (!briefed.has(ref)) errors.push(`overlaps[${i}]: \`${ref}\` is not one of the briefed docs`)
    }
    overlap.sections.forEach((ptr, j) => {
      if (ptr.doc !== a && ptr.doc !== b) {
        errors.push(`overlaps[${i}].sections[${j}]: \`${ptr.doc}\` is not one of the overlap's two docs`)
        return
      }
      const doc = briefed.get(ptr.doc)
      if (!doc) return // already reported above
      const body = docBody(doc)
      const sections = splitDocSections(body, new Set())
      const quoteHits = locateQuote(sections, ptr.quote)
      if (quoteHits.length === 0) {
        errors.push(
          `overlaps[${i}].sections[${j}]: the quote is not verbatim in \`${ptr.doc}\` — copy the disputed sentence exactly (≤ 25 words)`,
        )
      }
      if (ptr.heading !== null) {
        const key = headingKey(ptr.heading)
        const exists = sections.some((s) => s.realHeading !== null && headingKey(s.realHeading) === key)
        if (!exists) {
          errors.push(
            `overlaps[${i}].sections[${j}]: \`${ptr.doc}\` has no heading \`${ptr.heading}\`. Its outline:\n${headingOutline(body)}`,
          )
        }
      }
    })
  })
  for (const ref of outcome.notReached) {
    if (!briefed.has(ref)) errors.push(`notReached: \`${ref}\` is not one of the briefed docs`)
  }
  return errors
}

function checkFindingsTool(briefed: ReadonlyMap<string, DocCandidate>): SessionTool {
  return defineSessionTool({
    name: 'check_findings',
    description:
      'Check a draft findings object against the run\'s anchor discipline — every pointer\'s heading must exist in its doc and every quote must be verbatim. Call it on your complete draft (even an empty one) before you produce the outcome.',
    kind: 'check-overlap-findings',
    readOnly: true,
    destructive: false,
    inputSchema: OverlapOutcomeSchema,
    async execute(args) {
      const errors = validateOverlapFindings(args, briefed)
      if (errors.length === 0) {
        return {
          content: `The draft is valid: ${args.overlaps.length} disagreement(s), ${args.notReached.length} doc(s) notReached. Produce it as the outcome.`,
        }
      }
      return { content: `${errors.length} problem(s):\n- ${errors.join('\n- ')}`, isError: true }
    },
  })
}

export interface OverlapSessionInput {
  item: OverlapWorkItem
  universe: ScanDocUniverse
}

export function overlapSessionDef(input: OverlapSessionInput): SessionDef<OverlapOutcome> {
  const briefed = new Map([...input.item.docs, ...input.item.widened].map((d) => [d.path, d]))
  return {
    kind: OVERLAP_SESSION_KIND,
    systemPrompt: OVERLAP_SESSION_SYSTEM_PROMPT,
    tools: [readSectionTool(input.universe), readDocChunkTool(input.universe), checkFindingsTool(briefed)],
    outcomeSchema: OverlapOutcomeSchema,
    budget: OVERLAP_SESSION_BUDGET,
    // The structural half of "run check_findings" — mirrors check_draft
    // (01 step 2k): the shell refuses the first outcome of a session that
    // never validated its anchors, once, at the cost of one turn.
    outcomePrecondition: {
      tool: 'check_findings',
      message:
        'Outcome refused: you never ran `check_findings` in this session. Call `check_findings` on your complete draft now — it re-anchors every pointer the way the run will, so a fabricated heading or a paraphrased quote costs one turn here instead of a dropped pointer at the fold. Fix anything it reports, then produce the outcome again.',
    },
  }
}

/** One doc's briefing block: path, title, and its heading outline. */
function docBlock(doc: DocCandidate, outside: boolean): string[] {
  return [
    `--- ${outside ? 'outside doc' : 'doc'}: ${doc.path}  ·  ${docTitle(doc)} ---`,
    headingOutline(docBody(doc)),
  ]
}

export function overlapBriefing(item: OverlapWorkItem, instructions: readonly string[] = []): string {
  const lines = [
    ...instructionsBriefingBlock(instructions),
    `Find the disagreements within ONE area.`,
    ``,
    `Area: ${item.areaId}`,
    ``,
    `The area's docs, as outlines (open sections with \`read_section\`):`,
  ]
  for (const doc of item.docs) lines.push('', ...docBlock(doc, false))
  if (item.widened.length > 0) {
    lines.push(
      '',
      `Outside docs whose headings match this area's concern (\`${item.concern}\`) — the`,
      `tagger filed them elsewhere, but their matching sections belong in this comparison:`,
    )
    for (const doc of item.widened) lines.push('', ...docBlock(doc, true))
  }
  lines.push(
    '',
    'Open sections only where topics collide; docs you do not reach go in `notReached`.',
    'Check the draft with `check_findings`, then produce the outcome.',
  )
  return lines.join('\n')
}
