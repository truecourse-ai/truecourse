/**
 * THE CLAIM-EXTRACTION SESSION — `guard-generate.extract`, one per spec doc
 * (plan 04 step 15). It replaces the per-view extract ONE-SHOTS with one
 * session that pages its own document: the briefing carries the outline and
 * the first chunk, and the session opens the rest (`read_chunk` /
 * `read_section`) instead of the engine fanning a call per slice.
 *
 * What stayed deterministic, and where:
 * - anchors are NEVER trusted: `check_claims` runs the live snap in-session
 *   (a fabricated anchor bounces as an observation in one turn), and the
 *   seam's fold re-snaps the outcome regardless (`snapExtraction` — the same
 *   function, so a draft that checks clean folds clean);
 * - the claim-gap settlement (dismissed / awaiting-driver / blocked-on /
 *   untestable / no-claim) stays in `generateGuards`, verbatim — the seam
 *   returns the one-shot path's `ExtractResult` shape and the engine cannot
 *   tell which path produced it.
 *
 * NEW here (the strapi corpus wish): each claim carries structured `needs` —
 * what testing it takes beyond an empty sandbox. They ride into flow synthesis
 * (`FlowClaimInput.needs`) and the flows checker's needs-vs-catalog binding.
 */

import { createHash } from 'node:crypto'
import { defineSessionTool, type SessionBudget, type SessionDef, type SessionTool } from '@truecourse/agent-loop'
import { verificationBoundaryProblems, ExtractOutcomeSchema, type ExtractOutcome } from '@truecourse/shared'
import { snapExtraction, suppressionKey, type GuardDoc } from '@truecourse/guard-generator'
import { promptFingerprint } from '../agent/session-cache.js'
import {
  docChunkCount,
  docOutlineLines,
  readOwnChunkTool,
  readOwnSectionTool,
  readReferencedDocTool,
  renderDocChunk,
  type GuardDocUniverse,
} from './tools.js'

export const EXTRACT_SESSION_KIND = 'guard-generate.extract'

/**
 * Cache name — NEW, beside the legacy per-view `guard/extract` (whose files
 * remain on disk, orphaned since the one-shot retirement — nothing reads or
 * writes them; section 06 notes the rename). The pre-flight estimate probes
 * THIS cache with {@link extractSessionCacheKey} (step 20). Per-doc keys are
 * coarser than per-view — accepted: one doc edit re-runs one session.
 */
export const EXTRACT_SESSION_CACHE_NAME = 'guard/extract-session'

/**
 * The three numbers (§3.3). A doc is one briefed chunk plus a few pages or a
 * reference lookup, a `check_claims` round, and the outcome — ten turns covers
 * a big doc with a correction loop. ONE resume grant: a huge doc legitimately
 * needs the tour, and re-buying its read costs more than granting it.
 */
export const EXTRACT_SESSION_BUDGET: SessionBudget = {
  turns: 10,
  maxResumes: 1,
  tokenCeiling: 120_000,
}

export const EXTRACT_SESSION_SYSTEM_PROMPT = `You read ONE specification document and extract the CLAIMS in it that an executable test could verify — each a single, externally-observable behavior the document guarantees — plus a note for every section that states no testable behavior. The briefing carries the document's OUTLINE (every section with its exact anchor) and the first chunk of its body; page the rest yourself with \`read_chunk\` / \`read_section\` before you judge sections you have not seen.

# What a claim is
A claim is ONE concrete, observable behavior a program guarantees: an exit code, text written to stdout/stderr, a file created or changed, an HTTP response, a datastore change, a rendered UI element. Write each claim as a single declarative sentence, in the document's own terms.

# Obligation boundaries and cases
For EVERY claim supply verification.scope (web, api, configuration, implementation)
and verification.cases. Each case has a stable kebab-case id, its source-grounded
claim, method, requires (observation capabilities), and conditions (an array).
Preserve per-case prerequisites as [{dependency,mode:"provided"|"absent",evidence,originalNames?}].
Use the exact known service or catalog identifier when grounded; retain an unresolved name otherwise.
A successful live conversion and any later assertion requiring that conversion need the supplied service account.
A missing-key error branch uses mode absent, never provided. Account-free cases explicitly carry prerequisites: [].
Keep credential environment identifiers in need.detail as source evidence so existing extraction names can be resolved without guessing.
Cross-browser-timezone invariance requires browser-timezone-control, currently unsupported. Server TZ does not establish browser timezone.
Only for a documented server-startup/configuration guarantee verified through web or HTTP, add invocation: {command,address?}. Preserve the exact server startup command and fixed address; production readiness does not prove development startup. Ordinary CLI behavior (for example relkit --version) is proved by its CLI steps and must not receive server invocation metadata.
Capabilities: browser, http, process, filesystem, datastore, concurrency,
implementation, request-control, browser-timezone-control. Conditions: fresh-state, request-failure,
request-pending. Use [] when no special condition is required.
A case is an independently falsifiable acceptance or boundary case, not an example
input. Enumerate named search semantics, boundary conditions and error classes;
never hide literal wildcard escaping or case handling inside "filters work".
For sorting by date then ID, enumerate primary-date ordering and equal-date ID
ordering as separate cases. Same-date examples cannot prove the primary ordering.
An empty ledger or pristine installation requires conditions: ["fresh-state"].
Separate that branch from behavior using populated state; never omit the condition
merely to combine both cases into one claim. Default dates must be compared with
the browser's local calendar date, not with a value captured from the field itself.
Mark cases that require a pristine ledger with preparation: "empty" and conditions:
["fresh-state"]. Mark exact global totals, global counts, and deterministic page
boundaries with preparation: "controlled". This declares isolated, known data;
it is not datastore observation. Do not require controlled preparation merely to
read one uniquely identified record or a filter scoped to this scenario's records.
A filtered list with no matching rows is a different condition from an empty ledger:
extract separate source-grounded cases when the specification promises both.
Split a UI save sentence from an HTTP POST method contract: dialog closure,
confirmation text, refreshed totals, preserved filters and pagination are web cases;
method/status/body behavior belongs to API cases. Likewise, preserve prefilled edit
fields, Cancel behavior and persistence after reload as UI cases independently of
an API guarantee that createdAt or identity remains unchanged. A field not exposed
by the UI cannot become browser proof merely because the rest of the sentence is UI.
Keep each case's required transition and starting state explicit after splitting.
All cases of one claim must share scope, method and conditions. Split a mixed
sentence BEFORE submitting: ordinary reads vs retry after failure; returned cents
vs SQLite column types; normal startup vs exact file placement.
Web claims require browser observations only (and request-control for controlled
UI failure or loading). A fresh instance is preparation, not datastore observation.
An unchanged record after rejection is observed by subsequent API/UI reads. Preserve
an explicit guarantee about ALL internal tables as a separate implementation claim.
A UI error state may use a controlled response; it need not damage a real database.
Configuration and implementation guarantees stay separate and remain accounted for.
The boundary checker runs on both check_claims and the final outcome; repair its
reported problems rather than dropping the underlying specification requirements.

# Be selective — extract behaviors, not sentences
Group related cases into claims only within the verification boundaries above. Preserve every explicit guarantee and named boundary case:
- Prefer a handful of coherent claims with explicit cases. A claim-count target never justifies omitting a requirement or merging incompatible verification scopes.
- ONE claim per distinct behavior, not one per sentence, per listed flag, or per example. A command documented with several options is usually ONE claim about its primary observable outcome; a flag earns its own claim only when the section states a SEPARATE, distinct observable behavior for it.
- Do not extract a claim for every item merely because a section lists it (a command map, an options table, an enumeration). Extract the behaviors the section explicitly specifies an outcome for.
- Deduplicate restatements. Do not drop a specified outcome merely because it seems obvious; represent its independently falsifiable conditions as cases.

# Drivers — which kind of test could assert the claim
- cli — a command-line program's behavior when invoked with arguments (and optional stdin): its exit code, what it writes to stdout/stderr, or the files it creates or changes.
- api — an HTTP/RPC service's response, or the datastore state a request leaves — AND the behavior of the service PROCESS itself: that it starts (or refuses to start) under a given configuration, that it applies migrations at boot, what it writes while serving, that it shuts down on SIGTERM/SIGINT, that its state survives a restart. A claim about the SERVER's own lifecycle is an \`api\` claim; \`cli\` is for a COMMAND a user runs to completion.
  cli, api and web are runnable; still extract tui/library claims for coverage accounting.
- web — a browser UI (navigation, clicks, visible content).
- tui — an interactive terminal UI (keystrokes, on-screen contents).
- library — the package's programmatic API, consumed by IMPORTING it from user code. The deciding line is the documented consumption form: the SAME capability is \`cli\` when the docs invoke a command and \`library\` when they tell the user to write importing code.

Choose the driver from what must be OBSERVED, not the implementation behind it.
A user adding, editing or deleting an item and seeing the result is a web claim even
when the UI calls a server. It does not require a separate API test. HTTP status
codes, malformed HTTP requests, headers and raw response bodies require targeted
api verification; clicking through a UI cannot prove those contracts.
Set \`alternativeDrivers\` only when each listed driver can independently prove the
ENTIRE same claim. These are alternatives, not extra mandatory variants. Omit it
when there is no genuine alternative. Do not list api just because a UI uses HTTP,
or web for an API contract whose protocol details are not visible in the UI.

# Verification requirements
For every claim supply \`verification: { scope, method, observable, cases }\`:
- behavior: visible UI, HTTP values/status/headers, process output or lifecycle.
- filesystem: directly inspect the claimed file path, contents or existence.
- datastore: directly inspect database schema, indexes or stored representation.
- concurrency: controlled concurrent operations that can expose inconsistent reads.
- implementation: inspect an internal mechanism, such as never multiplying floats
  or using a particular transaction primitive. HTTP examples cannot prove this.
The observable must state the evidence needed, not merely repeat the claim.
Split independently provable guarantees into separate claims even within one
sentence: exact returned cents is behavior; no floating-point multiplication is
implementation. Correct response totals is behavior; snapshot consistency under
concurrent writes is concurrency; use of a specific transaction is implementation.
Likewise split successful mutation from failure/retry behavior requiring injection.
Do not weaken, omit or recast internal guarantees as response checks. Preserve them
with their verification method so missing capabilities remain visible.

# Faithfulness — the prime directive
Extract ONLY what the text states. Never infer a behavior the words do not state. A claim that overreaches the prose is worse than a missing one. When a section is background, rationale, definitions, naming, design history, or a pure cross-reference, record an untestable note. Preserve concrete guarantees with their required verification method even when the current drivers cannot verify them; matching records the missing capability.

# Sandbox limits — commands that need an LLM provider are not cli-testable
Guard runs each command in a sealed sandbox with NO credentials and NO network. A command whose documented behavior requires an authenticated LLM provider or an external AI CLI cannot run there. Do NOT extract such a command's behavior as a cli claim — record an untestable note whose reason states it needs an authenticated LLM provider (llm-provider). Judge this by the DOCUMENTED behavior, never a fixed command list.

# NEEDS — what testing a claim would take
For every claim, report its \`needs\`: the prerequisites a test would require BEYOND an empty sandbox and the program itself. Most claims need nothing — an empty array is the common, correct answer. When the DOCUMENTED behavior presupposes something, name it:
  - credential — an account, token, or login the behavior is gated on.
  - fixture    — a real-world input the test cannot fabricate (a repository to operate on, a corpus, a media file).
  - state      — durable pre-existing application state (an existing project, seeded rows) the doc assumes rather than creates.
  - external   — a third-party service the behavior calls out to.
  - manual     — a step only a human can perform.
Give each need a short stable \`name\` (lower-kebab-case, e.g. \`github-token\`, \`sample-repo\`) and reuse the SAME name when two claims need the same thing. Needs describe what the DOC presupposes — never speculate about implementation details.

# Sections and anchors
The OUTLINE lists every section with its exact ANCHOR. Each claim MUST carry the anchor of the section whose own text states it, copied VERBATIM from the outline — never invent, abbreviate, translate, or reformat an anchor. Bind a claim to the NARROWEST section that states it.

# Untestable notes — honesty about gaps
For every section whose own text states NO externally-observable behavior any driver could assert, add ONE untestable note: its anchor and a one-sentence reason. A section that yields at least one claim needs no note. Do not note a section that is only a container for subsections.

# Suppressed sentences
When the briefing carries a RESOLVED — STALE block, those verbatim sentences lost a conflict resolution (another document is authoritative). Extract NO claim that asserts what any of them says — treat them as absent.

# Tools — when to use them
- \`read_chunk\` — page through YOUR document (the briefing carried chunk 1). Read every chunk before settling sections you have not seen.
- \`read_section\` — re-read one section of your document precisely, by its anchor.
- \`read_referenced_doc\` — open ANOTHER doc ONLY to resolve an explicit reference your doc makes ("see docs/auth.md") — never to browse.
- \`check_claims\` — REQUIRED before you finish: call it with your complete draft. It snaps every anchor against the live section index exactly as the engine will, so a wrong anchor costs one turn here instead of a dropped claim at the fold. Fix what it reports, then produce the outcome.

# The outcome
One object: { "claims": [ { "claim", "driver", "alternativeDrivers"?, "verification": { "scope", "method", "observable", "cases": [{ "id", "claim", "method", "requires", "conditions", "preparation"? }] }, "sectionAnchor", "reason", "needs": [ { "kind", "name", "detail"? } ] } ], "untestable": [ { "sectionAnchor", "reason" } ] }. "reason" on a claim states the observable a test would assert.`

/** The prompt half of every extract-session cache key — exported for the
 *  step-20 estimate rework, which must probe the REAL keys. */
export const EXTRACT_SESSION_PROMPT_FINGERPRINT = promptFingerprint(EXTRACT_SESSION_SYSTEM_PROMPT)

/**
 * The per-doc cache key (plan 04 step 15): prompt fingerprint :: the doc's
 * content hash [:: its suppression key, appended ONLY when quotes are
 * suppressed — so an unsuppressed doc keys off its text alone and a resolved
 * conflict re-keys exactly the losing doc]. Coarser than the legacy per-view
 * key, by decision.
 */
export function extractSessionCacheKey(doc: Pick<GuardDoc, 'content' | 'suppressedQuotes'>): string {
  return extractSessionCacheKeyForContentHash(extractDocContentHash(doc.content), doc.suppressedQuotes)
}

/** The doc-content half of the extract cache key — hex sha256 over the bytes.
 *  The manifest records it per doc so the claim-diff gate can address the
 *  PRIOR extraction of a document whose content has since moved. */
export function extractDocContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** {@link extractSessionCacheKey} from an already-computed content hash. */
export function extractSessionCacheKeyForContentHash(contentHash: string, suppressedQuotes: readonly string[]): string {
  const base = `${EXTRACT_SESSION_PROMPT_FINGERPRINT}::${contentHash}`
  const suppression = suppressionKey(suppressedQuotes)
  return createHash('sha256').update(suppression ? `${base}::${suppression}` : base).digest('hex')
}

/** The work item, as the session index and the transcript record it. */
export function extractSessionWorkItem(docPath: string): string {
  return `doc:${docPath}`
}

/**
 * The in-session validation `check_claims` runs — the live snap, exactly the
 * discipline the fold applies (`snapExtraction`), so a draft that checks clean
 * folds clean. Returns the entries that would not survive; empty = valid.
 */
export function validateExtractDraft(draft: ExtractOutcome, doc: GuardDoc): string[] {
  const snapped = snapExtraction(draft, doc.sections)
  const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase()
  const keptClaims = new Set(snapped.claims.map((c) => `${c.driver}\0${normalize(c.claim)}`))
  const keptNotes = new Set(snapped.untestable.map((n) => n.sectionAnchor))
  const problems: string[] = []
  for (const c of draft.claims) {
    problems.push(...verificationBoundaryProblems(c.verification, false, [c.driver, ...(c.alternativeDrivers ?? [])]).map(p => `claim "${c.claim}": ${p}`))
    if (!keptClaims.has(`${c.driver}\0${normalize(c.claim)}`)) {
      problems.push(
        `claim "${c.claim}" — its anchor \`${c.sectionAnchor}\` snaps onto no section (or the claim duplicates another). Copy an anchor from the outline verbatim.`,
      )
    }
  }
  const seenNoteAnchor = new Set<string>()
  for (const n of draft.untestable) {
    const snappedTo = snapExtraction({ claims: [], untestable: [n] }, doc.sections).untestable[0]
    if (!snappedTo || !keptNotes.has(snappedTo.sectionAnchor)) {
      problems.push(`untestable note at \`${n.sectionAnchor}\` — the anchor snaps onto no section.`)
      continue
    }
    if (seenNoteAnchor.has(snappedTo.sectionAnchor)) {
      problems.push(`untestable note at \`${n.sectionAnchor}\` — a second note for the same section (one per section).`)
    }
    seenNoteAnchor.add(snappedTo.sectionAnchor)
  }
  return problems
}

/** Rechecked on the final outcome, even when the model changes a checked draft. */
function checkedExtractionSchema(doc: GuardDoc) {
  return ExtractOutcomeSchema.superRefine((draft, ctx) => {
    const problems = validateExtractDraft(draft, doc)
    for (const c of draft.claims) problems.push(...verificationBoundaryProblems(c.verification, true, [c.driver, ...(c.alternativeDrivers ?? [])]).map(p => `claim "${c.claim}": ${p}`))
    for (const message of new Set(problems)) ctx.addIssue({ code: 'custom', message })
  })
}

function checkClaimsTool(doc: GuardDoc): SessionTool {
  return defineSessionTool({
    name: 'check_claims',
    description:
      'Check a draft extraction against the live section index — every anchor is snapped exactly as the engine will snap it. Call it on your complete draft (claims AND untestable notes) before you produce the outcome.',
    kind: 'check-extract-claims',
    readOnly: true,
    destructive: false,
    inputSchema: ExtractOutcomeSchema,
    async execute(args) {
      const problems = validateExtractDraft(args, doc)
      for (const c of args.claims) problems.push(...verificationBoundaryProblems(c.verification, true, [c.driver, ...(c.alternativeDrivers ?? [])]).map(p => `claim "${c.claim}": ${p}`))
      if (problems.length === 0) {
        return {
          content: `The draft is valid: ${args.claims.length} claim(s), ${args.untestable.length} untestable note(s), every anchor snapped. Produce it as the outcome.`,
        }
      }
      return { content: `${problems.length} problem(s):\n- ${problems.join('\n- ')}`, isError: true }
    },
  })
}

export interface ExtractSessionInput {
  doc: GuardDoc
  universe: GuardDocUniverse
}

export function extractSessionDef(input: ExtractSessionInput): SessionDef<ExtractOutcome> {
  return {
    kind: EXTRACT_SESSION_KIND,
    systemPrompt: EXTRACT_SESSION_SYSTEM_PROMPT,
    tools: [
      readOwnChunkTool(input.doc),
      readOwnSectionTool(input.doc),
      readReferencedDocTool(input.universe),
      checkClaimsTool(input.doc),
    ],
    outcomeSchema: checkedExtractionSchema(input.doc),
    // A revised draft can still violate a verification boundary. Return the
    // terminal validation errors to the session before losing the whole doc.
    outcomeSchemaRepairs: 2,
    budget: EXTRACT_SESSION_BUDGET,
    // The structural half of "run check_claims before you finish" (01 step 2k):
    // the shell refuses the first outcome of a session that never snapped its
    // anchors, once, at the cost of one turn.
    outcomePrecondition: {
      tool: 'check_claims',
      message:
        'Outcome refused: you never ran `check_claims` in this session. Call `check_claims` on your complete draft now — it snaps every anchor the way the engine will, so a wrong anchor costs one turn here instead of a dropped claim at the fold. Fix anything it reports, then produce the outcome again.',
    },
  }
}

/**
 * The opening message: the doc's coordinates, its corpus areas, the complete
 * outline (the closed anchor set — for an OpenAPI doc these are its operation
 * sections), the suppressed-quote block when any, and the body's first chunk
 * with an honest "N more chunks" note.
 */
export function extractSessionBriefing(doc: GuardDoc): string {
  const areas = doc.sections[0]?.areaTags ?? []
  const chunks = docChunkCount(doc)
  const lines = [
    `Extract the testable claims of ONE spec document.`,
    ``,
    `Document: ${doc.doc}`,
    ...(areas.length > 0 ? [`Corpus areas: ${areas.join(', ')}`] : []),
    ``,
    `OUTLINE — the complete section list; copy one of these anchors verbatim into`,
    `every claim and note:`,
    ...docOutlineLines(doc),
  ]
  if (doc.suppressedQuotes.length > 0) {
    lines.push(
      '',
      'RESOLVED — STALE, DO NOT EXTRACT. A conflict resolution judged the following',
      'sentence(s) in this document stale (another document is authoritative here).',
      'Extract NO claim that asserts what any of them says — treat them as if absent:',
      ...doc.suppressedQuotes.map((q) => `- "${q}"`),
    )
  }
  lines.push('', renderDocChunk(doc, 1).content)
  if (chunks > 1) {
    lines.push('', `${chunks - 1} more chunk(s) — use \`read_chunk\` to page through the rest before you finish.`)
  }
  lines.push('', 'Read the whole document, check the draft with `check_claims`, then produce the outcome.')
  return lines.join('\n')
}
