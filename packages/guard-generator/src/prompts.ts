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
  RawGeneratedScenarioSchema,
  FidelityReviewSchema,
  type ExampleBlock,
  type SupportSubject,
} from './schemas.js'
import type { GuardDoc, SectionInput } from './section-plan.js'
import type { ProbeTranscript } from './ground.js'

/** The authored-scenario JSON Schema — the behavioral fields only, rendered from
 *  the SAME Zod schema the engine parses replies with (`.strip()` renders it
 *  without the parse-side unknown-key tolerance, so the hint stays closed). */
const SCENARIO_JSON_SCHEMA = jsonSchemaHint(RawGeneratedScenarioSchema.strip())
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
  creates or changes. This is the ONLY driver a test is authored for today; still
  extract api/web/tui/library claims so the coverage picture stays honest.
- api — an HTTP/RPC service's response, or the datastore state a request leaves.
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

# Example blocks — a worked example is a high-value claim
Docs are full of WORKED EXAMPLES: a fenced code block whose SURROUNDING PROSE states
what the block produces. When the prose states an OUTCOME for the block, emit ONE
claim for it with "flavor": "example", carrying the block's content copied VERBATIM
(byte-for-byte, exactly as fenced) in "example.block" and the promised result in
"example.outcome". These are the cheapest, highest-fidelity claims — the exact input
AND its expected result are already written in the doc.
The prose STATES AN OUTCOME when it says, in effect, what running the block does:
"this fails" / "this passes" / "produces X" / "outputs X" / "returns X" / "is
rejected" / "is valid" / "is an anti-pattern (rule Y flags it)" / "is reported as an
error". The outcome must be a concrete, observable result — not a vague "for example".
A fenced block with NO stated outcome is NOT a claim. A bare snippet shown only to
ILLUSTRATE syntax, a config shape, or usage — with no sentence saying what running it
produces — must NOT become a claim: extract nothing for it (and do not force an
untestable note for the block alone).
  POSITIVE — emit an example claim. Prose: "This query is an anti-pattern; ST07 flags
    it:" followed by a fenced SQL block ⇒ ONE claim, "flavor":"example", "example.block"
    the SQL copied verbatim, "example.outcome" "ST07 flags this query".
  NEGATIVE — do NOT emit a claim. Prose: "A rule file looks like this:" followed by a
    fenced TOML block, with no sentence stating what running it produces ⇒ extract
    nothing for that block (it only illustrates the file shape).
Bind an example claim to the narrowest section that states it, like any claim; its
"claim" is still one declarative sentence in the doc's terms and its "driver" is the
kind of test that could assert it. "example.block" is copied VERBATIM — never
reformatted, re-indented, or "corrected".

# Invariant claims — an always/never rule tested over MANY inputs
Some documented behaviors are UNIVERSAL RULES, not single facts: the prose says the
tool does (or never does) something for ALL inputs — "always" / "never" / "idempotent"
/ "deterministic" / "for any input" / "round-trips" / "safe on every file". Examples:
"fix never changes your code's behavior", "formatting is idempotent", "the parser
accepts any valid document", "install is deterministic given a lockfile". Such a rule
cannot be tested by one hand-picked input, so mark it "flavor": "invariant" — the
engine will check it over a whole corpus of inputs rather than one. An invariant claim
carries an "examples" ARRAY: copy VERBATIM (byte-for-byte, like example.block) every
worked-example block in the SAME section that can serve as an input the rule applies to
(the docs' own before/after snippets, sample files, or inputs). Omit "examples" (or
leave it empty) when the section shows no such inputs. The "claim" is still one
declarative sentence stating the rule; the "driver" is the kind of test that asserts it.
Reserve "invariant" for a genuine universal rule — a one-off behavior is a "normal" (or
"example") claim, not an invariant.

# Support claims — a "supports X" promise tested over a GENERATED corpus
Some documented behaviors are QUANTIFIED SUPPORT promises: the prose says the tool
SUPPORTS, HANDLES, ACCEPTS, PARSES, or is COMPATIBLE WITH a whole CLASS of input named
by a language, dialect, format, or syntax — "supports the Postgres dialect", "handles
JSON5", "parses any valid YAML 1.2 document", "compatible with PEP 604 union syntax".
Such a promise covers thousands of inputs the doc never lists, so mark it
"flavor": "support" and carry a "support" object naming the class:
  { "kind": "language" | "dialect" | "format" | "syntax",
    "subject": "<the named class X, e.g. \\"the Postgres SQL dialect\\">",
    "extension": "<the file extension the tool dispatches on, e.g. \\"sql\\"; omit if none>" }
The engine then GENERATES a diverse corpus of X inputs and runs the tool's documented
operation over all of them. The "claim" is still one declarative sentence stating the
support promise; the "driver" is the kind of test that asserts it (usually "cli").
The deciding line is QUANTIFICATION over a class — the promise is that a WHOLE FAMILY of
inputs works, not that one specific input does.
  POSITIVE — emit a support claim. Prose: "sqlfluff supports the Postgres, BigQuery, and
    Snowflake dialects." ⇒ one support claim per dialect (or one naming the dialect the
    section is about), "flavor":"support", "support":{ "kind":"dialect",
    "subject":"the Postgres SQL dialect", "extension":"sql" }.
  NEGATIVE — do NOT emit a support claim. Prose: "The --dialect flag selects the SQL
    dialect; see the dialect reference." merely MENTIONS dialects without promising a
    class of inputs works ⇒ this is a "normal" claim about the flag (or nothing), NOT a
    support claim. A passing MENTION of a format/language is not a "supports X" promise.
Reserve "support" for a genuine quantified support promise; a single documented example
is an "example" claim and a one-off behavior is a "normal" claim.

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
        "reason": "<the observable behavior a test would assert>",
        "flavor": "example",
        "example": { "block": "<the fenced block's content, copied VERBATIM>",
                     "outcome": "<the result the prose promises for it>" } } ],
    "untestable": [
      { "sectionAnchor": "<an anchor copied verbatim>",
        "reason": "<why no driver can assert anything here>" } ] }
Omit "flavor"/"example" for a normal prose claim; set "flavor":"example" and the
"example" object ONLY for a worked-example block whose prose states an outcome; set
"flavor":"invariant" and the "examples" array (verbatim input blocks from the section)
for a universal always/never/idempotent/deterministic rule; set "flavor":"support" and
the "support" object for a quantified "supports/handles/parses <class> X" promise.`

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

# Two-sided claims — assert BOTH what DOES and what does NOT happen
Some claims assert BOTH halves of a behavior: a set of inputs the tool ACCEPTS,
MATCHES, or INCLUDES and a set it REJECTS, EXCLUDES, or leaves OUT ("accepts A and B
but not C or D"; "flags X, leaves Y untouched"). BOTH halves are the contract. A
scenario that exercises only the positive half — feeds the included inputs and
asserts they appear — is HALF a test: it would STILL PASS if the logic were broken so
the EXCLUDED inputs were wrongly accepted too, so it proves nothing about the negative
half. When a claim names things that must NOT happen, you MUST assert that half
observably: exercise the excluded inputs and assert their exclusion in the observable
output — absent from the emitted set, a distinct exit code, a rejection/error line,
whatever the tool uses to signal "not included". Prefer feeding the included AND the
excluded inputs in ONE invocation and asserting the output holds exactly the included
ones and NONE of the excluded, so a single run proves both directions at once. A
scenario that drops the exclusion half is \`weak\` and will be flagged.

# The assumed environment is part of the test — reproduce it in setup
A claim or example rarely runs in a vacuum: the surrounding section or document
usually establishes the CONFIGURATION it depends on — a required setting, a mode, an
option value, a selected target — stated in nearby prose or a shown config snippet.
That environment is PART of the test. Reproduce it in \`setup\` (a config file under
\`setup.files\`, \`setup.env\`) so the program runs under the same assumptions the doc
makes around the example. A setting the program REFUSES TO RUN WITHOUT — one the docs
take for granted and never repeat — belongs in \`setup\` too, even when the claim's own
sentence does not mention it (the real program, and any transcript below, will name it
when it is missing). A scenario that copies the example's input but drops the
configuration it assumes is testing a DIFFERENT world than the doc describes, and it
fails for the wrong reason.

# Verify ONLY the claim — constrain the invocation so nothing else contaminates it
Assert exactly the one behavior the claim names, and nothing else. When the program
applies MANY behaviors at once (several rules, checks, or default passes) and only one
is the claim's subject, an unrelated behavior can contaminate the outcome you assert —
a second, off-topic failure flips a documented "passes" into a "fails". Constrain the
invocation so it cannot: scope the run to the claim's subject (the flag or subcommand
that selects just the relevant behavior) and use the MINIMAL input that exercises the
claimed behavior. The scenario must turn red for the claim's behavior ALONE, never for
a neighbor the claim says nothing about.

# Example claims — the doc's own block IS the input, byte-faithful
Some claims arrive marked as an EXAMPLE (the claim shows an "EXAMPLE BLOCK" and its
promised outcome). For such a claim the doc already contains the EXACT input and its
expected result, so you do NOT invent or paraphrase inputs: seed the doc's block as
the scenario's setup file content (\`setup.files\`) — or pipe it as \`stdin\` — copied
BYTE-FOR-BYTE, exactly as given, minus only the doc's own escaping. Do NOT reformat,
re-indent, re-quote, trim, "fix", or otherwise edit the block — a deliberately-broken
example must stay broken. You choose only the MECHANICS: which command/argv runs it,
which file path to seed the block into, and the matcher FORM. The asserted OUTCOME is
the promised result the example states (the rule fires / the output equals the shown
output / it passes clean). Editing or "improving" the block's bytes is the worst
failure — the whole point is that the doc's exact example is what runs.

# Invariant claims — ONE rule, checked over MANY inputs
Some claims arrive marked INVARIANT (an always / never / idempotent / deterministic
rule about the tool — "fix never breaks your code", "formatting is idempotent",
"install is deterministic given a lockfile"). One hand-picked input cannot test the
word "never", so you author ONE scenario (the RULE) and the engine runs your steps
ONCE PER FILE in a committed input corpus, staging each file into the sandbox under a
STABLE name your steps reference. You do NOT author or invent the inputs — the engine
seeds the corpus; you author only the rule.
- The staged input name is \`input\` by default. Set \`inputs.as\` (e.g. "input.sql")
  when the tool dispatches on file extension, and reference THAT exact path in your
  step \`run\` argv / \`files\` matchers. Do not seed the input via \`setup.files\` — the
  engine stages it.
- Assert the RULE, not one input's exact output — the corpus varies file to file. Use
  exit codes and the two PROPERTY forms, plus structural \`contains\`/\`matches\`; never
  \`equals\` on a whole line of per-file output.
  - \`stableOnRerun: true\` on a step — the engine runs the step a SECOND time and
    requires identical output (same exit + stdout/stderr, and the staged input file
    unchanged). This is idempotence / determinism: "formatting is idempotent", "a
    second fix changes nothing", "output is deterministic".
  - \`stdinFromStep: N\` on a step — feed the stdout of earlier step N as this step's
    stdin, so "the output of step N must itself pass step M". Example (fix output
    re-parses clean): step 1 runs the formatter to stdout; step 2 sets
    \`stdinFromStep: 1\` and asserts a clean parse (exit 0). \`stdinFromStep\` replaces
    \`stdin\` — never set both on one step.
- Return exactly ONE scenario for an invariant claim (the rule). It rides the same
  schema; only \`inputs.as\` + the property forms are invariant-specific.

# Support claims — ONE operation, run over a GENERATED corpus
Some claims arrive marked SUPPORT (the doc promises the tool supports / handles / is
compatible with a whole CLASS of input — "supports the Postgres dialect", "handles
JSON5", "compatible with PEP 604 syntax"). The class promises thousands of inputs, so
the engine GENERATES a diverse corpus of valid inputs in that class and runs your
steps ONCE PER FILE, staging each at a stable name — exactly like an invariant claim.
You author ONE scenario: run the DOCUMENTED OPERATION over the staged input and assert
the BORING PASS the section promises for supported input — it PARSES / LINTS / FORMATS
CLEAN, exits 0, and its output contains no failure marker (e.g. no \`unparsable\`,
no \`error\`). Read the section to pick the operation + the pass signal; the corpus is
all VALID input, so a supported class means every file passes.
- The staged input name is \`input\` by default. Set \`inputs.as\` (e.g. "input.sql")
  when the tool dispatches on file extension, and reference THAT path in your \`run\`
  argv. Do NOT seed the input via \`setup.files\` — the engine stages each corpus file.
- Assert the RULE (every input is accepted), never one input's exact output: use the
  exit code and structural \`contains\`/\`matches\`, never \`equals\` on a whole line.
- Return exactly ONE scenario for a support claim (the rule). It rides the same schema;
  only \`inputs.as\` is support-specific.

# Titles — the doc's promise, never the expected output
Each scenario \`title\` states, in plain words, the BEHAVIORAL PROMISE the doc makes —
what the tool does — so a reviewer reads it as doc-vs-code without decoding the
matchers. It is NEVER the literal expected output (the exact stdout/exit code/file
content the assertion checks — that already lives in the step's \`expect\`). You MAY
cite the doc's own example in parentheses for concreteness.
  Good: "fix rewrites the file in place (leaving \`SELECT 1\`)".
  Good: "an unparsable token is reported under an \`unparsable:\` node".
  Bad:  "stdout contains 'unparsable: [2, 3]'" (that is the expected output, not the promise).
  Bad:  "exit code is 1" (a mechanic, not what the doc promises).

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
  /** Present ONLY for an example claim (extraction `flavor: 'example'`): the doc's
   *  own block content (verbatim) + the promised outcome. Threaded so the model
   *  seeds the scenario's setup from the exact bytes, never a paraphrase. */
  example?: ExampleBlock
  /** Present ONLY for an invariant claim (extraction `flavor: 'invariant'`) whose
   *  input pack the engine seeded: the pack id (engine-owned; the model does not
   *  author it) plus sample inputs so the model shapes a property assertion the
   *  whole corpus satisfies. Its presence tells the model to author ONE rule over
   *  many staged inputs (item 8). */
  invariant?: { pack: string; samples: ExampleBlock[] }
  /** Present ONLY for a support claim (extraction `flavor: 'support'`): the class +
   *  named subject X the engine generated an exemplar pack for, and the file
   *  extension the tool dispatches on (when the section names one). Its presence
   *  tells the model to author ONE rule that runs the documented operation over the
   *  engine-generated corpus with the boring pass expectation (item 9). */
  support?: { kind: SupportSubject['kind']; subject: string; extension?: string }
  /** On a birth-validation retry, the prior attempt's failure evidence. */
  retry?: BirthRetryContext
  /** Present when this claim was TAINTED (item 2): a scenario authored for it on an
   *  EARLIER generate was flagged and rejected, and the author cache was bypassed so
   *  this call re-authors fresh. Carries the prior flag's evidence so the model avoids
   *  reproducing the rejected shape. Rides the ROUND-1 author call (unlike `retry`,
   *  which is a within-run birth failure). */
  priorFlag?: { title: string; mismatch: string }
  /** Present on a FAMILY re-author (item 4): several sibling scenarios were all
   *  rejected for the SAME reason (clustered by diagnosis), so this call re-authors
   *  fresh carrying the shared correction + 1–2 exemplar mismatches from the family —
   *  the model fixes the recurring PATTERN, not this instance blindly. */
  familyCorrection?: { correction: string; exemplars: string[] }
}

/**
 * The whole-document context for an authoring batch: the FULL document text,
 * always. Authoring reasons over the complete document it draws claims from — it
 * never degrades to a thinned outline. (Extraction chunks large docs losslessly;
 * authoring does not — a doc that physically exceeds the model context fails loud
 * rather than silently thinning.)
 */
export function buildAuthorDocContext(gd: GuardDoc): string {
  return gd.content
}

export interface AuthorUserContext {
  /** Repo-relative doc path the claims come from. */
  doc: string
  /** Whole-document context: the full document text (see {@link buildAuthorDocContext}). */
  docContext: string
  /** Canonical area ids the doc covers, from the corpus (may be empty). */
  areaTags: string[]
  /** The recipe entrypoint argv, so the model knows what `run` is appended to. */
  recipeEntry: string[]
  /** Recipe build command — context on what is built before scenarios run. */
  recipeBuild: string
  /** The claims to author this call. */
  claims: AuthorClaim[]
  /** Real empty-sandbox transcripts for the commands the claims name (may be empty
   *  — ungrounded when the build failed or no command was named). */
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
  const lines: string[] = [
    `Program entrypoint: ${JSON.stringify(ctx.recipeEntry)}  (your step \`run\` argv is appended to this)`,
    `Build command: ${ctx.recipeBuild}`,
  ]
  if (ctx.areaTags.length > 0) lines.push(`Area context: ${ctx.areaTags.join(', ')}`)
  lines.push(
    '',
    `Document: ${ctx.doc}`,
    'Document context — the FULL document the claims are drawn from (each claim below',
    'cites its section by heading):',
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
    if (c.example) {
      lines.push(
        'EXAMPLE BLOCK — the doc\'s own example. Seed this as the scenario input',
        '(setup.files content or stdin) copied BYTE-FOR-BYTE; do NOT reformat, edit, or',
        '"fix" it. Choose only the command, the file path, and the matcher form:',
        '"""',
        c.example.block,
        '"""',
        `promised outcome: ${c.example.outcome}`,
      )
    }
    if (c.invariant) {
      lines.push(
        'INVARIANT — author ONE scenario (the RULE). The engine runs your steps once per',
        'file in a committed corpus, staging each at "input" (override via inputs.as).',
        'Reference the staged input by that name; do NOT seed it yourself. Assert the rule',
        'across ALL inputs with exit codes + stableOnRerun / stdinFromStep, never one',
        "input's exact output. Sample inputs the corpus holds (each staged in turn):",
      )
      for (const s of c.invariant.samples.slice(0, 3)) {
        lines.push('"""', s.block, '"""')
      }
      if (c.invariant.samples.length > 3) {
        lines.push(`(…and ${c.invariant.samples.length - 3} more input(s) in the corpus)`)
      }
    }
    if (c.support) {
      const staged = c.support.extension ? `input.${c.support.extension.replace(/^\./, '')}` : 'input'
      lines.push(
        `SUPPORT — the doc promises this tool handles the ${c.support.kind} "${c.support.subject}".`,
        `Author ONE scenario (the RULE). The engine generated a DIVERSE corpus of valid`,
        `${c.support.subject} inputs and runs your steps once per file, staging each at "${staged}"`,
        c.support.extension
          ? `— set inputs.as to "${staged}" and reference it in your run argv.`
          : '(override via inputs.as if the tool dispatches on file extension).',
        'Run the documented operation over the staged input and assert the BORING PASS the',
        'section promises for supported input — it is accepted (parses/lints/formats clean,',
        'exit 0, no failure marker in the output). Do NOT seed the input yourself; do NOT',
        "assert one input's exact output — the corpus varies file to file.",
      )
    }
    if (c.familyCorrection) {
      lines.push(
        'FAMILY CORRECTION — several scenarios, this one among them, were all rejected',
        'for the SAME underlying mistake. Apply this shared correction and do NOT',
        'reproduce the recurring pattern:',
        `  shared correction: ${c.familyCorrection.correction}`,
      )
      if (c.familyCorrection.exemplars.length > 0) {
        lines.push('  examples of the recurring mistake in the family:')
        for (const ex of c.familyCorrection.exemplars) lines.push(`  - ${ex}`)
      }
    }
    if (c.priorFlag) {
      lines.push(
        'PRIOR FLAG — a scenario you authored for this claim on an EARLIER generate did',
        'NOT truly verify the claim: it was flagged and rejected. Author a DIFFERENT',
        'scenario that CLOSES the gap below — do NOT reproduce the rejected shape (for a',
        'two-sided claim, that usually means also exercising the excluded inputs and',
        'asserting their exclusion). The prior rejection:',
        `  rejected scenario: ${c.priorFlag.title}`,
        `  why it was rejected: ${c.priorFlag.mismatch}`,
      )
    }
    if (c.retry) {
      lines.push(
        'RETRY — a scenario you authored for this claim FAILED birth validation (it did',
        'not pass against the current code). Read the evidence below — ESPECIALLY the',
        "program's own output printed under it — and fix COMMANDS, ARGUMENTS, and SETUP.",
        'The program tells you, in its own words below, what it needs.',
        '',
        'FIRST decide which of two failures this is — they are handled OPPOSITELY:',
        '- USAGE / SETUP error — the program REJECTED the invocation and never evaluated',
        '  the claimed behavior: it printed a usage message, named a missing or required',
        '  option, reported an unknown/invalid argument, or refused to run because a',
        '  mandatory setting was not configured (often a non-zero "usage" exit, or empty',
        '  output with an error on stderr). This is ALWAYS a defect in YOUR scenario, never',
        '  a finding — the claim was never tested. FIX it: add the option/argument the',
        "  program says it needs to the step's `run`, or reproduce the required",
        '  configuration in `setup` — CREATE OR EDIT the config file under `setup.files`,',
        '  set `setup.env`. Do NOT leave the rejected invocation in place.',
        '- DOC-vs-CODE disagreement — the program actually RAN the claimed behavior and',
        '  produced a DIFFERENT value than the claim quotes. ONLY here does the assertion',
        '  stand: if the evidence shows a genuine',
        '  DOC-vs-CODE disagreement on the asserted VALUE (the code really RAN and printed',
        "  something other than what the claim quotes), KEEP the claim's assertion — the",
        '  retry then fails again and the claim',
        '  correctly becomes a finding. Do NOT change a claimed assertion to match the',
        '  code. Return an empty scenarios array only if the claim is genuinely not',
        '  CLI-observable:',
        `  scenario: ${c.retry.scenarioTitle}`,
        `  failing step: ${c.retry.step}`,
        `  expected: ${c.retry.expected}`,
        `  actual:   ${c.retry.actual}`,
      )
      // The failing run's raw program output — the program's own words the rules above
      // point at (a usage/setup error names exactly what to add). Each stream omitted
      // when absent.
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
      'above; each scenario matches the schema (title, driver "cli", non-empty steps,',
      'optional setup/normalize). Use an empty scenarios array for a claim that is not',
      'CLI-assertable — and add "blockedOn": ["<capability>"] when it is empty because',
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

You are given the repository's recognized manifests, each LABELED with its path and
ecosystem (js | python | csharp). Read them and return exactly one JSON object
matching this schema (CANONICAL — generated from the engine's Zod definition; your
reply must validate against it exactly):
${RECIPE_JSON_SCHEMA}
Concretely:
  { "install": "<optional shell command run once in the repo root, before the build, to fetch dependencies>",
    "build": "<shell command run once in the repo root to produce the entrypoint>",
    "entry": ["<argv>", "..."] }

- install (optional) fetches dependencies before the build runs — the tree may be
  a fresh clone with nothing installed. Match the ecosystem AND the lockfile that is
  actually present (see "Other files present"): js — "pnpm install --frozen-lockfile"
  with pnpm-lock.yaml, "npm ci" with package-lock.json, "yarn install --immutable"
  with yarn.lock; when NO lockfile is listed as present, use plain "npm install" —
  "npm ci" and the frozen/immutable variants FAIL without a lockfile. python —
  "python3 -m venv .venv && .venv/bin/pip install -e ." (an editable install
  makes [project.scripts] console scripts runnable at .venv/bin/<name>); csharp —
  "dotnet restore". Omit it when the tree needs no dependency fetch.
- build produces the runnable program (e.g. "pnpm build", "npm run build",
  "dotnet build -c Release"). It MAY be the no-op "true" when the repo needs no
  compile step — "true" is valid for build ONLY, never for entry.
- entry is the argv that invokes the ACTUAL program under test; scenario arguments
  are appended to it. Read it from whichever manifest DECLARES the CLI:
  - js — package.json "bin" or "main", or a workspace script (e.g. ["node","dist/cli.js"]).
  - python — the [project.scripts] / console_scripts entry point names the command
    (e.g. [project.scripts] sqlfluff = "sqlfluff.cli.commands:cli" ⇒
    [".venv/bin/sqlfluff"] after the editable install, or ["python","-m","sqlfluff"]).
  - csharp — a project with <OutputType>Exe</OutputType> or a <ToolCommandName>
    (e.g. ["dotnet","run","--project","src/Tool/Tool.csproj"]).
  Paths are repo-relative.
- entry must NEVER be a shell no-op that runs no program. true, false, :, test, [,
  and noop are FORBIDDEN as entry[0]: an entry built on one "passes" every scenario
  while testing nothing, and the engine rejects it.

# Choosing among ecosystems
When manifests from more than one ecosystem are present (say a Python CLI alongside
a docs-site package.json), choose the entrypoint from WHICHEVER MANIFEST DECLARES
THE CLI ENTRY POINT — never a fixed language precedence. A package.json's presence
does not make the program a Node program when the CLI is declared in pyproject.toml.
If NO manifest declares a runnable CLI, or two declare rival CLIs and you cannot
tell which is the program under test, DO NOT GUESS: return exactly
  { "ambiguous": "<one sentence: what is unclear and which manifests conflict>" }
instead of a proposal. The engine treats that as a discovery failure and surfaces
your explanation to the user.

Output exactly one JSON object — either the { "build", "entry" } proposal (with
optional "install" and "env" when needed) or the { "ambiguous" } signal. No prose.`

export const RECIPE_PROMPT_FINGERPRINT = fingerprint(RECIPE_SYSTEM_PROMPT)

/** The ecosystem a discovered manifest belongs to. */
export type ManifestEcosystem = 'js' | 'python' | 'csharp'

/** One recognized manifest, labeled by path + ecosystem, its contents inlined. */
export interface RecipeManifest {
  /** Repo-relative path. */
  path: string
  /** The ecosystem this manifest belongs to. */
  ecosystem: ManifestEcosystem
  /** The manifest's (size-capped) contents. */
  content: string
}

export interface RecipeDiscoveryInput {
  /** The recognized manifests found in the repo, labeled by path + ecosystem. */
  manifests: RecipeManifest[]
  /** Lockfile / build-config files surfaced by presence only (no contents). */
  presentInputs: string[]
  /** When more C# project files exist than were inlined, a note naming the rest. */
  extraProjectNote?: string
  /** On a re-ask after invalid output, the prior output quoted back. */
  correction?: OutputCorrection
  /**
   * On a revision after ENGINE VERIFICATION failed (install/build/entry), the
   * rejected proposal plus the verifier's reason — the model revises the recipe
   * with the failing command's own error in front of it.
   */
  verifyFailure?: { proposal: string; reason: string }
}

export function buildRecipeUserPrompt(input: RecipeDiscoveryInput): string {
  const lines: string[] = [
    'RECOGNIZED MANIFESTS — choose the entrypoint from whichever DECLARES the CLI:',
  ]
  for (const m of input.manifests) {
    lines.push('', `--- [${m.ecosystem}] ${m.path}`, '"""', m.content, '"""')
  }
  if (input.extraProjectNote) lines.push('', input.extraProjectNote)
  lines.push(
    '',
    `Other files present (presence only, no contents): ${input.presentInputs.join(', ') || '(none)'}`,
  )
  if (input.verifyFailure) {
    lines.push(
      '',
      'VERIFICATION FAILURE — the engine ran your previous proposal and it did NOT',
      'work. The proposal was:',
      input.verifyFailure.proposal,
      'The failure (the failing command\'s own output is inside it):',
      input.verifyFailure.reason,
      'Revise the recipe so the failing step succeeds — fix the install/build command',
      'or the entry argv to match what this repo actually supports (e.g. an install',
      'that needs no lockfile, a different build script, the real built path). When',
      'the INSTALL step is what failed and the entry can plausibly run from the tree',
      'as-is (a script-file CLI with no runtime dependencies), OMITTING install',
      'entirely is a valid revision — the engine will verify the entry answers.',
      'Return exactly one revised JSON proposal, or { "ambiguous": "<why>" } if the',
      'failure shows this repo cannot be built non-interactively.',
    )
  }
  if (input.correction) {
    lines.push(
      '',
      'CORRECTION — your previous response was NOT a valid recipe proposal. You returned:',
      input.correction.invalidOutput,
      'Return exactly one JSON object: either a proposal with a non-empty "build"',
      'string and a non-empty "entry" argv that invokes the program under test (never',
      'a shell no-op like "true"), plus optional "install" and "env" —',
      '  { "install": "<optional shell command>", "build": "<shell command>", "entry": ["<argv>", "..."] }',
      '— or { "ambiguous": "<why>" } when no manifest declares a runnable CLI. Nothing else.',
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

# Two-sided claims — both halves must be asserted
When the claim asserts BOTH what the tool DOES and what it does NOT do — a set of
inputs accepted/matched/included AND a set rejected/excluded/left out ("accepts A and
B but not C or D") — BOTH halves are the contract. A scenario that exercises only the
positive half — feeds the included inputs and asserts they appear — is \`weak\`: it
would STILL PASS if the excluded inputs were wrongly accepted too, so the negative
half is never verified. Flag it unless the scenario ALSO exercises the excluded inputs
and asserts their exclusion observably (absent from the output, a distinct exit, a
rejection/error line).

# Confidence (on a flagged verdict)
When you flag, also state how SURE you are the scenario is weak — this decides
whether the system fixes itself or asks a human:
- high — you are certain the scenario is vacuous/weak/miscast (it plainly cannot
  fail if the claimed behavior broke). The system will DISCARD it and re-author once
  automatically; reserve "high" for the clear cases.
- medium — likely weak, but a reasonable reader could disagree.
- low — a mild concern; the scenario may be acceptable.
Omit "confidence" when faithful.

# Output schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition; your reply must
validate against it exactly. Output EXACTLY ONE JSON object, no prose, no fences:
${FIDELITY_JSON_SCHEMA}
Concretely:
  { "verdict": "faithful" }
  { "verdict": "flagged", "confidence": "high", "mismatch": "<one sentence naming what the scenario fails to verify>" }
On "flagged" the "mismatch" is REQUIRED — one sentence stating the gap between what
the claim asserts and what the scenario actually checks — and "confidence" is
REQUIRED (high | medium | low). Omit both when faithful.`

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
    '{ "verdict": "flagged", "confidence": "high|medium|low", "mismatch": "<one sentence>" }.',
  ]
  if (ctx.correction) {
    lines.push(
      '',
      'CORRECTION — your previous response was NOT valid. You returned:',
      ctx.correction.invalidOutput,
      'Return exactly ONE JSON object with a "verdict" of "faithful" or "flagged"',
      '(a one-sentence "mismatch" AND a "confidence" of high|medium|low when flagged),',
      'and NOTHING else.',
    )
  }
  return lines.join('\n')
}
