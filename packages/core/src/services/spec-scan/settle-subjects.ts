/**
 * THE SUBJECT SETTLING — `spec-scan.settle-subjects`, a barrier after the fact
 * record. Every recorded fact names its SUBJECT on its own, so one product
 * thing goes by several names ("ATS checker", "resume checker", "ATS check").
 * This step says which names mean the same thing, the way area settling does
 * for area labels, so the comparison can put the facts about one thing side by
 * side however their recorders named it.
 *
 * Names equal after {@link subjectKey} (case, spacing, markdown markup) are one
 * name before any session runs. The rest are briefed one per line under short
 * ids (`S1`…), each with how many facts and docs use it and one statement as a
 * sample. More names than {@link SETTLE_SUBJECTS_NAMES} are divided with
 * `partitionByAffinity` over the name text, one session per part; a part of
 * one name has nothing to settle and runs no session.
 *
 * THE GATE ({@link checkSubjects}), run by `check_subjects` on a draft and by
 * `validateOutcome` on the outcome: every name id appears exactly once, in a
 * `same` entry of two or more names or in `distinct`. A wrapping-up session's
 * outcome is taken as it stands and folded leniently: a name placed twice
 * stays where it was placed first, and an entry left with fewer than two names
 * merges nothing. A failed session merges nothing: its names stay as written.
 *
 * The fold ({@link settledSubjects}) maps every fact to its SETTLED SUBJECT:
 * the `subject` its name's `same` entry gives, else the name as its facts
 * most often spell it.
 */

import { z } from 'zod'
import {
  defineSessionKind,
  defineToolSpec,
  type KnownDisplayBlock,
  type SessionBudget,
  type SessionDef,
  type SessionTool,
} from '@truecourse/agent-loop'
import { partitionByAffinity } from '@truecourse/spec-consolidator'
import type { RecordedFact } from './record-facts.js'
import { instructionsBriefingBlock, scanCacheKey } from './tools.js'

export const SETTLE_SUBJECTS_SESSION_KIND = 'spec-scan.settle-subjects'

/** One entry per part of the corpus's subject names. */
export const SETTLE_SUBJECTS_CACHE_NAME = 'consolidator/subject-settle'

/**
 * THE SUBJECT SETTLING'S VERSION, bumped by hand. A prompt change that fixes
 * wrong output bumps it in the same commit; any other prompt edit invalidates
 * nothing.
 */
export const SUBJECT_SETTLE_STAGE_VERSION = 1

/**
 * Most names one session settles. A briefed name is a line of about a hundred
 * characters, so 2,500 of them are some 65k tokens of briefing, and the
 * outcome names every id once: a few thousand tokens per draft.
 */
export const SETTLE_SUBJECTS_NAMES = 2_500

/**
 * The three numbers. The whole list rides the briefing, so the work is a
 * draft, a `check_subjects` round, a correction and the outcome: four turns,
 * six with room for a second correction, and one resume for a list whose first
 * check comes back long. The ceiling is a context level: a full part briefed is
 * some 70k tokens, and three drafts of its ids sit well under 200k.
 */
export const SETTLE_SUBJECTS_BUDGET: SessionBudget = { turns: 6, maxResumes: 1, tokenCeiling: 200_000 }

/** Longest sample statement a briefed name shows. */
const SAMPLE_CHARS = 140

/**
 * The key two subject names are one name by: lowercased, trimmed, whitespace
 * collapsed, and markdown markup dropped (code and emphasis markers, link
 * syntax, underscores that wrap a word). `ENCRYPTION_SECRET` keeps its
 * underscore.
 */
export function subjectKey(name: string): string {
  return name
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*~]/g, '')
    .replace(/(^|\s)_+(?=\S)|(?<=\S)_+(?=\s|$)/g, '$1')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** One distinct subject name, as the facts use it. */
export interface SubjectName {
  key: string
  /** The spelling most of its facts use; ties go to the first in sort order. */
  name: string
  facts: number
  docs: number
  /** The statement of its first fact, as a sample. */
  sample: string
}

/** The distinct subject names of `facts` after the deterministic merge, sorted by key. */
export function collectSubjectNames(facts: readonly RecordedFact[]): SubjectName[] {
  const byKey = new Map<string, { spellings: Map<string, number>; docs: Set<string>; facts: number; sample: string }>()
  for (const fact of facts) {
    const key = subjectKey(fact.subject)
    const entry = byKey.get(key) ?? { spellings: new Map(), docs: new Set(), facts: 0, sample: fact.statement }
    entry.spellings.set(fact.subject, (entry.spellings.get(fact.subject) ?? 0) + 1)
    entry.docs.add(fact.doc)
    entry.facts += 1
    byKey.set(key, entry)
  }
  return [...byKey]
    .map(([key, entry]) => {
      const [name] = [...entry.spellings].sort(([a, n], [b, m]) => m - n || (a < b ? -1 : a > b ? 1 : 0))[0]!
      return { key, name, facts: entry.facts, docs: entry.docs.size, sample: entry.sample }
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/** One session's work: a part of the corpus's subject names, each briefed as `S<position>`. */
export interface SubjectPart {
  /** 1-based, in plan order. */
  index: number
  /** How many parts the names were divided into. */
  parts: number
  /** Every distinct name of the corpus. */
  total: number
  names: SubjectName[]
}

/**
 * The parts the names are settled in: all of them at once up to
 * {@link SETTLE_SUBJECTS_NAMES}, else the parts `partitionByAffinity` cuts
 * over the name text. A part of fewer than two names has nothing to settle and
 * is not planned. Deterministic.
 */
export function planSubjectParts(names: readonly SubjectName[]): SubjectPart[] {
  const { parts } = partitionByAffinity(names, {
    maxSize: SETTLE_SUBJECTS_NAMES,
    text: (name) => name.name,
    origin: (name) => name.key,
  })
  return parts
    .map((part, i) => ({ index: i + 1, parts: parts.length, total: names.length, names: part }))
    .filter((part) => part.names.length >= 2)
}

/** The work item, as the session index and the transcript record it. */
export function settleSubjectsWorkItem(part: Pick<SubjectPart, 'index'>): string {
  return `subjects:${part.index}`
}

const nameId = (position: number): string => `S${position + 1}`

/**
 * The cache key, over NAMED inputs only: the stage version, the part's names
 * in briefing order (each as its facts spell it and how many facts use it),
 * and the tail (the standing instructions).
 */
export function settleSubjectsCacheKey(part: SubjectPart, extraParts: readonly string[] = []): string {
  return scanCacheKey([
    `settle-subjects-v${SUBJECT_SETTLE_STAGE_VERSION}`,
    part.names.map((name) => `${name.name}\t${name.facts}`).join('\n'),
    ...extraParts,
  ])
}

// ---------------------------------------------------------------------------
// The outcome and its gate
// ---------------------------------------------------------------------------

const SameSubjectSchema = z
  .object({
    subject: z
      .string()
      .describe('The name the product uses for the one thing these names mean: usually one of them, the most specific and most used.'),
    names: z.array(z.string()).describe('The ids of the names that mean it, two or more, e.g. ["S12", "S77"].'),
  })
  .strict()

/** What the model writes, and what is cached: the names that mean one thing, and every other name. */
export const SubjectSettlementSchema = z
  .object({
    same: z.array(SameSubjectSchema),
    distinct: z.array(z.string()).describe('The id of every name no `same` entry holds, each once.'),
  })
  .strict()
export type SubjectSettlement = z.infer<typeof SubjectSettlementSchema>

export interface SubjectsCheck {
  problems: string[]
  /** Name ids placed nowhere, in briefing order. */
  missing: string[]
}

/** Most problems, and most missing ids, one refusal lists. */
const REFUSAL_LIST_MAX = 40

/** THE GATE: what is wrong with a settlement of `count` names, and which ids it leaves out. */
export function checkSubjects(settlement: SubjectSettlement, count: number): SubjectsCheck {
  const problems: string[] = []
  const placedAt = new Map<string, string>()
  const known = (id: string): boolean => /^S\d+$/.test(id) && Number(id.slice(1)) >= 1 && Number(id.slice(1)) <= count
  const place = (id: string, where: string): void => {
    if (!known(id)) {
      problems.push(`${where} names "${id}", which is not a name of this list (S1 to S${count})`)
      return
    }
    const first = placedAt.get(id)
    if (first !== undefined) problems.push(`${id} is placed twice, in ${first} and in ${where}; place each name once`)
    else placedAt.set(id, where)
  }
  settlement.same.forEach((entry, i) => {
    const where = `same[${i}]`
    if (entry.subject.trim() === '') problems.push(`${where} has no subject`)
    if (new Set(entry.names).size < 2) problems.push(`${where} holds fewer than two names; a name that means nothing else goes in "distinct"`)
    for (const id of entry.names) place(id, where)
  })
  for (const id of settlement.distinct) place(id, 'distinct')
  const missing = Array.from({ length: count }, (_, i) => nameId(i)).filter((id) => !placedAt.has(id))
  return { problems, missing }
}

/** The refusal for a settlement the gate does not pass, bounded, or `undefined` when it passes. */
export function subjectsRefusal(check: SubjectsCheck): string | undefined {
  if (check.problems.length === 0 && check.missing.length === 0) return undefined
  const parts: string[] = []
  if (check.missing.length > 0) {
    const shown = check.missing.slice(0, REFUSAL_LIST_MAX).join(', ')
    const more = check.missing.length > REFUSAL_LIST_MAX ? `, and ${check.missing.length - REFUSAL_LIST_MAX} more` : ''
    parts.push(`${check.missing.length} name(s) placed nowhere: ${shown}${more}. Put each in a "same" entry or in "distinct".`)
  }
  if (check.problems.length > 0) {
    const listed = check.problems.slice(0, REFUSAL_LIST_MAX).map((p) => `  - ${p}`)
    if (check.problems.length > REFUSAL_LIST_MAX) listed.push(`  - and ${check.problems.length - REFUSAL_LIST_MAX} more`)
    parts.push(listed.join('\n'))
  }
  return `Settlement refused.\n\n${parts.join('\n\n')}\n\nFix these and check the whole settlement again.`
}

/**
 * What a settlement merges, leniently: each name's key to the subject of the
 * first `same` entry that holds it, for every entry left with two or more
 * names. A name merged nowhere is absent.
 */
export function subjectMerges(part: SubjectPart, settlement: SubjectSettlement): Map<string, string> {
  const merges = new Map<string, string>()
  const byId = new Map(part.names.map((name, i) => [nameId(i), name]))
  for (const entry of settlement.same) {
    const names = [...new Set(entry.names)].flatMap((id) => {
      const name = byId.get(id)
      return name && !merges.has(name.key) ? [name] : []
    })
    if (names.length < 2) continue
    const subject = entry.subject.trim() || names[0]!.name
    for (const name of names) merges.set(name.key, subject)
  }
  return merges
}

/**
 * Every fact's settled subject: the subject its name was merged into, else
 * its name as its facts most often spell it.
 */
export function settledSubjects(
  facts: readonly RecordedFact[],
  names: readonly SubjectName[],
  merges: ReadonlyMap<string, string>,
): Map<RecordedFact, string> {
  const spelled = new Map(names.map((name) => [name.key, name.name]))
  return new Map(
    facts.map((fact) => {
      const key = subjectKey(fact.subject)
      return [fact, merges.get(key) ?? spelled.get(key) ?? fact.subject]
    }),
  )
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

const CHECK_SUBJECTS = defineToolSpec({
  name: 'check_subjects',
  description:
    'Check a draft settlement the way the run will: every name id of your list placed exactly once, in a "same" entry of two or more names or in "distinct". Call it on your complete draft before you give the outcome.',
  kind: 'check-subject-settlement',
  readOnly: true,
  destructive: false,
  display: {
    one: 'I checked that every subject name is placed once',
    many: 'I checked that every subject name is placed once, {n} passes',
  },
  inputSchema: SubjectSettlementSchema,
})

function checkSubjectsTool(count: number): SessionTool {
  return CHECK_SUBJECTS.bind({
    async execute(args) {
      const refusal = subjectsRefusal(checkSubjects(args, count))
      if (refusal) return { content: refusal, isError: true }
      const merged = args.same.reduce((n, entry) => n + entry.names.length, 0)
      return {
        content: `The settlement is complete: ${args.same.length} subject(s) named more than one way, ${merged} name(s) merged into them, ${args.distinct.length} distinct. Give it as the outcome.`,
      }
    },
  })
}

const SETTLE_SUBJECTS_SESSION = defineSessionKind({
  kind: SETTLE_SUBJECTS_SESSION_KIND,
  outcomeSchema: SubjectSettlementSchema,
})

function presentSubjectSettlement(settlement: SubjectSettlement): KnownDisplayBlock[] {
  const merged = settlement.same.reduce((n, entry) => n + entry.names.length, 0)
  const lines =
    settlement.same.length === 0
      ? ['Every name names a different thing; I merged nothing']
      : [`I found ${settlement.same.length} subject${settlement.same.length === 1 ? '' : 's'} named more than one way, ${merged} names in all`]
  return [{ kind: 'facts', lines }]
}

export function settleSubjectsSessionDef(part: SubjectPart): SessionDef<SubjectSettlement> {
  const count = part.names.length
  return {
    ...SETTLE_SUBJECTS_SESSION,
    systemPrompt: SETTLE_SUBJECTS_SYSTEM_PROMPT,
    tools: [checkSubjectsTool(count)],
    budget: SETTLE_SUBJECTS_BUDGET,
    display: {
      title: 'Subject settling',
      intro: `I'm settling ${count} subject names, merging the ones that name the same product thing.`,
    },
    // Wrapping up, the settlement is taken as it stands and folded leniently.
    validateOutcome: (outcome, { wrappingUp }) => (wrappingUp ? undefined : subjectsRefusal(checkSubjects(outcome, count))),
    presentOutcome: presentSubjectSettlement,
    outcomePrecondition: {
      tool: CHECK_SUBJECTS.name,
      message:
        'Outcome refused: you never ran `check_subjects` in this session. Call it on your complete draft now, fix what it lists, then give the outcome again.',
    },
  }
}

const clip = (text: string, max: number): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export function settleSubjectsBriefing(part: SubjectPart, instructions: readonly string[] = []): string {
  const count = part.names.length
  const scope =
    part.parts > 1
      ? `part ${part.index} of ${part.parts}: ${count} of the ${part.total} subject names the recorded facts use, grouped so names that share words sit in one part. Other sessions settle the rest.`
      : `all ${count} subject names the recorded facts use.`
  return [
    ...instructionsBriefingBlock(instructions),
    `SUBJECT NAMES, ${scope}`,
    'Each line: id · name · how many facts and documents use it · one statement as a sample.',
    '',
    ...part.names.map(
      (name, i) =>
        `${nameId(i)} · ${name.name} · ${name.facts} fact${name.facts === 1 ? '' : 's'} in ${name.docs} doc${name.docs === 1 ? '' : 's'} · "${clip(name.sample, SAMPLE_CHARS)}"`,
    ),
    '',
    `Place every id from S1 to S${count} once: in a "same" entry with the other names of the same product thing, or in "distinct". Check the draft with \`check_subjects\`, then give it as the outcome.`,
  ].join('\n')
}

export const SETTLE_SUBJECTS_SYSTEM_PROMPT = `You settle the SUBJECT NAMES of a documentation corpus's recorded facts. Each fact was recorded from one document by a session that named its subject on its own: the product thing the fact is about, such as a control, a setting, an endpoint, an environment variable or a feature. So one thing goes by several names: "ATS checker", "resume checker", "ATS check". Your outcome says which names mean the same thing, so the facts about one thing are compared side by side.

# Same or distinct

Names are the SAME when they name one product thing: the same control, setting, endpoint, variable or feature, spelled, abbreviated or phrased differently ("Export my data" and "Export data button"; "ENCRYPTION_SECRET" and "encryption secret"). A name that only adds an aspect of the thing ("Export my data location", "ATS checker limits") names the thing itself.

They are DISTINCT when they name different things, however closely related: a feature and one of its own settings ("ATS checker" and "ATS checker threshold"), two endpoints of one resource ("GET /api/resume" and "DELETE /api/resume"), two variables, a whole and one of its parts, a general thing and a specific one ("Exports" and "PDF export").

A wrong merge puts facts about two things side by side; a missed merge keeps facts about one thing apart, where a contradiction between them goes unseen. Both cost. When the names alone do not settle it, the sample statements usually do.

# The outcome

Every id of the list appears EXACTLY ONCE: in one \`same\` entry of two or more names, or in \`distinct\`. A \`same\` entry's \`subject\` is the name the product uses for the thing: usually one of its names, the most specific and the most used. \`check_subjects\` runs exactly the check the run will: call it on your complete draft, fix what it lists, then give the outcome.

You have ${SETTLE_SUBJECTS_BUDGET.turns} turns, and one more grant of as many when they run out. Draft the whole settlement in your first turn.

One object: { "same": [{ "subject": "ATS checker", "names": ["S12", "S340", "S77"] }], "distinct": ["S1", "S2", "S3"] }`
