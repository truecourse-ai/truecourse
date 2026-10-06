/**
 * THE CORPUS REVIEW — `spec-scan.corpus-review`, run after per-doc curation
 * and before the areas are settled, when the scan's driver can hand a session
 * a computer (Claude Code). On any other driver the scan skips it.
 *
 * Per-doc curation judges each document alone, so it cannot see what only a
 * view of the whole corpus shows: a comparison page that only restates the
 * guides, a plan that calls itself superseded, a fixture's README, a generated
 * copy of a schema guide. This session sees the list of every doc
 * curation KEPT, reads what it needs out of the corpus directory
 * (`corpus-dir.ts`), and names the docs that do not belong in a corpus of
 * documents that state how the shipped product behaves. Everything it does not
 * name stays.
 *
 * A document is never dropped for DISAGREEING with another one: which of two
 * disagreeing documents describes the shipped product is the question a
 * conflict puts to a person, and a review that answered it would delete the
 * conflict. So `historical` is something a document says of itself, in its
 * text or in its status metadata, and the check ({@link validateCorpusReview})
 * holds the session to that: the words it quotes must be in the document, or
 * the document's own status must read as superseded or dropped.
 *
 * The fold applies its drops as skipped docs ({@link applyCorpusReview}), and
 * two rules there outrank it: a doc the user pinned (`manualIncludes`) is never
 * dropped, and a doc dropped as a restatement stays when none of the docs it
 * restates is still in the corpus. The run, not the session, holds both, so
 * they also correct a cached outcome.
 *
 * A corpus too large to list in one briefing is SHARDED by the conflict hunt's
 * slice rule (`planReadingSlices`, area-grouped), with its own bounds: each
 * shard judges its own docs and can still read and grep the whole directory.
 */

import { z } from 'zod'
import { defineSessionKind, type KnownDisplayBlock, type SessionBudget, type SessionDef } from '@truecourse/agent-loop'
import {
  classifyStatusValue,
  docBody,
  parseDocStatus,
  readDocFrontmatter,
  type DocCandidate,
} from '@truecourse/spec-consolidator'
import { corpusDocLine, corpusReadingComputer, planReadingSlices, type CorpusDir } from './corpus-dir.js'
import { docLifecycleLines, instructionsBriefingBlock, scanCacheKey } from './tools.js'

export const CORPUS_REVIEW_SESSION_KIND = 'spec-scan.corpus-review'

/** One entry per shard. */
export const CORPUS_REVIEW_CACHE_NAME = 'consolidator/corpus-review'

/**
 * THE CORPUS REVIEW'S VERSION, bumped by hand. A prompt change that fixes wrong
 * output bumps it in the same commit; any other prompt edit invalidates nothing.
 */
export const CORPUS_REVIEW_STAGE_VERSION = 2

/**
 * One shard's bounds. The session reads selectively, so the bound that binds is
 * the briefing's list: 400 lines of ref, title, size and areas is a few tens of
 * KB. The byte bound keeps a shard's docs readable in one session if it must.
 */
export const CORPUS_REVIEW_SHARD = { maxChars: 1_000_000, maxDocs: 400 } as const

export const CORPUS_REVIEW_BUDGET: SessionBudget = { turns: 80, maxResumes: 1, tokenCeiling: 2_000_000 }

/** The session's whole wall clock: a list to weigh and some reading, not a full read. */
export const CORPUS_REVIEW_TIMEOUT_MS = 20 * 60_000

/**
 * Why a doc does not belong. Each is recorded as the skipped doc's category:
 * `process` is curation's own word for tooling and contributor material, and
 * the other three name what only the whole corpus shows.
 */
export const CorpusReviewCategorySchema = z.enum(['derivative', 'duplicate', 'historical', 'process'])
export type CorpusReviewCategory = z.infer<typeof CorpusReviewCategorySchema>

/** The categories that are a restatement of other kept docs, which must be named. */
const RESTATING: ReadonlySet<CorpusReviewCategory> = new Set(['derivative', 'duplicate'])

const CorpusReviewDropSchema = z
  .object({
    ref: z.string().min(1).describe('The doc to drop, by ref as listed.'),
    category: CorpusReviewCategorySchema,
    reason: z.string().min(1).describe('One sentence, grounded in what the doc says.'),
    restates: z
      .array(z.string())
      .describe('For derivative and duplicate: the kept docs it restates, by ref. Empty otherwise.'),
    marker: z
      .string()
      .describe(
        'For historical: the words of the document itself that say so, copied verbatim from its text or from its STATUS line as briefed. Empty otherwise.',
      ),
  })
  .strict()

export const CorpusReviewOutcomeSchema = z.object({ drops: z.array(CorpusReviewDropSchema) }).strict()
export type CorpusReviewOutcome = z.infer<typeof CorpusReviewOutcomeSchema>

const CORPUS_REVIEW_SESSION = defineSessionKind({
  kind: CORPUS_REVIEW_SESSION_KIND,
  outcomeSchema: CorpusReviewOutcomeSchema,
})

/** One session's work: the kept docs it judges. */
export interface CorpusReviewShard {
  /** 1-based, in plan order. */
  index: number
  docs: DocCandidate[]
}

export function planCorpusReviewShards(
  kept: readonly DocCandidate[],
  areasByDoc: ReadonlyMap<string, readonly string[]>,
): CorpusReviewShard[] {
  return planReadingSlices(kept, areasByDoc, CORPUS_REVIEW_SHARD).map((docs, i) => ({ index: i + 1, docs }))
}

/** The work item, as the session index and the transcript record it. */
export function corpusReviewWorkItem(index: number): string {
  return `corpus:${index}`
}

/**
 * The cache key, over NAMED inputs only: the stage version, the shard's docs
 * (ref and content hash), the fingerprint of the whole kept set the session
 * may read (`corpusFingerprint`), and the tail (the standing instructions).
 */
export function corpusReviewCacheKey(
  shard: CorpusReviewShard,
  keptSet: string,
  extraParts: readonly string[] = [],
): string {
  const docs = shard.docs.map((d) => `${d.path}=${d.contentHash}`).sort()
  return scanCacheKey([`corpus-review-v${CORPUS_REVIEW_STAGE_VERSION}`, docs.join(','), keptSet, ...extraParts])
}

/** A marker shorter than this is a word, not a statement a document makes about itself. */
const MARKER_MIN_CHARS = 8

/** Text as a marker is matched against it: case, markup and spacing do not count. */
const plain = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The words by which a document says of itself that it is no longer current.
 * A quoted marker must carry one: quoting a sentence that is in the document
 * proves only that the document says it, and what a historical drop needs is
 * the document saying THIS. A document that says it some other way stays in
 * the corpus, which is the cheap mistake.
 */
const SAYS_NOT_CURRENT =
  /\b(histor(?:y|ic|ical)|supersed\w*|deprecat\w*|obsolete|archiv\w*|retired|replaced|outdated|out of date|legacy|no longer|abandon\w*|cancell?ed|rejected|withdrawn|won'?t (?:do|fix)|never (?:shipped|implemented|built)|not (?:shipped|implemented|built)|did not ship|shipped differently|built differently|(?:was|were) (?:cut|dropped))\b/i

/** The statuses that say a document no longer describes the product: superseded, retired, rejected, cancelled. */
const HISTORICAL_STATUSES: ReadonlySet<string> = new Set(['deprecated', 'out-of-scope'])

/** The document's own status as the scan reads it: its frontmatter's, else its header's. */
function ownStatus(doc: DocCandidate): string | undefined {
  const body = docBody(doc)
  const stated = readDocFrontmatter(body)?.status
  return (stated ? classifyStatusValue(stated) : undefined) ?? parseDocStatus(body)
}

/**
 * Whether the document says of ITSELF that it is historical: the quoted marker
 * is in its text (frontmatter included) and says so, or its status metadata
 * reads as superseded or dropped. A last-changed date is not a status, and what other
 * documents say is not the document's word.
 */
export function saysItIsHistorical(doc: DocCandidate, marker: string): boolean {
  const quoted = plain(marker)
  if (quoted.length >= MARKER_MIN_CHARS && SAYS_NOT_CURRENT.test(quoted) && plain(docBody(doc)).includes(quoted)) return true
  const status = ownStatus(doc)
  return status !== undefined && HISTORICAL_STATUSES.has(status)
}

/**
 * The in-session check: every drop names a shard doc once, a restatement names
 * kept docs, and a historical drop stands on the document's own word.
 */
export function validateCorpusReview(
  outcome: CorpusReviewOutcome,
  shard: ReadonlyMap<string, DocCandidate>,
  kept: ReadonlySet<string>,
): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  outcome.drops.forEach((drop, i) => {
    if (!shard.has(drop.ref)) errors.push(`drops[${i}]: \`${drop.ref}\` is not one of the docs listed for you to judge`)
    if (seen.has(drop.ref)) errors.push(`drops[${i}]: \`${drop.ref}\` is named twice`)
    seen.add(drop.ref)
    if (RESTATING.has(drop.category)) {
      if (drop.restates.length === 0) {
        errors.push(`drops[${i}]: a ${drop.category} drop names the kept docs it restates in \`restates\``)
      }
      for (const ref of drop.restates) {
        if (ref === drop.ref) errors.push(`drops[${i}]: \`${ref}\` cannot restate itself`)
        else if (!kept.has(ref)) errors.push(`drops[${i}]: \`${ref}\` in \`restates\` is not a kept doc`)
      }
    }
    const doc = shard.get(drop.ref)
    if (drop.category === 'historical' && doc && !saysItIsHistorical(doc, drop.marker)) {
      errors.push(
        `drops[${i}]: nothing in \`${drop.ref}\` says it is historical: \`marker\` must be words copied from the document (its text or its status line) that say it is superseded, retired, or a record of a plan, and its status metadata does not say so either. A document that disagrees with another is not historical; leave it in and the scan reports the disagreement.`,
      )
    }
  })
  return errors
}

function presentCorpusReview(outcome: CorpusReviewOutcome): KnownDisplayBlock[] {
  const lines =
    outcome.drops.length === 0
      ? ['Every doc I was given belongs in the corpus']
      : outcome.drops.map((d) => `I'm leaving out ${d.ref} (${d.category}): ${d.reason}`)
  return [{ kind: 'facts', lines }]
}

export interface CorpusReviewSessionInput {
  shard: CorpusReviewShard
  /** Every kept prose doc's ref: what a restatement may name. */
  kept: ReadonlySet<string>
  dir: CorpusDir
}

export function corpusReviewSessionDef(input: CorpusReviewSessionInput): SessionDef<CorpusReviewOutcome> {
  const shard = new Map(input.shard.docs.map((d) => [d.path, d]))
  return {
    ...CORPUS_REVIEW_SESSION,
    systemPrompt: CORPUS_REVIEW_SYSTEM_PROMPT,
    reasoning: 'high',
    computer: corpusReadingComputer(input.dir.root()),
    tools: [],
    budget: CORPUS_REVIEW_BUDGET,
    display: {
      title: 'Corpus review',
      intro: `I'm looking over the ${input.shard.docs.length} kept docs of ${corpusReviewWorkItem(input.shard.index)} for any that do not describe the shipped product.`,
    },
    validateOutcome: (outcome) => {
      const errors = validateCorpusReview(outcome, shard, input.kept)
      return errors.length === 0 ? undefined : `Outcome refused, ${errors.length} problem(s):\n- ${errors.join('\n- ')}`
    },
    presentOutcome: presentCorpusReview,
  }
}

export interface CorpusReviewBriefingInput {
  shard: CorpusReviewShard
  keptCount: number
  root: string
  areasByDoc: ReadonlyMap<string, readonly string[]>
  instructions?: readonly string[]
}

export function corpusReviewBriefing(input: CorpusReviewBriefingInput): string {
  const others = input.keptCount - input.shard.docs.length
  return [
    ...instructionsBriefingBlock(input.instructions ?? []),
    `The kept corpus is in ${input.root}: every document at its ref, ${input.keptCount} in all. Your working directory is that directory.`,
    '',
    `THE DOCS YOU JUDGE (${input.shard.docs.length}):`,
    ...input.shard.docs.flatMap((doc) => [
      corpusDocLine(doc, input.areasByDoc.get(doc.path) ?? []),
      ...docLifecycleLines(doc, { classify: true }).map((line) => `    ${line}`),
    ]),
    ...(others > 0
      ? ['', `${others} other kept doc${others === 1 ? ' is' : 's are'} in the same directory; \`Glob\` lists them and they count as sources.`]
      : []),
    '',
    'Name the docs that do not belong, with category and reason. Everything you do not name stays.',
  ].join('\n')
}

export interface CorpusReviewDrop {
  ref: string
  category: CorpusReviewCategory
  reason: string
}

export interface CorpusReviewApplied {
  drops: CorpusReviewDrop[]
  /** Drops the run declined, each with why. */
  declined: Array<{ ref: string; why: string }>
}

/**
 * What the reviews' drops do to the kept set. A pinned doc is never dropped. A
 * restatement is dropped only while at least one doc it restates stays: the
 * rule runs to a fixpoint in ref order, so of two docs named as restating each
 * other the first stays and the second goes, never both. Anything that is not
 * a kept doc is ignored.
 */
export function applyCorpusReview(
  outcomes: readonly CorpusReviewOutcome[],
  kept: ReadonlySet<string>,
  manualIncludes: ReadonlySet<string>,
): CorpusReviewApplied {
  const declined: CorpusReviewApplied['declined'] = []
  const candidates = new Map<string, CorpusReviewOutcome['drops'][number]>()
  for (const drop of outcomes.flatMap((o) => o.drops)) {
    if (!kept.has(drop.ref) || candidates.has(drop.ref)) continue
    if (manualIncludes.has(drop.ref)) {
      declined.push({ ref: drop.ref, why: 'force-included by a decision' })
      continue
    }
    candidates.set(drop.ref, drop)
  }
  let changed = true
  while (changed) {
    changed = false
    for (const [ref, drop] of [...candidates].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (!RESTATING.has(drop.category)) continue
      const sourceStays = drop.restates.some((source) => source !== ref && kept.has(source) && !candidates.has(source))
      if (sourceStays) continue
      candidates.delete(ref)
      declined.push({ ref, why: 'none of the docs it restates stays in the corpus' })
      changed = true
    }
  }
  const drops = [...candidates.values()].map(({ ref, category, reason, restates, marker }) => ({
    ref,
    category,
    reason: RESTATING.has(category)
      ? `${reason} (restates ${restates.join(', ')})`
      : category === 'historical' && marker.trim() !== ''
        ? `${reason} (it says: "${marker.trim()}")`
        : reason,
  }))
  return { drops, declined }
}

export const CORPUS_REVIEW_SYSTEM_PROMPT = `You review the documents a product's documentation corpus has KEPT, and name the ones that do not belong in it. The corpus is meant to hold documents that state how the SHIPPED product behaves: what it does, what it allows, how it is configured and used. Tests are written from it, so a document in it is taken as a promise about the product.

The documents are files in your working directory, at their refs. You have \`Read\`, \`Glob\` and \`Grep\` over them. The briefing lists the documents you judge, with title, size, the areas curation tagged them with, and each one's own lifecycle metadata: when it last changed, and its status and status history when it states them. Read what you need to decide; you do not have to read everything.

# What does not belong

Name a document only when it is one of these, and say which:

- \`derivative\`: it only restates what other kept documents already say (a comparison page, a summary, a landing page that repeats the guides), so removing it loses no statement about the product. Name the documents it restates in \`restates\`. If it states even one product fact no other kept document states, it is not derivative. A document that states something DIFFERENT from the documents it would restate is not derivative either: it is one side of a disagreement, and it stays.
- \`duplicate\`: a generated or copied version of another kept document (an export, a rendered copy, a second language's page with the same content). Name the original in \`restates\`.
- \`historical\`: a document that SAYS OF ITSELF that it no longer describes the product. Either its own text says so (it calls itself a historical record, superseded, replaced, retired, archived, a plan that was carried out or abandoned, a note that what shipped differs from it), or its own status metadata says so (a status such as superseded, deprecated, obsolete, rejected, cancelled or won't do, as an issue or a decision record carries). Copy the words that say it into \`marker\`, verbatim, from the document's text or from its STATUS line in the briefing. The run checks that the marker is in the document and that it says the document is no longer current, and refuses a historical drop that nothing in the document supports. A date alone is not a status: an old document is not historical for being old.
- \`process\`: about working on the product rather than the product: test fixtures and their READMEs, development tooling, CI notes, contributor or translator guides, glossaries for translators.

# Never drop a document for disagreeing

Two documents that say different things about the product are a CONFLICT, and reporting conflicts is what this scan is for. Which of the two describes the shipped product is not yours to decide and cannot be read off the documents: a requirements page that contradicts the specification at every point may be the stale one, or the specification may be. Leave both in. A document is never historical, derivative or out of place because another document contradicts it, however thoroughly.

# Be conservative

A document stays when you are unsure. A document that is the ONLY source of some product behavior stays, even if it reads like marketing, a legal page or a FAQ. Overlap with other documents is normal and is not a reason to drop one: drop a restatement only when it adds nothing. Dropping a real source loses tests; keeping a redundant one costs little.

# The outcome

One object: { "drops": [ { "ref": "...", "category": "derivative" | "duplicate" | "historical" | "process", "reason": "one sentence grounded in what the document says", "restates": ["refs", "..."], "marker": "..." } ] }. \`restates\` is empty except for derivative and duplicate, and \`marker\` is empty except for historical. Name only documents from your list, each at most once. When every document belongs: { "drops": [] }.`
