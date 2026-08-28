/**
 * The guard-generator prompt doctrine — scenario authoring (reused verbatim as
 * the flow-worker session prompts' base), fidelity review (the worker's child
 * reviewer's base), realization matching, recipe discovery, and the seed
 * doctrine guard-setup's session reuses — plus their content fingerprints
 * (folded into the cache keys so a prompt edit re-runs the affected stage).
 * The retired one-shot extract/flows prompts are gone (plan 04 step 20); the
 * session prompts that replaced them live in `@truecourse/core`.
 *
 * Every output shape a prompt asks for is the JSON Schema rendered from the SAME
 * Zod definition the engine validates the reply with — never hand-written prose
 * that could drift from the engine. `GENERATE_SYSTEM_PROMPT` embeds
 * `RawGeneratedScenarioSchema` (the behavioral fields the model authors — engine-
 * owned fields like `id`/`binds`/`guard` are not in the model's vocabulary at
 * all); `RECIPE_SYSTEM_PROMPT` the proposal (`RecipeProposalSchema`).
 * Hand-written prose that can drift from the schema is exactly what burned the
 * contract prompts; here the schema IS the documentation.
 *
 * The prompts are written to be reliable on the smallest supported model: closed
 * enumerations, one canonical schema, a single JSON object/array out, and an
 * explicit "copy this verbatim" rule for the anchors and refs the engine keys on.
 */

import { createHash } from 'node:crypto'
import type { InterfaceResource, InvalidMatchPattern, OutputExcerpts } from '@truecourse/shared'
import {
  describeWebLocator,
  GuardStreamMatcherSchema,
  GuardWebCapturesSchema,
  GuardWebExpectSchema,
  GuardWebFileSchema,
  GuardWebLocatorSchema,
  GuardWebStateSchema,
  type GuardDriverId,
} from '@truecourse/shared'
import { jsonSchemaHint, OUTPUT_ONLY_GUARDRAIL } from '@truecourse/shared/llm'
import {
  RecipeProposalSchema,
  SeedProposalSchema,
  RawGeneratedCliScenarioSchema,
  RawGeneratedApiScenarioSchema,
  RawGeneratedWebScenarioObjectSchema,
  FidelityReviewSchema,
  RealizationMatchSchema,
} from './schemas.js'
import type { ProbeTranscript } from './ground.js'
import type { MinedExampleBlock } from './examples.js'

/** The authored-scenario JSON Schemas — the behavioral fields only, rendered from
 *  the SAME Zod schemas the engine parses replies with (`.strip()` renders them
 *  without the parse-side unknown-key tolerance, so the hints stay closed). One
 *  per runnable driver: each authoring prompt embeds its own. */
const SCENARIO_JSON_SCHEMA = jsonSchemaHint(RawGeneratedCliScenarioSchema.strip())
const API_SCENARIO_JSON_SCHEMA = jsonSchemaHint(RawGeneratedApiScenarioSchema.strip())
/** The web arm's hint NAMES its deeply-shared sub-schemas: the locator union (with
 *  its 80-role enum) recurs in every verb, expectation and capture, and inlined it
 *  renders at ~119K characters — named under `definitions`, ~18K. */
const WEB_SCENARIO_JSON_SCHEMA = jsonSchemaHint(RawGeneratedWebScenarioObjectSchema.strip(), {
  webLocator: GuardWebLocatorSchema,
  webState: GuardWebStateSchema,
  webExpect: GuardWebExpectSchema,
  webCaptures: GuardWebCapturesSchema,
  webFile: GuardWebFileSchema,
  matcher: GuardStreamMatcherSchema,
})
/** The extraction + recipe-proposal JSON Schemas, from the runner's Zod source. */
const RECIPE_JSON_SCHEMA = jsonSchemaHint(RecipeProposalSchema)
/** The seed-draft JSON Schema, from the engine's own Zod source. */
const SEED_JSON_SCHEMA = jsonSchemaHint(SeedProposalSchema)
/** The fidelity-review verdict JSON Schema, from the runner's Zod source. */
const FIDELITY_JSON_SCHEMA = jsonSchemaHint(FidelityReviewSchema)
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

// ---------------------------------------------------------------------------
// Retired one-shot stages
// ---------------------------------------------------------------------------

// The one-shot EXTRACT / FLOWS / FLOWS_EPIC prompts were RETIRED (plan 04
// step 20): extraction and flow synthesis run as agent sessions whose prompts
// live in `@truecourse/core` (`services/guard-generate/{extract,flows}.ts`).
// Their frozen fingerprints survive as literal salt inside
// `flowGenerationInputsHash` (see `section-plan.ts`) so committed flow hashes
// did not move when the prompts left.

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

# The doc's own examples run VERBATIM
Some milestone sections contain a WORKED EXAMPLE: a fenced block whose surrounding
prose promises an outcome for it. The user prompt repeats each such block byte-exact
between DOC EXAMPLE markers. When the example is what the scenario RUNS — the block
is the input the claim promises an outcome for — you do NOT invent or paraphrase an
input: seed the DOC EXAMPLE's bytes as the scenario input (\`setup.files\` content, or
\`stdin\`) copied BYTE-FOR-BYTE, exactly as delimited. Do NOT reformat, re-indent,
re-quote, trim, "fix", or otherwise edit it — a deliberately-broken example must
stay broken. You choose only the MECHANICS: the argv that runs it, the file path it
is seeded to, and the matcher form. When the prose also quotes the example's OUTPUT,
the assertion states that output exactly as quoted. A block nothing runs (a pure
illustration) constrains nothing.

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

# Two-sided promises get two-sided tests
Some claims state BOTH halves of a behavior: what DOES happen and what does NOT —
inputs the program ACCEPTS, MATCHES, or INCLUDES and inputs it REJECTS, EXCLUDES,
or leaves OUT ("accepts A and B but not C or D"; "flags X, leaves Y untouched").
BOTH halves are that milestone's contract. A scenario exercising only the positive
half — feeding the included inputs and asserting they appear — is HALF a test: it
would STILL PASS if the logic broke so the excluded inputs were wrongly accepted
too, so the negative half is never verified. When a milestone's claim names things
that must NOT happen, realize that milestone with steps for BOTH halves — each
carrying its number: exercise the excluded inputs too, and assert their exclusion
OBSERVABLY (absent from the emitted set, a distinct exit code, a rejection/error
line — whatever the program uses to signal "not included"). Prefer feeding the
included AND the excluded inputs in ONE invocation and asserting the output holds
exactly the included ones and NONE of the excluded, so a single run proves both
directions. A scenario that drops the exclusion half is weak and will be flagged.

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
It contains ONLY the fields you author; the engine assigns the scenario's id, its
flow/interface references, and its section bindings itself, so do not emit any
field that is not in the schema.
${SCENARIO_JSON_SCHEMA}

# The title states the PROMISE, never the expected output
\`title\` is what the DOCUMENT promises, in the words a reader of the doc would use
— "Adding a task lists it and marks it complete", not "stdout contains
\`Completed t1 ✓\`" and not "exit code is 0". The assertions are already in the
steps; a title that repeats a literal expected value tells a reviewer nothing about
what the test is FOR, and reads as an implementation detail the moment the wording
changes.

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

/**
 * PIN 2026-08-12 (the scenario-level `driver` field's REMOVAL): the authored schema
 * no longer carries it — the driver belongs to the STEP — so the rendered schema and
 * the sentence that explained the field both shrank. A deletion: nothing new is
 * authorable, and the author cache re-keys once.
 */
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

# The doc's own examples run VERBATIM
Some milestone sections contain a WORKED EXAMPLE: a documented request (and often
the response promised for it), fenced in the doc. The user prompt repeats each such
block byte-exact between DOC EXAMPLE markers. When a documented request is what a
step SENDS, its body is the DOC EXAMPLE's bytes copied BYTE-FOR-BYTE into the step's
\`body\` (or, for a JSON example, the identical JSON into \`json\` — same fields, same
values, nothing added or "fixed") — never a paraphrase and never a reformat; a
deliberately-invalid example must stay invalid. And when the doc shows the RESPONSE
promised for that request, the step's \`expect\` asserts exactly the statuses and
values that documented response shows. You choose only the mechanics: which step
sends it and the matcher form. A block nothing sends (a pure illustration)
constrains nothing.

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

# Two-sided promises get two-sided tests
Some claims state BOTH halves of a behavior: the request the service ACCEPTS and
the one it REJECTS ("valid X is accepted, invalid X is rejected"; "members may,
guests may not"). BOTH halves are that milestone's contract. A scenario that sends
only the accepted request is HALF a test: it would STILL PASS if validation broke
and the invalid request were accepted too, so the rejection half is never verified.
When a milestone's claim names what must NOT be accepted, realize that milestone
with steps for BOTH halves — each carrying its number: one step sends the valid
request and asserts the documented success (the status and shape the claim names),
and one sends the invalid/forbidden request and asserts the documented REJECTION
(the exact 4xx it names, the error shape it quotes). A scenario that drops the
rejection half is weak and will be flagged.

# How a scenario runs
The service is built once from the recipe, then booted FRESH for each scenario in
an empty sandbox working directory (its state files land there, so every scenario
starts from the service's empty/initial state) on a runner-chosen port. Each step
is ONE action. Most are one HTTP request against that server; the process-lifecycle
steps below are the rest. A \`request\` step carries:
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

# The server PROCESS is drivable — startup, shutdown, logs, restarts
Some claims are about the process itself, not about a response, and three step kinds
make them testable. Use them ONLY for such a claim; a scenario about ordinary request
behavior needs none of them and must not declare any.
- \`{ "boot": { "env": { … }, "expect": { … } } }\` — (re)start the service. \`env\`
  layers over the recipe's environment FOR THIS BOOT ONLY, which is how a claim about
  CONFIGURATION is written ("with no TIMEOUT set the default applies", "an invalid
  DATABASE_URL fails startup"). \`expect: { "ready": true }\` (also the default when
  \`expect\` is omitted) requires the service to come up healthy;
  \`expect: { "exitCode": <n>, "stderrContains": ["…"] }\` requires it to EXIT instead —
  that is how "invalid configuration fails startup with a non-zero exit code and a
  descriptive message" is asserted. The two are exclusive.
- \`{ "signal": { "name": "SIGTERM" | "SIGINT", "expect": { "exitCode": 0, "withinMs": <n> } } }\`
  — signal the running service. This is the graceful-shutdown claim, whole.
- \`{ "logs": { "stream": "stdout" | "stderr", "match": "<substring>" | { "pattern": "<regex>" },
  "sinceLastStep": true, "count": <n> } }\` — assert on what the service WROTE, per
  line. \`sinceLastStep\` opens the window where the PREVIOUS step BEGAN, so it holds
  everything that step caused — including a line the service flushes after its
  response (a duration log). A request-log claim is therefore "make the request, then
  assert ONE line matching it"; \`count\` makes "exactly one line per request" sayable.
  Matching is on the RAW output, so a duration or a timestamp in the line is matchable
  with a regex.
A scenario that declares NO \`boot\` gets the usual implicit one and behaves exactly as
before. A scenario that declares one owns the lifecycle: the FIRST step must then be a
\`boot\`, and after a boot that exited (or a signal that killed the service) another
\`boot\` is needed before any further request. Every boot gets a fresh port, and the
sandbox — including any files or database the service wrote — survives a restart, so
"state persists across a restart" is: \`boot\` → write it → \`signal\` → \`boot\` → read it
back. Choose \`boot.env\` over \`setup.env\` when the claim is about that environment
BEING what it is (defaults, invalid values, a restart under different settings);
\`setup.env\` still sets the world every boot of the scenario shares.
These steps drive the SERVICE the recipe serves — nothing else. A claim about a
package script (\`npm test\`, a typecheck, a build command) is NOT this: that is a
different program, and such a flow stays honestly \`blockedOn\`.

# World-state capabilities
\`setup\` declares the WORLD a test needs — never code, never shell. The recipe's
own \`api\` block already brings up the service (and its declared datastores), and a
scenario touches the process only through the lifecycle steps above — never a shell,
never a command of its own. The sandbox is otherwise bare: no network egress
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
  included. TWO blocks list them: the operations this flow WALKS, and the OTHER
  operations available for setup steps. A path in neither does not exist and answers
  404, so a scenario built on one proves nothing. When a step must PREPARE the world
  (register the account the flow signs in with, create the resource a milestone acts
  on), take that operation from the second block rather than inventing one — an
  invented \`/auth/register\` next to a real \`/auth/signup\` is the single most common
  way a scenario dies before its claim is ever reached.
- A request body must carry every field the prompt marks REQUIRED for that operation,
  including on a setup step that only prepares the world. A missing required field is
  a 400 the app returns before any assertion of yours runs.
- ONE carve-out, and only this one: when the CLAIM ITSELF is about how the app answers
  a request it does not serve — an unknown path, an unsupported method on a listed
  path, the shape of a 404/405 — the scenario MUST request exactly such a thing, so it
  MAY use a path or method outside both blocks. That is the behavior under test, not a
  guess about the surface. Every other step of that scenario, and every step of every
  other flow, keeps the verbatim rule.
- A \`setup.http\` stub's response body must satisfy the fields the prompt says the app
  READS off that upstream, with the types it states, and its route must match the path
  and query the app actually sends. An app that rejects its own stub reports an
  UPSTREAM failure — a red scenario that says nothing about the claim.

# One service, one server — never re-route a documented path
This scenario runs against ONE server: the one named in the user prompt. The operations
listed are the ones THAT server serves. If a milestone's documented path is not among
them, you must NOT rewrite its prefix (\`/v2/x\` → \`/api/v2/x\`), NOT substitute a
different endpoint that looks similar, and NOT author against another service's path
hoping it is proxied. Return \`{"blockedOn": ["missing-server", "<the service the path
belongs to>"]}\` instead. A scenario that asks the wrong server for a documented path
proves nothing about the doc and reports as a false failure.

# The scenario schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition — match it exactly.
It contains ONLY the fields you author; the engine assigns the scenario's id, its
flow/interface references, and its section bindings itself, so do not emit any
field that is not in the schema.
${API_SCENARIO_JSON_SCHEMA}

# The title states the PROMISE, never the expected output
\`title\` is what the DOCUMENT promises, in the words a reader of the doc would use
— "Creating a todo returns it and lists it", not "response status is 201" and not
"\`data.id\` exists". The assertions are already in the steps; a title that repeats a
literal expected value tells a reviewer nothing about what the test is FOR, and
reads as an implementation detail the moment the wording changes.

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

/**
 * PIN 2026-08-12: rolled with the cli prompt, by the scenario-level `driver` field's
 * REMOVAL — the authored schema no longer carries it, so the rendered schema and the
 * sentence that explained it both shrank. A deletion.
 */
export const GENERATE_API_PROMPT_FINGERPRINT = fingerprint(GENERATE_API_SYSTEM_PROMPT)

// ---------------------------------------------------------------------------
// Scenario authoring — web driver
// ---------------------------------------------------------------------------

export const GENERATE_WEB_SYSTEM_PROMPT = `\
You author ONE guard SCENARIO — a declarative, executable test that walks a spec
FLOW through an application's WEB SURFACE, in a real browser. A flow is a
user-goal path: an ordered list of MILESTONES, each one a spec claim. You are
given the flow, each milestone's claim and the section text it came from, a
REALIZATION PLAN naming the screens and tasks that serve each milestone, and how
the surface is built and served. You return ONE scenario whose steps walk the
path in order. No prose, only JSON.

# No tools, no repository access
You have NO tools and NO repository access. Tool-call JSON or \`<tool_use>\` markup is
invalid output — your response can ONLY be the JSON object described below. You never
need to inspect code: author steps from what the CLAIMS and their sections state and
what the PLACES listed in the user prompt really render, and when a scenario fails
birth validation the retry supplies the failing step's observed page state — use it
to fix LOCATORS, ADDRESSES, and SETUP, never to decide WHAT to assert (see the next
rule).

# Assertions come from the claim, never the observed page
Every ASSERTION must state what the milestone's CLAIM — read against its section's
text — says: the exact text it quotes, the address it names, the state it promises,
adapting only placeholders to the concrete values your scenario creates. If the page
demonstrably behaves DIFFERENTLY from the claim, you MUST STILL assert the CLAIM'S
version. The scenario then fails birth — and that is the CORRECT, desired outcome:
the doc-vs-code disagreement surfaces as a finding. Never weaken, generalize, or
swap a claimed assertion for a softer, effect-only check (asserting "some text
changed" where the claim quotes a message) to make a scenario pass — a green test
that proves less than the claim is the worst outcome.

# Faithfulness — the prime directive
Assert only what each claim, read against its section's text, states. A scenario
must never claim more than the prose does.

# The doc's own examples run VERBATIM
Some milestone sections contain a WORKED EXAMPLE: a fenced block whose surrounding
prose promises an outcome for it. The user prompt repeats each such block byte-exact
between DOC EXAMPLE markers. When the example is what the scenario RUNS or FEEDS the
app — a file it imports, a value it fills in — copy the bytes BETWEEN the markers
EXACTLY (into \`setup.files\` content, a \`fill\` value, an upload's \`text\`), never a
paraphrase and never a reformat; a deliberately-broken example must stay broken. When
the prose also quotes the example's OUTCOME, the assertion states that outcome exactly
as quoted. A block nothing runs (a pure illustration) constrains nothing.

# The path is the point: one scenario, every milestone
The flow's milestones are ORDERED, and the state one leaves behind is what the next
acts on: create a thing, see it listed, open it, change it. Author ONE scenario that
walks them in order in a single sandbox world.
- Every milestone MUST be realized by at least one step, and each such step carries
  \`milestone: <that milestone's number>\`. A step that only prepares the world (a
  login, a seeding action nothing asserts) carries NO \`milestone\`.
- A milestone may take several steps (act, then observe): annotate each of them
  with that milestone's number.
- Never renumber, merge, split, skip, or invent a milestone — the numbers are given.
- When a milestone needs world-state the milestones before it do not produce, declare
  it in \`setup\` or seed it with a plumbing step — never drop the milestone.

# Two-sided promises get two-sided tests
Some claims state BOTH halves of a behavior: what DOES happen and what does NOT —
the input a form ACCEPTS and the one it REJECTS, the item a filter SHOWS and the one
it HIDES. BOTH halves are that milestone's contract. A scenario exercising only the
positive half is HALF a test: it would STILL PASS if the logic broke so the excluded
case wrongly succeeded too. When a milestone's claim names what must NOT happen,
realize that milestone with steps for BOTH halves — each carrying its number — and
assert the exclusion OBSERVABLY (the item absent from the page's text, the
documented error message shown, the control disabled). A scenario that drops the
exclusion half is weak and will be flagged.

# The verb vocabulary — six verbs, closed
A web step is one of: \`navigate\` (go to a surface-relative path), \`click\`
(activate an element), \`fill\` (type a \`value\` into an input; empty clears it),
\`upload\` (hand a \`file\` to the control a user would operate), \`history\` (the
browser's own \`back\`/\`forward\` — the claim "Back returns you" is about the
BROWSER, never re-navigation), and \`expect\` (assert on the page without acting).
There is deliberately no hover, no scroll, no keyboard — and no sleep verb, ever:
every expectation WAITS on observable state, bounded by \`timeoutMs\`, so "the page
catches up" is expressed by asserting what it must show, never by waiting a
duration.

# Every web step declares \`driver: web\`
Every web step carries \`"driver": "web"\` — all six verbs, not only the ambiguous
one. If it says \`web\`, the browser does it; a step without the tag is a cli or api
step. (The rule exists because a step whose only verb is \`expect\` would otherwise
be ambiguous against every other step's \`expect\` block.)

# THE LOCATOR POLICY — address elements the way a user finds them
Every element a step touches is addressed by a LOCATOR, and the locator family is
closed to the handles a USER perceives:
- The PRIMARY handle is role + accessible name: \`{ "role": "button", "name": "Save" }\`.
  The role is a real ARIA role; the name is the element's label, text, or aria-label.
- The five alternates, for elements a role+name does not reach: \`placeholder\` (the
  prompt inside an empty input), \`label\` (the visible label of a form control),
  \`text\` (the element's own visible words), \`title\` (the tooltip), \`alt\` (an
  image's alt text). Each member is exclusive — one handle per locator.
- NO CSS selectors, NO XPath, NO test ids: those address the IMPLEMENTATION, and a
  scenario that addresses the implementation stops being a user-replayable probe of
  the promise.
- The match is case-insensitive substring by default; \`"exact": true\` demands the
  whole string (use it when one name is a prefix of another).
- A locator is STRICT: it must resolve to exactly ONE element. Two matches is a
  genuine ambiguity and fails loudly. \`"pick": "first"\` is the one authored
  exception, for a page that legitimately shows many controls reading the same (a
  grid of slot buttons) where ANY serves the flow.
- An element no user-perceivable handle reaches is NOT guessed at: the milestone
  that needs it makes the flow blocked — name the unlocatable element in
  \`blockedOn\`.
The realization plan writes targets as \`<role> "<name>"\`. Translate them directly:
\`click: button "Add Repository"\` becomes
\`{ "driver": "web", "click": { "role": "button", "name": "Add Repository" } }\`, and
\`fill: textbox "Repository path"\` becomes
\`{ "driver": "web", "fill": { "role": "textbox", "name": "Repository path" }, "value": "…" }\`.

# Addresses are SURFACE-RELATIVE
A \`navigate\` path starts with \`/\` and never carries an origin — the sandbox
allocates the port, so \`navigate: "/analyses/42"\`, never a host. \`expect.url\`
matches \`pathname + search\` with the origin stripped: \`/notes?title=x\` is what a
scenario writes and what a failure quotes.

# What an expectation may assert
A web \`expect\` waits on, then asserts, one or more of:
- \`text\` — the page's visible text (or, with \`within\`, one element's), using the
  same equals | contains | matches vocabulary every stream matcher has;
- \`url\` — the address, origin-stripped (above);
- \`visible\` — an element (or a list of them) that must be present and visible: the
  plainest form of "the page arrived";
- \`state\` — an ARIA state of one element: checked | pressed | selected | expanded |
  disabled. These are the states with NO text — the active tab, the switch's
  position — and the state assertion is the only honest form of such a claim. A
  control that exposes no such state fails the assertion by saying so, and that
  failure is a real finding: the control is unobservable to a screen reader too.
- \`attribute\` / \`class\` — what the page keeps OUTSIDE its text, on the document
  element by default: a theme (\`class\` has \`dark\`), a locale, a \`data-\` fact.
  \`class\` matches a TOKEN, the way \`classList.contains\` does.

# Mixing vocabularies — one sandbox, one world
Your scenario runs in ONE sandbox world shared by three vocabularies, and two other
step kinds may appear beside the web steps:
- a cli step — \`run\` is argv APPENDED to the program entrypoint the user prompt
  names — may SEED the world the browser then sees (create the record a screen must
  list);
- an api \`request\` step may VERIFY through the server what the UI just wrote (and
  \`capture\` ids from responses).
Both are ordinary steps and may carry a \`milestone\`. Two prohibitions: a milestone
about a SCREEN must be realized by a web step — a \`request\` alone proves the API,
not the page — and the api lifecycle verbs (\`boot\`, \`signal\`, \`logs\`) do not
exist here: the sandbox owns the served surface's lifecycle. Values cross the
boundary through ONE capture namespace: a cli/api capture is read back as \`\${name}\`
and a web capture as \`\${captured:<name>}\`, in any authored string of any step.

# How a scenario runs
The web surface is built once (its build command, when it declares one) and served
FRESH for each scenario in an empty sandbox working directory on a runner-chosen
port, health-polled before the first browser step. The browser, the cli entrypoint
and the served app all share that one sandbox cwd — one world. Seed inputs
declaratively with \`setup.files\` (path → content) and \`setup.env\` (extra env for
the served process); \`setup.git\` declares a git repo the sandbox starts with. There
is no shell escape.

# Web captures — carry what the page shows
A web step may take a value OFF the page for later steps:
\`"capture": { "<name>": { "from": <locator>, "get": "text" | "value" | "count" |
{ "state": … } | { "attribute": … } } }\` — \`text\` is the default; add
\`"number": "<regex with ONE capturing group>"\` to slice a figure out of a sentence
("seats left: 3"). Later steps read it as \`\${captured:<name>}\`. A capture whose
element or pattern finds nothing FAILS its step — capture only what the page really
shows. Whenever the scenario CREATES a resource with a client-chosen identifier,
embed the run-unique \`\${unique}\` token in it so parallel and repeated runs never
collide.

# World-state capabilities
\`setup\` declares the WORLD a test needs — never code, never shell. The sandbox is
otherwise bare: no network egress beyond the surface under test, no credentials, no
external systems. When the flow needs world-state neither \`setup\` nor the app's own
UI can produce — an authenticated session no supplied credential opens, a screen the
recipe's web block does not serve, a third-party service, pre-existing DATA no
screen can create — author NOTHING: omit \`scenario\` AND name the missing capability
in \`blockedOn\`. An honest blocked flow is right; a scenario that fakes the missing
world is wrong. NAME the blocker with the right noun: \`"credentials"\` for a missing
secret or login, the SERVICE ITSELF for a third party (\`"stripe"\`), the unlocatable
element when no user-perceivable handle reaches it, and \`"missing-data"\` plus a
second entry naming the entity when pre-existing data is what is missing.

# The scenario schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition — match it exactly.
It contains ONLY the fields you author; the engine assigns the scenario's id, its
flow/interface references, and its section bindings itself, so do not emit any
field that is not in the schema.
${WEB_SCENARIO_JSON_SCHEMA}

# The title states the PROMISE, never the expected output
\`title\` is what the DOCUMENT promises, in the words a reader of the doc would use
— "Creating a note shows it on the board", not "the page contains \`Note created\`"
and not "the url is /notes". The assertions are already in the steps; a title that
repeats a literal expected value tells a reviewer nothing about what the test is
FOR, and reads as an implementation detail the moment the wording changes.

# Determinism
No timing assumptions, no retries, no assertions on values the app generates
non-deterministically (timestamps, ids) unless you \`capture\` them first or list the
matching \`normalize\` entry (timestamps | abs-paths | versions | durations). Prefer
\`contains\` on the meaningful phrase over \`equals\` on a whole page's text, and
prefer asserting a DELTA against a captured value over an absolute number that only
tests the state the world happened to be in.

# Output — ONE object, carrying one scenario
Return EXACTLY ONE JSON object:
  { "scenario": { … the scenario, its steps carrying \`milestone\` … } }
or, when the flow needs world-state the sandbox cannot provide:
  { "blockedOn": ["<capability, e.g. credentials|missing-data|<service>|<the unlocatable element>"] }
Exactly one of the two. No prose, no fences — only the JSON object.`

export const GENERATE_WEB_PROMPT_FINGERPRINT = fingerprint(GENERATE_WEB_SYSTEM_PROMPT)

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
 * assertion source), the section text the claim is read against, and the
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
  /**
   * The bound section's text — what the claim is read against. Embedded VERBATIM:
   * authoring never degrades to an outline, an excerpt, or a truncation, so a
   * section too large for the model's context fails loud instead of silently
   * thinning what it sees.
   */
  sectionText: string
  /** Synthesis' note on why this step sits here, when it wrote one. */
  note?: string
  /**
   * The realization the matcher picked, already translated through the driver
   * adapter (`invoke` → cli `run`, `request` → api `request`) — one line per
   * interface step. Empty when no interface was matched to this milestone.
   */
  realization: string[]
  /**
   * The section's fenced example blocks (D3), mined DETERMINISTICALLY from the
   * same section text above — never echoed through a model, so the bytes cannot
   * drift. Rendered clearly bounded with the copy-exactly instruction; the
   * engine byte-compares the authored scenario against them (`examples.ts`).
   * Absent when the section fences nothing.
   */
  examples?: MinedExampleBlock[]
}

/**
 * One detected third party as the AUTHORING prompt names it: its canonical name
 * plus, when the detector saw one, the env var that overrides its base URL. The
 * env var is the precondition for a `setup.http` stub — with it the flow
 * is authorable against a scripted fake; without it, it is honestly blocked.
 */
export interface ExternalServiceHint {
  name: string
  baseUrlEnv?: string
  /**
   * EVERY base-URL override variable detected for this service, best-confidence
   * first. A repo reaching one vendor through several hosts has one
   * variable per host, and a stub has to point ALL of them at itself — advertising
   * only `baseUrlEnv` would describe a half-stubbed world. Absent ⇒ `baseUrlEnv`
   * alone, which keeps a single-variable repo's prompt as it was.
   */
  baseUrlEnvs?: string[]
  /**
   * The user PROVIDED an account for this service: the runner points the app at it
   * before the scenario runs, so it is a live capability rather than a blocker.
   * Absent/false keeps the unprovided (blocker) rendering byte-identical.
   */
  provided?: boolean
  /** Whether the provided account is the vendor's SANDBOX or the REAL service. */
  mode?: 'sandbox' | 'real'
  /** The user's note about the account, rendered verbatim next to it. */
  description?: string
}

/**
 * One operation the flow walks, as the app's OWN routes declare it: the
 * exact path a request must use verbatim, plus what its handler reads off the
 * request. `required: 'unknown'` is a real answer — the field is read, and nothing
 * in the source says whether it may be absent.
 */
export interface InterfaceContractHint {
  method: string
  path: string
  bodyFields?: { name: string; required: boolean | 'unknown' }[]
  queryFields?: { name: string; required: boolean | 'unknown' }[]
}

/**
 * One request the app SENDS to an upstream, as its own source constructs it — the
 * contract a `setup.http` stub has to satisfy to be accepted by the app it is
 * faking for, and the query params a stub may assert.
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
  /** The interface ids the realization plan walks, in order (provenance for the model). */
  interfacePath: string[]
  /** Canonical area ids the flow's docs cover, from the corpus (may be empty). */
  areaTags: string[]
  /** The surface this scenario runs on — selects the system prompt + the
   *  preparation framing below. */
  driver: GuardDriverId
  /** cli and web batches: the recipe entrypoint argv, so the model knows what
   *  `run` is appended to. Absent on api batches, and on web batches whose
   *  recipe declares no entry. */
  recipeEntry?: string[]
  /** api and web batches: the surface's serve argv (the runner boots it per scenario). */
  recipeServe?: string[]
  /** api and web batches: the health endpoint the runner polls before any step runs. */
  recipeHealthPath?: string
  /**
   * api batches: the recipe server this scenario is BOUND to — its name,
   * and the workspace app it serves when the route manifest knows it. Present only
   * for a repo whose recipe declares several servers AND whose flow could be
   * attributed to one, so a single-service repo's prompt is byte-identical to
   * before. It is what the "one service, one server" rule refers to: everything
   * else the prompt lists (serve argv, health path, operations, credentials) is
   * already scoped to THIS server.
   */
  server?: { name: string; app?: string; description?: string }
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
   * api batches: the third parties THIS repo imports, canonical names,
   * detected from the working tree. Not a capability the sandbox offers — the
   * opposite: the list of blockers worth naming precisely, so a refusal says
   * `blockedOn: ["stripe"]` instead of `["external-service"]`. Empty/absent (nothing
   * detected, or a degraded mapping) keeps the prompt byte-identical. Ignored on cli.
   */
  externalServices?: ExternalServiceHint[]
  /**
   * api scenarios: the flow's own operations as the repo's ROUTES declare them —
   * exact path + the request fields the handler reads, requiredness included when
   * the source states it. Grounds three measured failures: invented
   * paths, bodies missing a required field, and a setup step that 400s before the
   * claim is reached. Empty/absent (no api interfaces, a degraded mapping, cli) keeps
   * the prompt byte-identical. USER-prompt only.
   */
  interfaceContracts?: InterfaceContractHint[]
  /**
   * The PLACES this flow's interfaces act on — the resource-registry entries
   * their location contract (`at`/`to`) names, `of`-ancestors included, with
   * their READABLES: what each place visibly shows, as facts in the web
   * driver's own assertion vocabulary. Grounds web assertions in what the page
   * really renders instead of doc prose. Empty/absent (no location contract —
   * every cli/api plan, and web catalogs from before resources) keeps the
   * prompt byte-identical. USER-prompt only.
   */
  resources?: InterfaceResource[]
  /**
   * api scenarios: the REST of the app's operations — everything the api catalog
   * offers that THIS flow's interfaces do not walk. A flow's SETUP steps
   * routinely need one (signing up before signing in), and with only the flow's own
   * operations listed the model invented the rest and got a 404 on step 1. Same
   * rendering and same verbatim-path rule as {@link interfaceContracts}; empty/absent
   * keeps the prompt byte-identical. USER-prompt only.
   */
  otherOperations?: InterfaceContractHint[]
  /** How many other operations the cap dropped, so the block can say so. */
  otherOperationsOverflow?: number
  /**
   * api scenarios: how the app CONSTRUCTS its outbound requests and which response
   * fields it reads back — what a `setup.http` stub must answer with to be
   * accepted by the app it fakes for. Empty/absent keeps the prompt byte-identical.
   * USER-prompt only.
   */
  outboundRequests?: OutboundRequestHint[]
  /** How many outbound requests the cap dropped, so the block can say so. */
  outboundRequestsOverflow?: number
  /**
   * api scenarios: the OpenAPI write-op request-body schemas the flow's markdown
   * sections reference — method + path + pretty-printed JSON Schema.
   * Advertises the authoritative body shape so the model authors the request `json`
   * against declared fields/types instead of guessing. Empty/absent when no section
   * references a write op (or on cli), keeping the prompt byte-identical.
   */
  endpointSchemas?: { method: string; path: string; requestSchema: string }[]
  /**
   * api scenarios: whether the flow binds to an OpenAPI OPERATION section — the
   * precondition for `expect.schema: true` to resolve at run time. Only
   * then is the response-schema conformance guidance rendered; a markdown-bound (or
   * cli) flow keeps the prompt byte-identical, so a scenario that could only die at
   * birth (unresolvable schema) is never nudged toward `schema: true`.
   */
  bindsOpenApiOperation?: boolean
  /**
   * api scenarios: how the OpenAPI operations the flow binds to map onto the declared
   * credentials — `satisfiedBy` names, per required security scheme, the
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
   * The PRIOR-REJECTION evidence: the scenario authored for this flow —
   * on an earlier generate (the taint) or earlier this run (the fidelity
   * self-heal) — was rejected as not truly verifying the flow. Distinct from
   * `retry` (a within-run birth failure): the program did not disagree, the TEST
   * was judged wrong. Its presence also bypasses the author cache read (which
   * still holds the rejected scenario).
   */
  priorFlag?: { title: string; mismatch: string }
  /**
   * On a re-ask after the engine rejected the scenario: the milestones no step
   * realized, the `milestone` values that match none of the flow's, and an
   * `expect` regex that does not compile. Exactly what was wrong — never a bare
   * "try again".
   */
  issues?: {
    uncoveredMilestones: number[]
    unknownMilestones: number[]
    invalidPattern?: InvalidMatchPattern
    /**
     * A COMPOSITION defect the schema accepts but the engine cannot execute — a
     * cli `run[0]` that repeats the program or names a foreign binary, an api
     * `${var}` no earlier step captures, a `${HTTP_STUB:…}` the scenario never
     * declares. Already a model-facing one-liner (see `validate.ts`).
     */
    composition?: string
    /**
     * An EXAMPLE-FIDELITY defect (D3): the scenario embeds a whitespace-
     * reformatted copy of a DOC EXAMPLE instead of its exact bytes. Already a
     * model-facing one-liner (see `examples.ts`).
     */
    exampleFidelity?: string
  }
  /** On a re-ask after invalid output, the prior output quoted back. */
  correction?: OutputCorrection
}

/**
 * The request fields one operation declares, as one trailing clause: the REQUIRED
 * ones first (the actionable half), then the fields that are read but whose
 * requiredness the source does not state — never rendered as "optional", which
 * would be a claim the analysis did not make.
 */
/**
 * One resource of the PLACES block: the place's identity line, then one line per
 * readable, each in the web driver's own words ({@link describeWebLocator} — the
 * same rendering a step list and a failure use, so the model reads the vocabulary
 * it must write). A `when` renders as a trailing condition; a readable kind the
 * place doesn't carry renders nothing.
 *
 * A readable that carries an `id` renders it. The id is the NAME of one fact on
 * this place, and naming it is what lets the capture note below point at a
 * specific readable ("take the count off `violations-rows`") instead of at prose;
 * a readable without one renders exactly as it always did.
 */
function resourceLines(place: InterfaceResource): string[] {
  const cond = (when?: string) => (when ? `  [${when}]` : '')
  const named = (id?: string) => (id ? ` \`${id}\`` : '')
  const lines = [
    `- ${place.title} (${place.kind} \`${place.id}\`${place.of ? `, ${nesting(place.kind)} \`${place.of}\`` : ''})${
      place.description ? `: ${place.description}` : ''
    }`,
  ]
  const r = place.readables
  // A cli command group and an api noun carry NO readables — those are DOM
  // facts (plan item 102) — so such a place renders its identity line and stops,
  // exactly as an unfleshed web place does.
  if (!r) return lines
  for (const m of r.markers ?? []) {
    lines.push(
      `    shows${named(m.id)} “${m.marker}”${m.within ? ` within ${describeWebLocator(m.within)}` : ''}${cond(m.when)}`,
    )
  }
  for (const e of r.elements ?? []) {
    lines.push(`    renders${named(e.id)} ${describeWebLocator(e.element)}${cond(e.when)}`)
  }
  for (const c of r.controls ?? []) {
    lines.push(
      `    control${named(c.id)} ${describeWebLocator(c.control)} exposes ${c.states.join(', ')}${cond(c.when)}`,
    )
  }
  for (const row of r.rows ?? []) {
    const enums = row.slots
      .filter((s) => s.kind === 'enum')
      .map((s) => `${s.name} ∈ ${(s.values ?? []).join(' | ')}`)
      .join('; ')
    lines.push(
      `    rows${named(row.id)}: one ${row.item} per item${row.within ? ` within ${describeWebLocator(row.within)}` : ''}, text \`${row.template}\`${
        enums ? ` (${enums})` : ''
      }${cond(row.when)}`,
    )
  }
  return lines
}

/**
 * How a place sits on the one it is `of`, in that surface's own words: a dialog
 * opens OVER a screen, a panel sits ON one, a command lives IN its group and a
 * REST noun UNDER the noun that encloses it. The three web kinds keep the words
 * they had, so a web PLACES block renders byte-identically.
 */
function nesting(kind: InterfaceResource['kind']): string {
  if (kind === 'dialog') return 'over'
  if (kind === 'command-group') return 'in'
  if (kind === 'rest-noun') return 'under'
  return 'on'
}

function contractSummary(hint: InterfaceContractHint): string {
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

/** The preparation framing that heads the author prompt, per driver. The cli and
 *  api arms' lines are byte-identical to what they always were — only web adds a
 *  shape of its own. */
function preparationLines(ctx: AuthorUserContext): string[] {
  if (ctx.driver === 'api') {
    return [
      // Name the bound service FIRST when the repo has more than one —
      // every line under it describes that server and nothing else.
      ...(ctx.server
        ? [
            `Service: "${ctx.server.name}"${ctx.server.app ? ` — the workspace app ${ctx.server.app}` : ''}${ctx.server.description ? ` (${ctx.server.description})` : ''}.`,
            'This repository runs several HTTP services; your scenario runs against THIS one only.',
          ]
        : []),
      `Service serve command: ${JSON.stringify(ctx.recipeServe)}  (the runner boots it fresh per scenario and injects PORT)`,
      `Health endpoint: GET ${ctx.recipeHealthPath ?? '/'}  (polled until 2xx before any step runs)`,
      `Build command: ${ctx.recipeBuild}`,
    ]
  }
  if (ctx.driver === 'web') {
    return [
      `Web surface serve command: ${JSON.stringify(ctx.recipeServe)}  (the runner boots it fresh per scenario and injects PORT)`,
      `Health endpoint: GET ${ctx.recipeHealthPath ?? '/'}  (polled until 2xx before the first browser step)`,
      ...(ctx.recipeEntry
        ? [`Program entrypoint: ${JSON.stringify(ctx.recipeEntry)}  (a cli step's \`run\` argv is appended to this)`]
        : []),
      `Build command: ${ctx.recipeBuild}`,
    ]
  }
  return [
    `Program entrypoint: ${JSON.stringify(ctx.recipeEntry)}  (your step \`run\` argv is appended to this)`,
    `Build command: ${ctx.recipeBuild}`,
  ]
}

export function buildAuthorUserPrompt(ctx: AuthorUserContext): string {
  const lines: string[] = preparationLines(ctx)
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
  // Detected third parties: what this repo actually integrates
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
    // The user supplied a real/sandbox account for these — they are a
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
  // How the app itself builds the requests it SENDS upstream, and which response
  // fields it reads back. A stub scripted against the vendor's documented payload
  // rather than these facts is rejected by the app under test, which reads as an
  // upstream failure and fails the scenario for a reason unrelated to the claim.
  // api-only and gated on non-empty, so a repo whose source yields none is
  // byte-identical to before this block existed.
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
  if (ctx.interfacePath.length > 0) {
    lines.push(
      `realized through: ${ctx.interfacePath.join(' → ')}  (the surfaces matching chose; the`,
      'per-milestone lines below say which serves which)',
    )
  }
  // The PLACES block — what each screen/dialog/panel the flow acts on visibly
  // shows, from the interface catalog's resource registry. Gated on non-empty,
  // so every plan without a location contract renders byte-identical.
  if (ctx.resources && ctx.resources.length > 0) {
    lines.push(
      '',
      "PLACES THIS FLOW ACTS ON — from the app's own interface catalog. Each place",
      'lists what it VISIBLY shows, as assertable facts in the web-step vocabulary.',
      'Ground your web expectations in THESE — a marker is text the page really',
      'renders, a control lists the ARIA states it genuinely exposes (assert no',
      'state on a control not listed here), and a rows shape says what varies in a',
      'repeated item so you never assert a rendered value as if it were stable.',
    )
    for (const place of ctx.resources) lines.push(...resourceLines(place))
    // The capture note. Placed HERE and not in the system prompt on purpose: what
    // makes a capture safe is being grounded in a listed readable, so the vocabulary
    // is taught next to the facts it may point at.
    lines.push(
      '',
      'CAPTURE — a web step may take a value OFF one of these readables and use it in a',
      'later step, which is the only way to state a claim about a CHANGE. Write it on the',
      'step as `capture: { <name>: { from: <locator>, get: … } }`, where `from` is a',
      'locator listed above and `get` is one of: `text` (the default), `value` (an',
      "input's current value), `count` (how many elements match — several matches are",
      'the answer here, not an ambiguity), `{ state: <aria state> }`, or',
      '`{ attribute: <name> }`. Add `number: "<regex with ONE group>"` to slice the',
      'number out of a sentence the page writes it in ("seats left: 3").',
      'Later steps read it as `${captured:<name>}` in any authored string, and assert a',
      'DELTA with `compare: { equals: "${captured:<name>}", offset: -1 }` — "one fewer',
      'than there were". Prefer that to asserting an absolute number, which only tests',
      'the state the world happened to be in. A capture whose element or pattern finds',
      'nothing FAILS its step, so capture only what these places really show.',
    )
  }
  // The flow's own operations as the repo's ROUTE REGISTRATIONS declare
  // them — the exact paths, and what each handler reads off the request. api-only and
  // gated on non-empty, so a cli batch or a degraded mapping is byte-identical.
  if (ctx.driver === 'api' && ctx.interfaceContracts && ctx.interfaceContracts.length > 0) {
    lines.push(
      '',
      "OPERATIONS THIS FLOW WALKS — read out of the app's own route registrations. Use",
      'these paths VERBATIM (a path listed in neither operations block below nor in a',
      'milestone above does not exist and answers 404), and give every request a body',
      'carrying each field marked `required` — a missing one is a 400 before any',
      'assertion of yours runs:',
    )
    for (const j of ctx.interfaceContracts) {
      lines.push(`- ${j.method} ${j.path}${contractSummary(j)}`)
    }
    // The rest of the surface. A flow's SETUP steps live here — the
    // favorites flow has to sign up and sign in, and neither is one of its
    // milestones, so with only the block above the model invented `/v1/auth/register`.
    if (ctx.otherOperations && ctx.otherOperations.length > 0) {
      lines.push(
        '',
        'OTHER OPERATIONS AVAILABLE (for setup steps — same verbatim-path rule) — the',
        'rest of this app\'s surface. Reach for one when a step must PREPARE the world',
        'the flow needs (register an account before signing in, create the resource a',
        'milestone acts on); the milestones themselves are still walked through the',
        'operations above. Same rules: path verbatim, every `required` field present:',
      )
      for (const j of ctx.otherOperations) {
        lines.push(`- ${j.method} ${j.path}${contractSummary(j)}`)
      }
      if (ctx.otherOperationsOverflow) {
        lines.push(`(…and ${ctx.otherOperationsOverflow} more operation(s) not shown.)`)
      }
    }
  }
  // Authoritative OpenAPI write-op request schemas for the endpoints
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
  // Response-schema conformance guidance. api-only AND gated on the batch binding to
  // an OpenAPI operation section (the precondition for `schema: true` to resolve at
  // run time), mirroring the precise endpointSchemas gating above — a
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
  // Per-operation security → credential mapping. api-only and gated on a non-empty
  // operationAuth (some bound operation declares security AND a credential matched or
  // failed to), so a public operation / markdown / cli batch is byte-identical to
  // before this block existed. USER-prompt only — the pinned api SYSTEM fingerprint is
  // untouched.
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
    // D3 — the section's own fenced blocks, byte-exact and clearly bounded. The
    // bytes are engine-mined from the section text above (never model-echoed);
    // the delimiters make "copy exactly" unambiguous, and the engine byte-checks
    // the authored scenario against these very bytes.
    for (const [i, example] of (m.examples ?? []).entries()) {
      lines.push(
        `DOC EXAMPLE ${m.order}.${i + 1}${example.lang ? ` (${example.lang})` : ''} — this section's own worked example,`,
        'byte-exact. When your scenario runs or sends it, copy the bytes BETWEEN the',
        'markers EXACTLY — character for character, whitespace included; never',
        'reformat, re-indent, requote, or "fix" them:',
        '<<<DOC-EXAMPLE',
        example.content,
        'DOC-EXAMPLE>>>',
      )
    }
  }
  if (ctx.priorFlag) {
    lines.push(
      '',
      'PRIOR FLAG — a scenario you authored for this flow before was REJECTED: it did',
      'NOT truly verify what the flow promises. Author a DIFFERENT scenario that CLOSES',
      'the gap below — do NOT reproduce the rejected shape (assert the exact values the',
      "claims quote, on the exact observables they name, as one chained path). The",
      'prior rejection:',
      `  rejected scenario: ${ctx.priorFlag.title}`,
      `  why it was rejected: ${ctx.priorFlag.mismatch}`,
    )
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
    if (ctx.issues.composition) {
      lines.push(
        '',
        'CORRECTION — this scenario does not COMPOSE: the engine accepts its shape but',
        'cannot execute it as written. Fix exactly this, keeping every assertion and every',
        'milestone:',
        `  ${ctx.issues.composition}`,
      )
    }
    if (ctx.issues.exampleFidelity) {
      lines.push(
        '',
        "CORRECTION — the scenario reformats a DOC EXAMPLE. The doc's own example must",
        'run byte-for-byte, exactly as delimited between the DOC-EXAMPLE markers above.',
        'Fix exactly this, keeping every assertion and every milestone:',
        `  ${ctx.issues.exampleFidelity}`,
      )
    }
    if (ctx.issues.invalidPattern) {
      const bad = ctx.issues.invalidPattern
      lines.push(
        '',
        'CORRECTION — this `matches` value is not a valid regular expression. A "matches"',
        'is a JS regex SOURCE compiled with new RegExp — it must compile. Fix the pattern,',
        'or use "contains" for a literal substring (or "equals" for the whole value):',
        `  step ${bad.step}, ${bad.where}: /${bad.pattern}/ — ${bad.error}`,
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
      'the schema (title, non-empty steps, optional setup/normalize,',
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
  a fresh clone with no node_modules. Match the ecosystem AND THE LOCKFILE THAT IS
  ACTUALLY PRESENT (the user message lists the repo-root files):
    pnpm-lock.yaml     → "pnpm install --frozen-lockfile"
    package-lock.json  → "npm ci"
    yarn.lock          → "yarn install --immutable"
    no lockfile at all → plain "npm install"
  "npm ci" and the frozen/immutable variants FAIL outright when their lockfile is
  absent. Omit install entirely when the tree needs no dependency fetch to build.
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
- When the repository is a workspace/monorepo that ships MORE THAN ONE HTTP service
  (a web app and a separate API service), declare them ALL under api.servers, one
  named entry per service, plus api.defaultServer. Each entry carries its own serve,
  healthPath, and app — the repo-relative directory of the workspace package it
  serves ("apps/api/v2") — plus \`"cwd": "repo"\` whenever the serve argv is
  workspace-mediated ("yarn workspace …", "npm run -w …"): the default boot
  directory is a throwaway sandbox, where such an argv cannot find the workspace
  root. The workspace apps listed in the user message are the
  inventory to draw from. Declaring only one of several services means every
  documented endpoint of the others is untestable, and every test written against
  them asks the wrong server and fails for the wrong reason. Use api.serve for a
  single-service repository and api.servers for a multi-service one — never both.
  Example:
    "api": { "servers": {
                "web":    { "serve": ["yarn","workspace","@acme/web","start"],
                            "healthPath": "/api/health", "app": "apps/web" },
                "api-v2": { "serve": ["yarn","workspace","@acme/api-v2","start"],
                            "healthPath": "/v2/health", "app": "apps/api/v2" } },
             "defaultServer": "web" }
- Propose entry for a command-line program, api for an HTTP server, or BOTH when
  the repository ships both. At least one of them is required.
- Everything the recipe runs must be something THIS repository ships. Never an
  inline-eval stand-in (\`node -e …\` as a server, an entry that merely loads a
  module, a build that builds nothing) — the engine refuses those statically, and
  a stand-in that passed would test nothing.
- A server that needs a datastore declares the repo's OWN bring-up under
  \`api.services\` (\`{"up": "docker compose -f <repo compose file> up -d --wait …",
  "down": "docker compose -f … stop"}\`) — never inside \`build\` (statically
  refused: the runner owns the services lifecycle, and a build's leftovers leak).
  Namespace EVERY \`docker compose\` invocation: pass \`-p <dedicated-project>\`, or
  point \`-f\` at a compose file that declares a top-level \`name:\` (a dedicated
  test compose). A bare \`docker compose up/stop\` attaches to the repository's
  DEFAULT compose project — the developer's own running stack, whose containers
  it would recreate or stop — and is refused statically. And when the app pins a
  SQL datastore, run the repo's schema/migration step inside \`api.services.up\`
  after the bring-up — a compose that only starts an empty database boots a
  server with no schema behind a green health probe.
- ownHosts (optional, recommended) lists the product's OWN hostnames
  ("acme.com", "api.acme.com") — domains the app's code calls that ARE the app,
  not third parties. Without it, detection reports the app's own domains as
  external services.

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

/** One workspace app as the recipe prompt advertises it (from the route manifest). */
export interface RecipeAppInventoryEntry {
  /** Repo-relative dir (`apps/api/v2`) — what an `api.servers[*].app` names. */
  dir: string
  /** package.json name, when it has one. */
  pkg?: string
  framework: string
  /** Static route prefixes the app declares (`/v2`, `/api`), a few samples. */
  prefixes: string[]
}

export interface RecipeDiscoveryInput {
  /** package.json contents (or a note that it's absent). */
  packageJson: string
  /** Names of the lockfiles / build-config files present in the repo root. */
  presentInputs: string[]
  /**
   * The workspace apps the route manifest found, with the path prefixes
   * each one serves. Without this the model sees only the ROOT package.json and
   * cannot know a second HTTP service exists — the cal.com failure: a recipe that
   * declared the web app while the docs described `apps/api/v2`. Empty/absent for a
   * single-package repo, where the prompt is exactly what it always was.
   */
  apps?: RecipeAppInventoryEntry[]
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
  if (input.apps && input.apps.length > 0) {
    lines.push(
      '',
      'Workspace apps in this repository (directory · package · framework · route prefixes it serves).',
      'An app with HTTP route prefixes is a service that needs its own api.servers entry,',
      'whose `app` is that directory:',
      ...input.apps.map((a) => {
        const prefixes = a.prefixes.length > 0 ? a.prefixes.join(', ') : '(no routes detected)'
        return `  ${a.dir}${a.pkg ? ` · ${a.pkg}` : ''} · ${a.framework} · ${prefixes}`
      }),
    )
  }
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
      // A dependency-free CLI (a plain script that runs straight from the clone)
      // does not need an install at all, and a package manager that crashes on a
      // legacy tree can never be argued into working — so dropping the step is a
      // real fix, not a workaround. The engine still probes the entry, so a wrong
      // omission fails loudly on the same verification.
      'If the INSTALL step is what failed and the entry can plausibly run from the tree',
      'as-is (a script-file CLI with no runtime dependencies), OMITTING install entirely',
      'is a VALID revision — the engine still verifies that the entry answers, so a wrong',
      'omission fails loudly rather than silently. The same goes for an install that needs',
      'a lockfile the repository does not commit: use the non-frozen form instead.',
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
// Seed drafting — the LLM-drafted `api.seed`
// ---------------------------------------------------------------------------

export const SEED_SYSTEM_PROMPT = `\
You write the ONE PREPARATION SCRIPT a repository's specification-derived tests run
against: it creates both the ROWS those tests reference and the AUTHENTICATED
PRINCIPALS they act as. You are given the app's own parsed database schema, the
ORM/client it uses, the environment variable it reads its connection from, its HTTP
route surface, the authentication schemes its API declares, and excerpts of its own
specification describing the roles that exist. You return JSON only — the script's
full source and the recipe block that runs it. You never run anything: the engine
runs your script, validates the manifest it writes, and boots the server against the
state it left behind. Nothing is written to the repository unless that verification
passes.

Data and auth are ONE artifact on purpose: a login token cannot be minted without a
user row, so seeding the principal IS seeding data. Never assume some other step
created the accounts.

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
- "fixtures" is what the tests will REFERENCE: the ids and key fields of the rows you
  created (a scenario interpolates them as {{fixture:<name>.<field>}}). Declare the
  fields a test of the ROUTE SURFACE below would have to reference — an id it must
  request, a slug it must send, a status it must observe. When the flows that could
  not be tested are listed, cover those first.
- "credentials" is the AUTHENTICATED PRINCIPALS half. Each is name → the request
  header it is injected as, plus a "description" naming the role in the app's own
  words ("org owner", "regular member") and, when the API declares OpenAPI security
  schemes, a "satisfies" naming the scheme this credential fulfills.

# Principals — one per role
- Mint ONE PRINCIPAL PER ROLE the app actually distinguishes. The ROLES section below
  lists the roles the schema and the specification agree on; create one account for
  each, with the role stored the way the schema stores it, and declare one credential
  per account. When no role is listed, one principal is the right answer — do not
  invent a hierarchy the app does not have.
- Mint the SECRET the way the APP would: call its own token/session issuance if the
  script can import it, otherwise sign the token with the same secret and algorithm
  the app verifies with (read from the same environment variable the app reads).
  Never hand-write a token shape you have not seen the app produce.
- The value must SURVIVE the seed process. The seed runs once per guard run, before
  the server boots, and every scenario then boots its own fresh server — so a token
  is only usable if it is stateless (a signed JWT any instance can verify) or backed
  by a session row in the datastore. A secret held in the seeding process's memory
  authenticates nothing.
- The header value is injected VERBATIM. If the API expects "Authorization: Bearer
  <token>", emit "Bearer <token>" as the manifest value — the runner adds no prefix.
- Omit "credentials" entirely only when the API declares no authentication at all.

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
  /** The blocked-on nouns as authoring stated them (the noun + the entity). */
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
  /**
   * The flows that could not be authored, with the data they said they needed. Now
   * that `truecourse guard setup` owns seed drafting this is OPTIONAL grounding, not
   * the trigger: setup drafts a seed BEFORE authoring has ever run, so on a first
   * setup this list is legitimately empty.
   */
  blocked: SeedBlockedClaim[]
  /**
   * The app's HTTP route surface — what the tests will actually drive, and
   * therefore what the fixtures must make reachable. Capped by the caller.
   */
  routes?: { method: string; path: string }[]
  /**
   * The OpenAPI security schemes the corpus declares (B7), name → a one-line
   * description of the scheme. A CLOSED SET: a credential's `satisfies` must name one
   * of these, and the engine drops any other name before writing.
   */
  securitySchemes?: { name: string; summary: string }[]
  /**
   * The roles the app distinguishes — one principal is minted per entry. Derived
   * deterministically from the schema (a role-shaped column and its enumerated
   * values) and, where the specs name them, from the spec language. Empty ⇒ one
   * principal, which is the honest default.
   */
  roles?: { name: string; source: string }[]
  /** Short excerpts of the curated specs, for the ROLE/PRINCIPAL language only. */
  specExcerpts?: { doc: string; text: string }[]
  /** The repo's ecosystem, so the script lands in the right language. */
  ecosystem: string
  /** A suggested script path in the repo's own conventions. */
  suggestedPath: string
  /**
   * The seed script this draft REPLACES (`guard setup --refresh` over a repo that
   * already has one), quoted back so the replacement is an improvement rather than a
   * fresh guess. Absent on a first draft.
   */
  replacing?: { scriptPath: string; scriptContent: string }
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
  if (input.routes && input.routes.length > 0) {
    lines.push(
      '',
      'ROUTE SURFACE (what the tests will drive — your fixtures must make these reachable):',
    )
    for (const r of input.routes) lines.push(`  ${r.method.toUpperCase()} ${r.path}`)
  }
  if (input.securitySchemes && input.securitySchemes.length > 0) {
    lines.push(
      '',
      'AUTHENTICATION SCHEMES this API declares. A credential\'s "satisfies" must name',
      'exactly one of these keys (any other name is dropped by the engine):',
    )
    for (const s of input.securitySchemes) lines.push(`  ${s.name}: ${s.summary}`)
  } else {
    lines.push(
      '',
      'AUTHENTICATION: the specification declares no OpenAPI security scheme. Read the',
      'route surface and the schema to decide whether a principal is needed at all, and',
      'omit "satisfies" — there is nothing for it to name.',
    )
  }
  if (input.roles && input.roles.length > 0) {
    lines.push('', 'ROLES — mint ONE PRINCIPAL PER ENTRY:')
    for (const r of input.roles) lines.push(`  ${r.name}  (${r.source})`)
  } else {
    lines.push(
      '',
      'ROLES: none were detected. Mint ONE principal unless the specification excerpts',
      'below clearly distinguish more — do not invent a hierarchy the app does not have.',
    )
  }
  if (input.specExcerpts && input.specExcerpts.length > 0) {
    lines.push(
      '',
      'SPECIFICATION EXCERPTS (for the ROLE and PRINCIPAL language only — the schema above',
      'remains the authority on what is creatable):',
    )
    for (const e of input.specExcerpts) {
      lines.push(`  ${e.doc}`, indentBlock(e.text))
    }
  }
  if (input.blocked.length > 0) {
    lines.push(
      '',
      'THE FLOWS THAT COULD NOT BE TESTED (each names the data it needed — your fixtures',
      'must cover these, by the fields a test would have to reference):',
    )
    for (const b of input.blocked) {
      lines.push(`  - ${b.flow}`, `      needs: ${b.needs.join('; ')}`)
    }
  }
  if (input.replacing) {
    lines.push(
      '',
      `REPLACING the seed script this repository already has (${input.replacing.scriptPath}).`,
      'It is quoted below because a replacement must be an IMPROVEMENT on it, not a fresh',
      'guess: keep what already works (its imports, its idempotence mechanism, the fixtures',
      'it already provides) and change only what the instructions above require.',
      indentBlock(input.replacing.scriptContent),
    )
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

# Two-sided claims — both halves must be asserted
When a claim asserts BOTH what the program DOES and what it does NOT do — a set of
inputs accepted/matched/included AND a set rejected/excluded/left out ("accepts A
and B but not C or D"; "valid X is accepted, invalid X is rejected") — BOTH halves
are the contract. A scenario that exercises only the positive half — feeds the
included inputs and asserts they appear — is \`weak\`: it would STILL PASS if the
excluded inputs were wrongly accepted too, so the negative half is never verified.
Flag it unless the scenario ALSO exercises the excluded inputs and asserts their
exclusion observably (absent from the output, a distinct exit code or status, a
rejection/error line).

# Output schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition; your reply must
validate against it exactly. Output EXACTLY ONE JSON object, no prose, no fences:
${FIDELITY_JSON_SCHEMA}
Concretely:
  { "verdict": "faithful" }
  { "verdict": "flagged", "confidence": "high", "mismatch": "<one sentence naming what the scenario fails to verify>" }
On "flagged" the "mismatch" is REQUIRED — one sentence stating the gap between what
the flow's claims assert and what the scenario actually checks (name the milestone)
— and so is "confidence" (high | medium | low): how certain you are the scenario
truly fails to verify its flow. Say "high" only when the gap is beyond doubt (the
claim quotes a value no assertion mentions); a high-confidence flag is acted on
without a human. Omit both when faithful.`

/**
 * PIN 2026-08-01 (Wave 5): rolled once — the reviewer now flags a
 * one-sided scenario `weak` on the same two-sided criterion the authoring prompts
 * teach, so the author and the auditor can never disagree on what "verifies" means.
 */
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

export interface FlowDigest {
  /** Stable ref (`F1`, `F2`, …) the epic's `composedOf` copies. */
  ref: string
  areaId: string
  title: string
  goal: string
  milestones: { doc: string; anchor: string; claimTitle: string }[]
}

/** The epic pass's engine feedback for its ONE corrective re-ask. */
export const MATCH_SYSTEM_PROMPT = `\
You decide HOW a spec FLOW could be walked on ONE of an application's surfaces. You
are given the flow — a user goal and an ordered list of MILESTONES — and that
surface's INTERFACE CATALOG: every entry point the surface actually offers, with the
steps each one performs. Your one job: return the ordered plan that walks the
milestones through those interfaces, or say plainly that the surface cannot do it. You
return JSON only.

${OUTPUT_ONLY_GUARDRAIL}

# What you are matching
- A MILESTONE is something the product should do for a user, stated by the spec.
- A INTERFACE is something the code actually offers: a command a user can run, an
  endpoint they can call, a screen they can reach. It is derived from the code, so
  the catalog is the complete list of what this surface can do.
- A PLAN pairs them: for each milestone, the interface (or interfaces) a test would use
  to reach it, in the order a user would walk them.

# The rules
- Use ONLY interfaces from the catalog below, addressed by their \`id\` copied VERBATIM.
  An id that is not in the catalog invalidates your whole answer.
- Every milestone must appear in the plan at least once. A milestone may take two
  interfaces (do it, then observe it); an interface may serve two milestones.
- Keep the plan in milestone order — it is a path, and each step acts on the state
  the previous one left.
- Match on BEHAVIOR, not on wording. An interface whose entry is \`tasks add\` realizes
  "creating a task returns its id" even though neither text quotes the other.

# The api surface also owns the SERVER PROCESS
The api surface does not only send requests: a test on it starts the service (with
any environment it likes), signals it, reads what it writes to stdout/stderr, and
restarts it. So a milestone about STARTUP, CONFIGURATION defaults, a failed start,
boot-time migrations, request LOGGING, graceful SHUTDOWN, or state SURVIVING a
restart is realizable on \`api\` even though no interface in the catalog names it —
interfaces are entry points, not the process's whole life. Plan such a milestone
against the interface the test observes it THROUGH (the endpoint whose data must
survive the restart, the endpoint whose request produces the log line, or the
service's health/entry interface when it is the boot itself under test) and say so in
the \`note\`. Only a milestone about a DIFFERENT program — a package script, a build
or test command the docs tell a user to run — is outside this surface.

# A route the app does NOT have is still the api surface's behavior
A milestone about how the service answers a request it does not serve — an unknown
path, an unsupported method on a real path, the shape of a 404 or 405 — IS realizable
on the api surface even though no interface names it: the catalog lists the routes that
EXIST, and the claim is precisely about what happens off that list. Plan it against
the interface it sits nearest (the operation whose path or family the claim names) and
say so in the \`note\`. Do not call it unrealizable.

# When the surface cannot do it — say so, and say why
If any milestone has NO interface that could plausibly serve it, do NOT stretch an
unrelated interface to cover it and do NOT return a partial plan. Return
\`unrealizable\` with ONE sentence naming the milestone(s) nothing serves and what is
missing (e.g. "no interface creates a project — the catalog only reads them"). That
verdict is a first-class, useful answer: it is how a spec promise with no code
surface behind it becomes visible. A wrong plan, by contrast, produces a test that
checks the wrong thing.

# Output schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition; your reply must
validate against it exactly. Output EXACTLY ONE JSON object, no prose, no fences:
${MATCH_JSON_SCHEMA}
Concretely:
  { "plan": [ { "interfaceId": "<copied verbatim from the catalog>",
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
 * One interface as the matcher sees it: the DIGEST — id, title, entry descriptor, and
 * a one-line summary per step. Never file paths, symbols, or source: the matcher
 * reads what a USER can reach, exactly like the interface fingerprint.
 */
export interface InterfaceDigest {
  id: string
  title: string
  /** The entry descriptor as the surface declares it (a command path, a route). */
  entry: string
  /** One line per step — kind + its surface-visible payload. */
  steps: string[]
}

/** What the engine tells the matcher on its ONE corrective re-ask. */
export interface MatchIssues {
  /** Interface ids the plan named that are not in the catalog. */
  unknownInterfaces: string[]
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
  /** The surface's whole interface catalog, as digests. */
  interfaces: InterfaceDigest[]
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
    `INTERFACE CATALOG for ${ctx.surface} — everything this surface offers. Copy an \`id\``,
    'verbatim into every plan entry:',
  )
  for (const j of ctx.interfaces) {
    lines.push('', `--- id: ${j.id}`, `title: ${j.title}`, `entry: ${j.entry}`)
    if (j.steps.length > 0) {
      lines.push('steps:')
      for (const s of j.steps) lines.push(`  ${s}`)
    }
  }
  if (ctx.issues) {
    if (ctx.issues.unknownInterfaces.length > 0) {
      lines.push(
        '',
        'CORRECTION — these interface ids are NOT in the catalog above. Every `interfaceId`',
        'is copied verbatim from a catalog entry:',
      )
      for (const id of ctx.issues.unknownInterfaces) lines.push(`- ${id}`)
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
        'CORRECTION — your plan covered no interface for these milestones. Either give each',
        'one an interface from the catalog, or answer `unrealizable` naming what is missing:',
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
      'Return exactly ONE JSON object: { "plan": [ { "interfaceId", "milestone" }, … ] }',
      'with interface ids copied verbatim from the catalog, or { "unrealizable": "<one',
      'sentence>" }. Nothing else.',
    )
  }
  return lines.join('\n')
}
