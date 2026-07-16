/**
 * The three guard-generator prompts — whole-document claim extraction, batched
 * scenario authoring, and recipe discovery — plus their content fingerprints
 * (folded into the cache keys so a prompt edit re-runs the affected stage).
 *
 * Every output shape a prompt asks for is the JSON Schema rendered from the SAME
 * Zod definition the engine validates the reply with — never hand-written prose
 * that could drift from the engine. `GENERATE_SYSTEM_PROMPT` embeds
 * `RawGeneratedScenarioSchema` (the behavioral fields the model authors — engine-
 * owned fields like `id`/`binds`/`guard` are not in the model's vocabulary at
 * all); `EXTRACT_SYSTEM_PROMPT` the per-document `DocExtractionSchema`;
 * `RECIPE_SYSTEM_PROMPT` the proposal (`RecipeProposalSchema`). Hand-written
 * prose that can drift from the schema is exactly what burned the contract
 * prompts; here the schema IS the documentation.
 *
 * The prompts are written to be reliable on the smallest supported model: closed
 * enumerations, one canonical schema, a single JSON object/array out, and an
 * explicit "copy this verbatim" rule for the anchors and refs the engine keys on.
 */

import { createHash } from 'node:crypto'
import type { OutputExcerpts } from '@truecourse/shared'
import { jsonSchemaHint, OUTPUT_ONLY_GUARDRAIL } from '@truecourse/shared/llm'
import {
  CLAIM_DRIVERS,
  DocExtractionSchema,
  RecipeProposalSchema,
  RawGeneratedCliScenarioSchema,
  RawGeneratedApiScenarioSchema,
  FidelityReviewSchema,
} from './schemas.js'
import type { GuardDoc, SectionInput } from './section-plan.js'
import type { ProbeTranscript } from './ground.js'

/** The authored-scenario JSON Schemas — the behavioral fields only, rendered from
 *  the SAME Zod schemas the engine parses replies with (`.strip()` renders them
 *  without the parse-side unknown-key tolerance, so the hints stay closed). One
 *  per runnable driver: each authoring prompt embeds its own. */
const SCENARIO_JSON_SCHEMA = jsonSchemaHint(RawGeneratedCliScenarioSchema.strip())
const API_SCENARIO_JSON_SCHEMA = jsonSchemaHint(RawGeneratedApiScenarioSchema.strip())
/** The extraction + recipe-proposal JSON Schemas, from the runner's Zod source. */
const EXTRACTION_JSON_SCHEMA = jsonSchemaHint(DocExtractionSchema)
const RECIPE_JSON_SCHEMA = jsonSchemaHint(RecipeProposalSchema)
/** The fidelity-review verdict JSON Schema, from the runner's Zod source. */
const FIDELITY_JSON_SCHEMA = jsonSchemaHint(FidelityReviewSchema)

function fingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/** A corrective addendum for a re-ask after the prior output failed validation. */
export interface OutputCorrection {
  /** The invalid output quoted back to the model. */
  invalidOutput: string
}

/** One section as it appears in the outline the extractor picks anchors from. */
export interface OutlineEntry {
  anchor: string
  headingText: string
  level: number
}

/** Render the document outline as a compact, one-anchor-per-line list. The anchor
 *  already carries the heading path, so no extra heading text is needed. */
function renderOutline(outline: OutlineEntry[]): string {
  return outline.map((e) => e.anchor).join('\n')
}

// ---------------------------------------------------------------------------
// Claim extraction
// ---------------------------------------------------------------------------

export const EXTRACT_SYSTEM_PROMPT = `\
You read ONE specification document and extract the CLAIMS in it that an executable
test could verify — each a single, externally-observable behavior the document
guarantees. You return JSON only: the claims, plus a note for every section that
states no testable behavior. No prose outside the JSON.

${OUTPUT_ONLY_GUARDRAIL}

# What a claim is
A claim is ONE concrete, observable behavior a program guarantees: an exit code,
text written to stdout/stderr, a file created or changed, an HTTP response, a
datastore change, a rendered UI element. Write each claim as a single declarative
sentence, in the document's own terms.

# Be selective — extract behaviors, not sentences
Return the SMALLEST set of claims that captures what a section actually guarantees.
This is the most important rule after faithfulness:
- A well-covered section yields a HANDFUL of claims (roughly 1–8), not dozens. If
  you are emitting more than ~8 claims for one section, you are almost certainly
  over-splitting — consolidate.
- ONE claim per distinct behavior, not one per sentence, per listed flag, or per
  example. A command documented with several options is usually ONE claim about
  its primary observable outcome; give a flag its own claim only when the section
  states a SEPARATE, distinct observable behavior for it.
- Do not extract a claim for every item merely because a section lists it (a
  command map, an options table, an enumeration). Extract the behaviors the
  section explicitly specifies an outcome for.
- Skip trivial, obvious, or restated behaviors. Prefer fewer, higher-value claims;
  when unsure whether something is a distinct testable behavior, leave it out.

# Drivers — which kind of test could assert the claim
- cli — a command-line program's behavior when invoked with arguments (and
  optional stdin): its exit code, what it writes to stdout/stderr, or the files it
  creates or changes.
- api — an HTTP/RPC service's response, or the datastore state a request leaves.
  cli and api are the drivers tests are authored for today; still extract
  web/tui/library claims so the coverage picture stays honest.
- web — a browser UI (navigation, clicks, visible content).
- tui — an interactive terminal UI (keystrokes, on-screen contents).
- library — the package's programmatic API, consumed by IMPORTING it from user
  code: \`import\`/\`require\` of the package or its subpaths, calling its exported
  functions/classes/hooks, registering it from a program. The deciding line is the
  documented consumption form, not the feature: the SAME capability is \`cli\` when
  the docs invoke a command and \`library\` when they tell the user to write code
  that imports the package.

# Faithfulness — the prime directive
Extract ONLY what the text states. Never infer a behavior the words do not state.
A claim that overreaches the prose is worse than a missing one. When a section is
background, rationale, definitions, naming, design history, a pure cross-
reference, or needs a capability no driver has, record an untestable note instead
of forcing a weak claim.

# Sandbox limits — commands that need an LLM provider are not cli-testable
Guard runs each command in a sealed sandbox with NO credentials and NO network. A
command whose documented behavior requires an authenticated LLM provider or an
external AI CLI (it calls out to a model to do its work — an infer / generate /
AI-backed command) therefore CANNOT run there: its real behavior is unreachable, and a
cli claim for it would only be authored to die in the sandbox for lack of provider
auth. Do NOT extract such a command's behavior as a cli claim — classify it blocked-on
the llm-provider capability instead: record an untestable note for the section whose
reason states it needs an authenticated LLM provider (llm-provider). Judge this by the
DOCUMENTED behavior, never a fixed command list — any provider-auth-dependent command.

# Sections and anchors
The OUTLINE below lists every section with its exact ANCHOR. Each claim MUST carry
the anchor of the section whose own text states it, copied VERBATIM from the
outline — never invent, abbreviate, translate, or reformat an anchor. Bind a claim
to the NARROWEST section that states it (a claim stated in a subsection belongs to
that subsection, not its parent).

# Untestable notes — honesty about gaps
For every section whose own text states NO externally-observable behavior any
driver could assert, add ONE untestable note: its anchor and a one-sentence
reason. A section that yields at least one claim needs no note. Do not note a
section that is only a container for subsections.

# Output schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition; your reply must
validate against it exactly. Output EXACTLY ONE JSON object, no prose, no fences:
${EXTRACTION_JSON_SCHEMA}
Concretely:
  { "claims": [
      { "claim": "<one declarative sentence>",
        "driver": "cli" | "api" | "web" | "tui" | "library",
        "sectionAnchor": "<an anchor copied verbatim from the outline>",
        "reason": "<the observable behavior a test would assert>" } ],
    "untestable": [
      { "sectionAnchor": "<an anchor copied verbatim>",
        "reason": "<why no driver can assert anything here>" } ] }`

export const EXTRACT_PROMPT_FINGERPRINT = fingerprint(EXTRACT_SYSTEM_PROMPT)

export interface ExtractUserContext {
  /** Repo-relative doc path. */
  doc: string
  /** The full document outline (every section) — the closed anchor set. */
  outline: OutlineEntry[]
  /** The text of this view (the whole doc, or one chunk when the doc is large). */
  viewText: string
  /** 1-based view position + count, present only when the doc was chunked. */
  view?: { index: number; total: number }
  /**
   * Verbatim sentences a conflict resolution judged STALE (item 31) — the losing
   * side of a "the other doc is right" verdict. No claim asserting what they say
   * may be extracted. Rides the per-view INPUT (not the system prompt), so only
   * views containing a suppressed sentence change their cache key.
   */
  suppressed?: string[]
  /** On a re-ask after invalid output, the prior output quoted back. */
  correction?: OutputCorrection
}

export function buildExtractUserPrompt(ctx: ExtractUserContext): string {
  const lines = [
    `Document: ${ctx.doc}`,
    '',
    'OUTLINE — copy one of these anchors verbatim into every claim/note (this is the',
    'complete section list; it stays the same across parts of a chunked document):',
    renderOutline(ctx.outline),
    '',
    ctx.view
      ? `DOCUMENT TEXT (part ${ctx.view.index} of ${ctx.view.total} — extract only from this part; the outline above is complete):`
      : 'DOCUMENT TEXT:',
    '"""',
    ctx.viewText,
    '"""',
  ]
  if (ctx.suppressed && ctx.suppressed.length > 0) {
    lines.push(
      '',
      'RESOLVED — STALE, DO NOT EXTRACT. A conflict resolution judged the following',
      'sentence(s) in this document stale (another document is authoritative here).',
      'Extract NO claim that asserts what any of them says — treat them as if absent:',
    )
    for (const q of ctx.suppressed) lines.push(`- "${q}"`)
  }
  if (ctx.correction) {
    lines.push(
      '',
      'CORRECTION — your previous response was NOT valid. You returned:',
      ctx.correction.invalidOutput,
      'Return exactly ONE JSON object with "claims" and "untestable" arrays matching',
      `the schema above, and NOTHING else. Every "driver" is one of ${CLAIM_DRIVERS.join('|')};`,
      'every "sectionAnchor" is an anchor copied verbatim from the outline.',
    )
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Scenario authoring
// ---------------------------------------------------------------------------

export const GENERATE_SYSTEM_PROMPT = `\
You author guard SCENARIOS — declarative, executable tests that bind a spec CLAIM
to a command-line program's observable behavior. You are given one document's
context and a BATCH of claims drawn from it (each already judged CLI-testable),
with the program's entrypoint. For EACH claim you return the scenarios that assert
it. No prose, only JSON.

# No tools, no repository access
You have NO tools and NO repository access. Tool-call JSON or \`<tool_use>\` markup is
invalid output — your response can ONLY be the JSON array described below. You never
need to inspect code: when a claim names a command, its REAL BEHAVIOR transcript
(captured in an empty sandbox) is provided below, and birth validation supplies the
program's actual output on retry. Use those transcripts to get the COMMANDS, ARGUMENTS,
and SETUP right — never to decide WHAT to assert (see the next rule); a claim about
behavior in a NON-empty world (existing files or git state) still needs a \`setup\`
block — the transcripts show only the empty-world baseline.

# Assertions come from the claim, never the transcript
Transcripts (the REAL BEHAVIOR probes, and the actual output birth supplies on retry)
exist ONLY to get commands, arguments, and setup right. Every ASSERTION must state what
the CLAIM — read against its section's text — says: copied VERBATIM where the claim
quotes exact output, adapting only placeholders (e.g. \`t<N>\`, \`<file>\`) to the
concrete values your scenario creates. If a transcript shows the tool behaving
DIFFERENTLY from the claim, you MUST STILL assert the CLAIM'S version. The scenario then
fails birth — and that is the CORRECT, desired outcome: the doc-vs-code disagreement
surfaces as a finding. Never weaken, generalize, or swap a claimed assertion for a
softer, effect-only check (asserting that a list changed instead of the exact message
the claim quotes) to make a scenario pass — a green test that proves less than the claim
is the worst outcome.
Worked example — claim: "\`done <id>\` prints \`Completed t<N> ✓\`". The probe transcript
shows the command instead printing \`Marked t1 as done\`. You STILL author the assertion
from the claim: stdout \`contains "Completed t1 ✓"\` (the claim's output X, \`t<N>\`→\`t1\`),
NOT \`Marked t1 as done\` (the transcript's Y) and NOT an effect-only check of the done
list. The scenario fails birth against the real output — correct: the disagreement is
now a finding, not a passing test.

# Faithfulness — the prime directive
Assert only what the claim, read against its section's text, states. A scenario
must never claim more than the prose does. A weaker-than-spec test — green but
proving less than the claim — is the worst failure mode. If, on reflection, a
claim states nothing a CLI invocation can actually observe, return an empty
scenarios array for it rather than inventing behavior.

# How a scenario runs
The program is built once from the recipe and invoked per step. Each step's
\`run\` is ARGV APPENDED to the recipe entrypoint: with entry ["node","cli.js"],
\`run: ["check","--strict"]\` invokes \`node cli.js check --strict\`. Do NOT repeat
the entrypoint in \`run\` — list only the arguments. \`stdin\` is piped in; \`repeat\`
runs the step N times (each iteration must satisfy \`expect\`). A step asserts on
\`exit\` (exact code), \`stdout\`/\`stderr\` (one of equals | contains | matches — a
regex — compared AFTER normalization), and \`files\` (a sandbox-relative path →
exists | absent | equals | contains). Seed inputs declaratively with
\`setup.files\` (path → content) and \`setup.env\`; there is no shell escape.

# World-state capabilities
\`setup\` declares the WORLD a test needs — never code, never shell. Beyond
\`setup.files\`/\`setup.env\`, \`setup.git\` declares a git repo the sandbox starts
with (its commits, its staged working-index, its branch); the engine materializes
it deterministically with pinned author/committer + dates and hooks off, so its
mere presence means a repo exists in the sandbox cwd. Declare only WHAT the world
looks like — the schema below carries the fields.
SEEDING RULE (do not skip): every path you reference in \`setup.git.commits[].files\`
or \`setup.git.staged\` MUST also be seeded — it must appear in \`setup.files\`, or be
created by an EARLIER commit in the same \`setup.git\`. A path that appears ONLY under
\`git\` is never materialized and the WHOLE test fails to build.
  Wrong: \`git: { commits: [{ files: ["a.txt"] }] }\` with no \`a.txt\` in \`setup.files\`.
  Right: \`files: { "a.txt": "…" }\` AND \`git: { commits: [{ files: ["a.txt"] }] }\`.
The sandbox is otherwise bare: no network egress, no credentials (env is
allowlisted — the host's API keys never reach the program), no shell. When a claim
needs world-state NO setup block can express — a running service, a database,
network, credentials — author NOTHING for it: return an empty \`scenarios\` array
AND name the missing capability in \`blockedOn\` (see the output shape). An honest
blocked claim is right; a scenario that fakes the missing world is wrong.

# The scenario schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition — match it exactly.
It contains ONLY the fields you author (\`driver\` is always "cli"); the engine
assigns each scenario's id and section binding itself, so do not emit any field
that is not in the schema.
${SCENARIO_JSON_SCHEMA}

# Determinism
No network, no timing assumptions, no retries. When asserted output contains a
timestamp, absolute path, version string, or duration, list the matching
\`normalize\` entry (timestamps | abs-paths | versions | durations) instead of
hard-coding the volatile value, and prefer \`contains\`/\`matches\` on the meaningful
substring over \`equals\` on a whole line that carries volatile text.

# Output — one entry per input claim, echoing its ref
Return a JSON ARRAY with EXACTLY ONE object per claim in the batch, in any order:
  [ { "ref": "<the claim's ref, copied verbatim>", "scenarios": [ <scenario>, … ], "blockedOn": ["<capability, e.g. service|db|network|credentials>"] } ]
Author one or more scenarios per claim (one per distinct way to assert it), or an
empty \`scenarios\` array if the claim is not CLI-assertable after all. Set
\`blockedOn\` ONLY on an empty-scenarios claim that needs world-state the sandbox
can't provide, naming what's missing (free-form nouns); omit it otherwise. Include
every \`ref\` you were given exactly once. No prose — only the JSON array.`

export const GENERATE_PROMPT_FINGERPRINT = fingerprint(GENERATE_SYSTEM_PROMPT)

// ---------------------------------------------------------------------------
// Scenario authoring — api driver
// ---------------------------------------------------------------------------

export const GENERATE_API_SYSTEM_PROMPT = `\
You author guard SCENARIOS — declarative, executable tests that bind a spec CLAIM
to an HTTP service's observable behavior. You are given one document's context and
a BATCH of claims drawn from it (each already judged API-testable), with how the
service is built and served. For EACH claim you return the scenarios that assert
it. No prose, only JSON.

# No tools, no repository access
You have NO tools and NO repository access. Tool-call JSON or \`<tool_use>\` markup is
invalid output — your response can ONLY be the JSON array described below. You never
need to inspect code: author requests from what the CLAIM and its section state, and
when a scenario fails birth validation the retry supplies the service's ACTUAL
response body — use it to fix PATHS, METHODS, and REQUEST BODIES, never to decide
WHAT to assert (see the next rule).

# Assertions come from the claim, never the observed response
Every ASSERTION must state what the CLAIM — read against its section's text — says:
the exact status code it names, the exact field values or messages it quotes,
adapting only placeholders to the concrete values your scenario creates. If the
service demonstrably behaves DIFFERENTLY from the claim, you MUST STILL assert the
CLAIM'S version. The scenario then fails birth — and that is the CORRECT, desired
outcome: the doc-vs-code disagreement surfaces as a finding. Never weaken,
generalize, or swap a claimed assertion for a softer, effect-only check (asserting
"some 2xx" where the claim says 201, or that a list changed where the claim quotes
an error message) to make a scenario pass — a green test that proves less than the
claim is the worst outcome.

# Faithfulness — the prime directive
Assert only what the claim, read against its section's text, states. A scenario
must never claim more than the prose does. If, on reflection, a claim states
nothing an HTTP exchange can actually observe, return an empty scenarios array for
it rather than inventing behavior.

# How a scenario runs
The service is built once from the recipe, then booted FRESH for each scenario in
an empty sandbox working directory (its state files land there, so every scenario
starts from the service's empty/initial state) on a runner-chosen port. Each step
sends ONE HTTP request to that server:
- \`request\`: \`method\` + \`path\` (starts with \`/\`, may carry a query string),
  optional \`headers\`, and at most one body — \`body\` (raw text) or \`json\` (a JSON
  value, sent as \`application/json\`).
- \`capture\`: variable name → a dotted path into THIS step's JSON response body
  (\`id\`, \`items[0].id\`; \`""\` is the whole body). Captured values are available to
  LATER steps as \`\${name}\` inside path, header values, and body strings — this is
  how you chain create-then-fetch flows without guessing ids.
- \`expect\` asserts on \`status\` (exact code), \`headers\` (name → one of
  equals | contains | matches), \`body\` (the raw text, same matchers, compared
  AFTER normalization), and \`json\` (dotted path → equals — a JSON value compared
  structurally — | contains | matches | exists | absent).
- \`repeat\` runs the step N times (each iteration must satisfy \`expect\`).
Seed inputs declaratively with \`setup.files\` (path → content, materialized in the
sandbox cwd the service starts in) and \`setup.env\` (extra env for the service
process); there is no shell escape.

# World-state capabilities
\`setup\` declares the WORLD a test needs — never code, never shell. The recipe's
own \`api\` block already brings up the service (and its declared datastores);
scenarios never manage processes. The sandbox is otherwise bare: no network egress
beyond the service under test, no credentials, no external systems. When a claim
needs world-state neither \`setup\` nor the recipe provides — a third-party SaaS, a
credentialed integration, another live service — author NOTHING for it: return an
empty \`scenarios\` array AND name the missing capability in \`blockedOn\`. An honest
blocked claim is right; a scenario that fakes the missing world is wrong.

# The scenario schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition — match it exactly.
It contains ONLY the fields you author (\`driver\` is always "api"); the engine
assigns each scenario's id and section binding itself, so do not emit any field
that is not in the schema.
${API_SCENARIO_JSON_SCHEMA}

# Determinism
No timing assumptions, no retries, no assertions on values the service generates
non-deterministically (timestamps, uuids) unless you \`capture\` them first or list
the matching \`normalize\` entry (timestamps | abs-paths | versions | durations).
Ids your scenario itself creates against the empty initial state ARE deterministic
(the first created resource's id is stable) — but prefer \`capture\` + \`\${var}\`
chaining over hard-coding them. Prefer \`contains\`/\`matches\` on the meaningful
substring over \`equals\` on a whole body that carries volatile fields, and prefer
\`json\` path matchers over whole-body \`equals\`.

# Output — one entry per input claim, echoing its ref
Return a JSON ARRAY with EXACTLY ONE object per claim in the batch, in any order:
  [ { "ref": "<the claim's ref, copied verbatim>", "scenarios": [ <scenario>, … ], "blockedOn": ["<capability, e.g. external-service|credentials>"] } ]
Author one or more scenarios per claim (one per distinct way to assert it), or an
empty \`scenarios\` array if the claim is not HTTP-assertable after all. Set
\`blockedOn\` ONLY on an empty-scenarios claim that needs world-state the sandbox
can't provide, naming what's missing (free-form nouns); omit it otherwise. Include
every \`ref\` you were given exactly once. No prose — only the JSON array.`

export const GENERATE_API_PROMPT_FINGERPRINT = fingerprint(GENERATE_API_SYSTEM_PROMPT)

/**
 * A birth-validation failure attached to a claim on a retry so the model can fix
 * it. Extends the shared excerpt pair: the failing run's RAW program output is the
 * evidence the retry's doc-first language refers to — the usage error the program
 * printed reveals the correct flags/subcommand. Absent when the stream was empty
 * (or an infra failure produced no capture).
 */
export interface BirthRetryContext extends OutputExcerpts {
  scenarioTitle: string
  step: number
  expected: string
  actual: string
}

/** One claim in an authoring batch — its stable ref, text, driver, and section. */
export interface AuthorClaim {
  /** Stable ref the model echoes so the engine maps scenarios back to the claim. */
  ref: string
  /** The claim text as extraction stated it. */
  claim: string
  /** The section this claim binds to (its anchor + own text drive authoring). */
  section: SectionInput
  /** On a birth-validation retry, the prior attempt's failure evidence. */
  retry?: BirthRetryContext
}

/** Char budget above which authoring sends outline + section texts instead of the
 *  full document. */
export const AUTHOR_DOC_BUDGET = 48_000

/**
 * Build the whole-document context for an authoring batch: the full text when the
 * doc fits the budget, otherwise a titles-only outline (the model never outputs
 * anchors — the engine binds scenarios itself, so slugs would be dead weight) plus
 * each batch section's own text exactly ONCE (the per-claim blocks reference their
 * section by title instead of re-carrying its text).
 */
export function buildAuthorDocContext(gd: GuardDoc, anchors: string[]): string {
  if (gd.content.length <= AUTHOR_DOC_BUDGET) return gd.content
  const outline = gd.sections
    .map((s) => `${'  '.repeat(Math.max(0, s.level - 1))}- ${s.headingText}`)
    .join('\n')
  const byAnchor = new Map(gd.sections.map((s) => [s.anchor, s]))
  const seen = new Set<string>()
  const parts: string[] = []
  for (const a of anchors) {
    if (seen.has(a)) continue
    seen.add(a)
    const text = byAnchor.get(a)?.ownText
    if (text) parts.push(text)
  }
  return `OUTLINE (titles only):\n${outline}\n\nTEXT OF THE SECTIONS THE CLAIMS CITE:\n${parts.join('\n\n')}`
}

export interface AuthorUserContext {
  /** Repo-relative doc path the claims come from. */
  doc: string
  /** Whole-document context: the full text when it fits, else a titles-only
   *  outline + each batch section's text once (see {@link buildAuthorDocContext}). */
  docContext: string
  /** Canonical area ids the doc covers, from the corpus (may be empty). */
  areaTags: string[]
  /** The driver this batch authors for — selects the system prompt + the
   *  preparation framing below. Every claim in a batch shares one driver. */
  driver: 'cli' | 'api'
  /** cli batches: the recipe entrypoint argv, so the model knows what `run` is
   *  appended to. Absent on api batches. */
  recipeEntry?: string[]
  /** api batches: the recipe's serve argv (the runner boots it per scenario). */
  recipeServe?: string[]
  /** api batches: the health endpoint the runner polls before any step runs. */
  recipeHealthPath?: string
  /** Recipe build command — context on what is built before scenarios run. */
  recipeBuild: string
  /** The claims to author this call. */
  claims: AuthorClaim[]
  /** Real empty-sandbox transcripts for the commands the claims name (cli batches
   *  only; may be empty — ungrounded when the build failed or no command was named). */
  probes?: ProbeTranscript[]
  /** On a re-ask after invalid output, the prior output quoted back. */
  correction?: OutputCorrection
}

/** Indent every line of a program-output excerpt so it reads as one nested block. */
function indentBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
}

export function buildAuthorUserPrompt(ctx: AuthorUserContext): string {
  const lines: string[] =
    ctx.driver === 'api'
      ? [
          `Service serve command: ${JSON.stringify(ctx.recipeServe)}  (the runner boots it fresh per scenario and injects PORT)`,
          `Health endpoint: GET ${ctx.recipeHealthPath ?? '/'}  (polled until 2xx before any step runs)`,
          `Build command: ${ctx.recipeBuild}`,
        ]
      : [
          `Program entrypoint: ${JSON.stringify(ctx.recipeEntry)}  (your step \`run\` argv is appended to this)`,
          `Build command: ${ctx.recipeBuild}`,
        ]
  if (ctx.areaTags.length > 0) lines.push(`Area context: ${ctx.areaTags.join(', ')}`)
  lines.push(
    '',
    `Document: ${ctx.doc}`,
    'Document context (for the global picture — each claim cites its section by',
    'title; that section\'s text is in here exactly once):',
    '"""',
    ctx.docContext,
    '"""',
  )
  if (ctx.probes && ctx.probes.length > 0) {
    lines.push('', 'REAL BEHAVIOR (captured in an empty sandbox — trust these transcripts over guesses):')
    for (const p of ctx.probes) {
      lines.push(`$ ${p.command}`)
      lines.push(p.timedOut ? 'exit (timed out)' : `exit ${p.exit ?? '(killed, no exit code)'}`)
      if (p.stdout) lines.push('stdout:', p.stdout + (p.stdoutTruncated ? '\n…(truncated)' : ''))
      if (p.stderr) lines.push('stderr:', p.stderr + (p.stderrTruncated ? '\n…(truncated)' : ''))
      if (!p.stdout && !p.stderr) lines.push('(no output)')
    }
  }
  lines.push(
    '',
    'CLAIMS TO AUTHOR — return exactly one output object per ref below:',
  )
  for (const c of ctx.claims) {
    lines.push(
      '',
      `--- ref: ${c.ref}`,
      `claim: ${c.claim}`,
      `section: ${c.section.headingText}`,
    )
    if (c.retry) {
      lines.push(
        'RETRY — a scenario you authored for this claim FAILED birth validation (it did',
        'not pass against the current code). Use the evidence below to fix COMMANDS,',
        'ARGUMENTS, and SETUP — a wrong flag, a missing `setup` file, an off-by-one id.',
        'But the ASSERTION still states what the CLAIM says: if the evidence shows a',
        'genuine DOC-vs-CODE disagreement on the asserted VALUE (the code really prints',
        "something other than what the claim quotes), KEEP the claim's assertion — the",
        'retry then fails again and the claim correctly becomes a finding. Do NOT change a',
        'claimed assertion to match the code. Return an empty scenarios array only if the',
        `claim is genuinely not ${ctx.driver === 'api' ? 'HTTP' : 'CLI'}-observable:`,
        `  scenario: ${c.retry.scenarioTitle}`,
        `  failing step: ${c.retry.step}`,
        `  expected: ${c.retry.expected}`,
        `  actual:   ${c.retry.actual}`,
      )
      // The failing run's raw program output — the evidence the rules above point
      // at (a usage error reveals the real flags). Each stream omitted when absent.
      if (c.retry.stdout) lines.push('  program stdout:', indentBlock(c.retry.stdout))
      if (c.retry.stderr) lines.push('  program stderr:', indentBlock(c.retry.stderr))
    }
  }
  if (ctx.correction) {
    lines.push(
      '',
      'CORRECTION — your previous response was NOT a valid output array. You returned:',
      ctx.correction.invalidOutput,
      'Return a JSON ARRAY with exactly one { "ref", "scenarios" } object per claim ref',
      `above; each scenario matches the schema (title, driver "${ctx.driver}", non-empty steps,`,
      'optional setup/normalize). Use an empty scenarios array for a claim that is not',
      `${ctx.driver === 'api' ? 'HTTP' : 'CLI'}-assertable — and add "blockedOn": ["<capability>"] when it is empty because`,
      'the claim needs world-state the sandbox cannot provide. No prose — only the JSON array.',
    )
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Recipe discovery
// ---------------------------------------------------------------------------

export const RECIPE_SYSTEM_PROMPT = `\
You propose how to turn a repository's working tree into a runnable command-line
entrypoint that guard scenarios can invoke. You return JSON only. You never run
commands — the engine verifies your proposal by building and probing it.

${OUTPUT_ONLY_GUARDRAIL}

Given the repository's manifest files, return exactly one JSON object matching
this schema (CANONICAL — generated from the engine's Zod definition; your reply
must validate against it exactly):
${RECIPE_JSON_SCHEMA}
Concretely:
  { "install": "<optional shell command run once in the repo root, before the build, to fetch dependencies>",
    "build": "<shell command run once in the repo root to produce the entrypoint>",
    "entry": ["<argv>", "..."] }

- install (optional) fetches dependencies before the build runs — the tree may be
  a fresh clone with no node_modules (e.g. "npm ci", "pnpm install --frozen-lockfile",
  "yarn install --immutable"; match the lockfile present). Omit it when the tree
  needs no dependency fetch to build.
- build produces the runnable program (e.g. "pnpm build", "npm run build"), or a
  no-op "true" when nothing needs building.
- entry is the argv that invokes the built program; scenario arguments are
  appended to it (e.g. ["node","dist/cli.js"] or ["node","bin/tool.js"]). Prefer
  the package's declared bin/main and its build script. Paths are repo-relative.

Output exactly one JSON object with \`build\` and \`entry\` (and \`install\` when
dependencies must be fetched first). No prose.`

export const RECIPE_PROMPT_FINGERPRINT = fingerprint(RECIPE_SYSTEM_PROMPT)

export interface RecipeDiscoveryInput {
  /** package.json contents (or a note that it's absent). */
  packageJson: string
  /** Names of the lockfiles / build-config files present in the repo root. */
  presentInputs: string[]
  /** On a re-ask after invalid output, the prior output quoted back. */
  correction?: OutputCorrection
}

export function buildRecipeUserPrompt(input: RecipeDiscoveryInput): string {
  const lines = [
    `Files present in the repo root: ${input.presentInputs.join(', ') || '(none of the usual manifests)'}`,
    '',
    'package.json:',
    '"""',
    input.packageJson,
    '"""',
  ]
  if (input.correction) {
    lines.push(
      '',
      'CORRECTION — your previous response was NOT a valid recipe proposal. You returned:',
      input.correction.invalidOutput,
      'Return exactly one JSON object with a non-empty "build" string and a non-empty',
      '"entry" argv array (and optional "install" and "env"), and nothing else:',
      '  { "install": "<optional shell command>", "build": "<shell command>", "entry": ["<argv>", "..."] }',
    )
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Fidelity review
// ---------------------------------------------------------------------------

export const FIDELITY_SYSTEM_PROMPT = `\
You are a strict reviewer. You are given ONE test scenario that already PASSES
against the current code, the SPEC SECTION it is bound to, and the CLAIM it was
authored from. Your ONE job: decide whether this scenario actually VERIFIES what
the section/claim asserts. You return JSON only — no prose.

${OUTPUT_ONLY_GUARDRAIL}

# The question
A green test is worthless if it passes for the wrong reason. Read the scenario's
steps and assertions against what the CLAIM (in its section's own words) says the
program does, then judge it as exactly one of:
- faithful — the scenario's assertions would FAIL if the claimed behavior were
  broken. It checks the specific observable the claim names (the exact stdout the
  claim quotes, the exact exit code, the exact file content), not a loose proxy.
- flagged — the scenario does NOT truly verify the claim. It is one of:
  - weak: it asserts LESS than the claim. The claim quotes exact output \`X\` but the
    scenario only checks that something changed, that the command exited 0, or that
    an unrelated substring appears — the disputed value \`X\` is never asserted.
  - vacuous: the assertion would still pass even if the claimed behavior were
    entirely broken or removed (e.g. asserts a prompt/help line, an unconditional
    banner, or exit 0 on a command that exits 0 regardless).
  - miscast: it tests a DIFFERENT behavior than the claim — a different command,
    flag, or observable than the one the claim is about.

# The bar
Assume the claim is the contract. Ask: "if a developer broke exactly the behavior
this claim describes, would THIS scenario turn red?" If yes → faithful. If it could
stay green while the claimed behavior is broken → flagged. When the claim quotes an
exact message or value, a scenario that does not assert that exact message/value is
flagged (weak), no matter how much else it checks.

# Output schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition; your reply must
validate against it exactly. Output EXACTLY ONE JSON object, no prose, no fences:
${FIDELITY_JSON_SCHEMA}
Concretely:
  { "verdict": "faithful" }
  { "verdict": "flagged", "mismatch": "<one sentence naming what the scenario fails to verify>" }
On "flagged" the "mismatch" is REQUIRED — one sentence stating the gap between what
the claim asserts and what the scenario actually checks. Omit it when faithful.`

export const FIDELITY_PROMPT_FINGERPRINT = fingerprint(FIDELITY_SYSTEM_PROMPT)

export interface FidelityUserContext {
  /** Repo-relative doc path the claim comes from — orientation only. */
  doc: string
  /** The bound section's heading, for context. */
  sectionHeading: string
  /** The section's own text — what the claim is read against. */
  sectionText: string
  /** The extracted claim the scenario was authored from. */
  claim: string
  /** The committed YAML of the green scenario under review. */
  scenarioYaml: string
  /** On a re-ask after invalid output, the prior output quoted back. */
  correction?: OutputCorrection
}

export function buildFidelityUserPrompt(ctx: FidelityUserContext): string {
  const lines = [
    `Document: ${ctx.doc}`,
    `Section: ${ctx.sectionHeading}`,
    '',
    'SECTION TEXT (what the claim is read against):',
    '"""',
    ctx.sectionText,
    '"""',
    '',
    `CLAIM the scenario was authored from:`,
    ctx.claim,
    '',
    'SCENARIO UNDER REVIEW (passes against current code):',
    '"""',
    ctx.scenarioYaml,
    '"""',
    '',
    'Return exactly one JSON object: { "verdict": "faithful" } or',
    '{ "verdict": "flagged", "mismatch": "<one sentence>" }.',
  ]
  if (ctx.correction) {
    lines.push(
      '',
      'CORRECTION — your previous response was NOT valid. You returned:',
      ctx.correction.invalidOutput,
      'Return exactly ONE JSON object with a "verdict" of "faithful" or "flagged"',
      '(a one-sentence "mismatch" when flagged), and NOTHING else.',
    )
  }
  return lines.join('\n')
}
