/**
 * THE OVERLAP SESSION — `spec-scan.overlap`, one per COLLISION CLUSTER.
 * It replaces
 * TWO one-shots — the recall-biased pair-matrix detector and the strict
 * verify judge — with sessions that read the disputed sections themselves
 * and both flag AND adjudicate each disagreement.
 *
 * Item 119 moved RETRIEVAL out of the LLM: the deterministic collision
 * pairing (`@truecourse/spec-consolidator`'s `deriveCollisionPairs`)
 * nominates section pairs that share rare claim tokens or a canonical
 * heading, each pair is assigned to exactly ONE area, and the pairs
 * cluster into connected components — ONE SESSION PER CLUSTER, so spend
 * tracks real collisions, never corpus size, and a 60-doc area no longer
 * dilutes one session's budget (the 2026-08-21 documenso run reached
 * ~25% of its biggest areas' docs).
 *
 * What stays deterministic, and where:
 * - the CANDIDATE CHECKLIST leads the briefing — ranked pairs with their
 *   shared signals — beside the cluster docs' `headingOutline`s (never
 *   full contents); the session opens both sides of each pair
 *   (`read_section`) and may flag any other disagreement it notices
 *   between the briefed docs;
 * - pointer verification runs in the FOLD (`verifyOverlapSections` on
 *   every returned pointer — never trust the transcript), then the
 *   existing cross-area dedup + confidence auto-apply, verbatim;
 * - `sectionsOpened` AND `uncheckedPairs` are stamped off the TRANSCRIPT
 *   — a self-report cannot mark a pair checked: a briefed pair counts as
 *   examined only when the transcript shows BOTH its sections opened.
 *   The run stamps both into the outcome value BEFORE it is cached, so a
 *   cache hit carries what the original session earned, and a pair
 *   nobody examined lands IN THE CORPUS (`Area.uncheckedPairs`).
 */

import { z } from 'zod'
import {
  defineSessionTool,
  type DisplayDispute,
  type OutcomeBlock,
  type SessionBudget,
  type SessionDef,
  type SessionTool,
} from '@truecourse/agent-loop'
import {
  OverlapReviewSchema,
  assignPairArea,
  clusterPairs,
  deriveCollisionPairs,
  docBody,
  headingOutline,
  locateQuote,
  pairsFingerprint,
  splitDocSections,
  type CollisionPair,
  type DocCandidate,
  type VocabMap,
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
 * Cache name — one entry per COLLISION CLUSTER, keyed on the cluster docs'
 * content hashes plus the identity fingerprint of its briefed pairs, so one
 * doc edit re-runs only the clusters that doc participates in. (Bumped from
 * `overlap-session` when the work item changed from area to cluster — the old
 * entries' values answer a different question.)
 */
export const OVERLAP_SESSION_CACHE_NAME = 'consolidator/overlap-cluster'

/**
 * The three numbers. Fifteen turns of BATCHED section reads covers a
 * cluster's checklist; TWO resume grants because a hot cluster legitimately
 * needs the tour — resume, never divide the cluster. The prompt states these
 * numbers to the session (2026-08-21, the documenso field run: a session that
 * cannot see its budget reads to the wall), and the loop announces each grant
 * and demands the outcome in a wrap-up window when the last one binds. A
 * session that still runs out lands its remainder in `notReached` and its
 * unexamined pairs in `uncheckedPairs` via the fold (the failure is data in
 * the corpus, never a log line).
 */
export const OVERLAP_SESSION_BUDGET: SessionBudget = {
  turns: 15,
  maxResumes: 2,
  tokenCeiling: 150_000,
}

/**
 * Ceiling on the candidate pairs one session is briefed with. A pair costs two
 * section reads, so 30 pairs fits the budget with batching even when no
 * sections repeat. A cluster with more pairs is CHUNKED into several sessions
 * (rank order, doc-pair kept whole) rather than truncated — every derived pair
 * is briefed to exactly one session, so `uncheckedPairs` only ever holds what
 * a session demonstrably did not examine.
 */
export const MAX_BRIEFED_PAIRS = 30

// `keys` is required (no default) so the schema's input and output types
// agree — the generic ZodType<TOutcome> seam the cached pool runs through
// rejects input/output divergence. The stamp always writes it.
const CandidatePairOutcomeSchema = z.object({
  a: z.object({ doc: z.string(), heading: z.string().nullable() }),
  b: z.object({ doc: z.string(), heading: z.string().nullable() }),
  keys: z.array(z.string()),
})

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
    /** Briefed docs this session did not (fully) read. */
    notReached: z.array(z.string()),
    /**
     * The session's skim signal — how many non-error `read_section` results it
     * ingested. STAMPED BY THE RUN off the transcript before the value is
     * cached (never accepted from the session — the stamp overwrites any
     * self-report), so a cache hit carries the count its session earned.
     * Optional so entries cached before the field existed still parse.
     */
    sectionsOpened: z.number().int().min(0).optional(),
    /**
     * Briefed candidate pairs the session did NOT examine — a pair counts as
     * examined only when the transcript shows BOTH its sections opened via
     * `read_section`. STAMPED BY THE RUN off the transcript, same contract as
     * `sectionsOpened`: never self-reported, cached with the stamp, so a hit
     * carries the coverage its session earned. Optional for the same reason.
     */
    uncheckedPairs: z.array(CandidatePairOutcomeSchema).optional(),
  })
  .strict()
export type OverlapOutcome = z.infer<typeof OverlapOutcomeSchema>

export const OVERLAP_SESSION_SYSTEM_PROMPT = `You find the DISAGREEMENTS between the docs of ONE comparison group of a documentation corpus. The briefing opens with CANDIDATE COLLISIONS — section pairs a deterministic pass nominated because they share concrete signals (an endpoint segment, a field name, an enum member, a header name, or the same heading) — followed by each doc as a heading OUTLINE. You open the nominated sections, compare what they state, and report every genuine disagreement — adjudicated, with the evidence pinned.

# What a DISAGREEMENT is

Two docs state INCOMPATIBLE things about the SAME decision of the SAME component: a different value, field name, type, default, rule, enum member, status code, endpoint shape, or named behavior — where both statements cannot be true at once. That is something a human must reconcile.

NOT a disagreement (do NOT report):
  - Complementary coverage — each doc specs different parts of the system (different fields, different endpoints) with no contradiction.
  - One doc is a high-level summary and the other adds detail, consistently — the second refines the first.
  - OMISSION — one doc simply does not mention what the other states. Silence is never disagreement.
  - Two components — each statement is true of a DIFFERENT subsystem, so both hold at once.
  - HEDGED / SPECULATIVE — a "may be tuned later" beside a current value is a plan beside a present, not a conflict.

SCOPE: this session is the ONLY one that will ever see these pairs — no other comparison group covers them. Judge every disagreement you find between the briefed docs, whatever topic it touches; never defer one to "another area's session".

When two STATED values collide and you genuinely cannot tell whether they are compatible, report it — a human should look. Never report on the strength of an omission, a hedge, or a two-components difference.

# The candidate checklist

The CANDIDATE COLLISIONS are ranked leads, not verdicts: most nominated pairs will turn out to agree or be complementary — such a pair is simply not reported. Work the checklist FIRST, top to bottom: open BOTH sides of each pair with \`read_section\` and compare. The run watches the transcript — a pair whose two sections you never both opened is recorded in the corpus as UNCHECKED, whatever else you report — so never skip a pair silently; when the budget will not cover the list, spend it top-down and let the tail be recorded honestly. A disagreement between the briefed docs that no pair nominated (you noticed it while reading) is just as reportable — the checklist directs your reading, it does not limit your findings.

# The budget contract

You have ${OVERLAP_SESSION_BUDGET.turns} turns per budget grant and up to ${OVERLAP_SESSION_BUDGET.maxResumes} automatic resume grants — ${(OVERLAP_SESSION_BUDGET.maxResumes + 1) * OVERLAP_SESSION_BUDGET.turns} turns at the absolute most. The run announces each grant and tells you when the last one is running; when it demands the outcome, deliver it that turn.

BATCH your reads: issue SEVERAL \`read_section\` calls in one message — both sides of two or three pairs per turn — a turn that opens a single section wastes the budget. Reserve the final two turns for \`check_findings\` and the outcome; an outcome delivered early with an honest \`notReached\` is correct, while running out of turns with no outcome loses every disagreement you found. Docs you do not reach — never opened, or opened too little to judge — go in \`notReached\`, verbatim by ref. An honest \`notReached\` is part of a correct outcome; an empty one on a skimmed group is not.

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

The outcome is one object: { "overlaps": [...], "notReached": [...] }. A group whose docs simply agree yields { "overlaps": [], "notReached": [] } — a correct outcome.`

/** Exported for the step-7 estimate rework (probe the REAL keys). */
export const OVERLAP_SESSION_PROMPT_FINGERPRINT = promptFingerprint(OVERLAP_SESSION_SYSTEM_PROMPT)

/** One session's work: a chunk of one collision cluster — docs + ranked pairs. */
export interface OverlapWorkItem {
  /** The ONE area every pair of this chunk is assigned to (item 119). */
  areaId: string
  concern: string
  /** Deterministic session ordinal within the area (0 = hottest chunk). */
  cluster: number
  /** The briefed docs — every doc a briefed pair touches, sorted by ref. */
  docs: DocCandidate[]
  /** The ranked candidate pairs this session is briefed to check. */
  pairs: CollisionPair[]
}

/**
 * THE ONE DERIVATION (run + estimate, in lockstep): global collision pairs
 * over the kept docs → each pair assigned to exactly one area → per area,
 * connected components over doc refs → each component CHUNKED into work items
 * of at most {@link MAX_BRIEFED_PAIRS} pairs, in rank order (a chunk never
 * mixes clusters). Every derived pair is briefed to exactly one session.
 * Deterministic; areas keep their given order, chunks their rank order.
 */
export function deriveOverlapWorkItems(
  areas: ReadonlyArray<{ id: string; concern: string; docRefs: readonly string[] }>,
  keptDocs: readonly DocCandidate[],
  vocab?: VocabMap,
): OverlapWorkItem[] {
  const byPath = new Map(keptDocs.map((d) => [d.path, d]))
  const areasByDoc = new Map<string, string[]>()
  for (const area of areas) {
    for (const ref of area.docRefs) {
      const list = areasByDoc.get(ref) ?? []
      list.push(area.id)
      areasByDoc.set(ref, list)
    }
  }
  const pairs = deriveCollisionPairs(keptDocs, vocab)
  const byArea = new Map<string, CollisionPair[]>()
  for (const pair of pairs) {
    const areaId = assignPairArea(pair, areasByDoc)
    if (areaId === null) continue
    const list = byArea.get(areaId) ?? []
    list.push(pair)
    byArea.set(areaId, list)
  }
  const items: OverlapWorkItem[] = []
  for (const area of areas) {
    const areaPairs = byArea.get(area.id)
    if (!areaPairs) continue
    let ordinal = 0
    for (const cluster of clusterPairs(areaPairs)) {
      for (let at = 0; at < cluster.length; at += MAX_BRIEFED_PAIRS) {
        const briefed = cluster.slice(at, at + MAX_BRIEFED_PAIRS)
        const docs = [...new Set(briefed.flatMap((p) => [p.a.doc, p.b.doc]))]
          .sort()
          .map((ref) => byPath.get(ref))
          .filter((d): d is DocCandidate => d !== undefined)
        if (docs.length < 2) continue
        items.push({ areaId: area.id, concern: area.concern, cluster: ordinal++, docs, pairs: briefed })
      }
    }
  }
  return items
}

/**
 * The cache key: prompt fingerprint :: area id :: the sorted content hashes of
 * the cluster's briefed docs :: the identity fingerprint of the briefed pairs
 * (docs + headings, never scores — an edit elsewhere in the corpus that only
 * shifts weights re-runs nothing). `extraParts` is the appendable tail (the
 * orchestrator `instructions` land there).
 */
export function overlapSessionCacheKey(item: OverlapWorkItem, extraParts: readonly string[] = []): string {
  const hashes = item.docs.map((d) => d.contentHash).sort()
  return scanCacheKey([
    OVERLAP_SESSION_PROMPT_FINGERPRINT,
    item.areaId,
    hashes.join(','),
    pairsFingerprint(item.pairs),
    ...extraParts,
  ])
}

/** The work item, as the session index and the transcript record it. */
export function overlapWorkItem(areaId: string, cluster: number): string {
  return `area:${areaId}:${cluster}`
}

/** Match key for a heading vs a doc's real sections — inline markers + case folded. */
const headingKey = (h: string): string => h.replace(/[`*_~]/g, '').trim().toLowerCase()

/** The transcript-side identity of one opened section (`null` heading = lead). */
export function openedSectionKey(doc: string, heading: string | null): string {
  return `${doc} ${heading === null ? 'lead' : headingKey(heading)}`
}

/**
 * The briefed pairs the transcript does NOT show examined: a pair is examined
 * only when BOTH its sections were opened (successful `read_section`). Pure —
 * the run computes `opened` off the transcript and stamps the result into the
 * outcome value (never accepted from the session).
 */
export function uncheckedBriefedPairs(
  pairs: readonly CollisionPair[],
  opened: ReadonlySet<string>,
): CollisionPair[] {
  return pairs.filter(
    (p) =>
      !opened.has(openedSectionKey(p.a.doc, p.a.heading)) ||
      !opened.has(openedSectionKey(p.b.doc, p.b.heading)),
  )
}

/** A pair in the shape the outcome/corpus record it (score dropped). */
export function pairRecord(pair: CollisionPair): z.infer<typeof CandidatePairOutcomeSchema> {
  return { a: pair.a, b: pair.b, keys: pair.keys }
}

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
    display: {
      one: 'I double-checked my findings against the docs before writing them down',
      many: 'I double-checked my findings against the docs, {n} passes',
    },
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

/**
 * One reported disagreement as a card: the note as the claim, up to two quoted
 * passages, the adjudication, and the DISPUTE IDENTITY — the unordered doc pair
 * plus each side's section anchor and verbatim quote, which is the same key a
 * `conflictResolutions` entry carries, so a verdict recorded off the card
 * matches the corpus conflict.
 */
function presentOverlap(overlap: OverlapOutcome['overlaps'][number]): OutcomeBlock {
  const [docA, docB] = overlap.docs
  const side = (ref: string): { anchor: string | null; quote?: string } => {
    const section = overlap.sections.find((s) => s.doc === ref)
    return { anchor: section?.heading ?? null, ...(section ? { quote: section.quote } : {}) }
  }
  const a = side(docA)
  const b = side(docB)
  const dispute: DisplayDispute = {
    docA,
    anchorA: a.anchor,
    ...(a.quote !== undefined ? { quoteA: a.quote } : {}),
    docB,
    anchorB: b.anchor,
    ...(b.quote !== undefined ? { quoteB: b.quote } : {}),
  }
  const { action, rationale, confidence } = overlap.review.recommendation
  // Only a pick names a doc; `fix-doc`/`dismiss` recommend no side.
  const recommendedDoc = action === 'pick-a' ? docA : action === 'pick-b' ? docB : undefined
  // Full paths throughout: the client matches the recommendation against the
  // quotes and the dispute sides by ref equality, and shortens only to display.
  return {
    kind: 'finding',
    claim: overlap.note,
    quotes: overlap.sections.slice(0, 2).map((s) => ({
      doc: s.doc,
      ...(s.heading !== null ? { heading: s.heading } : {}),
      quote: s.quote,
    })),
    recommendation: {
      ...(recommendedDoc ? { doc: recommendedDoc } : {}),
      rationale,
      ...(confidence ? { confidence } : {}),
    },
    dispute,
  }
}

/**
 * The cards, then what the session did not get to. `sectionsOpened` and
 * `uncheckedPairs` are deliberately absent: the run recomputes both from the
 * transcript after this display is already persisted, so at emit time the
 * outcome only carries the model's self-report of them.
 */
function presentOverlapOutcome(outcome: OverlapOutcome): OutcomeBlock[] {
  const lines: string[] = [
    outcome.overlaps.length === 0
      ? 'These docs agree — I found no disagreements'
      : `I found ${outcome.overlaps.length} disagreement${outcome.overlaps.length === 1 ? '' : 's'}`,
  ]
  if (outcome.notReached.length > 0) lines.push(`I didn't get through ${outcome.notReached.join(', ')}`)
  return [...outcome.overlaps.map(presentOverlap), { kind: 'facts', lines }]
}

export function overlapSessionDef(input: OverlapSessionInput): SessionDef<OverlapOutcome> {
  const briefed = new Map(input.item.docs.map((d) => [d.path, d]))
  return {
    kind: OVERLAP_SESSION_KIND,
    systemPrompt: OVERLAP_SESSION_SYSTEM_PROMPT,
    tools: [readSectionTool(input.universe), readDocChunkTool(input.universe), checkFindingsTool(briefed)],
    outcomeSchema: OverlapOutcomeSchema,
    budget: OVERLAP_SESSION_BUDGET,
    display: {
      intro: `I'm reviewing ${overlapWorkItem(input.item.areaId, input.item.cluster)}, reading its docs side by side to catch any claims that disagree.`,
    },
    presentOutcome: presentOverlapOutcome,
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
function docBlock(doc: DocCandidate): string[] {
  return [`--- doc: ${doc.path}  ·  ${docTitle(doc)} ---`, headingOutline(docBody(doc))]
}

const pairSide = (s: CollisionPair['a']): string => `${s.doc} · ${s.heading ?? '(lead)'}`

export function overlapBriefing(item: OverlapWorkItem, instructions: readonly string[] = []): string {
  const lines = [
    ...instructionsBriefingBlock(instructions),
    `Find the disagreements between these docs.`,
    ``,
    `Area: ${item.areaId}`,
    ``,
    `CANDIDATE COLLISIONS — ranked leads from the deterministic pairing. Open BOTH`,
    `sides of every pair with \`read_section\` (batched) and compare what they state;`,
    `a pair whose sections you never both open is recorded as UNCHECKED:`,
  ]
  item.pairs.forEach((pair, i) => {
    lines.push(`  ${i + 1}. ${pairSide(pair.a)}  <->  ${pairSide(pair.b)}  [shared: ${pair.keys.join(', ')}]`)
  })
  lines.push('', `The docs, as outlines (open sections with \`read_section\`):`)
  for (const doc of item.docs) lines.push('', ...docBlock(doc))
  lines.push(
    '',
    'Work the checklist top-down; also report any other disagreement you notice',
    'between these docs. Docs you do not reach go in `notReached`.',
    'Check the draft with `check_findings`, then produce the outcome.',
  )
  return lines.join('\n')
}
