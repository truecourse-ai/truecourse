/**
 * THE FACT COMPARISON — `spec-scan.compare-facts`, one session per BATCH of the
 * facts the record step wrote, after their subjects are settled. It is the
 * second half of finding conflicts by comparing facts: the session places every
 * fact of its batch in a group of facts about the same thing, or alone, and
 * judges each group of two or more.
 *
 * BATCHES ({@link planCompareBatches}, deterministic) are two cuts through the
 * same facts, because one is not enough:
 *
 * - AREA BATCHES: a fact belongs to each of its areas, and areas are packed
 *   whole, in id order, into batches of at most {@link COMPARE_BATCH_FACTS}
 *   facts. An area over the bound is split by `partitionByAffinity`, each part
 *   a batch of its own; the area's parts and cut pairs are recorded.
 * - SUBJECT BATCHES: settled subjects whose NAMES share a rare word form a
 *   SUBJECT FAMILY ("Download PDF button", "Download button", "Download
 *   dialog"), since one control named two ways is exactly where two docs
 *   disagree. Families are clustered with `clusterByAffinity` over the
 *   distinct settled names (a word in more than
 *   {@link SUBJECT_FAMILY_DF_CAP} names is vocabulary and links nothing),
 *   each held to the bound by its fact count. A family whose facts do not all
 *   sit in one area batch is compared on its own: such families are packed
 *   whole, in order, up to the bound, and one over the bound (a single
 *   subject that large) is split the way an area is.
 *
 * Within an area batch the facts are ordered by settled subject, then doc
 * ref, then unit number; within a subject batch by family first, so a
 * family's subjects sit together. They are briefed one line each under
 * batch-local ids `F1`…`Fn`. The
 * session's tools are closed (`read_context` over its own facts' passages, and
 * `check_groups`), so it runs on every driver.
 *
 * THE GATE ({@link checkGroups}), run by `check_groups` on a draft, by
 * `validateOutcome` on the outcome and again by the run's fold: every briefed
 * id appears exactly once, in a group or in `alone`; a group holds two or more
 * facts and a verdict; an `agree` group names no conflict; a `conflict` group
 * names at least one pair of its own facts from two different passages
 * (different docs, or one doc and no unit in common), each with a note and a
 * review. A wrapping-up session's outcome is accepted as it stands, the facts
 * it placed nowhere STAMPED into it as `unplaced` by the engine before it is
 * cached. An entry the gate refuses never stands in the fold.
 *
 * A conflict that stands becomes the finding the overlap fold takes: the two
 * facts' docs, one pointer per fact ({@link factPointer}: the unit and the
 * window of at most {@link POINTER_QUOTE_WORDS} words that share the most
 * words with the fact's statement, verbatim by construction), the note and the
 * review.
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  defineSessionKind,
  defineToolSpec,
  type KnownDisplayBlock,
  type SessionBudget,
  type SessionDef,
  type SessionTool,
} from '@truecourse/agent-loop'
import {
  OverlapReviewSchema,
  affinityTokens,
  clusterByAffinity,
  docBody,
  partitionByAffinity,
  type DocCandidate,
  type DocUnit,
} from '@truecourse/spec-consolidator'
import { parseHeadings, type OverlapLike } from '@truecourse/shared'
import { presentOverlap, priorDisputesAmong, sameDocFindingProblem, type OverlapFinding } from './overlap.js'
import type { RecordedFact } from './record-facts.js'
import { subjectKey } from './settle-subjects.js'
import { docLifecycleFingerprint, docLifecycleLines, instructionsBriefingBlock, scanCacheKey } from './tools.js'

export const COMPARE_FACTS_SESSION_KIND = 'spec-scan.compare-facts'

/** One entry per batch. */
export const COMPARE_FACTS_CACHE_NAME = 'consolidator/fact-compare'

/**
 * THE COMPARE STEP'S VERSION, bumped by hand. A prompt change that fixes wrong
 * output bumps it in the same commit; any other prompt edit invalidates nothing.
 */
export const COMPARE_STAGE_VERSION = 1

/**
 * Most facts one batch holds. A briefed fact is a line of about 180
 * characters, so 300 of them are some 15k tokens, and the outcome names every
 * id once beside its groups and their conflicts.
 */
export const COMPARE_BATCH_FACTS = 300

/** Most words a pointer's quote holds, the length every conflict quote is held to. */
export const POINTER_QUOTE_WORDS = 25

/**
 * The three numbers. The batch rides the briefing, so the work is a grouping
 * draft, a few turns of `read_context` on the pairs it is unsure of (batched),
 * a `check_groups` round, a correction and the outcome: some eight turns,
 * twelve with room, and one resume for a batch with many close calls. The
 * ceiling is a context level: the briefing is about 15k tokens, a few dozen
 * passages read some 30k more, and each draft of the outcome a few thousand.
 */
export const COMPARE_FACTS_BUDGET: SessionBudget = { turns: 12, maxResumes: 1, tokenCeiling: 200_000 }

/**
 * A word of a subject NAME in more than this many distinct settled names is
 * vocabulary ("button", "settings", "export") and joins no family. The words
 * that name one control appear in a handful of names (on a 1,751-name corpus,
 * "download" in 9, "checker" in about 5, "health" in 3); 12 passes those with
 * room while generic words appear in dozens, and bounds the links one word
 * makes to C(12,2) = 66.
 */
export const SUBJECT_FAMILY_DF_CAP = 12

/** Characters of one passage's surroundings `read_context` shows at most. */
const CONTEXT_CHARS = 4_000

/** Facts one `read_context` call opens at most. */
const CONTEXT_FACTS_MAX = 12

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

/** One fact of a batch, under its batch-local id. */
export interface BatchFact {
  id: string
  fact: RecordedFact
  /** Its settled subject. */
  subject: string
}

/** Which part of an area or a subject over the bound a batch is. */
export interface BatchPart {
  /** The area id, or the settled subject. */
  of: string
  index: number
  parts: number
}

export type CompareBatch =
  | { kind: 'area'; index: number; areas: string[]; part?: BatchPart; facts: BatchFact[] }
  | { kind: 'subject'; index: number; subjects: string[]; part?: BatchPart; facts: BatchFact[] }

export interface ComparePlan {
  /** Area batches in area order, then subject batches in family order. */
  batches: CompareBatch[]
  /** Each area over the bound: how many parts it was cut into, and the linked pairs the cut separated. */
  splitAreas: Map<string, { parts: number; cutPairs: number }>
  /** Families that join two or more settled subjects. */
  subjectFamilies: number
  /** Families, of any size, sent to subject batches. */
  subjectBatchFamilies: number
  /** Facts that sit in a subject batch. */
  subjectBatchFacts: number
}

/** The passage a fact comes from: its doc and the units it cites. */
const passageOf = (fact: RecordedFact): string => `${fact.doc}#${fact.units.map((u) => u.n).join(',')}`

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * A batch's facts in briefing order: family (in a subject batch), settled
 * subject, doc ref, first unit, then statement and units so the order is
 * total. Ids follow the order.
 */
function orderBatch(
  facts: Iterable<RecordedFact>,
  subjectOf: (fact: RecordedFact) => string,
  familyOf: (fact: RecordedFact) => number = () => 0,
): BatchFact[] {
  return [...facts]
    .map((fact) => ({ fact, subject: subjectOf(fact), key: subjectKey(subjectOf(fact)), family: familyOf(fact) }))
    .sort(
      (x, y) =>
        x.family - y.family ||
        byText(x.key, y.key) ||
        byText(x.fact.doc, y.fact.doc) ||
        (x.fact.units[0]?.n ?? 0) - (y.fact.units[0]?.n ?? 0) ||
        byText(x.fact.statement, y.fact.statement) ||
        byText(passageOf(x.fact), passageOf(y.fact)),
    )
    .map(({ fact, subject }, i) => ({ id: `F${i + 1}`, fact, subject }))
}

/**
 * THE BATCH PLAN. Pure and deterministic: the same facts in the same order,
 * with the same settled subjects, always give the same batches and ids.
 */
export function planCompareBatches(
  facts: readonly RecordedFact[],
  subjectOf: (fact: RecordedFact) => string,
  maxFacts: number = COMPARE_BATCH_FACTS,
): ComparePlan {
  const split = (list: readonly RecordedFact[]) =>
    partitionByAffinity(list, {
      maxSize: maxFacts,
      text: (fact) => `${subjectOf(fact)} ${fact.statement}`,
      passage: passageOf,
    })

  // Area batches: whole areas in id order, an area over the bound in parts.
  const byArea = new Map<string, RecordedFact[]>()
  for (const fact of facts) {
    for (const area of fact.areas) {
      const list = byArea.get(area)
      if (list) list.push(fact)
      else byArea.set(area, [fact])
    }
  }
  const areaSets: Array<{ areas: string[]; facts: ReadonlySet<RecordedFact>; part?: BatchPart }> = []
  const splitAreas = new Map<string, { parts: number; cutPairs: number }>()
  let open: { areas: string[]; facts: Set<RecordedFact> } | null = null
  for (const area of [...byArea.keys()].sort(byText)) {
    const list = byArea.get(area)!
    if (list.length > maxFacts) {
      if (open) areaSets.push(open)
      open = null
      const { parts, cutPairs } = split(list)
      splitAreas.set(area, { parts: parts.length, cutPairs })
      parts.forEach((part, i) =>
        areaSets.push({ areas: [area], facts: new Set(part), part: { of: area, index: i + 1, parts: parts.length } }),
      )
      continue
    }
    if (open) {
      const merged = new Set([...open.facts, ...list])
      if (merged.size <= maxFacts) {
        open.areas.push(area)
        open.facts = merged
        continue
      }
      areaSets.push(open)
    }
    open = { areas: [area], facts: new Set(list) }
  }
  if (open) areaSets.push(open)

  // Subject families: settled subjects whose names share a rare word, each
  // family held to the bound by its fact count.
  const bySubject = new Map<string, { subject: string; facts: RecordedFact[] }>()
  for (const fact of facts) {
    const subject = subjectOf(fact)
    const key = subjectKey(subject)
    const entry = bySubject.get(key)
    if (entry) entry.facts.push(fact)
    else bySubject.set(key, { subject, facts: [fact] })
  }
  const families = clusterByAffinity(
    [...bySubject.keys()].sort(byText).map((key) => ({ key, ...bySubject.get(key)! })),
    {
      maxSize: maxFacts,
      text: (s) => s.subject,
      passage: (s) => s.key,
      weight: (s) => s.facts.length,
      dfCap: SUBJECT_FAMILY_DF_CAP,
    },
  )
  const familyOf = new Map<RecordedFact, number>()
  families.forEach((family, i) => {
    for (const member of family) for (const fact of member.facts) familyOf.set(fact, i)
  })

  // Subject batches: the families no one area batch holds whole.
  const spans = (list: readonly RecordedFact[]): boolean =>
    list.length >= 2 &&
    new Set(list.map(passageOf)).size >= 2 &&
    !areaSets.some((set) => list.every((fact) => set.facts.has(fact)))
  const subjectSets: Array<{ subjects: string[]; facts: RecordedFact[]; part?: BatchPart }> = []
  let openSubjects: { subjects: string[]; facts: RecordedFact[] } | null = null
  let subjectBatchFamilies = 0
  for (const family of families) {
    const subjects = family.map((member) => member.subject)
    const list = family.flatMap((member) => member.facts)
    if (!spans(list)) continue
    subjectBatchFamilies += 1
    if (list.length > maxFacts) {
      if (openSubjects) subjectSets.push(openSubjects)
      openSubjects = null
      const { parts } = split(list)
      parts.forEach((part, i) =>
        subjectSets.push({ subjects, facts: part, part: { of: subjects.join(', '), index: i + 1, parts: parts.length } }),
      )
      continue
    }
    if (openSubjects && openSubjects.facts.length + list.length <= maxFacts) {
      openSubjects.subjects.push(...subjects)
      openSubjects.facts.push(...list)
      continue
    }
    if (openSubjects) subjectSets.push(openSubjects)
    openSubjects = { subjects, facts: [...list] }
  }
  if (openSubjects) subjectSets.push(openSubjects)

  const batches: CompareBatch[] = [
    ...areaSets.map((set, i): CompareBatch => ({
      kind: 'area',
      index: i + 1,
      areas: set.areas,
      ...(set.part ? { part: set.part } : {}),
      facts: orderBatch(set.facts, subjectOf),
    })),
    ...subjectSets.map((set, i): CompareBatch => ({
      kind: 'subject',
      index: i + 1,
      subjects: set.subjects,
      ...(set.part ? { part: set.part } : {}),
      facts: orderBatch(set.facts, subjectOf, (fact) => familyOf.get(fact) ?? 0),
    })),
  ]
  return {
    batches,
    splitAreas,
    subjectFamilies: families.filter((family) => family.length >= 2).length,
    subjectBatchFamilies,
    subjectBatchFacts: subjectSets.reduce((n, set) => n + set.facts.length, 0),
  }
}

/** A batch in a few words, for the checklist and the session's intro. */
export function describeBatch(batch: CompareBatch): string {
  if (batch.part) {
    const of = batch.kind === 'area' ? batch.part.of : `subject "${batch.part.of}"`
    return `${of}, part ${batch.part.index} of ${batch.part.parts}`
  }
  if (batch.kind === 'subject') {
    return `subject batch ${batch.index} (${batch.subjects.length} subject${batch.subjects.length === 1 ? '' : 's'})`
  }
  return batch.areas.length === 1
    ? batch.areas[0]!
    : `area batch ${batch.index} (${batch.areas.length} areas, ${batch.areas[0]} to ${batch.areas[batch.areas.length - 1]})`
}

/** The work item, as the session index and the transcript record it. */
export function compareFactsWorkItem(batch: Pick<CompareBatch, 'kind' | 'index'>): string {
  return `compare:${batch.kind}:${batch.index}`
}

/** One session's work: a batch, and the docs its facts come from, by ref. */
export interface CompareItem {
  batch: CompareBatch
  docs: ReadonlyMap<string, DocCandidate>
}

/** The batch's docs whose lifecycle carries more than a date: the ones the briefing shows. */
function docsWithStatus(item: CompareItem): DocCandidate[] {
  const refs = [...new Set(item.batch.facts.map((f) => f.fact.doc))].sort(byText)
  return refs.flatMap((ref) => {
    const doc = item.docs.get(ref)
    return doc && docLifecycleLines(doc).length > 1 ? [doc] : []
  })
}

const textHash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** One fact as the key folds it: doc ref, units (number and text hash), settled subject, statement, areas. */
const factFingerprint = (bf: BatchFact): string =>
  [
    bf.fact.doc,
    bf.fact.units.map((u) => `${u.n}:${textHash(u.text)}`).join(','),
    bf.subject,
    bf.fact.statement,
    bf.fact.areas.join(','),
  ].join('\t')

/**
 * The cache key, over NAMED inputs only: the stage version, every fact of the
 * batch in briefing order (its fingerprint), the lifecycle of each batch doc
 * the briefing shows one for, and the tail (the standing instructions). A doc
 * edit that changes no fact of a batch does not re-run it.
 */
export function compareFactsCacheKey(item: CompareItem, extraParts: readonly string[] = []): string {
  return scanCacheKey([
    `compare-facts-v${COMPARE_STAGE_VERSION}`,
    item.batch.facts.map(factFingerprint).join('\n'),
    docsWithStatus(item)
      .map((doc) => `${doc.path}=${docLifecycleFingerprint(doc)}`)
      .join('\n'),
    ...extraParts,
  ])
}

// ---------------------------------------------------------------------------
// The outcome and its gate
// ---------------------------------------------------------------------------

const FactConflictSchema = z
  .object({
    a: z.string().describe('The id of the fact on side a, the side `pick-a` says is right, e.g. "F41".'),
    b: z.string().describe('The id of the fact on side b, from another passage than side a.'),
    note: z.string().describe('What differs, naming each document by its filename (for one document, its two sections).'),
    review: OverlapReviewSchema,
  })
  .strict()

const FactGroupSchema = z
  .object({
    subject: z.string().describe('What the facts of the group are about, in a few words.'),
    facts: z.array(z.string()).describe('The ids of the facts about it, two or more.'),
    verdict: z.enum(['agree', 'conflict']),
    conflicts: z
      .array(FactConflictSchema)
      .describe('For a "conflict" group, every pair of its facts that cannot both be true; empty for an "agree" group.'),
  })
  .strict()

/** What the model writes: its groups, and the facts no other fact speaks about. */
export const FactComparisonWireSchema = z
  .object({
    groups: z.array(FactGroupSchema),
    alone: z.array(z.string()).describe('The id of every fact no group holds, each once.'),
  })
  .strict()
export type FactComparisonWire = z.infer<typeof FactComparisonWireSchema>

export const FactComparisonSchema = FactComparisonWireSchema.extend({
  /**
   * Briefed fact ids the outcome placed nowhere, in id order. STAMPED by the
   * engine when the outcome is accepted, before it is cached; empty unless the
   * session was wrapping up.
   */
  unplaced: z.array(z.string()),
}).strict()
export type FactComparison = z.infer<typeof FactComparisonSchema>

/** How many of `wanted` the tokens of `text` hold. */
const sharedWords = (wanted: ReadonlySet<string>, tokens: ReadonlySet<string>): number => {
  let n = 0
  for (const token of tokens) if (wanted.has(token)) n += 1
  return n
}

/**
 * The window of at most {@link POINTER_QUOTE_WORDS} consecutive words of
 * `text` that shares the most words with `wanted` (the earliest on a tie), as
 * an exact slice of `text`: the whole text when it is no longer.
 */
export function evidenceWindow(text: string, wanted: ReadonlySet<string>): string {
  const words = [...text.matchAll(/\S+/g)]
  if (words.length <= POINTER_QUOTE_WORDS) return text
  const tokens = words.map((w) => affinityTokens(w[0]))
  let best = 0
  let bestScore = -1
  for (let at = 0; at + POINTER_QUOTE_WORDS <= words.length; at++) {
    const score = sharedWords(wanted, new Set(tokens.slice(at, at + POINTER_QUOTE_WORDS).flatMap((t) => [...t])))
    if (score > bestScore) {
      best = at
      bestScore = score
    }
  }
  const last = words[best + POINTER_QUOTE_WORDS - 1]!
  return text.slice(words[best]!.index, last.index + last[0].length)
}

/**
 * Where a fact is stated, as a finding's pointer: among the units it cites,
 * the one sharing the most words with its statement (the first in doc order
 * on a tie), its heading, and within it the {@link evidenceWindow} as the
 * quote. Deterministic, and verbatim: the quote is a slice of the unit's text.
 */
export function factPointer(fact: RecordedFact): OverlapFinding['sections'][number] {
  const wanted = affinityTokens(fact.statement)
  let unit: DocUnit | undefined
  let unitScore = -1
  for (const candidate of fact.units) {
    const score = sharedWords(wanted, affinityTokens(candidate.text))
    if (score > unitScore) {
      unit = candidate
      unitScore = score
    }
  }
  return {
    doc: fact.doc,
    heading: unit?.heading ?? null,
    quote: unit ? evidenceWindow(unit.text, wanted) : fact.statement,
  }
}

/** Whether two facts are one passage: one doc, and a unit both cite. */
function onePassage(a: RecordedFact, b: RecordedFact): boolean {
  if (a.doc !== b.doc) return false
  const units = new Set(a.units.map((u) => u.n))
  return b.units.some((u) => units.has(u.n))
}

/** A group the gate lets stand: its facts as first placed, two or more. */
export interface StandingGroup {
  subject: string
  verdict: 'agree' | 'conflict'
  facts: BatchFact[]
}

export interface GroupsCheck {
  problems: string[]
  /** Briefed ids placed nowhere, in id order. */
  unplaced: string[]
  groups: StandingGroup[]
  /** The conflicts that stand, as findings, in outcome order. */
  findings: OverlapFinding[]
}

/** `F1-F3, F7`: ids as ranges, at most `max` of them. */
function idRanges(ids: readonly string[], max = Number.POSITIVE_INFINITY): string {
  const ns = ids.map((id) => Number(id.slice(1))).sort((a, b) => a - b)
  const ranges: string[] = []
  let shown = 0
  for (let i = 0; i < ns.length && ranges.length < max; ) {
    let j = i
    while (j + 1 < ns.length && ns[j + 1] === ns[j]! + 1) j++
    ranges.push(i === j ? `F${ns[i]}` : `F${ns[i]}-F${ns[j]}`)
    shown = j + 1
    i = j + 1
  }
  const rest = ns.length - shown
  return rest > 0 ? `${ranges.join(', ')}, and ${rest} more` : ranges.join(', ')
}

/**
 * THE GATE. What is wrong with a comparison of `batch`, which ids it places
 * nowhere, and what of it stands: a fact counts in the first group or `alone`
 * that places it, a group stands with two or more facts, and a conflict stands
 * only in a `conflict` group, between two of the facts that group lists, from
 * two different passages, with a note.
 */
export function checkGroups(outcome: FactComparisonWire, batch: CompareBatch): GroupsCheck {
  const byId = new Map(batch.facts.map((bf) => [bf.id, bf]))
  const problems: string[] = []
  const placedAt = new Map<string, string>()
  const place = (id: string, where: string): boolean => {
    if (!byId.has(id)) {
      problems.push(`${where} names "${id}", which is not a fact of this batch (F1 to F${batch.facts.length})`)
      return false
    }
    const first = placedAt.get(id)
    if (first !== undefined) {
      problems.push(`${id} is placed twice, in ${first} and in ${where}; place each fact once`)
      return false
    }
    placedAt.set(id, where)
    return true
  }

  const groups: StandingGroup[] = []
  const findings: OverlapFinding[] = []
  outcome.groups.forEach((group, i) => {
    const where = `groups[${i}]`
    const facts = group.facts.filter((id) => place(id, where)).map((id) => byId.get(id)!)
    if (new Set(group.facts).size < 2) problems.push(`${where} holds one fact; a fact with no peer goes in "alone"`)
    if (group.subject.trim() === '') problems.push(`${where} has no subject`)
    if (facts.length >= 2) groups.push({ subject: group.subject.trim(), verdict: group.verdict, facts })
    if (group.verdict === 'agree') {
      if (group.conflicts.length > 0) problems.push(`${where} agrees and names conflicts; give it the verdict "conflict", or drop them`)
      return
    }
    if (group.conflicts.length === 0) problems.push(`${where} is a conflict and names no pair of facts that cannot both be true`)
    const listed = new Set(group.facts)
    group.conflicts.forEach((conflict, j) => {
      const at = `${where}.conflicts[${j}]`
      const a = byId.get(conflict.a)
      const b = byId.get(conflict.b)
      const outside = [conflict.a, conflict.b].filter((id) => !listed.has(id))
      if (outside.length > 0) {
        problems.push(`${at} pairs ${outside.join(' and ')}, not in this group; a conflict is between two facts of its group`)
        return
      }
      if (!a || !b) return
      if (conflict.a === conflict.b || onePassage(a.fact, b.fact)) {
        problems.push(
          `${at}: ${conflict.a} and ${conflict.b} are one passage of ${a.fact.doc}; a conflict is between two passages (two documents, or two places in one)`,
        )
        return
      }
      if (conflict.note.trim() === '') {
        problems.push(`${at} has no note`)
        return
      }
      const finding: OverlapFinding = {
        docs: [a.fact.doc, b.fact.doc],
        note: conflict.note.trim(),
        sections: [factPointer(a.fact), factPointer(b.fact)],
        review: conflict.review,
      }
      const samePassage = a.fact.doc === b.fact.doc ? sameDocFindingProblem(finding) : undefined
      if (samePassage) {
        problems.push(`${at}: ${conflict.a} and ${conflict.b} quote the same words under one heading of ${a.fact.doc}; a conflict is between two passages`)
        return
      }
      findings.push(finding)
    })
  })
  for (const id of outcome.alone) place(id, 'alone')
  const unplaced = batch.facts.map((bf) => bf.id).filter((id) => !placedAt.has(id))
  return { problems, unplaced, groups, findings }
}

/** Most problems, and most id ranges, one refusal lists. */
const REFUSAL_PROBLEMS_MAX = 25
const REFUSAL_RANGES_MAX = 40

/** The refusal for a comparison the gate does not pass, bounded, or `undefined` when it passes. */
export function groupsRefusal(check: GroupsCheck): string | undefined {
  if (check.problems.length === 0 && check.unplaced.length === 0) return undefined
  const parts: string[] = []
  if (check.unplaced.length > 0) {
    parts.push(
      `${check.unplaced.length} fact(s) placed nowhere: ${idRanges(check.unplaced, REFUSAL_RANGES_MAX)}. Put each in the group of facts about the same thing, or in "alone".`,
    )
  }
  if (check.problems.length > 0) {
    const listed = check.problems.slice(0, REFUSAL_PROBLEMS_MAX).map((p) => `  - ${p}`)
    if (check.problems.length > REFUSAL_PROBLEMS_MAX) listed.push(`  - and ${check.problems.length - REFUSAL_PROBLEMS_MAX} more`)
    parts.push(`Entries that do not stand:\n${listed.join('\n')}`)
  }
  return `Groups refused.\n\n${parts.join('\n\n')}\n\nFix these and check the whole draft again.`
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

const CHECK_GROUPS = defineToolSpec({
  name: 'check_groups',
  description:
    'Check a draft the way the run will: every fact id of the batch placed exactly once, in a group or in "alone"; every group two or more facts with a verdict; every conflict a pair of its own group\'s facts from two different passages, with a note and a review. Call it on your complete draft before you give the outcome.',
  kind: 'check-fact-groups',
  readOnly: true,
  destructive: false,
  display: {
    one: 'I checked that every fact is placed and every group judged',
    many: 'I checked that every fact is placed and every group judged, {n} passes',
  },
  inputSchema: FactComparisonWireSchema,
})

function checkGroupsTool(batch: CompareBatch): SessionTool {
  return CHECK_GROUPS.bind({
    async execute(args) {
      const check = checkGroups(args, batch)
      const refusal = groupsRefusal(check)
      if (refusal) return { content: refusal, isError: true }
      return {
        content: `The draft is complete: ${check.groups.length} group(s), ${check.findings.length} conflict(s), ${args.alone.length} fact(s) alone, all ${batch.facts.length} facts placed. Give it as the outcome.`,
      }
    },
  })
}

/**
 * The lines around a passage: from the heading above its first unit to the
 * next heading after its last, cut to {@link CONTEXT_CHARS} around the units
 * when longer, blank lines at either end dropped. Line numbers are 1-based.
 */
function passageContext(units: readonly DocUnit[], body: string): { from: number; to: number; text: string } {
  const lines = body.split('\n')
  const first = (units[0]?.startLine ?? 1) - 1
  const last = (units[units.length - 1]?.endLine ?? 1) - 1
  let from = 0
  let to = lines.length
  for (const heading of parseHeadings(lines)) {
    if (heading.line < first) from = heading.line
    else if (heading.line > last) {
      to = heading.line
      break
    }
  }
  let lo = first
  let hi = last + 1
  let chars = lines.slice(lo, hi).reduce((n, l) => n + l.length + 1, 0)
  for (let grew = true; grew; ) {
    grew = false
    if (lo > from && chars + lines[lo - 1]!.length + 1 <= CONTEXT_CHARS) {
      lo -= 1
      chars += lines[lo]!.length + 1
      grew = true
    }
    if (hi < to && chars + lines[hi]!.length + 1 <= CONTEXT_CHARS) {
      chars += lines[hi]!.length + 1
      hi += 1
      grew = true
    }
  }
  while (hi > last + 1 && lines[hi - 1]!.trim() === '') hi -= 1
  while (lo < first && lines[lo]!.trim() === '') lo += 1
  const cut = (dropped: readonly string[]): boolean => dropped.some((l) => l.trim() !== '')
  const text = [cut(lines.slice(from, lo)) ? '…' : null, ...lines.slice(lo, hi), cut(lines.slice(hi, to)) ? '…' : null]
    .filter((l) => l !== null)
    .join('\n')
  return { from: lo + 1, to: hi, text }
}

const READ_CONTEXT = defineToolSpec({
  name: 'read_context',
  description: `Read the passages some facts of your batch were recorded from, in their document: the section around each, as written. Pass up to ${CONTEXT_FACTS_MAX} fact ids per call; batch them.`,
  kind: 'read-fact-context',
  readOnly: true,
  destructive: false,
  display: {
    one: 'I read the passage around a fact before judging it',
    many: 'I read the passages around facts before judging them, {n} reads',
  },
  inputSchema: z
    .object({ facts: z.array(z.string()).describe('Fact ids from the briefing, e.g. ["F41", "F207"].') })
    .strict(),
})

function readContextTool(item: CompareItem): SessionTool {
  const byId = new Map(item.batch.facts.map((bf) => [bf.id, bf]))
  return READ_CONTEXT.bind({
    async execute(args) {
      const ids = [...new Set(args.facts)]
      if (ids.length === 0) return { content: 'Name at least one fact id.', isError: true }
      if (ids.length > CONTEXT_FACTS_MAX) {
        return { content: `${ids.length} facts in one call; open at most ${CONTEXT_FACTS_MAX} per call.`, isError: true }
      }
      const unknown = ids.filter((id) => !byId.has(id))
      if (unknown.length > 0) {
        return { content: `${unknown.join(', ')}: not a fact of this batch (F1 to F${item.batch.facts.length}).`, isError: true }
      }
      // Facts of one passage's surroundings are shown once, under all their ids.
      const blocks = new Map<string, { ids: string[]; header: string; text: string }>()
      for (const id of ids) {
        const { fact } = byId.get(id)!
        const doc = item.docs.get(fact.doc)
        if (!doc) continue
        const context = passageContext(fact.units, docBody(doc))
        const key = `${fact.doc}:${context.from}-${context.to}`
        const block = blocks.get(key)
        if (block) block.ids.push(id)
        else {
          const heading = fact.units[0]?.heading ?? '(lead)'
          blocks.set(key, { ids: [id], header: `${fact.doc} · ${heading} · lines ${context.from}-${context.to}`, text: context.text })
        }
      }
      return {
        content: [...blocks.values()].map((b) => [`--- ${b.ids.join(', ')} · ${b.header} ---`, b.text, '--- end ---'].join('\n')).join('\n\n'),
      }
    },
  })
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

const COMPARE_FACTS_SESSION = defineSessionKind({
  kind: COMPARE_FACTS_SESSION_KIND,
  outcomeSchema: FactComparisonSchema,
  outcomeInputSchema: FactComparisonWireSchema,
})

function presentComparison(outcome: FactComparison, batch: CompareBatch): KnownDisplayBlock[] {
  const check = checkGroups(outcome, batch)
  const conflicts = check.groups.filter((g) => g.verdict === 'conflict').length
  const lines = [
    `I placed ${batch.facts.length - outcome.unplaced.length} of ${batch.facts.length} facts: ${check.groups.length} group${check.groups.length === 1 ? '' : 's'}, ${conflicts} in conflict, ${outcome.alone.length} alone`,
  ]
  if (outcome.unplaced.length > 0) lines.push(`I left ${idRanges(outcome.unplaced, REFUSAL_RANGES_MAX)} unplaced`)
  return [...check.findings.map(presentOverlap), { kind: 'facts', lines }]
}

export function compareFactsSessionDef(item: CompareItem): SessionDef<FactComparison> {
  const { batch } = item
  return {
    ...COMPARE_FACTS_SESSION,
    systemPrompt: COMPARE_FACTS_SYSTEM_PROMPT,
    reasoning: 'high',
    tools: [readContextTool(item), checkGroupsTool(batch)],
    budget: COMPARE_FACTS_BUDGET,
    display: {
      title: 'Fact comparison',
      intro: `I'm comparing the ${batch.facts.length} facts of ${describeBatch(batch)}, grouping them by what they are about.`,
    },
    // The facts placed nowhere are stamped by the engine over whatever the model wrote.
    resolveOutcome: (value) => {
      const wire = FactComparisonWireSchema.parse(value)
      return { ...wire, unplaced: checkGroups(wire, batch).unplaced }
    },
    // Wrapping up, the outcome is taken as it stands, its unplaced facts stamped on it.
    validateOutcome: (outcome, { wrappingUp }) => (wrappingUp ? undefined : groupsRefusal(checkGroups(outcome, batch))),
    presentOutcome: (outcome) => presentComparison(outcome, batch),
    outcomePrecondition: {
      tool: CHECK_GROUPS.name,
      message:
        'Outcome refused: you never ran `check_groups` in this session. Call it on your complete draft now, fix what it lists, then give the outcome again.',
    },
  }
}

export function compareFactsBriefing(
  item: CompareItem,
  instructions: readonly string[] = [],
  priorOverlaps: readonly OverlapLike[] = [],
): string {
  const { batch } = item
  const lines = [
    ...instructionsBriefingBlock(instructions),
    `YOUR FACTS: the ${batch.facts.length} facts of ${describeBatch(batch)}.`,
    ...(batch.kind === 'subject'
      ? [
          'These subjects have facts in more than one batch of areas, so their facts are compared here together. Subjects whose names share a rare word are listed together: they may be one control or feature named two ways, which is exactly where two documents disagree, so judge them by what their facts say, not by their names.',
        ]
      : []),
    'Each line: id · document · the heading it sits under · [subject] statement.',
    '',
    ...batch.facts.map(
      (bf) => `${bf.id} · ${bf.fact.doc} · ${bf.fact.units[0]?.heading ?? '(lead)'} · [${bf.subject}] ${bf.fact.statement}`,
    ),
  ]
  const lifecycles = docsWithStatus(item)
  if (lifecycles.length > 0) {
    lines.push('', 'DOCUMENTS WITH A STATUS: when each last changed and where it stands.')
    for (const doc of lifecycles) lines.push(`  ${doc.path}`, ...docLifecycleLines(doc, { classify: true }).map((l) => `    ${l}`))
  }
  const prior = priorDisputesAmong(new Set(batch.facts.map((bf) => bf.fact.doc)), priorOverlaps)
  if (prior.length > 0) {
    lines.push(
      '',
      'PREVIOUSLY FLAGGED: conflicts an earlier scan reported between these documents. Re-examine each among the facts above; one that still stands is a conflict group here, one the documents no longer state is not.',
    )
    prior.forEach((o, i) => {
      const sides = (o.sections ?? []).map((s) => `${s.doc} · ${s.heading ?? '(lead)'}`).join('  <->  ')
      lines.push(`  ${i + 1}. ${sides || `${o.docs[0]}  <->  ${o.docs[1]}`}${o.note ? `  : ${o.note}` : ''}`)
    })
  }
  lines.push(
    '',
    `Place every fact from F1 to F${batch.facts.length}: group the facts about the same thing and judge each group, put every fact with no peer in "alone". Check the draft with \`check_groups\`, then give it as the outcome.`,
  )
  return lines.join('\n')
}

export const COMPARE_FACTS_SYSTEM_PROMPT = `You find where a product's documentation CONTRADICTS ITSELF by comparing the FACTS it states. Each fact was recorded from one passage of one document. The briefing gives you a batch of them, one per line under an id: \`F41 · <document> · <heading> · [<subject>] <statement>\`. Facts are listed by subject, so facts about one thing are usually next to each other.

# How to work

1. GROUP the facts by what they are ABOUT, not by their wording. Facts that state something about the same product thing (the same control, setting, endpoint, variable, limit, list or feature) form one group, even when their subjects are named differently or they sit far apart in the list. A fact no other fact of the batch speaks about goes in \`alone\`.
2. JUDGE every group of two or more. Its verdict is \`agree\` when all its facts can be true of the same product at once: facts that restate each other, add detail or describe different aspects are a group with the verdict \`agree\`. It is \`conflict\` when two of its facts cannot both be true; name each such pair.
3. When you are unsure whether two facts are compatible, OPEN THEIR PASSAGES with \`read_context\` and read them before you decide. A statement alone loses the sentence before it, the list it belongs to and the scope its heading sets. Batch the ids: several facts per call.
4. Check the draft with \`check_groups\`, fix what it lists, then give the outcome.

# What a conflict is

Two passages that CANNOT BOTH BE TRUE of the same product: "Export my data is under Settings, Account" against "under Settings, Danger Zone"; "no account needed" against "you must sign in first"; "keys are kept in your browser's local storage" against "keys are stored encrypted on the server"; a default of 30 against a default of 60.

The two passages may be in ONE document: one section says a button press is a 1px translate and another says it is a 0.97 scale. That is a conflict too. Two facts recorded from the same passage never conflict with each other.

NOT a conflict: one passage giving more detail than the other; the same fact worded differently; different audiences (a user guide and a developer guide) describing the same behavior at different depths; one document silent where another speaks; two statements about different things that happen to share a word; a plan or a hedge beside a statement of what ships; a document whose status says it was dropped, deferred or superseded.

Four rulings that decided real cases:
  - A LIST conflicts with another passage only when the list presents itself as closed or complete (it gives a count, says "complete", "all" or "only", or it is plainly the inventory of one bounded thing, such as a reference table of every tool) AND the other passage states a member it leaves out. An open or illustrative list that omits something ("for example", "such as", a few highlights) is not a conflict.
  - A SCOPED statement (the hosted service against a self-hosted install, one deployment target against another, one plan against another) conflicts with another only where the two scopes genuinely overlap.
  - A HEDGE ("may", "can", "coming soon", "planned") is not a conflict, unless the same passage also asserts the thing definitely.
  - A UNIVERSAL or CLOSED statement ("all", "every", "always", "never", "only", "entirely", "either", "both", "exactly N", "complete") conflicts with a passage that states an exception to it or a member beyond it. A statement that fully describes what one thing checks, contains or supports is closed too: "verifies the database and storage, returning 503 if either is unhealthy and 200 when both are healthy" conflicts with "checks the database, storage and Redis when configured". So does "all animations collapse to 0.01ms" with "transitions collapse to 0.01ms, except animate-spin, which keeps spinning". Read such a pair word by word before you call it agreement: an exception or an extra member is a conflict, not more detail. This does not touch the list ruling above: an open or illustrative list still conflicts with nothing it leaves out.

When you have read both passages and genuinely cannot tell whether two stated facts are compatible, report the conflict: a human should look.

# Each conflict

  - \`a\` and \`b\`: the ids of the two facts, both from the group. Side a is what \`pick-a\` names.
  - \`note\`: what differs, naming each document by its filename (for one document, its two sections).
  - \`review.explanation\`: 2 to 4 sentences naming the exact disagreement and quoting both sides, each attributed to its document by name.
  - \`review.recommendation.action\`: exactly one of "pick-a" (fact a's passage is right; b's should change), "pick-b", "fix-doc" (neither is simply right; say which doc needs which edit in \`fix\`), "dismiss" (on reflection both can hold).
  - \`review.recommendation.rationale\`: one sentence, naming the documents.
  - \`review.recommendation.confidence\`: "low", "medium" or "high". A "high" pick or dismiss is applied with no human review, so give "high" only when you would act on it unsupervised. When in doubt, the lower grade.

# The gate

Every fact id of the batch appears EXACTLY ONCE: in one group's \`facts\`, or in \`alone\`. A group holds two or more facts and a verdict. An \`agree\` group names no conflicts. A \`conflict\` group names every pair of its facts that disagree, both facts of that group, from two different passages (two documents, or two places in one), each with a note and a review. One group can hold more than one disagreement (where a control is, and what it does): name a pair for each distinct point, and one pair is enough for a point that several passages repeat. \`check_groups\` runs exactly this check.

You have ${COMPARE_FACTS_BUDGET.turns} turns, and one more grant of as many when they run out. Draft every group in your first turn or two, then read what you are unsure of.

# The outcome

One object: { "groups": [{ "subject": "Export my data", "facts": ["F41", "F207"], "verdict": "conflict", "conflicts": [{ "a": "F41", "b": "F207", "note": "exporting-your-resume.mdx puts Export my data under Settings, Account; faq.mdx under Settings, Danger Zone", "review": { "explanation": "...", "recommendation": { "action": "fix-doc", "rationale": "...", "fix": "...", "confidence": "medium" } } }] }, { "subject": "PDF page size", "facts": ["F12", "F13"], "verdict": "agree", "conflicts": [] }], "alone": ["F3", "F9"] }`
