/**
 * THE FACT RECORD — `spec-scan.record-facts`, one session per WINDOW of one
 * kept prose doc: consecutive sections of its sentences (`splitDocSentences`,
 * `planSentenceWindows`). It is the first half of finding conflicts by comparing
 * facts: each session writes the LEDGER of one window, the concrete facts its
 * sentences state and the sentences it skips with a reason.
 *
 * The session's whole attention is one window of one doc. It is briefed with
 * the doc's ref, title, lifecycle, outline and area tags, and the window's
 * sentences, numbered. Its tools are closed (`check_ledger`, and `read_section`
 * over the same doc only), so it runs on every driver; no other doc is
 * reachable.
 *
 * THE GATE is one function ({@link checkLedger}), run by `check_ledger` on a
 * draft, by `validateOutcome` on the outcome, and again by the run's fold:
 * every sentence of the window is cited by a fact or lies inside a skip; a fact
 * cites 1 to {@link FACT_SENTENCES_MAX} sentences of the window, and one or more of the
 * doc's own area tags as curation wrote them; no sentence is both cited and
 * skipped; a skip for `other` carries a note. A wrapping-up session's outcome
 * is accepted as it stands, and what the gate finds uncovered there is
 * STAMPED into it as `unrecorded`, by the engine, before it is cached: the
 * model's own answer has no such field. An entry the gate refuses never
 * stands: its sentences count as unrecorded unless another entry covers them.
 *
 * A fact carries the doc's RAW area tags; the run canonicalizes them through
 * the settled vocabulary exactly as it does the doc's own tags, so a change in
 * how areas settle never re-records a ledger.
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
import {
  FactSkipReasonSchema,
  SENTENCE_SPLITTER_VERSION,
  docBody,
  headingOutline,
  normalizeArea,
  planSentenceWindows,
  presentSentence,
  splitDocSentences,
  type AreaTag,
  type DocCandidate,
  type DocLedgerCounts,
  type DocSentence,
  type FactSkipReason,
  type SentenceWindow,
  type VocabMap,
} from '@truecourse/spec-consolidator'
import { canonicalDocTags, reconcileDocTagsWithPrior } from './settle-areas.js'
import {
  buildScanUniverse,
  docLifecycleFingerprint,
  docLifecycleLines,
  docTitle,
  instructionsBriefingBlock,
  readSectionTool,
  scanCacheKey,
} from './tools.js'

export const RECORD_FACTS_SESSION_KIND = 'spec-scan.record-facts'

/** One entry per doc window. */
export const RECORD_FACTS_CACHE_NAME = 'consolidator/fact-record'

/**
 * THE RECORD STEP'S VERSION, bumped by hand. A prompt change that fixes wrong
 * output bumps it in the same commit; any other prompt edit invalidates nothing.
 */
export const RECORD_STAGE_VERSION = 2

/** Most sentences one window holds. */
export const RECORD_WINDOW_SENTENCES = 120

/** Most characters of sentence text one window holds. */
export const RECORD_WINDOW_CHARS = 24_000

/** Most sentences one fact cites. */
export const FACT_SENTENCES_MAX = 3

/**
 * The three numbers. A window is read whole from the briefing, so the work is
 * one draft, a `check_ledger` round, a correction and the outcome, with a
 * turn or two of `read_section` for context: about five turns, eight with
 * room for a second correction. One resume covers a window whose first check
 * comes back long. The ceiling is a context LEVEL: a full window briefed is
 * some 10k tokens, and each draft of a ledger over 120 sentences another 5k, so
 * three drafts and their checks sit well under it.
 */
export const RECORD_FACTS_BUDGET: SessionBudget = { turns: 8, maxResumes: 1, tokenCeiling: 120_000 }

const RecordedFactWireSchema = z
  .object({
    sentences: z
      .array(z.number().int())
      .describe(`The numbers of the sentences the fact is stated in: one, or up to ${FACT_SENTENCES_MAX} when it spans them.`),
    subject: z
      .string()
      .describe(
        'The product THING the fact is about, as the product names it and as specific as possible: a control, a setting, an endpoint, an environment variable, a feature ("ATS checker", "Export my data", "/api/health", "ENCRYPTION_SECRET", "Application Tracker views"). Never the product as a whole, never an aspect such as "location" or "limits". One to five words.',
      ),
    statement: z
      .string()
      .describe('The fact as ONE declarative sentence that can be read alone, naming the product thing it is about.'),
    areas: z.array(z.string()).describe('One or more of the document\'s area tags, exactly as the briefing lists them.'),
  })
  .strict()
type RecordedFactWire = z.infer<typeof RecordedFactWireSchema>

const LedgerSkipWireSchema = z
  .object({
    from: z.number().int().describe('The first sentence of the range.'),
    to: z.number().int().describe('The last sentence of the range, inclusive: equal to `from` for one sentence.'),
    why: FactSkipReasonSchema,
    note: z.string().optional().describe('What the sentences are. Required when `why` is "other".'),
  })
  .strict()
type LedgerSkipWire = z.infer<typeof LedgerSkipWireSchema>

/** What the model writes: the window's facts and skips, nothing about its own coverage. */
export const FactLedgerWireSchema = z
  .object({
    facts: z.array(RecordedFactWireSchema),
    skips: z.array(LedgerSkipWireSchema),
  })
  .strict()
export type FactLedgerWire = z.infer<typeof FactLedgerWireSchema>

export const FactLedgerSchema = FactLedgerWireSchema.extend({
  /**
   * The window's sentences the gate found uncovered, ascending. STAMPED by the
   * engine when the outcome is accepted, before it is cached; empty unless the
   * session was wrapping up.
   */
  unrecorded: z.array(z.number().int()),
}).strict()
export type FactLedger = z.infer<typeof FactLedgerSchema>

// ---------------------------------------------------------------------------
// The work
// ---------------------------------------------------------------------------

/** One session's work: one window of one doc. */
export interface RecordFactsItem {
  doc: DocCandidate
  /** Every sentence of the doc, numbered. */
  sentences: readonly DocSentence[]
  window: SentenceWindow
  /** How many windows the doc has. */
  windows: number
  /** The doc's area tags as curation wrote them, `product/concern`, sorted. */
  areas: readonly string[]
}

/** A raw area tag as the session sees and cites it. */
export const rawAreaTag = (tag: AreaTag): string => `${tag.product}/${tag.concern}`

/** A doc's raw area tags, deduplicated and sorted. */
export function rawAreaTags(tags: readonly AreaTag[]): string[] {
  return [...new Set(tags.map(rawAreaTag))].sort()
}

/** What files a fact's raw area tag under the corpus's areas. */
export interface FactAreaContext {
  /** Each kept doc's tags as its curation verdict wrote them, by ref. */
  rawTags: ReadonlyMap<string, readonly AreaTag[]>
  /** Each doc's area ids in the last scan's corpus, by ref. */
  priorTags: ReadonlyMap<string, readonly string[]>
  /** The area settlement's concern rewrites, per doc ref. */
  reassignments: ReadonlyMap<string, ReadonlyMap<string, string>>
  vocab: VocabMap
  /** The area ids a decision pins a doc to, replacing its own tags, by ref. */
  pinned: ReadonlyMap<string, readonly string[]>
}

/**
 * The area ids one raw tag of doc `ref` lands in: the path the doc's own tags
 * take (reconciled with the last scan's, canonicalized, reassigned by the
 * settlement, folded through the settled vocabulary), one tag at a time. A doc
 * a decision pins files every fact under the pinned areas.
 */
export function factAreaIds(ctx: FactAreaContext, ref: string, raw: string): string[] {
  const pinned = ctx.pinned.get(ref)
  if (pinned) return [...pinned]
  const tag = (ctx.rawTags.get(ref) ?? []).find((t) => rawAreaTag(t) === raw)
  if (!tag) return []
  const perDoc = ctx.reassignments.get(ref)
  return canonicalDocTags(reconcileDocTagsWithPrior([tag], ctx.priorTags.get(ref) ?? []))
    .map((t) => {
      const to = perDoc?.get(t.concern)
      return to === undefined ? t : { ...t, concern: to }
    })
    .flatMap((t) => normalizeArea(t, ctx.vocab) ?? [])
}

/** A doc's sentences, and the windows the record step cuts them into. */
export function recordWindows(doc: DocCandidate): { sentences: DocSentence[]; windows: SentenceWindow[] } {
  const sentences = splitDocSentences(docBody(doc))
  return { sentences, windows: planSentenceWindows(sentences, { maxSentences: RECORD_WINDOW_SENTENCES, maxChars: RECORD_WINDOW_CHARS }) }
}

/** The record sessions one doc takes: one per window of its sentences. None for a doc with no area tag. */
export function recordFactsItems(doc: DocCandidate, tags: readonly AreaTag[]): RecordFactsItem[] {
  const areas = rawAreaTags(tags)
  if (areas.length === 0) return []
  const { sentences, windows } = recordWindows(doc)
  return windows.map((window) => ({ doc, sentences, window, windows: windows.length, areas }))
}

/** The work item, as the session index and the transcript record it. */
export function recordFactsWorkItem(item: Pick<RecordFactsItem, 'doc' | 'window'>): string {
  return `facts:${item.doc.path}:${item.window.from}-${item.window.to}`
}

/**
 * The cache key, over NAMED inputs only: the stage version, the splitter
 * version, the doc's ref, content hash and lifecycle, its frontmatter sentences
 * (the content hash leaves frontmatter out, and every line of it is a sentence),
 * its raw area tags, the window's sentence range, and the tail (the standing
 * instructions).
 */
export function recordFactsCacheKey(item: RecordFactsItem, extraParts: readonly string[] = []): string {
  const frontmatter = item.sentences.flatMap((u) => (u.kind === 'frontmatter' ? [`${u.field ?? 'rest'}=${u.text}`] : []))
  return scanCacheKey([
    `record-facts-v${RECORD_STAGE_VERSION}`,
    `sentences-v${SENTENCE_SPLITTER_VERSION}`,
    item.doc.path,
    item.doc.contentHash,
    docLifecycleFingerprint(item.doc),
    frontmatter.join('\n'),
    [...item.areas].sort().join(','),
    `${item.window.from}-${item.window.to}`,
    ...extraParts,
  ])
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/** What a ledger is checked against. */
export interface LedgerScope {
  window: SentenceWindow
  /** The doc's raw area tags. */
  areas: readonly string[]
}

export interface LedgerCheck {
  /** Each entry the gate refuses, and why. */
  problems: string[]
  /** Window sentences no standing fact cites and no standing skip covers, ascending. */
  uncovered: number[]
  /** The facts that stand, in ledger order. */
  facts: RecordedFactWire[]
  /** Sentences of standing skips that no standing fact cites, per reason. */
  skipped: Partial<Record<FactSkipReason, number>>
}

/** `1-3, 5, 7-8`: ascending sentence numbers as ranges, at most `max` of them. */
export function sentenceRanges(sentences: readonly number[], max = Number.POSITIVE_INFINITY): string {
  const ranges: string[] = []
  let shown = 0
  for (let i = 0; i < sentences.length && ranges.length < max; ) {
    let j = i
    while (j + 1 < sentences.length && sentences[j + 1] === sentences[j]! + 1) j++
    ranges.push(i === j ? `${sentences[i]}` : `${sentences[i]}-${sentences[j]}`)
    shown = j + 1
    i = j + 1
  }
  const rest = sentences.length - shown
  return rest > 0 ? `${ranges.join(', ')}, and ${rest} more` : ranges.join(', ')
}

function factProblems(fact: RecordedFactWire, scope: LedgerScope, known: ReadonlySet<string>): string[] {
  const { from, to } = scope.window
  const problems: string[] = []
  if (fact.sentences.length === 0 || fact.sentences.length > FACT_SENTENCES_MAX) {
    problems.push(`cites ${fact.sentences.length} sentences; a fact cites 1 to ${FACT_SENTENCES_MAX}`)
  }
  const outside = fact.sentences.filter((u) => u < from || u > to)
  if (outside.length > 0) problems.push(`cites sentence ${outside.join(', ')}, outside this window (${from}-${to})`)
  if (fact.statement.trim() === '') problems.push('has no statement')
  if (fact.subject.trim() === '') problems.push('has no subject')
  const unknown = fact.areas.filter((a) => !known.has(a))
  if (fact.areas.length === 0) problems.push(`names no area; name one or more of ${scope.areas.join(', ')}`)
  else if (unknown.length > 0) {
    problems.push(`names ${unknown.map((a) => `"${a}"`).join(', ')}, not an area of this document (${scope.areas.join(', ')})`)
  }
  return problems
}

function skipProblems(skip: LedgerSkipWire, scope: LedgerScope): string[] {
  const { from, to } = scope.window
  const problems: string[] = []
  if (skip.from > skip.to) problems.push(`runs backwards (${skip.from} to ${skip.to})`)
  else if (skip.from < from || skip.to > to) problems.push(`reaches outside this window (${from}-${to})`)
  if (skip.why === 'other' && !skip.note?.trim()) problems.push('is for "other" and has no note saying what the sentences are')
  return problems
}

/**
 * THE GATE. What is wrong with a ledger for its window, which sentences it leaves
 * uncovered, and what of it stands: a refused entry covers nothing, and a sentence
 * both cited and skipped counts as cited.
 */
export function checkLedger(ledger: FactLedgerWire, scope: LedgerScope): LedgerCheck {
  const known = new Set(scope.areas)
  const problems: string[] = []
  const facts: RecordedFactWire[] = []
  const cited = new Set<number>()
  ledger.facts.forEach((fact, i) => {
    const found = factProblems(fact, scope, known)
    if (found.length > 0) {
      problems.push(...found.map((p) => `facts[${i}] ${p}`))
      return
    }
    facts.push(fact)
    for (const sentence of fact.sentences) cited.add(sentence)
  })
  const skippedAs = new Map<number, FactSkipReason>()
  ledger.skips.forEach((skip, i) => {
    const found = skipProblems(skip, scope)
    if (found.length > 0) {
      problems.push(...found.map((p) => `skips[${i}] ${p}`))
      return
    }
    for (let sentence = skip.from; sentence <= skip.to; sentence++) if (!skippedAs.has(sentence)) skippedAs.set(sentence, skip.why)
  })
  const both = [...cited].filter((u) => skippedAs.has(u)).sort((a, b) => a - b)
  if (both.length > 0) {
    problems.push(`sentence ${sentenceRanges(both)} is both cited by a fact and skipped; a sentence is one or the other`)
  }
  const uncovered: number[] = []
  const skipped: Partial<Record<FactSkipReason, number>> = {}
  for (let sentence = scope.window.from; sentence <= scope.window.to; sentence++) {
    const why = skippedAs.get(sentence)
    if (cited.has(sentence)) continue
    if (why) skipped[why] = (skipped[why] ?? 0) + 1
    else uncovered.push(sentence)
  }
  return { problems, uncovered, facts, skipped }
}

/** Most problems one refusal lists; the rest are counted. */
const REFUSAL_PROBLEMS_MAX = 25
/** Most sentence ranges one refusal lists. */
const REFUSAL_RANGES_MAX = 40

/** The refusal for a ledger the gate does not pass, bounded, or `undefined` when it passes. */
export function ledgerRefusal(check: LedgerCheck): string | undefined {
  if (check.problems.length === 0 && check.uncovered.length === 0) return undefined
  const parts: string[] = []
  if (check.uncovered.length > 0) {
    parts.push(
      `${check.uncovered.length} sentence(s) no fact cites and no skip covers: ${sentenceRanges(check.uncovered, REFUSAL_RANGES_MAX)}. Record the facts each states, or skip it with the reason that fits.`,
    )
  }
  if (check.problems.length > 0) {
    const listed = check.problems.slice(0, REFUSAL_PROBLEMS_MAX).map((p) => `  - ${p}`)
    if (check.problems.length > REFUSAL_PROBLEMS_MAX) listed.push(`  - and ${check.problems.length - REFUSAL_PROBLEMS_MAX} more`)
    parts.push(`Entries that do not stand (they cover nothing until fixed):\n${listed.join('\n')}`)
  }
  return `Ledger refused.\n\n${parts.join('\n\n')}\n\nFix these and check the whole ledger again.`
}

const skippedTotal = (skipped: Partial<Record<FactSkipReason, number>>): number =>
  Object.values(skipped).reduce((sum, n) => sum + (n ?? 0), 0)

const CHECK_LEDGER = defineToolSpec({
  name: 'check_ledger',
  description:
    'Check a draft ledger the way the run will: every sentence of your window cited by a fact or inside a skip, each fact citing 1 to 3 sentences of the window and areas the document has, no sentence both cited and skipped, a note on every "other" skip. Call it on your complete draft before you give the outcome.',
  kind: 'check-fact-ledger',
  readOnly: true,
  destructive: false,
  display: {
    one: 'I checked that every sentence of the window is recorded or skipped',
    many: 'I checked that every sentence of the window is recorded or skipped, {n} passes',
  },
  inputSchema: FactLedgerWireSchema,
})

function checkLedgerTool(scope: LedgerScope): SessionTool {
  return CHECK_LEDGER.bind({
    async execute(args) {
      const check = checkLedger(args, scope)
      const refusal = ledgerRefusal(check)
      if (refusal) return { content: refusal, isError: true }
      return {
        content: `The ledger is complete: ${check.facts.length} fact(s), ${skippedTotal(check.skipped)} sentence(s) skipped, every sentence from ${scope.window.from} to ${scope.window.to} accounted for. Give it as the outcome.`,
      }
    },
  })
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

const RECORD_FACTS_SESSION = defineSessionKind({
  kind: RECORD_FACTS_SESSION_KIND,
  outcomeSchema: FactLedgerSchema,
  outcomeInputSchema: FactLedgerWireSchema,
})

function presentLedger(ledger: FactLedger): KnownDisplayBlock[] {
  const skipped = ledger.skips.reduce((sum, s) => sum + Math.max(0, s.to - s.from + 1), 0)
  const lines = [
    `I recorded ${ledger.facts.length} fact${ledger.facts.length === 1 ? '' : 's'} and skipped ${skipped} sentence${skipped === 1 ? '' : 's'}`,
  ]
  if (ledger.unrecorded.length > 0) lines.push(`I left sentence ${sentenceRanges(ledger.unrecorded, REFUSAL_RANGES_MAX)} unrecorded`)
  return [{ kind: 'facts', lines }]
}

export function recordFactsSessionDef(item: RecordFactsItem): SessionDef<FactLedger> {
  const scope: LedgerScope = { window: item.window, areas: item.areas }
  return {
    ...RECORD_FACTS_SESSION,
    systemPrompt: RECORD_FACTS_SYSTEM_PROMPT,
    tools: [readSectionTool(buildScanUniverse([item.doc])), checkLedgerTool(scope)],
    budget: RECORD_FACTS_BUDGET,
    display: {
      title: 'Fact record',
      intro: `I'm recording what sentences ${item.window.from} to ${item.window.to} of ${item.doc.path} state, one sentence at a time.`,
    },
    // The gaps are stamped by the engine over whatever the model wrote.
    resolveOutcome: (value) => {
      const wire = FactLedgerWireSchema.parse(value)
      return { ...wire, unrecorded: checkLedger(wire, scope).uncovered }
    },
    // Wrapping up, the ledger is taken as it stands, its gaps stamped on it.
    validateOutcome: (outcome, { wrappingUp }) => (wrappingUp ? undefined : ledgerRefusal(checkLedger(outcome, scope))),
    presentOutcome: presentLedger,
    outcomePrecondition: {
      tool: CHECK_LEDGER.name,
      message:
        'Outcome refused: you never ran `check_ledger` in this session. Call it on your complete draft now, fix what it lists, then give the outcome again.',
    },
  }
}

export function recordFactsBriefing(item: RecordFactsItem, instructions: readonly string[] = []): string {
  const { doc, sentences, window } = item
  const lines = [
    ...instructionsBriefingBlock(instructions),
    `DOCUMENT: ${doc.path}  ·  ${docTitle(doc)}`,
    ...docLifecycleLines(doc, { classify: true }),
    `AREA TAGS (every fact names one or more, exactly as written): ${item.areas.join(', ')}`,
    '',
    'OUTLINE:',
    headingOutline(docBody(doc)),
    '',
    item.windows > 1
      ? `YOUR WINDOW: sentences ${window.from} to ${window.to} of ${sentences.length} (window ${window.index} of ${item.windows}; other sessions record the rest).`
      : `YOUR WINDOW: all ${sentences.length} sentences of the document.`,
  ]
  let heading: string | null | undefined
  for (const sentence of sentences.slice(window.from - 1, window.to)) {
    if (sentence.heading !== heading) {
      heading = sentence.heading
      lines.push('', heading === null ? '(above the first heading)' : `## ${heading}`)
    }
    lines.push(presentSentence(sentence, sentences, window))
  }
  lines.push(
    '',
    `Account for every sentence from ${window.from} to ${window.to}: record the facts it states, or skip it with the reason that fits. Check the ledger with \`check_ledger\`, then give it as the outcome.`,
  )
  return lines.join('\n')
}

export const RECORD_FACTS_SYSTEM_PROMPT = `You record the FACTS one documentation file states, sentence by sentence. The briefing gives you one WINDOW of one document: its sentences, numbered. A sentence here is a sentence of a paragraph or of a list item (an item's first sentence carries its marker, its later ones are indented under it), or one table row, one code block or part of a long one, a frontmatter title or description, a run of the frontmatter's other lines, or the title a component gives its content. Your outcome is the window's LEDGER: the facts its sentences state, and the sentences you skip.

# What a fact is

A fact is one concrete statement another document could state differently:
  - the name and location of a control: which page, which menu, which tab, which button;
  - a number, a limit, a default, a size, a version;
  - an environment variable, a config key, an endpoint and its method, a header, a command;
  - a tool's name, and how many tools or options there are;
  - a list of supported formats, providers, languages or platforms;
  - an authentication method;
  - where data is stored, and who can see it;
  - which steps are required, and in what order;
  - what happens on an error, or when something is missing;
  - what is free, and what needs an account, a key or a plan.

A frontmatter description that says something about the product is a fact like any sentence, and so is a design token or a setting the frontmatter declares.

# What must be recorded

Three kinds of sentence look skippable and are not:
  - A sentence that says a list or table is complete, or gives its count ("A complete list of the environment variables you can configure:", "There are six button variants") is a fact: record what it says is complete, or the count.
  - A list or table that is the INVENTORY of one thing (all the tools, all the variables, all the views, all the providers) yields, beside the fact each of its rows or items states, ONE fact for the inventory as a whole, naming its members ("The MCP server provides these tools: list_resumes, get_resume, create_resume."). It cites the sentence that introduces the list or table, or its first rows. That is how a member another document mentions and this one lacks can be seen.
  - What a document says it contains or lacks, when it names specific things ("examples for Nginx and Caddy", "contributions welcome for Traefik and Caddy"), is a fact, in its frontmatter description as anywhere else.

# How to write one

  - \`statement\`: ONE declarative sentence that can be read alone. It names the product thing it is about, never "it", "this", "this page", "the above" or "the following". Keep the document's own names and values exactly, and keep its quantifiers and closure words: all, every, only, either, both, never, always, entirely, complete, exactly N. "A failure in either dependency returns HTTP 503" records "either", not "the database or storage fails"; a contradiction often turns on that one word.
  - \`subject\`: the product THING the fact is about, as the product names it and as specific as possible: a control, a setting, an endpoint, an environment variable, a feature: "ATS checker", "Export my data", "/api/health", "ENCRYPTION_SECRET", "Application Tracker views". Never the product as a whole, and never an aspect of a thing ("location", "limits", "behavior"): the fact's statement says which aspect. One to five words. Facts about the same thing carry the same subject, spelled the same way.
  - \`sentences\`: the numbers of the sentences the fact is stated in: one, or up to three when it spans them (a list item and the sentence introducing the list).
  - \`areas\`: the ones the fact belongs to among the document's area tags, exactly as the briefing lists them.

A sentence that states two facts yields two facts. Every clause that asserts something is a fact of its own: a second sentence, a recommendation ("prefer the named volume from the example Compose file"), a condition, a default, an exception. A fact that keeps one clause of a sentence and drops the rest has lost what another document may contradict. A table row and a list item each need their own decision: a table of 40 rows is 40 sentences, and every row that states a fact yields one. A code block that names commands, variables, keys or endpoints states facts.

# Skipping

Skip only sentences that state no such fact. A skip is a range of consecutive sentences, \`from\` to \`to\`, with the reason that fits:
  - "navigation": links onward, "see also", calls to action, a title that only names what follows;
  - "advice": tips and recommendations that say nothing about how the product behaves;
  - "rationale": why something is the way it is, history, motivation;
  - "marketing": praise, slogans, claims of quality;
  - "competitor": what another product does;
  - "example": sample values or sample output that only illustrate;
  - "legal": licence and legal boilerplate;
  - "other": anything else, with a \`note\` saying what the sentences are.

# The gate

Every sentence of the window must be cited by at least one fact or lie inside a skip, and no sentence may be both. A fact cites sentences of this window only, and areas the document has. \`check_ledger\` runs exactly the check the run will: call it on your complete draft, fix what it lists, then give the outcome. Sentences outside your window are recorded by other sessions; read another section with \`read_section\` only when a sentence cannot be understood without it.

Before you give the outcome, re-read each sentence your facts cite and ask what else it says: a second sentence, a recommendation, a condition, a default, an exception or a closure word your facts leave out is a fact still to record.

You have ${RECORD_FACTS_BUDGET.turns} turns, and one more grant of as many when they run out. Draft the whole ledger in your first turn or two.

# The outcome

One object: { "facts": [{ "sentences": [17], "subject": "Export my data", "statement": "Export my data is under Settings, Account.", "areas": ["core/exports"] }], "skips": [{ "from": 1, "to": 3, "why": "navigation" }] }`

// ---------------------------------------------------------------------------
// The doc's ledger, folded
// ---------------------------------------------------------------------------

/** One recorded fact as the run keeps it. */
export interface RecordedFact {
  /** The doc it is recorded from, by ref. */
  doc: string
  /** The sentences it cites, in doc order. */
  sentences: DocSentence[]
  subject: string
  statement: string
  /** Its areas, as canonical area ids. */
  areas: string[]
}

/** One doc's facts and skips across its windows, as the run folds them. */
export interface DocFactLedger {
  doc: string
  /** Every sentence of the doc. */
  sentences: readonly DocSentence[]
  facts: RecordedFact[]
  /** Sentences skipped, per reason. */
  skipped: Partial<Record<FactSkipReason, number>>
  /** Sentences the recording left unaccounted for, ascending. */
  unrecorded: number[]
  /** Windows whose session failed: their sentences are in none of the lists. */
  failed: SentenceWindow[]
}

export interface DocLedgerInput {
  doc: string
  sentences: readonly DocSentence[]
  /** The doc's raw area tags. */
  areas: readonly string[]
  /** Each window's ledger, `null` for one whose session failed. */
  windows: ReadonlyArray<{ window: SentenceWindow; ledger: FactLedgerWire | null }>
  /** The canonical area ids one raw tag of this doc lands in. */
  canonicalAreas: (raw: string) => readonly string[]
}

/**
 * A doc's ledger from its windows' outcomes, each re-checked by the gate: only
 * what stands is kept, and a fact's raw areas become canonical area ids.
 */
export function docFactLedger(input: DocLedgerInput): DocFactLedger {
  const facts: RecordedFact[] = []
  const skipped: Partial<Record<FactSkipReason, number>> = {}
  const unrecorded: number[] = []
  const failed: SentenceWindow[] = []
  for (const { window, ledger } of [...input.windows].sort((a, b) => a.window.from - b.window.from)) {
    if (!ledger) {
      failed.push(window)
      continue
    }
    const check = checkLedger(ledger, { window, areas: input.areas })
    for (const fact of check.facts) {
      facts.push({
        doc: input.doc,
        sentences: [...new Set(fact.sentences)].sort((a, b) => a - b).flatMap((n) => input.sentences[n - 1] ?? []),
        subject: fact.subject.trim(),
        statement: fact.statement.trim(),
        areas: [...new Set(fact.areas.flatMap((raw) => input.canonicalAreas(raw)))].sort(),
      })
    }
    for (const reason of FactSkipReasonSchema.options) {
      const n = check.skipped[reason]
      if (n !== undefined) skipped[reason] = (skipped[reason] ?? 0) + n
    }
    unrecorded.push(...check.uncovered)
  }
  return { doc: input.doc, sentences: input.sentences, facts, skipped, unrecorded, failed }
}

/** What a doc's ledger came to, counted, as the corpus records it. */
export function docLedgerCounts(ledger: DocFactLedger): DocLedgerCounts {
  return {
    sentences: ledger.sentences.length,
    facts: ledger.facts.length,
    skipped: ledger.skipped,
    unrecorded: ledger.unrecorded.length,
  }
}

/** A doc's ledger in one line: `61 sentences, 34 facts, 27 skipped`, and what is missing. */
export function describeDocLedger(ledger: DocFactLedger, windows: number): string {
  const parts = [
    `${ledger.sentences.length} sentence${ledger.sentences.length === 1 ? '' : 's'}`,
    `${ledger.facts.length} fact${ledger.facts.length === 1 ? '' : 's'}`,
    `${skippedTotal(ledger.skipped)} skipped`,
  ]
  if (ledger.unrecorded.length > 0) parts.push(`${ledger.unrecorded.length} unrecorded`)
  if (ledger.failed.length > 0) {
    parts.push(`${ledger.failed.length} of ${windows} window${windows === 1 ? '' : 's'} not recorded, the session failed`)
  }
  return parts.join(', ')
}
