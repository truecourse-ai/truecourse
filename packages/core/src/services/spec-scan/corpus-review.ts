/**
 * THE CORPUS REVIEW — `spec-scan.corpus-review`, run after per-doc curation
 * and before the areas are settled, when the scan's driver can hand a session
 * a computer (Claude Code). On any other driver the scan skips it.
 *
 * Per-doc curation judges each document alone, so it cannot see what only a
 * view of the whole corpus shows: a comparison page that only restates the
 * guides, a design doc for what shipped differently, a fixture's README, a
 * generated copy of a schema guide. This session sees the list of every doc
 * curation KEPT, reads what it needs out of the corpus directory
 * (`corpus-dir.ts`), and names the docs that do not belong in a corpus of
 * documents that state how the shipped product behaves. Everything it does not
 * name stays.
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
import type { DocCandidate } from '@truecourse/spec-consolidator'
import { corpusDocLine, corpusReadingComputer, planReadingSlices, type CorpusDir } from './corpus-dir.js'
import { instructionsBriefingBlock, scanCacheKey } from './tools.js'

export const CORPUS_REVIEW_SESSION_KIND = 'spec-scan.corpus-review'

/** One entry per shard. */
export const CORPUS_REVIEW_CACHE_NAME = 'consolidator/corpus-review'

/**
 * THE CORPUS REVIEW'S VERSION, bumped by hand. A prompt change that fixes wrong
 * output bumps it in the same commit; any other prompt edit invalidates nothing.
 */
export const CORPUS_REVIEW_STAGE_VERSION = 1

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

/** The in-session check: every drop names a shard doc once, and a restatement names kept docs. */
export function validateCorpusReview(
  outcome: CorpusReviewOutcome,
  shard: ReadonlySet<string>,
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
  const shard = new Set(input.shard.docs.map((d) => d.path))
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
    ...input.shard.docs.map((doc) => corpusDocLine(doc, input.areasByDoc.get(doc.path) ?? [])),
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
  const drops = [...candidates.values()].map(({ ref, category, reason, restates }) => ({
    ref,
    category,
    reason: RESTATING.has(category) ? `${reason} (restates ${restates.join(', ')})` : reason,
  }))
  return { drops, declined }
}

export const CORPUS_REVIEW_SYSTEM_PROMPT = `You review the documents a product's documentation corpus has KEPT, and name the ones that do not belong in it. The corpus is meant to hold documents that state how the SHIPPED product behaves: what it does, what it allows, how it is configured and used. Tests are written from it, so a document in it is taken as a promise about the product.

The documents are files in your working directory, at their refs. You have \`Read\`, \`Glob\` and \`Grep\` over them. The briefing lists the documents you judge, with title, size and the areas curation tagged them with. Read what you need to decide; you do not have to read everything.

# What does not belong

Name a document only when it is one of these, and say which:

- \`derivative\`: it only restates what other kept documents already say (a comparison page, a summary, a landing page that repeats the guides), so removing it loses no statement about the product. Name the documents it restates in \`restates\`. If it states even one product fact no other kept document states, it is not derivative.
- \`duplicate\`: a generated or copied version of another kept document (an export, a rendered copy, a second language's page with the same content). Name the original in \`restates\`.
- \`historical\`: a plan, proposal, design record or implementation plan that does not describe what shipped: it labels itself historical or superseded, or describes a design the other documents show was built differently.
- \`process\`: about working on the product rather than the product: test fixtures and their READMEs, development tooling, CI notes, contributor or translator guides, glossaries for translators.

# Be conservative

A document stays when you are unsure. A document that is the ONLY source of some product behavior stays, even if it reads like marketing, a legal page or a FAQ. Overlap with other documents is normal and is not a reason to drop one: drop a restatement only when it adds nothing. Dropping a real source loses tests; keeping a redundant one costs little.

# The outcome

One object: { "drops": [ { "ref": "...", "category": "derivative" | "duplicate" | "historical" | "process", "reason": "one sentence grounded in what the document says", "restates": ["refs", "..."] } ] }. \`restates\` is empty except for derivative and duplicate. Name only documents from your list, each at most once. When every document belongs: { "drops": [] }.`
