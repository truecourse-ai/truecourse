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
  SeedProposalSchema,
  RawGeneratedCliScenarioSchema,
  RawGeneratedApiScenarioSchema,
  FidelityReviewSchema,
  FlowSynthesisSchema,
  EpicSynthesisSchema,
  RealizationMatchSchema,
} from './schemas.js'
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
/** The seed-draft JSON Schema (item 66), from the engine's own Zod source. */
const SEED_JSON_SCHEMA = jsonSchemaHint(SeedProposalSchema)
/** The fidelity-review verdict JSON Schema, from the runner's Zod source. */
const FIDELITY_JSON_SCHEMA = jsonSchemaHint(FidelityReviewSchema)
/** The flow-synthesis JSON Schemas (per-area composition + the epic pass). */
const FLOWS_JSON_SCHEMA = jsonSchemaHint(FlowSynthesisSchema)
const FLOWS_EPIC_JSON_SCHEMA = jsonSchemaHint(EpicSynthesisSchema)
/** The realization-matching verdict JSON Schema, from the runner's Zod source. */
const MATCH_JSON_SCHEMA = jsonSchemaHint(RealizationMatchSchema)

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
You author ONE guard SCENARIO — a declarative, executable test that walks a spec
FLOW through a command-line program. A flow is a user-goal path: an ordered list of
MILESTONES, each one a spec claim. You are given the flow, each milestone's claim
and the section text it came from, and a REALIZATION PLAN naming the commands that
serve each milestone. You return ONE scenario whose steps walk the path in order.
No prose, only JSON.

# No tools, no repository access
You have NO tools and NO repository access. Tool-call JSON or \`<tool_use>\` markup is
invalid output — your response can ONLY be the JSON object described below. You never
need to inspect code: the REAL BEHAVIOR transcripts (captured in an empty sandbox) are
provided below, and birth validation supplies the program's actual output on retry.
Use those transcripts to get the COMMANDS, ARGUMENTS, and SETUP right — never to decide
WHAT to assert (see the next rule); a milestone about behavior in a NON-empty world
(existing files or git state) still needs a \`setup\` block — the transcripts show only
the empty-world baseline.

# Assertions come from the claim, never the transcript
Transcripts (the REAL BEHAVIOR probes, and the actual output birth supplies on retry)
and the realization plan exist ONLY to get commands, arguments, and setup right. Every
ASSERTION must state what the milestone's CLAIM — read against its section's text —
says: copied VERBATIM where the claim
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
Assert only what each claim, read against its section's text, states. A scenario
must never claim more than the prose does. A weaker-than-spec test — green but
proving less than the claim — is the worst failure mode.

# The path is the point: one scenario, every milestone
The flow's milestones are ORDERED, and the state one leaves behind is what the next
acts on: create a thing, list it, complete it, filter for it. Author ONE scenario that
walks them in order in a single sandbox.
- Every milestone MUST be realized by at least one step, and each such step carries
  \`milestone: <that milestone's number>\`. A step that only prepares the world (seeding,
  a command whose output nothing asserts) carries NO \`milestone\` — it paints neutral.
- A milestone may take several steps (do it, then observe it): annotate each of them
  with that milestone's number.
- Never renumber, merge, split, skip, or invent a milestone — the numbers are given.
- When a milestone needs world-state the milestones before it do not produce, declare it
  in \`setup\` — never drop the milestone.

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
A step may also carry \`env\` — an overlay applied to THAT step alone on top of the
scenario-global \`setup.env\`; use it when a claim needs the SAME command observed
under different environments (default, then with the variable set), which one
\`setup.env\` cannot express.
The sandbox is otherwise bare: no network egress, no credentials (env is
allowlisted — the host's API keys never reach the program), no shell. When the flow
needs world-state NO setup block can express — a running service, a database,
network, credentials — author NOTHING: omit \`scenario\` AND name the missing
capability in \`blockedOn\` (see the output shape). An honest blocked flow is right;
a scenario that fakes the missing world is wrong.
NAME the blocker with the right noun — the classes are triaged differently:
- \`"credentials"\` when a SECRET is missing (an api key, a token, a login);
- the SERVICE ITSELF when a third party is missing (\`"stripe"\`), never a generic noun;
- \`"missing-data"\` when what is missing is pre-existing DATA — a record, a user, a
  state the program cannot create through its own commands and \`setup\` cannot
  express. Use exactly that noun, and add a SECOND entry naming the entity:
  \`"blockedOn": ["missing-data", "an already-cancelled booking"]\`. The noun is what
  makes it countable across flows; the entity is what makes it fixable.

# The scenario schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition — match it exactly.
It contains ONLY the fields you author (\`driver\` is always "cli"); the engine
assigns the scenario's id, its flow/journey references, and its section bindings
itself, so do not emit any field that is not in the schema.
${SCENARIO_JSON_SCHEMA}

# Determinism
No network, no timing assumptions, no retries. When asserted output contains a
timestamp, absolute path, version string, or duration, list the matching
\`normalize\` entry (timestamps | abs-paths | versions | durations) instead of
hard-coding the volatile value, and prefer \`contains\`/\`matches\` on the meaningful
substring over \`equals\` on a whole line that carries volatile text.

# Output — ONE object, carrying one scenario
Return EXACTLY ONE JSON object:
  { "scenario": { … the scenario, its steps carrying \`milestone\` … } }
or, when the flow needs world-state the sandbox cannot provide:
  { "blockedOn": ["<capability, e.g. service|db|network|credentials|missing-data>"] }
Exactly one of the two. No prose, no fences — only the JSON object.`

export const GENERATE_PROMPT_FINGERPRINT = fingerprint(GENERATE_SYSTEM_PROMPT)

// ---------------------------------------------------------------------------
// Scenario authoring — api driver
// ---------------------------------------------------------------------------

export const GENERATE_API_SYSTEM_PROMPT = `\
You author ONE guard SCENARIO — a declarative, executable test that walks a spec
FLOW through an HTTP service. A flow is a user-goal path: an ordered list of
MILESTONES, each one a spec claim. You are given the flow, each milestone's claim
and the section text it came from, a REALIZATION PLAN naming the operations that
serve each milestone, and how the service is built and served. You return ONE
scenario whose steps walk the path in order. No prose, only JSON.

# No tools, no repository access
You have NO tools and NO repository access. Tool-call JSON or \`<tool_use>\` markup is
invalid output — your response can ONLY be the JSON object described below. You never
need to inspect code: author requests from what the CLAIMS and their sections state,
and when a scenario fails birth validation the retry supplies the service's ACTUAL
response body — use it to fix PATHS, METHODS, and REQUEST BODIES, never to decide
WHAT to assert (see the next rule).

# Assertions come from the claim, never the observed response
Every ASSERTION must state what the milestone's CLAIM — read against its section's
text — says: the exact status code it names, the exact field values or messages it
quotes, adapting only placeholders to the concrete values your scenario creates. If
the service demonstrably behaves DIFFERENTLY from the claim, you MUST STILL assert the
CLAIM'S version. The scenario then fails birth — and that is the CORRECT, desired
outcome: the doc-vs-code disagreement surfaces as a finding. Never weaken,
generalize, or swap a claimed assertion for a softer, effect-only check (asserting
"some 2xx" where the claim says 201, or that a list changed where the claim quotes
an error message) to make a scenario pass — a green test that proves less than the
claim is the worst outcome.

# Faithfulness — the prime directive
Assert only what each claim, read against its section's text, states. A scenario
must never claim more than the prose does.

# The path is the point: one scenario, every milestone
The flow's milestones are ORDERED, and the state one leaves behind is what the next
acts on: create a resource, list it, update it, filter for it. Author ONE scenario that
walks them in order against one freshly booted server.
- Every milestone MUST be realized by at least one step, and each such step carries
  \`milestone: <that milestone's number>\`. A step that only prepares the world (an
  authenticating call, a seeding request nothing asserts) carries NO \`milestone\`.
- A milestone may take several steps (do it, then observe it): annotate each of them
  with that milestone's number.
- Never renumber, merge, split, skip, or invent a milestone — the numbers are given.
- Chain the path with \`capture\` + \`\${var}\` rather than guessing ids between steps.

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
- \`captureHeaders\`: variable name → a RESPONSE HEADER name (case-insensitive) on this
  step's response — the same \`\${name}\` namespace, for values that ride a header
  instead of the body (\`x-auth-token\`, an \`ETag\`, or the \`Location\` of a 3xx —
  redirects are never followed, so the target is observable). A header the response
  does not carry fails the step, exactly like a body path that resolves to nothing.
- \`expect\` asserts on \`status\` (exact code), \`headers\` (name → one of
  equals | contains | matches), \`body\` (the raw text, same matchers, compared
  AFTER normalization), and \`json\` (dotted path → equals — a JSON value compared
  structurally — | contains | matches | exists | absent).
- \`repeat\` runs the step N times (each iteration must satisfy \`expect\`).
Steps of one scenario share a COOKIE JAR, like a browser: whatever a step's response
sets via \`Set-Cookie\` is sent back on every later step of that scenario (and on no
other scenario), so a session-cookie login is just a first step — never capture or
re-send the cookie yourself. A step that writes its own \`Cookie\` header overrides the
jar for that one request.
Seed inputs declaratively with \`setup.files\` (path → content, materialized in the
sandbox cwd the service starts in) and \`setup.env\` (extra env for the service
process); there is no shell escape.

# World-state capabilities
\`setup\` declares the WORLD a test needs — never code, never shell. The recipe's
own \`api\` block already brings up the service (and its declared datastores);
scenarios never manage processes. The sandbox is otherwise bare: no network egress
beyond the service under test, no credentials, no external systems.

ONE exception, and it is the important one: \`setup.http\` FAKES a third-party HTTP
dependency. It works ONLY when the service reads that dependency's base URL from an
ENV VAR (the user prompt names the ones detected in this repo). Then:
- declare the stub — \`setup.http: { "<name>": { "routes": [...] } }\` — scripting the
  MINIMAL responses the flow needs (\`method\` + \`path\` + \`status\` + \`json\`/\`body\`),
  including the failure responses a claim about upstream errors needs;
- point the env var at it: \`setup.env: { "<THAT_ENV_VAR>": "\\\${HTTP_STUB:<name>}" }\`
  — the engine substitutes the stub's real origin at run time;
- add \`expect\` to a route for what the service MUST send the third party (query
  params, headers, request-body fields the claim names), and \`calls\` when the claim
  is about how many times it is called (\`calls: 0\` asserts it is never called).
A request no route matches FAILS the scenario, so script every call the flow makes.
This is how a claim about upstream failures, unusual upstream values, or the exact
upstream request becomes testable. It fakes ONE thing — an HTTP counterparty behind
a configurable base URL — and nothing else.

A SECOND exception, and it overrides the first for the services it covers: the user
may have PROVIDED a real account for a third party (a vendor sandbox, or the real
service). The user prompt marks those services as available; for one of them the
runner configures the service under test to reach the LIVE upstream before your
scenario runs, so nothing is missing and nothing needs stubbing. For a PROVIDED
service:
- author the flow against it — do NOT declare a \`setup.http\` stub for it and do NOT
  point its base-URL env var anywhere (a stub would replace the very account the
  user supplied);
- the responses are LIVE and outside this repo's control: assert SHAPES and
  INVARIANTS (status, presence and type of fields, the service's own derived
  values), never an exact upstream-dependent value (today's temperature, a live
  price, a row count) and never an upstream latency;
- FAULTS on a provided service ARE scriptable — every call to it goes through the
  runner's own proxy, so \`setup.externals\` can make it fail without touching the
  base-URL env var:
  \`setup.externals: { "<service>": { "faults": [...], "calls": <n> } }\`
  A fault rule may \`respond\` (a forced \`status\` + \`json\`/\`body\` instead of the real
  answer), \`delayMs\` (wait — this is how "slower than the service's timeout" is
  written), \`refuse: true\` (the connection dies unanswered, as a down upstream
  does), and may narrow to some calls with \`match\` (\`method\`/\`path\`). \`once: true\`
  makes a rule fire ONCE and then step aside, so
  \`[{"refuse": true, "once": true}, {}]\` is "the first call fails, the next
  succeeds". Calls no rule matches go to the real service untouched, and
  \`calls: <n>\` asserts EXACTLY how many calls the service received over the whole
  scenario (\`1\` proves no retry; \`0\` proves it was never called).
- so a claim about UPSTREAM FAILURE behavior — a 5xx from the third party, a
  timeout, a refused connection, "it does not retry" — is authorable against a
  provided service and must NOT be left \`blockedOn\`. What a provided service still
  cannot give you is a specific SUCCESS payload it does not really return: for that
  use \`setup.http\`, or leave the flow \`blockedOn\`.
A service NOT marked available in the user prompt is unchanged: stub it when it has
a base-URL env var, otherwise name it in \`blockedOn\`.

When the flow needs world-state neither \`setup\` nor the recipe provides — a
third-party with NO base-URL env override, a credentialed integration, another live
service — author NOTHING: omit \`scenario\`
AND name the missing capability in \`blockedOn\`. An honest blocked flow is right; a
scenario that fakes the missing world is wrong. NAME the blocker as precisely as you
can: when it is a third party this repo depends on, write the SERVICE (\`"stripe"\`,
\`"sendgrid"\`) rather than a generic noun — the user prompt lists the ones detected
in this repo. A named blocker is triaged per service; \`"external-service"\` is not.

A THIRD class of blocker, distinct from both: pre-existing DATA. When the flow needs
a record the API cannot create through its OWN endpoints — an already-cancelled
booking, a user with a past subscription, a row in a state no request produces — and
no fixture listed in the user prompt provides it, that flow is blocked on data, not
on a service and not on credentials. Use the noun \`"missing-data"\` and add a SECOND
entry naming the entity:
  \`"blockedOn": ["missing-data", "an already-cancelled booking"]\`
The noun makes it countable across flows; the entity names what a seed would have to
create. Data the flow can create for itself through the API's own endpoints is NOT
this — author those steps.

# Ground every request in the app's own surface, never in a guess
The user prompt states, from the app's OWN source, which operations exist, what each
one reads off the request, and how the app builds the requests it sends UPSTREAM.
Those facts outrank any shape you could infer from the prose:
- Author every request against a path the user prompt LISTS — verbatim, prefix
  included. A path that appears nowhere in it does not exist and answers 404, so a
  scenario built on one proves nothing.
- A request body must carry every field the prompt marks REQUIRED for that operation,
  including on a setup step that only prepares the world. A missing required field is
  a 400 the app returns before any assertion of yours runs.
- A \`setup.http\` stub's response body must satisfy the fields the prompt says the app
  READS off that upstream, with the types it states, and its route must match the path
  and query the app actually sends. An app that rejects its own stub reports an
  UPSTREAM failure — a red scenario that says nothing about the claim.

# The scenario schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition — match it exactly.
It contains ONLY the fields you author (\`driver\` is always "api"); the engine
assigns the scenario's id, its flow/journey references, and its section bindings
itself, so do not emit any field that is not in the schema.
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

# Output — ONE object, carrying one scenario
Return EXACTLY ONE JSON object:
  { "scenario": { … the scenario, its steps carrying \`milestone\` … } }
or, when the flow needs world-state the sandbox cannot provide:
  { "blockedOn": ["<capability — the SERVICE NAME when it is a third party, e.g. stripe|credentials|missing-data>"] }
Exactly one of the two. No prose, no fences — only the JSON object.`

export const GENERATE_API_PROMPT_FINGERPRINT = fingerprint(GENERATE_API_SYSTEM_PROMPT)

/**
 * A birth-validation failure attached to a flow scenario on a retry so the model
 * can fix it. Extends the shared excerpt pair: the failing run's RAW program output
 * is the evidence the retry's doc-first language refers to — the usage error the
 * program printed reveals the correct flags/subcommand. Absent when the stream was
 * empty (or an infra failure produced no capture).
 */
export interface BirthRetryContext extends OutputExcerpts {
  scenarioTitle: string
  step: number
  expected: string
  actual: string
  /** The milestone the failing step realized, when it carried one. */
  milestone?: number
}

/**
 * One milestone as authoring sees it: its position in the path, the CLAIM (the
 * assertion source — item 32), the section text the claim is read against, and the
 * realization the matcher chose for it (the HOW, translated into the driver's own
 * verbs by the adapter table).
 */
export interface AuthorMilestone {
  /** 1-based position in the flow's path — the `milestone` value steps carry. */
  order: number
  /** The extracted claim's text — assertions come from HERE. */
  claim: string
  /** Repo-relative doc the claim was extracted from. */
  doc: string
  /** The bound section's heading, for orientation. */
  sectionHeading: string
  /** The bound section's text — what the claim is read against. */
  sectionText: string
  /** Synthesis' note on why this step sits here, when it wrote one. */
  note?: string
  /**
   * The realization the matcher picked, already translated through the driver
   * adapter (`invoke` → cli `run`, `request` → api `request`) — one line per
   * journey step. Empty when no journey was matched to this milestone.
   */
  realization: string[]
}

/**
 * One detected third party as the AUTHORING prompt names it: its canonical name
 * plus, when the detector saw one, the env var that overrides its base URL. The
 * env var is the precondition for a `setup.http` stub (item 58) — with it the flow
 * is authorable against a scripted fake; without it, it is honestly blocked.
 */
export interface ExternalServiceHint {
  name: string
  baseUrlEnv?: string
  /**
   * EVERY base-URL override variable detected for this service, best-confidence
   * first (item 63). A repo reaching one vendor through several hosts has one
   * variable per host, and a stub has to point ALL of them at itself — advertising
   * only `baseUrlEnv` would describe a half-stubbed world. Absent ⇒ `baseUrlEnv`
   * alone, which keeps a single-variable repo's prompt as it was.
   */
  baseUrlEnvs?: string[]
  /**
   * The user PROVIDED an account for this service (item 62): the runner points the
   * app at it before the scenario runs, so it is a live capability rather than a
   * blocker. Absent/false keeps the pre-item-62 rendering byte-identical.
   */
  provided?: boolean
  /** Whether the provided account is the vendor's SANDBOX or the REAL service. */
  mode?: 'sandbox' | 'real'
  /** The user's note about the account, rendered verbatim next to it. */
  description?: string
}

/**
 * One operation the flow walks, as the app's OWN routes declare it (item 69): the
 * exact path a request must use verbatim, plus what its handler reads off the
 * request. `required: 'unknown'` is a real answer — the field is read, and nothing
 * in the source says whether it may be absent.
 */
export interface JourneyContractHint {
  method: string
  path: string
  bodyFields?: { name: string; required: boolean | 'unknown' }[]
  queryFields?: { name: string; required: boolean | 'unknown' }[]
}

/**
 * One request the app SENDS to an upstream, as its own source constructs it (item
 * 69) — the contract a `setup.http` stub has to satisfy to be accepted by the app
 * it is faking for, and the query params a stub may assert.
 */
export interface OutboundRequestHint {
  /** The detected third party this request goes to, when the source says which. */
  service?: string
  method: string
  path?: string
  /** How the origin is written in the source, when it is not a literal host. */
  base?: string
  queryParams: { key: string; value: string }[]
  /** Params dropped by the cap. */
  moreQueryParams?: number
  headers?: { name: string; value: string }[]
  responseFields: { path: string; hint?: 'number' | 'string' | 'array' | 'object' }[]
  /** Response fields dropped by the cap. */
  moreResponseFields?: number
}

export interface AuthorUserContext {
  /** The flow being realized: its handle, title, and goal statement. */
  flow: { id: string; title: string; goal: string }
  /** The flow's path, in order — the assertion source and the milestone numbers. */
  milestones: AuthorMilestone[]
  /** The journey ids the realization plan walks, in order (provenance for the model). */
  journeyPath: string[]
  /** Canonical area ids the flow's docs cover, from the corpus (may be empty). */
  areaTags: string[]
  /** The surface this scenario runs on — selects the system prompt + the
   *  preparation framing below. */
  driver: 'cli' | 'api'
  /** cli batches: the recipe entrypoint argv, so the model knows what `run` is
   *  appended to. Absent on api batches. */
  recipeEntry?: string[]
  /** api batches: the recipe's serve argv (the runner boots it per scenario). */
  recipeServe?: string[]
  /** api batches: the health endpoint the runner polls before any step runs. */
  recipeHealthPath?: string
  /**
   * api batches: the recipe's DECLARED credentials — name + the request header the
   * runner injects each as (never the secret value). Advertises to the model which
   * `{{cred:<name>}}` placeholders are available; empty/absent for repos that
   * declare none, keeping the authored prompt byte-identical to the pre-credential
   * behavior. Ignored on cli batches.
   */
  credentials?: { name: string; header: string; description?: string }[]
  /**
   * api batches: the seed stage's fixture CATALOG — each fixture's name + the field
   * names it exposes (never runtime values). Advertises the `{{fixture:<name>.<field>}}`
   * placeholders available; present only when the recipe declares a seed stage, so a
   * seed-less repo's prompt stays byte-identical. Ignored on cli batches.
   */
  fixtures?: { name: string; fields: string[] }[]
  /**
   * api batches: the third parties THIS repo imports (item 57), canonical names,
   * detected from the working tree. Not a capability the sandbox offers — the
   * opposite: the list of blockers worth naming precisely, so a refusal says
   * `blockedOn: ["stripe"]` instead of `["external-service"]`. Empty/absent (nothing
   * detected, or a degraded mapping) keeps the prompt byte-identical. Ignored on cli.
   */
  externalServices?: ExternalServiceHint[]
  /**
   * api scenarios: the flow's own operations as the repo's ROUTES declare them
   * (item 69) — exact path + the request fields the handler reads, requiredness
   * included when the source states it. Grounds three measured failures: invented
   * paths, bodies missing a required field, and a setup step that 400s before the
   * claim is reached. Empty/absent (no api journeys, a degraded mapping, cli) keeps
   * the prompt byte-identical. USER-prompt only.
   */
  journeyContracts?: JourneyContractHint[]
  /**
   * api scenarios: how the app CONSTRUCTS its outbound requests and which response
   * fields it reads back (item 69) — what a `setup.http` stub must answer with to be
   * accepted by the app it fakes for. Empty/absent keeps the prompt byte-identical.
   * USER-prompt only.
   */
  outboundRequests?: OutboundRequestHint[]
  /** How many outbound requests the cap dropped, so the block can say so. */
  outboundRequestsOverflow?: number
  /**
   * api scenarios: the OpenAPI write-op request-body schemas the flow's markdown
   * sections reference (item 42 / B4) — method + path + pretty-printed JSON Schema.
   * Advertises the authoritative body shape so the model authors the request `json`
   * against declared fields/types instead of guessing. Empty/absent when no section
   * references a write op (or on cli), keeping the prompt byte-identical.
   */
  endpointSchemas?: { method: string; path: string; requestSchema: string }[]
  /**
   * api scenarios: whether the flow binds to an OpenAPI OPERATION section (item 43 /
   * B5) — the precondition for `expect.schema: true` to resolve at run time. Only
   * then is the response-schema conformance guidance rendered; a markdown-bound (or
   * cli) flow keeps the prompt byte-identical, so a scenario that could only die at
   * birth (unresolvable schema) is never nudged toward `schema: true`.
   */
  bindsOpenApiOperation?: boolean
  /**
   * api scenarios: how the OpenAPI operations the flow binds to map onto the declared
   * credentials (item 45 / B7) — `satisfiedBy` names, per required security scheme, the
   * credential + header that fulfills it; `unsatisfied` names the schemes NO declared
   * credential satisfies (author no scenario, `blockedOn` naming them). Present only
   * when at least one bound operation declares security AND a credential matches (or
   * fails to); absent/all-empty for a public operation, a markdown flow, or cli.
   * USER-prompt only.
   */
  operationAuth?: { satisfiedBy: { scheme: string; credential: string; header: string }[]; unsatisfied: string[] }
  /** Recipe build command — context on what is built before scenarios run. */
  recipeBuild: string
  /** Real empty-sandbox transcripts for the commands the realization names (cli only;
   *  may be empty — ungrounded when the build failed or no command was named). */
  probes?: ProbeTranscript[]
  /** On a birth-validation retry, the prior attempt's failure evidence. */
  retry?: BirthRetryContext
  /**
   * On a re-ask after the engine rejected the scenario: the milestones no step
   * realized, and the `milestone` values that match none of the flow's. Exactly
   * what was wrong — never a bare "try again".
   */
  issues?: { uncoveredMilestones: number[]; unknownMilestones: number[] }
  /** On a re-ask after invalid output, the prior output quoted back. */
  correction?: OutputCorrection
}

/**
 * The request fields one operation declares, as one trailing clause: the REQUIRED
 * ones first (the actionable half), then the fields that are read but whose
 * requiredness the source does not state — never rendered as "optional", which
 * would be a claim the analysis did not make.
 */
function contractSummary(hint: JourneyContractHint): string {
  const parts: string[] = []
  for (const [label, fields] of [
    ['body', hint.bodyFields],
    ['query', hint.queryFields],
  ] as const) {
    if (!fields || fields.length === 0) continue
    const required = fields.filter((f) => f.required === true).map((f) => f.name)
    const rest = fields.filter((f) => f.required !== true).map((f) => f.name)
    const clauses: string[] = []
    if (required.length > 0) clauses.push(`requires ${required.join(', ')}`)
    if (rest.length > 0) clauses.push(`also reads ${rest.join(', ')}`)
    if (clauses.length > 0) parts.push(`${label} ${clauses.join('; ')}`)
  }
  return parts.length > 0 ? ` — ${parts.join(' | ')}` : ''
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
  // Declared api credentials (Phase 1): advertise the available `{{cred:<name>}}`
  // placeholders and the header each is injected as — never the secret value.
  // Gated so a credential-less repo's prompt is byte-identical to before.
  if (ctx.driver === 'api' && ctx.credentials && ctx.credentials.length > 0) {
    lines.push(
      '',
      'CREDENTIALS AVAILABLE — the recipe injects these as request headers; their',
      'values are secret and never shown to you. To use one, put its placeholder in a',
      'header value and the runner substitutes the real secret at request time:',
    )
    for (const c of ctx.credentials) {
      // Phase 3: the role/principal description (when set) rides next to the name so
      // the author picks the right credential for a role-sensitive claim. Omitted →
      // byte-identical to the Phase 1 line.
      const role = c.description ? ` (${c.description})` : ''
      lines.push(`- ${c.name}${role} → request header \`${c.header}\`; write \`{{cred:${c.name}}}\` as that header's value`)
    }
    lines.push(
      'A milestone whose behavior needs one of THESE credentials is authorable — place',
      'the placeholder in the header the service expects. A flow that needs a credential',
      'NOT listed above is blocked: omit `scenario` and return',
      '"blockedOn": ["credentials"].',
    )
  }
  // Seed fixture catalog (Phase 2): the ids/handles the seed created before the run,
  // usable via `{{fixture:<name>.<field>}}` ANYWHERE in a request (path, query, header,
  // body) — broader than credentials because fixtures are not secrets. Gated on a seed
  // stage existing, so a seed-less repo's prompt renders identically without it.
  if (ctx.driver === 'api' && ctx.fixtures && ctx.fixtures.length > 0) {
    lines.push(
      '',
      'FIXTURES AVAILABLE — the seed created this data before your scenario runs; their',
      'values are chosen at run time and never shown to you. Reference a field with',
      '`{{fixture:<name>.<field>}}` in a path, query string, header value, or request body',
      '(these are ids/handles, not secrets, so they may appear anywhere):',
    )
    for (const f of ctx.fixtures) {
      lines.push(`- ${f.name}: fields ${f.fields.map((x) => `\`${x}\``).join(', ')}`)
    }
    lines.push(
      'A milestone about SEEDED data (an existing booking, a pre-created event type, a',
      'known user) is authorable through these fixtures. A flow that needs data NOT listed',
      'above — and that the API cannot create through its own endpoints — is blocked on',
      'DATA: omit `scenario` and return `"blockedOn": ["missing-data", "<the entity>"]`.',
    )
  }
  // Detected third parties (Phase 3 / item 57): what this repo actually integrates
  // with, so a blocked flow names the SERVICE and the gap can be triaged per service.
  // Gated on a non-empty detection, so a repo with no third-party SDK renders exactly
  // as before.
  if (ctx.driver === 'api' && ctx.externalServices && ctx.externalServices.length > 0) {
    const unprovided = ctx.externalServices.filter((s) => !s.provided)
    const provided = ctx.externalServices.filter((s) => s.provided)
    if (unprovided.length > 0) {
      const rendered = unprovided.map((s) => {
        const envs = s.baseUrlEnvs ?? (s.baseUrlEnv ? [s.baseUrlEnv] : [])
        if (envs.length === 0) return s.name
        const label = envs.length === 1 ? 'base URL env' : 'base URL envs'
        return `${s.name} (${label}: ${envs.join(', ')} — stubable via setup.http, or provide it)`
      })
      lines.push(
        '',
        `THIRD PARTIES THIS REPO DEPENDS ON — detected in its source: ${rendered.join(', ')}.`,
        'The sandbox reaches NONE of them for real (no egress, no credentials). One that',
        'names base URL env vars above CAN be faked: declare a `setup.http` stub and point',
        'EVERY one of that service\'s env vars at `${HTTP_STUB:<name>}` in `setup.env` —',
        'leaving one unset leaves that host live and unreachable. One with no such env var',
        'cannot be faked: omit `scenario` and name THAT service in `blockedOn` — not a generic',
        'noun (e.g. `"blockedOn": ["stripe"]`). A milestone that never touches one of them is',
        'authorable as usual.',
      )
    }
    // Item 62: the user supplied a real/sandbox account for these — they are a
    // CAPABILITY, not a blocker, and they take precedence over stubbing.
    if (provided.length > 0) {
      lines.push('', 'EXTERNAL SERVICES AVAILABLE FOR REAL — the user provided an account for each:')
      for (const s of provided) {
        const notes = [
          s.mode ? `${s.mode} account` : 'user-provided account',
          ...(s.baseUrlEnv ? [`the server reaches it via ${s.baseUrlEnv}`] : []),
          ...(s.description ? [s.description] : []),
        ]
        lines.push(`- ${s.name}: ${notes.join('; ')}`)
      }
      lines.push(
        'The server under test is CONFIGURED to reach these before your scenario runs, so',
        'author flows against them and do NOT stub them (no `setup.http`, no base-URL env',
        'override) — a stub would replace the very account the user supplied. Their',
        'responses are LIVE: assert shapes and invariants (status, field presence/type, the',
        "service's own derived values), never an exact upstream-dependent value. Their FAULTS",
        'are yours to script, though: every call to one of them passes through the runner, so',
        '`setup.externals: { "<service>": { "faults": [...], "calls": <n> } }` can force a',
        'status, delay past a timeout, refuse the connection, or fail once and then recover —',
        'and count the calls. A flow about UPSTREAM FAILURE behavior is therefore authorable',
        'against these services, not `blockedOn`. A flow needing a specific SUCCESS payload',
        'the real service does not return still needs `setup.http`, or stays `blockedOn`.',
      )
    }
  }
  // Item 69: how the app itself builds the requests it SENDS upstream, and which
  // response fields it reads back. A stub scripted against the vendor's documented
  // payload rather than these facts is rejected by the app under test, which reads as
  // an upstream failure and fails the scenario for a reason unrelated to the claim.
  // api-only and gated on non-empty, so a repo whose source yields none is
  // byte-identical to before item 69.
  if (ctx.driver === 'api' && ctx.outboundRequests && ctx.outboundRequests.length > 0) {
    lines.push(
      '',
      "OUTBOUND REQUESTS THIS APP MAKES — harvested from the app's OWN source. Query",
      'keys and literal values are quoted as written; `<dynamic>` is computed at run',
      'time. A `setup.http` stub for one of these MUST answer this path, and its',
      'response body MUST carry the fields listed under `reads`, typed as shown — the',
      'app validates them itself and turns a wrong-shaped stub into its own upstream',
      'error. The query params are assertable on a stub route with `expect.query`:',
    )
    for (const r of ctx.outboundRequests) {
      const subject = [r.service ? `${r.service}:` : null, `${r.method} ${r.path ?? '(path built at run time)'}`]
        .filter(Boolean)
        .join(' ')
      lines.push(`- ${subject}${r.base ? `   (base: \`${r.base}\`)` : ''}`)
      if (r.queryParams.length > 0) {
        const rendered = r.queryParams.map((p) => `${p.key}=${p.value === '<dynamic>' ? '<dynamic>' : `"${p.value}"`}`)
        if (r.moreQueryParams) rendered.push(`…and ${r.moreQueryParams} more`)
        lines.push(`    query: ${rendered.join(', ')}`)
      }
      if (r.headers && r.headers.length > 0) {
        lines.push(`    headers: ${r.headers.map((h) => `${h.name}: ${h.value}`).join(', ')}`)
      }
      if (r.responseFields.length > 0) {
        const rendered = r.responseFields.map((f) => (f.hint ? `${f.path} (${f.hint})` : f.path))
        if (r.moreResponseFields) rendered.push(`…and ${r.moreResponseFields} more`)
        lines.push(`    reads: ${rendered.join(', ')}`)
      }
    }
    if (ctx.outboundRequestsOverflow) {
      lines.push(`(…and ${ctx.outboundRequestsOverflow} more outbound request(s) not shown.)`)
    }
  }
  // Batched-birth hygiene: scenarios in one birth round share ONE booted server, and
  // a resource a prior run created may still exist. Every scenario is given a
  // `${unique}` token — distinct per scenario in a run and across runs, stable across
  // its steps — so a client-chosen identifier it CREATES can be made collision-free.
  // A general authoring rule (it interpolates in cli argv/stdin too), so it is
  // unconditional — the block below is byte-identical for every claim/driver.
  lines.push(
    '',
    'UNIQUE IDENTIFIERS — this scenario is given a `${unique}` token: a short string',
    'distinct from every other scenario in this run and from any prior run, and stable',
    "across this scenario's steps. Whenever the scenario CREATES a resource with a",
    'client-chosen identifier (a slug, name, title, url, email, handle, id), embed',
    '`${unique}` in it so it cannot collide with one a sibling scenario or an earlier',
    'run already made — e.g. `"email": "user-${unique}@example.com"`, `"slug":',
    '"team-${unique}"`, or `init proj-${unique}`. The runner substitutes it at run',
    'time; assert on it by writing `${unique}` in the expectation or by capturing the',
    "server's response. Identifiers the SERVER assigns (an auto-increment id) still use",
    '`capture` + `${var}` as before.',
  )
  if (ctx.areaTags.length > 0) lines.push(`Area context: ${ctx.areaTags.join(', ')}`)
  lines.push(
    '',
    `FLOW: ${ctx.flow.title}`,
    `goal: ${ctx.flow.goal}`,
    `milestones: ${ctx.milestones.length}`,
  )
  if (ctx.journeyPath.length > 0) {
    lines.push(
      `realized through: ${ctx.journeyPath.join(' → ')}  (the surfaces matching chose; the`,
      'per-milestone lines below say which serves which)',
    )
  }
  // Item 69: the flow's own operations as the repo's ROUTE REGISTRATIONS declare
  // them — the exact paths, and what each handler reads off the request. api-only and
  // gated on non-empty, so a cli batch or a degraded mapping is byte-identical.
  if (ctx.driver === 'api' && ctx.journeyContracts && ctx.journeyContracts.length > 0) {
    lines.push(
      '',
      "OPERATIONS THIS FLOW WALKS — read out of the app's own route registrations. Use",
      'these paths VERBATIM (a path that is not listed here or in a milestone above does',
      'not exist and answers 404), and give every request a body carrying each field',
      'marked `required` — a missing one is a 400 before any assertion of yours runs:',
    )
    for (const j of ctx.journeyContracts) {
      lines.push(`- ${j.method} ${j.path}${contractSummary(j)}`)
    }
  }
  // Item 42 / B4: authoritative OpenAPI write-op request schemas for the endpoints
  // this batch's markdown sections reference. api-only and gated on non-empty, so a
  // batch that matched none is byte-identical to before enrichment.
  if (ctx.driver === 'api' && ctx.endpointSchemas && ctx.endpointSchemas.length > 0) {
    lines.push(
      '',
      'REQUEST BODY SCHEMAS (authoritative — for each endpoint below, author the request',
      '`json` to match these fields and types; do NOT invent or guess field names):',
    )
    for (const e of ctx.endpointSchemas) {
      lines.push(`- ${e.method} ${e.path}:`, e.requestSchema)
    }
  }
  // Item 43 / B5: response-schema conformance guidance. api-only AND gated on the
  // batch binding to an OpenAPI operation section (the precondition for `schema: true`
  // to resolve at run time), mirroring B4's precise endpointSchemas gating — a
  // markdown-bound or cli batch keeps the prompt byte-identical, so a scenario that
  // could only die at birth is never nudged toward `schema: true`. USER-prompt only,
  // so the pinned GENERATE_API_PROMPT_FINGERPRINT is untouched.
  if (ctx.driver === 'api' && ctx.bindsOpenApiOperation) {
    lines.push(
      '',
      'RESPONSE SCHEMA CONFORMANCE — when this service is described by an OpenAPI',
      'document, a step that asserts the exact status an operation documents may add',
      '`schema: true` to its `expect` (alongside `status`). The runner then checks the',
      'WHOLE response body against that operation\'s declared JSON response schema for',
      'that status — catching drift a handful of `json` path checks would miss (a renamed',
      'or dropped field the operation still declares required). Add it on the terminal',
      'step whose request method+path and status match a documented operation the',
      'scenario binds to; never on an error/edge status the operation does not describe,',
      'and never on a step that requests a DIFFERENT endpoint than the bound operation.',
    )
  }
  // Item 45 / B7: per-operation security → credential mapping. api-only and gated on a
  // non-empty operationAuth (some bound operation declares security AND a credential
  // matched or failed to), so a public operation / markdown / cli batch is byte-identical
  // to before B7. USER-prompt only — the pinned api SYSTEM fingerprint is untouched.
  if (
    ctx.driver === 'api' &&
    ctx.operationAuth &&
    (ctx.operationAuth.satisfiedBy.length > 0 || ctx.operationAuth.unsatisfied.length > 0)
  ) {
    lines.push(
      '',
      'OPERATION SECURITY — the bound OpenAPI operation(s) require these security',
      'schemes. Satisfy each with the credential named below; a scheme with NO declared',
      'credential is unauthorable — omit `scenario` and return `blockedOn` naming it,',
      'rather than authoring a request that dies un-authenticated at birth:',
    )
    for (const s of ctx.operationAuth.satisfiedBy) {
      lines.push(
        `- scheme \`${s.scheme}\` is satisfied by credential \`${s.credential}\` — put \`{{cred:${s.credential}}}\` in request header \`${s.header}\`.`,
      )
    }
    for (const scheme of ctx.operationAuth.unsatisfied) {
      lines.push(
        `- scheme \`${scheme}\` has NO declared credential — when the flow needs it, omit \`scenario\` and return \`"blockedOn": ["${scheme}"]\`.`,
      )
    }
  }
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
    'MILESTONES — the path, in order. Each block gives the CLAIM (what to assert), its',
    "section's text (what the claim is read against), and the realization matching chose",
    '(how to reach it). Every milestone number below must appear on at least one step:',
  )
  for (const m of ctx.milestones) {
    lines.push(
      '',
      `--- milestone ${m.order}`,
      `claim: ${m.claim}`,
      `section: ${m.sectionHeading}  (${m.doc})`,
    )
    if (m.note) lines.push(`note: ${m.note}`)
    if (m.realization.length > 0) {
      lines.push('realize with:')
      for (const r of m.realization) lines.push(`  ${r}`)
    }
    lines.push('section text:', '"""', m.sectionText, '"""')
  }
  if (ctx.retry) {
    lines.push(
      '',
      'RETRY — the scenario you authored for this flow FAILED birth validation (it did',
      'not pass against the current code). Use the evidence below to fix COMMANDS,',
      'ARGUMENTS, and SETUP — a wrong flag, a missing `setup` file, an off-by-one id —',
      'and you MAY REORDER the milestones when the path only works in another order.',
      'But the ASSERTIONS still state what the CLAIMS say: if the evidence shows a',
      'genuine DOC-vs-CODE disagreement on an asserted VALUE (the code really produces',
      "something other than what the claim quotes), KEEP the claim's assertion — the",
      'retry then fails again and the flow correctly becomes a finding. Never weaken an',
      'assertion, and never drop a milestone, to make the scenario pass:',
      `  scenario: ${ctx.retry.scenarioTitle}`,
      `  failing step: ${ctx.retry.step}${ctx.retry.milestone ? ` (milestone ${ctx.retry.milestone})` : ''}`,
      `  expected: ${ctx.retry.expected}`,
      `  actual:   ${ctx.retry.actual}`,
    )
    // The failing run's raw program output — the evidence the rules above point
    // at (a usage error reveals the real flags). Each stream omitted when absent.
    if (ctx.retry.stdout) lines.push('  program stdout:', indentBlock(ctx.retry.stdout))
    if (ctx.retry.stderr) lines.push('  program stderr:', indentBlock(ctx.retry.stderr))
  }
  if (ctx.issues) {
    if (ctx.issues.uncoveredMilestones.length > 0) {
      lines.push(
        '',
        'CORRECTION — no step realized these milestones. Every milestone needs at least',
        'one step carrying its number in `milestone`:',
        `  ${ctx.issues.uncoveredMilestones.join(', ')}`,
      )
    }
    if (ctx.issues.unknownMilestones.length > 0) {
      lines.push(
        '',
        'CORRECTION — these `milestone` values match no milestone of this flow. Use only',
        `the numbers listed above (1..${ctx.milestones.length}), or omit \`milestone\` for a plumbing step:`,
        `  ${ctx.issues.unknownMilestones.join(', ')}`,
      )
    }
    lines.push('Return the COMPLETE scenario again, as one JSON object matching the schema.')
  }
  if (ctx.correction) {
    lines.push(
      '',
      'CORRECTION — your previous response was NOT valid. You returned:',
      ctx.correction.invalidOutput,
      'Return exactly ONE JSON object: { "scenario": { … } } with the scenario matching',
      `the schema (title, driver "${ctx.driver}", non-empty steps, optional setup/normalize,`,
      '`milestone` on the steps that realize one) — or { "blockedOn": ["<capability>"] }',
      'when the flow needs world-state the sandbox cannot provide. No prose — only the',
      'JSON object.',
    )
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Recipe discovery
// ---------------------------------------------------------------------------

export const RECIPE_SYSTEM_PROMPT = `\
You propose how to turn a repository's working tree into something guard scenarios
can drive: a command-line entrypoint, an HTTP server, or both. You return JSON
only. You never run commands — the engine verifies your proposal by building it
and by starting what you proposed.

${OUTPUT_ONLY_GUARDRAIL}

Given the repository's manifest files, return exactly one JSON object matching
this schema (CANONICAL — generated from the engine's Zod definition; your reply
must validate against it exactly):
${RECIPE_JSON_SCHEMA}
Concretely:
  { "install": "<optional shell command run once in the repo root, before the build, to fetch dependencies>",
    "build": "<shell command run once in the repo root to produce the entrypoint and/or server>",
    "entry": ["<argv>", "..."],
    "api": { "serve": ["<argv>", "..."], "healthPath": "/health" } }

- install (optional) fetches dependencies before the build runs — the tree may be
  a fresh clone with no node_modules (e.g. "npm ci", "pnpm install --frozen-lockfile",
  "yarn install --immutable"; match the lockfile present). Omit it when the tree
  needs no dependency fetch to build.
- build produces the runnable program (e.g. "pnpm build", "npm run build"), or a
  no-op "true" when nothing needs building.
- entry (command-line programs) is the argv that invokes the built program;
  scenario arguments are appended to it (e.g. ["node","dist/cli.js"] or
  ["node","bin/tool.js"]). Prefer the package's declared bin/main and its build
  script. Paths are repo-relative.
- api (HTTP servers) is how to START the server under test:
  - api.serve is the argv that starts it and keeps it running (e.g.
    ["node","dist/server.js"]). Never a dev/watch command — a file watcher is not
    a server under test.
  - api.healthPath (optional) is a GET path the server answers 2xx on once it is
    ready; the engine polls it. Prefer a real health endpoint ("/health",
    "/healthz", "/readyz"); omit it when only "/" answers.
  - api.env (optional) is extra environment the server needs to boot.
  - The engine allocates a free port per boot and injects it as the PORT
    environment variable. When the server takes its port on the COMMAND LINE or in
    another environment variable instead, write the literal token \${PORT} where the
    number belongs — the engine substitutes the allocated port into every
    api.serve argument and every api.env value at start time (e.g.
    "serve": ["uvicorn","app.main:app","--port","\${PORT}"], or
    "env": { "ASPNETCORE_URLS": "http://127.0.0.1:\${PORT}" }).
- Propose entry for a command-line program, api for an HTTP server, or BOTH when
  the repository ships both. At least one of them is required.

Output exactly one JSON object with \`build\` plus \`entry\` and/or \`api\` (and
\`install\` when dependencies must be fetched first). No prose.`

export const RECIPE_PROMPT_FINGERPRINT = fingerprint(RECIPE_SYSTEM_PROMPT)

/**
 * A proposal the engine RAN and rejected, with the verification diagnostic quoted
 * verbatim — the evidence discovery's one retry hands back. Kind-blind by
 * construction: the engine never classifies the failure, so a dead install, a
 * broken build, a missing entry file, and an entry that won't start all arrive
 * here as the same two fields.
 */
export interface RecipeRetryContext {
  /** The rejected proposal as JSON — exactly what the engine verified. */
  proposal: string
  /** The engine's verification failure, verbatim (may be multi-line). */
  failure: string
}

export interface RecipeDiscoveryInput {
  /** package.json contents (or a note that it's absent). */
  packageJson: string
  /** Names of the lockfiles / build-config files present in the repo root. */
  presentInputs: string[]
  /** On the retry after the engine's verification rejected a proposal, its evidence. */
  retry?: RecipeRetryContext
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
  if (input.retry) {
    lines.push(
      '',
      'RETRY — the engine RAN your previous proposal and it did NOT verify. The engine',
      'runs `install`, then `build`, then checks that the `entry` script exists on disk',
      'and spawns it, and starts `api.serve` and polls its health path. Its report is',
      'quoted verbatim below — read it as the ground truth about this repository (it lists',
      'what was actually found) and propose a recipe that answers it: the install/build',
      'command the tree really needs, and the entry/serve argv that names what the build',
      'really produces. Do not repeat the rejected proposal.',
      '  proposal the engine ran:',
      indentBlock(input.retry.proposal),
      '  the engine reported:',
      indentBlock(input.retry.failure),
      'Return exactly one JSON object matching the schema. No prose.',
    )
  }
  if (input.correction) {
    lines.push(
      '',
      'CORRECTION — your previous response was NOT a valid recipe proposal. You returned:',
      input.correction.invalidOutput,
      'Return exactly one JSON object with a non-empty "build" string plus a non-empty',
      '"entry" argv array and/or an "api" block with a non-empty "serve" argv array (and',
      'optional "install" and "env"), and nothing else:',
      '  { "install": "<optional shell command>", "build": "<shell command>", "entry": ["<argv>", "..."],',
      '    "api": { "serve": ["<argv>", "..."], "healthPath": "/health" } }',
    )
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Seed drafting (item 66, stage 1)
// ---------------------------------------------------------------------------

export const SEED_SYSTEM_PROMPT = `\
You write a DATABASE SEED SCRIPT for a repository whose specification-derived tests
cannot run because the rows they describe do not exist yet. You are given the app's
own parsed database schema, the ORM/client it uses, the environment variable it
reads its connection from, and the exact claims the tests could not assert. You
return JSON only — the script's full source and the recipe block that runs it. You
never run anything: the engine runs your script, validates the manifest it writes,
and boots the server against the state it left behind. Nothing is written to the
repository unless that verification passes.

${OUTPUT_ONLY_GUARDRAIL}

Return exactly one JSON object matching this schema (CANONICAL — generated from the
engine's Zod definition; your reply must validate against it exactly):
${SEED_JSON_SCHEMA}

# The script
- Write rows through the APP'S OWN ORM or database client — import it the way the
  app's own files import it, and read the connection from the SAME environment
  variable the app reads. Never open a second connection with a different driver,
  and never hard-code a connection string.
- Satisfy the schema: every FOREIGN KEY must point at a row the script created (or
  one it verified exists), and every NOT NULL column without a default must be
  given a value. Create parents before children.
- Be IDEMPOTENT. The script runs once per guard run, against a store that may
  already carry the rows from the last run: use upserts, or stable natural keys the
  script looks up before inserting. Say WHY the chosen mechanism is idempotent in a
  comment block at the top of the file — that header is what a human reviews first.
- Emit the manifest. The engine sets the GUARD_SEED_OUT environment variable to a
  file path; write a single JSON object there:
    { "credentials": { "<name>": { "value": "<the minted secret>" } },
      "fixtures":    { "<name>": { "<field>": <any JSON value> } } }
  It must match "provides" EXACTLY: every declared credential needs a non-blank
  string value, and every declared fixture field must be present. Values keep their
  native JSON type — an id that is a number stays a number.
- FAIL LOUDLY. Any error — a failed connection, a rejected insert, a missing
  environment variable — prints a diagnostic and exits with a non-zero status. Never
  swallow an error, never exit 0 on a partial seed.
- No interactive prompts, no network access beyond the datastore, no writes outside
  the datastore and the manifest file.

# provides
- "fixtures" is what the blocked claims will REFERENCE: the ids and key fields of
  the rows you created (a scenario interpolates them as {{fixture:<name>.<field>}}).
  Declare exactly the fields the blocked claims below need — an id they must request,
  a slug they must send, a status they must observe.
- "credentials" is ONLY for a claim that needs an authenticated principal the script
  must MINT (a role the app cannot register through its own API). Each is name →
  the request header it is injected as. Omit "credentials" entirely when the blocked
  claims need rows, not roles.

# The recipe block
- "command" is one shell command run from the repository ROOT that executes the
  script (e.g. "node scripts/guard-seed.mjs", "python scripts/guard_seed.py",
  "npx tsx scripts/guard-seed.ts").
- "scriptPath" is where the script file is written, repo-relative, in the language
  and extension the repository already uses. Never overwrite an existing file.

Output exactly one JSON object. No prose.`

export const SEED_PROMPT_FINGERPRINT = fingerprint(SEED_SYSTEM_PROMPT)

/** One table of the app's parsed schema, as the draft prompt renders it. */
export interface SeedSchemaTable {
  name: string
  columns: {
    name: string
    type: string
    isNullable?: boolean
    isPrimaryKey?: boolean
    isUnique?: boolean
    defaultValue?: string
    isForeignKey?: boolean
    referencesTable?: string
    referencesColumn?: string
  }[]
}

/** One flow the last authoring pass left blocked on missing data. */
export interface SeedBlockedClaim {
  /** The flow's title — what the user was trying to do. */
  flow: string
  /** The blocked-on nouns as authoring stated them (item 60: the noun + the entity). */
  needs: string[]
}

export interface SeedDraftInput {
  /** The ORM/driver the analyzer detected (`prisma`, `drizzle-orm`, `sqlalchemy`, …). */
  driver: string
  /** The datastore kind (`postgres`, `sqlite`, …). */
  databaseType: string
  /** The parsed tables, FK graph included. */
  tables: SeedSchemaTable[]
  /** Foreign-key relations, as the schema parsers derived them. */
  relations: { sourceTable: string; targetTable: string; foreignKeyColumn: string }[]
  /** Env vars the recipe declares that name a database connection (the app's own). */
  connectionEnv: string[]
  /** How the app's own files import its client — real import lines from the tree. */
  appImports: string[]
  /** The flows that could not be authored, with the data they said they needed. */
  blocked: SeedBlockedClaim[]
  /** The repo's ecosystem, so the script lands in the right language. */
  ecosystem: string
  /** A suggested script path in the repo's own conventions. */
  suggestedPath: string
  /** On the retry after the engine RAN the draft and it failed, that evidence. */
  retry?: SeedRetryContext
  /** On a re-ask after invalid output, the prior output quoted back. */
  correction?: OutputCorrection
}

/**
 * A draft the engine RAN and rejected, quoted verbatim — the one evidence retry.
 * Kind-blind by construction (the engine never classifies the failure): a non-zero
 * exit, a manifest that does not match `provides`, and a server that would not boot
 * afterwards all arrive here as the same two fields.
 */
export interface SeedRetryContext {
  /** The rejected seed block + script, as JSON — exactly what the engine ran. */
  proposal: string
  /** The engine's verification failure, verbatim (may be multi-line). */
  failure: string
}

export function buildSeedUserPrompt(input: SeedDraftInput): string {
  const lines = [
    `Ecosystem: ${input.ecosystem}`,
    `Datastore: ${input.databaseType} via ${input.driver}`,
    `Connection environment variable${input.connectionEnv.length === 1 ? '' : 's'} the app reads: ${
      input.connectionEnv.join(', ') || '(none declared in the recipe — read the one the app itself reads)'
    }`,
    `Suggested script path: ${input.suggestedPath}`,
    '',
    'HOW THE APP IMPORTS ITS DATABASE CLIENT (real lines from this repository — import it the same way):',
    input.appImports.length > 0
      ? indentBlock(input.appImports.join('\n'))
      : indentBlock('(none found — use the driver named above, imported the way this ecosystem does)'),
    '',
    'SCHEMA (parsed from this repository):',
  ]
  for (const table of input.tables) {
    lines.push(`  ${table.name}`)
    for (const c of table.columns) {
      const flags = [
        c.isPrimaryKey ? 'PK' : '',
        c.isForeignKey && c.referencesTable
          ? `FK → ${c.referencesTable}${c.referencesColumn ? `.${c.referencesColumn}` : ''}`
          : '',
        c.isUnique ? 'unique' : '',
        c.isNullable === false ? 'NOT NULL' : '',
        c.defaultValue !== undefined ? `default ${c.defaultValue}` : '',
      ].filter(Boolean)
      lines.push(`    - ${c.name}: ${c.type}${flags.length ? ` [${flags.join(', ')}]` : ''}`)
    }
  }
  if (input.relations.length > 0) {
    lines.push('', 'RELATIONS:')
    for (const r of input.relations) {
      lines.push(`  ${r.sourceTable}.${r.foreignKeyColumn} → ${r.targetTable}`)
    }
  }
  lines.push(
    '',
    'THE FLOWS THAT COULD NOT BE TESTED (each names the data it needed — your fixtures',
    'must cover exactly these, by the fields a test would have to reference):',
  )
  for (const b of input.blocked) {
    lines.push(`  - ${b.flow}`, `      needs: ${b.needs.join('; ')}`)
  }
  if (input.retry) {
    lines.push(
      '',
      'RETRY — the engine RAN your previous seed and it did NOT verify. The engine writes',
      'your script, runs your command from the repository root with GUARD_SEED_OUT set,',
      'validates the manifest against your own "provides", and then boots the server. Its',
      'report is quoted verbatim below — read it as the ground truth about this repository',
      'and return a seed that answers it. Do not repeat the rejected draft.',
      '  the draft the engine ran:',
      indentBlock(input.retry.proposal),
      '  the engine reported:',
      indentBlock(input.retry.failure),
      'Return exactly one JSON object matching the schema. No prose.',
    )
  }
  if (input.correction) {
    lines.push(
      '',
      'CORRECTION — your previous response was NOT a valid seed proposal. You returned:',
      input.correction.invalidOutput,
      'Return exactly one JSON object with "scriptPath", "scriptContent", and a "seed"',
      'object carrying "command" and a "provides" declaring at least one fixture or',
      'credential, and nothing else.',
    )
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Fidelity review
// ---------------------------------------------------------------------------

export const FIDELITY_SYSTEM_PROMPT = `\
You are a strict reviewer. You are given ONE test scenario that already PASSES
against the current code, and the FLOW it was authored from: an ordered list of
MILESTONES, each a spec CLAIM with the section text it was read against. Your ONE
job: decide whether this scenario actually VERIFIES the flow's milestones. You
return JSON only — no prose.

${OUTPUT_ONLY_GUARDRAIL}

# The question
A green test is worthless if it passes for the wrong reason. Read the scenario's
steps and assertions against what each CLAIM (in its section's own words) says the
program does, then judge the scenario as exactly one of:
- faithful — the scenario's assertions would FAIL if any claimed behavior were
  broken. Each milestone is checked on the specific observable its claim names (the
  exact stdout the claim quotes, the exact status code, the exact file content), not
  a loose proxy, and the milestones are exercised as a PATH — later steps act on the
  state earlier ones left behind.
- flagged — the scenario does NOT truly verify the flow. It is one of:
  - weak: it asserts LESS than a claim. The claim quotes exact output \`X\` but the
    scenario only checks that something changed, that the command exited 0, or that
    an unrelated substring appears — the disputed value \`X\` is never asserted.
  - vacuous: an assertion would still pass even if the claimed behavior were
    entirely broken or removed (e.g. asserts a prompt/help line, an unconditional
    banner, or exit 0 on a command that exits 0 regardless).
  - miscast: a step tests a DIFFERENT behavior than the milestone it is annotated
    with — a different command, flag, endpoint, or observable.
  - broken chain: a milestone's step does not actually build on the state the
    previous milestones created (it re-creates its own world, or asserts against
    something the path never produced), so the composition is never exercised.

# The bar
Assume each claim is the contract. Ask, milestone by milestone: "if a developer
broke exactly the behavior this claim describes, would THIS scenario turn red?" If
yes for every milestone → faithful. If the scenario could stay green while a claimed
behavior is broken → flagged. When a claim quotes an exact message or value, a
scenario that does not assert that exact message/value is flagged (weak), no matter
how much else it checks. Judge only what the milestones claim — a scenario is not
flagged for failing to test something no milestone states.

# Output schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition; your reply must
validate against it exactly. Output EXACTLY ONE JSON object, no prose, no fences:
${FIDELITY_JSON_SCHEMA}
Concretely:
  { "verdict": "faithful" }
  { "verdict": "flagged", "mismatch": "<one sentence naming what the scenario fails to verify>" }
On "flagged" the "mismatch" is REQUIRED — one sentence stating the gap between what
the flow's claims assert and what the scenario actually checks (name the milestone).
Omit it when faithful.`

export const FIDELITY_PROMPT_FINGERPRINT = fingerprint(FIDELITY_SYSTEM_PROMPT)

/** One milestone as the fidelity reviewer sees it — the claim and its section text. */
export interface FidelityMilestone {
  order: number
  claim: string
  doc: string
  sectionHeading: string
  sectionText: string
}

export interface FidelityUserContext {
  /** The flow under review — its title and goal. */
  flow: { id: string; title: string; goal: string }
  /** The flow's milestones, in order: the claims the scenario must verify. */
  milestones: FidelityMilestone[]
  /** The committed YAML of the green scenario under review. */
  scenarioYaml: string
  /** On a re-ask after invalid output, the prior output quoted back. */
  correction?: OutputCorrection
}

export function buildFidelityUserPrompt(ctx: FidelityUserContext): string {
  const lines = [
    `FLOW: ${ctx.flow.title}`,
    `goal: ${ctx.flow.goal}`,
    '',
    'MILESTONES the scenario must verify, in order — each with the claim and the',
    'section text it is read against:',
  ]
  for (const m of ctx.milestones) {
    lines.push(
      '',
      `--- milestone ${m.order}`,
      `claim: ${m.claim}`,
      `section: ${m.sectionHeading}  (${m.doc})`,
      'section text:',
      '"""',
      m.sectionText,
      '"""',
    )
  }
  lines.push(
    '',
    'SCENARIO UNDER REVIEW (passes against current code):',
    '"""',
    ctx.scenarioYaml,
    '"""',
    '',
    'Return exactly one JSON object: { "verdict": "faithful" } or',
    '{ "verdict": "flagged", "mismatch": "<one sentence>" }.',
  )
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

// ---------------------------------------------------------------------------
// Flow synthesis — per-area composition
// ---------------------------------------------------------------------------

export const FLOWS_SYSTEM_PROMPT = `\
You compose FLOWS out of a specification area's already-extracted CLAIMS. A flow is
one user-goal path: a title, a goal, and an ordered list of MILESTONES, where every
milestone IS one of the claims you were given. You return JSON only.

${OUTPUT_ONLY_GUARDRAIL}

# Your input, and the only thing you may do with it
You are given the claims of ONE area — each with the document and the section anchor
it was extracted from — plus each document's heading outline. You ORDER and GROUP
those claims into paths. That is the entire job.
- Never invent, reword, translate, shorten, merge, or split a claim. Each milestone
  COPIES one given claim's \`doc\`, \`anchor\`, and claim text VERBATIM, character for
  character. A milestone the engine cannot match back to a given claim is discarded.
- You have NO code, NO commands, NO test framework, and NO repository. A flow states
  WHAT the product should do for a user, never HOW a test would drive it. Do not
  name a command, endpoint, URL, selector, file, or function that does not already
  appear in the text you were given.

# What makes a good flow
A flow is what a USER is trying to achieve, in the order they would do it.
- COMPOSE when claims chain into one goal. "Create a task → the list shows it →
  complete it → the completed filter shows it" is ONE flow with four milestones, not
  four flows. The state one milestone leaves behind is what the next one acts on.
- A ONE-MILESTONE flow is correct and expected when a claim stands alone (an error
  case, a validation rule, a single flag's behavior). Never pad a flow with unrelated
  claims to make it look bigger — a padded path tests nothing coherently.
- At most ~8 milestones. A longer chain is two flows.
- No near-duplicates: having emitted "create → list → complete", do NOT also emit
  "create → list" or "create → complete". Emit the longest path you believe in, once.
- \`title\`: the user goal in the document's own words ("Create and complete a task").
  \`goal\`: one sentence stating what the user gets when the whole path works.
- Group by GOAL, not by document or section: claims from different documents of the
  area belong in one flow when the user experiences them as one path.

# Coverage honesty — the rule you are graded on
Every claim marked \`account: required\` MUST appear either as a milestone of at least
one flow, or in \`noFlowClaims\` with a one-sentence reason. Never silently drop one.
A claim MAY appear in more than one flow when it genuinely belongs to both.
Claims marked \`account: optional\` sit on surfaces with no test runner today: use one
as a milestone when it truly belongs to the path, but you never have to account for it.
Reasons that are legitimate for \`noFlowClaims\`: the claim is an edge/error condition
no user path reaches, it restates another claim, or it describes a static property
rather than something a user does. "It didn't fit" is not a reason.

# Output schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition; your reply must
validate against it exactly. Output EXACTLY ONE JSON object, no prose, no fences:
${FLOWS_JSON_SCHEMA}
Concretely:
  { "flows": [
      { "title": "<the user goal, short>",
        "goal": "<one sentence: what the user gets when the path works>",
        "milestones": [
          { "order": 1,
            "doc": "<copied verbatim from the claim>",
            "anchor": "<copied verbatim from the claim>",
            "claimTitle": "<the claim text, copied verbatim>",
            "note": "<optional: why this step sits here>" } ] } ],
    "noFlowClaims": [
      { "doc": "<copied verbatim>", "anchor": "<copied verbatim>",
        "claimTitle": "<the claim text, copied verbatim>",
        "reason": "<one sentence: why no flow uses this claim>" } ] }`

export const FLOWS_PROMPT_FINGERPRINT = fingerprint(FLOWS_SYSTEM_PROMPT)

/** One claim as flow synthesis sees it: its identity triple, the surface hint
 *  extraction assigned, and whether coverage accounting requires it. */
export interface FlowClaimLine {
  doc: string
  anchor: string
  /** The claim's text — copied verbatim into a milestone's `claimTitle`. */
  claim: string
  /** The surface hint from extraction (`cli`, `api`, `web`, …). */
  driver: string
  /** True when the claim must land in a flow or in `noFlowClaims` (runnable surfaces). */
  required: boolean
}

/** One document's outline as flow synthesis sees it — sections only, no text. */
export interface FlowDocOutline {
  doc: string
  outline: OutlineEntry[]
  /** Sections extraction judged untestable — context on where the gaps are. */
  untestable?: { anchor: string; reason: string }[]
}

/** What the engine tells the model on its ONE corrective re-ask: the milestone /
 *  no-flow references it could not match, and the claims it left unaccounted. */
export interface FlowSynthesisIssues {
  unknownReferences: string[]
  uncoveredClaims: string[]
}

export interface FlowsUserContext {
  /** Canonical area id the claims belong to. */
  areaId: string
  /** The area's claims — the closed vocabulary milestones are drawn from. */
  claims: FlowClaimLine[]
  /** Heading outlines of the area's documents (orientation, never section text). */
  docs: FlowDocOutline[]
  /** On a re-ask after invalid output, the prior output quoted back. */
  correction?: OutputCorrection
  /** On a re-ask after engine validation, exactly what was wrong. */
  issues?: FlowSynthesisIssues
}

export function buildFlowsUserPrompt(ctx: FlowsUserContext): string {
  const lines: string[] = [`Area: ${ctx.areaId}`]
  if (ctx.docs.length > 0) {
    lines.push(
      '',
      "DOCUMENT OUTLINES (orientation — where this area's claims come from):",
    )
    for (const d of ctx.docs) {
      lines.push(`${d.doc}`)
      for (const e of d.outline) lines.push(`  ${e.anchor} — ${e.headingText}`)
      for (const u of d.untestable ?? []) lines.push(`  (no testable behavior: ${u.anchor} — ${u.reason})`)
    }
  }
  lines.push(
    '',
    'CLAIMS IN THIS AREA — the closed set your milestones are drawn from. Copy `doc`,',
    '`anchor`, and the claim text VERBATIM into every milestone you emit:',
  )
  for (const c of ctx.claims) {
    lines.push(
      '',
      `--- claim`,
      `doc: ${c.doc}`,
      `anchor: ${c.anchor}`,
      `claim: ${c.claim}`,
      `surface: ${c.driver}   account: ${c.required ? 'required' : 'optional'}`,
    )
  }
  if (ctx.issues) {
    if (ctx.issues.unknownReferences.length > 0) {
      lines.push(
        '',
        'CORRECTION — these references matched NO claim above. A milestone (or a',
        'noFlowClaims entry) must copy one claim\'s doc, anchor, and text verbatim:',
      )
      for (const r of ctx.issues.unknownReferences) lines.push(`- ${r}`)
    }
    if (ctx.issues.uncoveredClaims.length > 0) {
      lines.push(
        '',
        'CORRECTION — these claims are marked `account: required` but your answer put',
        'them in no flow and gave no reason. Put each one in a flow, or list it in',
        '"noFlowClaims" with a one-sentence reason:',
      )
      for (const c of ctx.issues.uncoveredClaims) lines.push(`- ${c}`)
    }
    lines.push(
      'Return the COMPLETE answer again (all flows, not only the corrections), as one',
      'JSON object matching the schema.',
    )
  }
  if (ctx.correction) {
    lines.push(
      '',
      'CORRECTION — your previous response was NOT valid. You returned:',
      ctx.correction.invalidOutput,
      'Return exactly ONE JSON object with "flows" and/or "noFlowClaims" arrays matching',
      'the schema above, and NOTHING else. Every milestone carries "doc", "anchor", and',
      '"claimTitle" copied verbatim from a claim listed above.',
    )
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Flow synthesis — cross-area epic pass
// ---------------------------------------------------------------------------

export const FLOWS_EPIC_SYSTEM_PROMPT = `\
You are given the FLOWS a product's specification areas produced — each a user-goal
path, summarized as its title, its goal, and its milestones. Your one job: decide
whether any of them chain into an EPIC — a single journey a real user performs
end-to-end ACROSS areas ("sign up → create a first project → invite a teammate").
You return JSON only.

${OUTPUT_ONLY_GUARDRAIL}

# The default answer is none
Most products have zero or one epic. An epic is justified only when a user genuinely
walks the whole chain in one sitting and each link depends on the previous one's
state. Two flows that merely belong to the same product are NOT an epic. When in
doubt, return { "epics": [] } — a wrong epic costs real test runs, a missing one costs
nothing (the individual flows already cover their claims).

# Rules for an epic you do emit
- \`composedOf\`: the refs (\`F1\`, \`F2\`, …) of the flows it chains — at least TWO, from
  DIFFERENT areas. Copy the refs exactly as listed below.
- \`milestones\`: the path, in the order the user walks it. EVERY milestone must be a
  milestone of one of the flows in \`composedOf\`, copied VERBATIM (\`doc\`, \`anchor\`,
  \`claimTitle\`). You may drop a composed flow's milestones that the journey doesn't
  need, but you may never introduce one from elsewhere or write new text.
- Keep the chain to at most ~12 milestones, in a single coherent order.
- \`title\`: the journey in user terms. \`goal\`: one sentence for what the user achieves.
- Never emit an epic that is just one flow restated, and never emit two epics with the
  same chain.

# Output schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition; your reply must
validate against it exactly. Output EXACTLY ONE JSON object, no prose, no fences:
${FLOWS_EPIC_JSON_SCHEMA}
Concretely:
  { "epics": [
      { "title": "<the cross-area journey>",
        "goal": "<one sentence>",
        "composedOf": ["F1", "F4"],
        "milestones": [
          { "order": 1, "doc": "<copied verbatim>", "anchor": "<copied verbatim>",
            "claimTitle": "<copied verbatim>" } ] } ] }
or, when nothing chains:
  { "epics": [] }`

export const FLOWS_EPIC_PROMPT_FINGERPRINT = fingerprint(FLOWS_EPIC_SYSTEM_PROMPT)

/** One flow as the epic pass sees it — its digest, never its documents. */
export interface FlowDigest {
  /** Stable ref (`F1`, `F2`, …) the epic's `composedOf` copies. */
  ref: string
  areaId: string
  title: string
  goal: string
  milestones: { doc: string; anchor: string; claimTitle: string }[]
}

/** The epic pass's engine feedback for its ONE corrective re-ask. */
export interface EpicSynthesisIssues {
  unknownReferences: string[]
}

export interface FlowsEpicUserContext {
  digests: FlowDigest[]
  correction?: OutputCorrection
  issues?: EpicSynthesisIssues
}

export function buildFlowsEpicUserPrompt(ctx: FlowsEpicUserContext): string {
  const lines: string[] = [
    'FLOWS (digests only — no document text). Chain these by ref, or return no epics:',
  ]
  for (const d of ctx.digests) {
    lines.push('', `--- ${d.ref}  (area: ${d.areaId})`, `title: ${d.title}`, `goal: ${d.goal}`, 'milestones:')
    d.milestones.forEach((m, i) => lines.push(`  ${i + 1}. ${m.doc}#${m.anchor} — ${m.claimTitle}`))
  }
  if (ctx.issues && ctx.issues.unknownReferences.length > 0) {
    lines.push(
      '',
      'CORRECTION — these references matched no flow ref / no milestone of the flows the',
      'epic composes. Every "composedOf" entry is a ref listed above, and every milestone',
      "is copied verbatim from one of that epic's composed flows:",
    )
    for (const r of ctx.issues.unknownReferences) lines.push(`- ${r}`)
    lines.push('Return the COMPLETE answer again as one JSON object matching the schema.')
  }
  if (ctx.correction) {
    lines.push(
      '',
      'CORRECTION — your previous response was NOT valid. You returned:',
      ctx.correction.invalidOutput,
      'Return exactly ONE JSON object with an "epics" array (use [] when nothing chains),',
      'and NOTHING else.',
    )
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Realization matching — one flow against one surface's journey catalog
// ---------------------------------------------------------------------------

export const MATCH_SYSTEM_PROMPT = `\
You decide HOW a spec FLOW could be walked on ONE of an application's surfaces. You
are given the flow — a user goal and an ordered list of MILESTONES — and that
surface's JOURNEY CATALOG: every entry point the surface actually offers, with the
steps each one performs. Your one job: return the ordered plan that walks the
milestones through those journeys, or say plainly that the surface cannot do it. You
return JSON only.

${OUTPUT_ONLY_GUARDRAIL}

# What you are matching
- A MILESTONE is something the product should do for a user, stated by the spec.
- A JOURNEY is something the code actually offers: a command a user can run, an
  endpoint they can call, a screen they can reach. It is derived from the code, so
  the catalog is the complete list of what this surface can do.
- A PLAN pairs them: for each milestone, the journey (or journeys) a test would use
  to reach it, in the order a user would walk them.

# The rules
- Use ONLY journeys from the catalog below, addressed by their \`id\` copied VERBATIM.
  An id that is not in the catalog invalidates your whole answer.
- Every milestone must appear in the plan at least once. A milestone may take two
  journeys (do it, then observe it); a journey may serve two milestones.
- Keep the plan in milestone order — it is a path, and each step acts on the state
  the previous one left.
- Match on BEHAVIOR, not on wording. A journey whose entry is \`tasks add\` realizes
  "creating a task returns its id" even though neither text quotes the other.

# When the surface cannot do it — say so, and say why
If any milestone has NO journey that could plausibly serve it, do NOT stretch an
unrelated journey to cover it and do NOT return a partial plan. Return
\`unrealizable\` with ONE sentence naming the milestone(s) nothing serves and what is
missing (e.g. "no journey creates a project — the catalog only reads them"). That
verdict is a first-class, useful answer: it is how a spec promise with no code
surface behind it becomes visible. A wrong plan, by contrast, produces a test that
checks the wrong thing.

# Output schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition; your reply must
validate against it exactly. Output EXACTLY ONE JSON object, no prose, no fences:
${MATCH_JSON_SCHEMA}
Concretely:
  { "plan": [ { "journeyId": "<copied verbatim from the catalog>",
                "milestone": <the milestone's number>,
                "note": "<optional: how it serves that milestone>" } ] }
or:
  { "unrealizable": "<one sentence: which milestone nothing realizes, and why>" }
Exactly one of the two.`

export const MATCH_PROMPT_FINGERPRINT = fingerprint(MATCH_SYSTEM_PROMPT)

/** One milestone as the matcher sees it — its number and its claim, never code. */
export interface MatchMilestoneLine {
  order: number
  claim: string
  /** Synthesis' note on why this step sits here, when it wrote one. */
  note?: string
}

/**
 * One journey as the matcher sees it: the DIGEST — id, title, entry descriptor, and
 * a one-line summary per step. Never file paths, symbols, or source: the matcher
 * reads what a USER can reach, exactly like the journey fingerprint.
 */
export interface JourneyDigest {
  id: string
  title: string
  /** The entry descriptor as the surface declares it (a command path, a route). */
  entry: string
  /** One line per step — kind + its surface-visible payload. */
  steps: string[]
}

/** What the engine tells the matcher on its ONE corrective re-ask. */
export interface MatchIssues {
  /** Journey ids the plan named that are not in the catalog. */
  unknownJourneys: string[]
  /** Milestone numbers the plan never covered. */
  uncoveredMilestones: number[]
  /** `milestone` values that match no milestone of this flow. */
  unknownMilestones: number[]
}

export interface MatchUserContext {
  /** The flow being matched — its handle, title, and goal. */
  flow: { id: string; title: string; goal: string }
  /** The flow's path, in order. */
  milestones: MatchMilestoneLine[]
  /** The surface being matched (a driver-registry id, e.g. `cli`). */
  surface: string
  /** The surface's whole journey catalog, as digests. */
  journeys: JourneyDigest[]
  /** On a re-ask after engine validation, exactly what was wrong. */
  issues?: MatchIssues
  /** On a re-ask after invalid output, the prior output quoted back. */
  correction?: OutputCorrection
}

export function buildMatchUserPrompt(ctx: MatchUserContext): string {
  const lines: string[] = [
    `Surface: ${ctx.surface}`,
    '',
    `FLOW: ${ctx.flow.title}`,
    `goal: ${ctx.flow.goal}`,
    '',
    'MILESTONES — the path to walk, in order:',
  ]
  for (const m of ctx.milestones) {
    lines.push(`  ${m.order}. ${m.claim}${m.note ? `  (${m.note})` : ''}`)
  }
  lines.push(
    '',
    `JOURNEY CATALOG for ${ctx.surface} — everything this surface offers. Copy an \`id\``,
    'verbatim into every plan entry:',
  )
  for (const j of ctx.journeys) {
    lines.push('', `--- id: ${j.id}`, `title: ${j.title}`, `entry: ${j.entry}`)
    if (j.steps.length > 0) {
      lines.push('steps:')
      for (const s of j.steps) lines.push(`  ${s}`)
    }
  }
  if (ctx.issues) {
    if (ctx.issues.unknownJourneys.length > 0) {
      lines.push(
        '',
        'CORRECTION — these journey ids are NOT in the catalog above. Every `journeyId`',
        'is copied verbatim from a catalog entry:',
      )
      for (const id of ctx.issues.unknownJourneys) lines.push(`- ${id}`)
    }
    if (ctx.issues.unknownMilestones.length > 0) {
      lines.push(
        '',
        'CORRECTION — these `milestone` values match no milestone of this flow. Use only',
        `the numbers listed above (1..${ctx.milestones.length}):`,
        `  ${ctx.issues.unknownMilestones.join(', ')}`,
      )
    }
    if (ctx.issues.uncoveredMilestones.length > 0) {
      lines.push(
        '',
        'CORRECTION — your plan covered no journey for these milestones. Either give each',
        'one a journey from the catalog, or answer `unrealizable` naming what is missing:',
        `  ${ctx.issues.uncoveredMilestones.join(', ')}`,
      )
    }
    lines.push('Return the COMPLETE answer again as one JSON object matching the schema.')
  }
  if (ctx.correction) {
    lines.push(
      '',
      'CORRECTION — your previous response was NOT valid. You returned:',
      ctx.correction.invalidOutput,
      'Return exactly ONE JSON object: { "plan": [ { "journeyId", "milestone" }, … ] }',
      'with journey ids copied verbatim from the catalog, or { "unrealizable": "<one',
      'sentence>" }. Nothing else.',
    )
  }
  return lines.join('\n')
}
