// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's packages/shared/src/interfaces.ts; delete with the preview.
/**
 * INTERFACES, the code-side unit (WITH WHAT to test), derived deterministically
 * from the app's own surfaces (commands, routes, screens) with no LLM in the loop.
 * What is stored is the CALLING INTERFACE, not a user's path: ONE entry per
 * INVOCABLE THING, one command, one HTTP operation, one web task, each carrying
 * its own contract and its own fingerprint, with a {@link InterfaceSchema.group}
 * naming the family it sits in (the `rules` command tree, the `analyses` route
 * family). Never a tree of commands folded into one entry, and never independent
 * invocations rendered as sequential steps (decided 2026-08-10). A scenario is one
 * spec flow realized through the interfaces its steps actually invoke.
 *
 * Shared (not under `guard/`) because the analyze side renders the same shape.
 * The catalog snapshot lives at `.truecourse/guard/interfaces.json`, gitignored and
 * re-derived from the working tree; the clone-portable part is the interface
 * FINGERPRINTS embedded in scenario YAMLs and the manifest.
 *
 * The step vocabulary is ONE envelope across every surface: a closed union keyed
 * by `kind`, so an api or web extractor lands additively (no new step schema, no
 * format event). An interface's `type` is a driver-registry id, the driver that
 * would execute its scenarios.
 */

import crypto from 'node:crypto'
import { z } from 'zod'
import { GuardDriverIdSchema } from './guard/drivers'
import { GUARD_WEB_ROLES, GUARD_WEB_STATES, GuardWebLocatorSchema } from './guard/web-steps'

/** The closed step vocabulary, shared by every surface. */
export const InterfaceStepKindSchema = z.enum([
  'invoke',
  'request',
  'navigate',
  'input',
  'activate',
])
export type InterfaceStepKind = z.infer<typeof InterfaceStepKindSchema>

/** Run a command (cli / tui): the argv PATH plus the flags that command accepts. */
export const InterfaceInvokeStepSchema = z
  .object({
    kind: z.literal('invoke'),
    /** Argv path of the command, e.g. `["tasks", "add"]`, never the binary path. */
    command: z.array(z.string()).min(1),
    /** Flags the command accepts, e.g. `["--json", "--force"]`. */
    flags: z.array(z.string()).default([]),
    /** Human one-liner for display; cosmetic, never fingerprinted. */
    label: z.string().optional(),
  })
  .strict()

/** One HTTP request (api): the operation's method + path template. */
export const InterfaceRequestStepSchema = z
  .object({
    kind: z.literal('request'),
    method: z.string().min(1),
    /** Path template as the surface declares it, e.g. `/tasks/:id`. */
    path: z.string().min(1),
    label: z.string().optional(),
  })
  .strict()

/** Move to a screen (web / desktop / mobile): the route as the surface declares it. */
export const InterfaceNavigateStepSchema = z
  .object({
    kind: z.literal('navigate'),
    route: z.string().min(1),
    label: z.string().optional(),
  })
  .strict()

/** Put a value into a field, the target as the surface names it. */
export const InterfaceInputStepSchema = z
  .object({
    kind: z.literal('input'),
    target: z.string().min(1),
    label: z.string().optional(),
  })
  .strict()

/** Click / tap / submit, the target as the surface names it. */
export const InterfaceActivateStepSchema = z
  .object({
    kind: z.literal('activate'),
    target: z.string().min(1),
    label: z.string().optional(),
  })
  .strict()

export const InterfaceStepSchema = z.discriminatedUnion('kind', [
  InterfaceInvokeStepSchema,
  InterfaceRequestStepSchema,
  InterfaceNavigateStepSchema,
  InterfaceInputStepSchema,
  InterfaceActivateStepSchema,
])
export type InterfaceInvokeStep = z.infer<typeof InterfaceInvokeStepSchema>
export type InterfaceRequestStep = z.infer<typeof InterfaceRequestStepSchema>
export type InterfaceNavigateStep = z.infer<typeof InterfaceNavigateStepSchema>
export type InterfaceInputStep = z.infer<typeof InterfaceInputStepSchema>
export type InterfaceActivateStep = z.infer<typeof InterfaceActivateStepSchema>
export type InterfaceStep = z.infer<typeof InterfaceStepSchema>

// ---------------------------------------------------------------------------
// NAMED STATES, the per-area registry an interface's state contract points into
// (decided 2026-08-11, replacing the one-sentence prose those fields carried).
// A state is DEFINED ONCE, with an id and one line, and every task that assumes
// or leaves it references that id. Two tasks chain when their ids are EQUAL,
// which is the whole reason the prose went: sentences describing the same world
// two ways can never be matched, and restating each step's side of the handoff
// made the entries unreadable. Within a task the chain is STEP ORDER, so a step
// carries no state of its own.
// ---------------------------------------------------------------------------

/**
 * A state ID, kebab-case, one token (`repo-report-open`, `rule-silenced`). The
 * shape is enforced rather than conventional: an id is compared by equality, and
 * a sentence that slips into the field is a state nothing can ever chain to.
 */
export const InterfaceStateIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'a state id is kebab-case, a sentence is not a state id')
export type InterfaceStateId = z.infer<typeof InterfaceStateIdSchema>

/**
 * One entry of the registry: the id tasks reference, and the ONE line that says
 * what world it names. The description is read by a human (and rendered by the
 * dashboard); nothing matches on it, so rewording it costs nothing.
 */
export const InterfaceStateSchema = z
  .object({
    id: InterfaceStateIdSchema,
    /** The world the id names, one line, never the path taken to reach it. */
    description: z.string().min(1),
  })
  .strict()
export type InterfaceState = z.infer<typeof InterfaceStateSchema>

/** An interface rooted at a cli command, the argv path it starts from. */
export const InterfaceCommandEntrySchema = z
  .object({
    /** Argv path the interface is rooted at, at least one token (a root interface is
     *  rooted at the program's own command name). Never the resolved binary path. */
    command: z.array(z.string()).min(1),
  })
  .strict()
export type InterfaceCommandEntry = z.infer<typeof InterfaceCommandEntrySchema>

/** An interface rooted at an HTTP operation, the method + path template it serves. */
export const InterfaceOperationEntrySchema = z
  .object({
    method: z.string().min(1),
    /** Canonical path template, params in `{name}` form (see `canonicalRoutePath`). */
    path: z.string().min(1),
  })
  .strict()
export type InterfaceOperationEntry = z.infer<typeof InterfaceOperationEntrySchema>

/** The surface-visible root of an interface, typed by the surface that declares it. */
export const InterfaceEntrySchema = z.union([
  InterfaceCommandEntrySchema,
  InterfaceOperationEntrySchema,
])
export type InterfaceEntry = z.infer<typeof InterfaceEntrySchema>

/** One display/identity string for any entry shape, `spec docs` or `GET /todos/{id}`. */
export function interfaceEntryLabel(entry: InterfaceEntry): string {
  return 'command' in entry
    ? entry.command.join(' ')
    : `${entry.method.toUpperCase()} ${entry.path}`
}

// ---------------------------------------------------------------------------
// The interface CONTRACT, the CALLING INTERFACE and nothing else: the full public
// grammar of every command in the tree and each command's input/output as
// STRUCTURED FACTS. Everything below is ADDITIVE and
// OPTIONAL: a catalog that carries only the command tree (the derivation's floor)
// stays valid, and the fields never enter {@link interfaceFingerprint}, grammar
// detail is what a command TAKES, not which command it is, so enriching an interface
// must never roll its identity or re-author a single scenario.
//
// Two absences are distinguished everywhere, and neither is ever guessed:
// an OMITTED field means the extraction established nothing; an EMPTY array
// means it established "none". A fact a probe could not settle is recorded
// as {@link INTERFACE_UNKNOWN}.
// ---------------------------------------------------------------------------

/** A fact the extraction and its probes could not establish, recorded, never guessed. */
export const INTERFACE_UNKNOWN = 'unknown'

/** Where an option is passed: on the command itself, or before it (program-level). */
export const InterfaceOptionScopeSchema = z.enum(['command', 'program'])
export type InterfaceOptionScope = z.infer<typeof InterfaceOptionScopeSchema>

/** One flag of a command's grammar, with everything a caller must know to pass it. */
export const InterfaceOptionSchema = z
  .object({
    /** The long form as a user types it (`--severity`); the short form when there is no long one. */
    flag: z.string().min(1),
    /** The short alias, when the command registers one (`-h`). */
    short: z.string().min(1).optional(),
    /** Whether the flag carries a value at all. */
    takesValue: z.boolean(),
    /** Whether that value is mandatory (as opposed to an optional `[value]`). */
    valueRequired: z.boolean(),
    /** The value placeholder help prints, `n`, `mode`, `list`. */
    valueHint: z.string().min(1).optional(),
    /** The closed value set, when the grammar declares one. */
    choices: z.array(z.string()).optional(),
    /** What applies when the flag is absent, as the registration declares it. */
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    scope: InterfaceOptionScopeSchema.optional(),
    /** Registered but withheld from help output. */
    hidden: z.boolean().optional(),
    description: z.string().optional(),
  })
  .strict()
export type InterfaceOption = z.infer<typeof InterfaceOptionSchema>

/** One positional argument of a command. */
export const InterfacePositionalSchema = z
  .object({
    name: z.string().min(1),
    required: z.boolean(),
    /** Consumes the rest of the argv (`<files...>`). */
    variadic: z.boolean().optional(),
    description: z.string().optional(),
  })
  .strict()
export type InterfacePositional = z.infer<typeof InterfacePositionalSchema>

/**
 * The IO CONTRACT is structured FACTS, never prose. Each entry is a thing a
 * scenario can act on: a marker to assert, a row shape to read values out of, an
 * exit status to expect, a path to check, a variable to set, a question to
 * answer. The only free text anywhere is the marker and the row template (both
 * text the program really prints) and `when`, ONE short condition, not a
 * description. A fact that cannot be stated in one of these shapes is not
 * contract material at all: the artifact is 100% structured facts, so there is
 * nowhere for a sentence about behavior to go.
 */

/** Which stream a marker appears on. `combined` = the interleaved pair. */
export const InterfaceStreamSchema = z.enum(['stdout', 'stderr', 'combined'])
export type InterfaceStream = z.infer<typeof InterfaceStreamSchema>

/**
 * One output fact: a STABLE SUBSTRING the command writes to a stream. The marker
 * is what a scenario matches on, so it carries the invariant part only, never a
 * rendered value, a count, or a path that moves between runs.
 */
export const InterfaceOutputFactSchema = z
  .object({
    stream: InterfaceStreamSchema,
    /** The stable substring, as the program prints it. */
    marker: z.string().min(1),
    /** The one condition under which it appears. */
    when: z.string().min(1).optional(),
  })
  .strict()
export type InterfaceOutputFact = z.infer<typeof InterfaceOutputFactSchema>

/**
 * Where a line sits in an enumerated block. A `row` is printed once PER ITEM (so
 * a scenario counts them, or samples one); a `header` and a `footer` are printed
 * once, before and after them. Nothing here claims a block HAS rows, a command
 * that totals a set without listing it prints the footer alone, and its `when`
 * says so.
 */
export const InterfaceRowRoleSchema = z.enum(['header', 'row', 'footer'])
export type InterfaceRowRole = z.infer<typeof InterfaceRowRoleSchema>

/**
 * The value vocabulary a template slot draws from, three members, deliberately:
 *
 *  - `count`, an integer the program renders (`2 shown`, `of 15 violations`).
 *  - `enum`, one of a CLOSED set the program can print, carried in `values`.
 *  - `text`, anything else the program renders into the line: a name, a title,
 *    or a variable-length sub-list it formats itself (`1 critical, 6 high`).
 *
 * A fourth member would have to be established by something, and nothing
 * establishes it: a probe sees an integer, a closed set, or a string.
 */
export const InterfaceSlotKindSchema = z.enum(['count', 'enum', 'text'])
export type InterfaceSlotKind = z.infer<typeof InterfaceSlotKindSchema>

/**
 * One value slot of a row template. `values` belongs to `enum` and only to it:
 * an enum without its set says no more than `text` does, and a set on a count or
 * a free string would be a claim nobody established.
 */
export const InterfaceRowSlotSchema = z
  .object({
    /** The slot's name, as it appears between angle brackets in the template. */
    name: z.string().min(1),
    kind: InterfaceSlotKindSchema,
    /** The closed value set, required for `enum`, rejected for the others. */
    values: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .superRefine((slot, ctx) => {
    if (slot.kind === 'enum' && !slot.values) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['values'], message: 'an `enum` slot must carry its value set' })
    }
    if (slot.kind !== 'enum' && slot.values) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['values'], message: '`values` belongs to an `enum` slot only' })
    }
  })
export type InterfaceRowSlot = z.infer<typeof InterfaceRowSlotSchema>

/** Every `<name>` a template names, in order, duplicates included. */
function templateSlotNames(template: string): string[] {
  return [...template.matchAll(/<([^<>]*)>/g)].map((match) => match[1])
}

/**
 * The template↔slots agreement rule, shared by every row-grammar fact (the cli
 * row fact and the web rows readable): every `<name>` declared, every declared
 * slot used, no slot declared twice, so a template can never promise a value the
 * slots do not describe, and a slot can never describe a value the line does not
 * print.
 */
function rowGrammarIssues(
  fact: { template: string; slots: readonly InterfaceRowSlot[] },
  ctx: z.RefinementCtx,
): void {
  const declared = fact.slots.map((slot) => slot.name)
  const duplicate = declared.find((name, i) => declared.indexOf(name) !== i)
  if (duplicate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['slots'], message: `slot \`${duplicate}\` is declared twice` })
  }
  const used = templateSlotNames(fact.template)
  for (const name of used) {
    if (!declared.includes(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['template'],
        message: `template names \`<${name}>\`, which no slot declares`,
      })
    }
  }
  for (const name of declared) {
    if (!used.includes(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['slots'],
        message: `slot \`${name}\` never appears in the template`,
      })
    }
  }
}

/**
 * One ROW-GRAMMAR fact: the SHAPE of a line of enumerated or tabular output -
 * the literal text the program prints with its varying parts named as `<slot>`
 * placeholders, plus what each slot may hold. This is the one fact kind that
 * describes a line a scenario cannot match verbatim, because every run renders
 * different values into it.
 *
 * It does NOT replace an output fact: a marker is the invariant SUBSTRING a
 * scenario matches on, a template is the whole line's grammar around it. A
 * command with both carries both, and they are read together, match the marker,
 * read the shape to know what varies and what it may vary over.
 *
 * ONE kind covers every shape, because the shapes differ only in three ways:
 * where the line sits (`role`), what the literal text is (`template`), and what
 * the slots hold (`slots`). A per-shape fact kind would be six copies of this
 * one with the literals baked in, and every new listing in the program would
 * need a seventh.
 *
 * The template and its slots must agree exactly, every `<name>` declared, every
 * declared slot used, so a template can never promise a value the slots do not
 * describe, and a slot can never describe a value the line does not print.
 */
export const InterfaceRowFactSchema = z
  .object({
    role: InterfaceRowRoleSchema,
    stream: InterfaceStreamSchema,
    /** The line as printed, varying parts written `<name>`; no leading indent. */
    template: z.string().min(1),
    /** Every slot the template names. At least one, a line with none is a marker. */
    slots: z.array(InterfaceRowSlotSchema).min(1),
    /** The one condition the line appears under. */
    when: z.string().min(1).optional(),
  })
  .strict()
  .superRefine(rowGrammarIssues)
export type InterfaceRowFact = z.infer<typeof InterfaceRowFactSchema>

/**
 * One exit fact. The status is a STRING so {@link INTERFACE_UNKNOWN} is sayable:
 * a status neither the extraction nor a probe settled is recorded, never rounded
 * to a plausible 0 or 1. One fact per CONDITION, a code reached three ways is
 * three facts, because a scenario asserts one of them at a time.
 */
export const InterfaceExitFactSchema = z
  .object({
    /** The status, or {@link INTERFACE_UNKNOWN}. */
    exit: z.string().min(1),
    when: z.string().min(1).optional(),
  })
  .strict()
export type InterfaceExitFact = z.infer<typeof InterfaceExitFactSchema>

/** One path the command writes, the file assertion a scenario reads off. */
export const InterfaceWriteFactSchema = z
  .object({
    path: z.string().min(1),
    when: z.string().min(1).optional(),
  })
  .strict()
export type InterfaceWriteFact = z.infer<typeof InterfaceWriteFactSchema>

/**
 * One path or state the command READS, the mirror of {@link InterfaceWriteFactSchema},
 * and the other half of the calling interface: an author seeds a file precisely
 * because the command reads it. `path` is the subject as the surface names it (a
 * store file, a config, or the state a scenario must arrange, a git index, a
 * working tree); `when` is the ONE condition it is read under.
 */
export const InterfaceReadFactSchema = z
  .object({
    path: z.string().min(1),
    when: z.string().min(1).optional(),
  })
  .strict()
export type InterfaceReadFact = z.infer<typeof InterfaceReadFactSchema>

/** One environment variable the command reads, something a scenario must set. */
export const InterfaceEnvFactSchema = z
  .object({
    var: z.string().min(1),
    when: z.string().min(1).optional(),
  })
  .strict()
export type InterfaceEnvFact = z.infer<typeof InterfaceEnvFactSchema>

/** How a question is answered, which is how a TTY step must script its answer. */
export const InterfacePromptKindSchema = z.enum(['confirm', 'select', 'text'])
export type InterfacePromptKind = z.infer<typeof InterfacePromptKindSchema>

/**
 * How an answer is SUBMITTED, the keystroke that ends it, and the one thing a
 * scripted TTY answer has to get right. The vocabulary is the two delivery
 * classes the runner's terminal layer actually has (`guard-runner/src/pty.ts`),
 * and no more:
 *
 *  - `enter`, the answer is a value followed by the ENTER key. The pty layer
 *    types it on its own turn, because a carriage return only survives once the
 *    prompt has raw mode on; before that the line discipline rewrites it.
 *  - `char`, a single printable keypress IS the answer and submits it, with no
 *    Enter at all (a `y`/`n` confirm). The answer splitter keeps such a fragment
 *    as an answer of its own.
 *
 * OMITTED means the extraction established nothing, per the rule above, never
 * a plausible default, because a select answered as if it were a keypress hangs
 * the step and a keypress answered with a trailing Enter answers the NEXT
 * question too.
 */
export const InterfacePromptSubmitSchema = z.enum(['enter', 'char'])
export type InterfacePromptSubmit = z.infer<typeof InterfacePromptSubmitSchema>

/**
 * One question the command asks on stdin. `marker` is the question's stable
 * substring (what a scenario waits for), `answerHint` the choices or default the
 * program offers, `submit` how the answer is delivered. An EMPTY prompt list is
 * the established "never asks anything".
 */
export const InterfacePromptFactSchema = z
  .object({
    kind: InterfacePromptKindSchema,
    /** The stable substring of the question, as the program words it. */
    marker: z.string().min(1),
    /** The offered answers or default, what a scripted answer picks from. */
    answerHint: z.string().min(1).optional(),
    /** The keystroke that submits the answer, see {@link InterfacePromptSubmitSchema}. */
    submit: InterfacePromptSubmitSchema.optional(),
    when: z.string().min(1).optional(),
  })
  .strict()
export type InterfacePromptFact = z.infer<typeof InterfacePromptFactSchema>

/**
 * The earlier ANSWER that reveals a later question. `prompt` is that earlier
 * question's marker (it must already have been asked, a sequence never points
 * forward), `answer` the answer CLASS that opens this branch, drawn from the
 * vocabulary the earlier prompt itself offers: `yes`/`no` on a confirm (the only
 * two answers it has, and the schema holds it to them), otherwise a value out of
 * that prompt's `answerHint`, one option (`bedrock`), or the closed set of
 * options that lead the same way (`anthropic | openai | copilot`).
 */
export const InterfaceSequenceBranchSchema = z
  .object({
    prompt: z.string().min(1),
    answer: z.string().min(1),
  })
  .strict()
export type InterfaceSequenceBranch = z.infer<typeof InterfaceSequenceBranchSchema>

/**
 * One question of the dialogue, in the position it is asked. It carries no facts
 * of its own: `prompt` names one of the command's own {@link InterfacePromptFactSchema}
 * entries by marker and `kind` restates how that one is answered, so a reader (or
 * a generator scripting the answers) never has to hold two lists side by side.
 * The prompt fact keeps saying WHAT the question is and the STATE it is asked
 * under (`when`); the node says WHEN IN THE RUN it arrives and, through
 * {@link InterfaceSequenceBranchSchema}, which earlier answer reveals it.
 *
 * `repeats` is the ONE condition the question is re-asked under, the same
 * one-short-condition rule `when` obeys. A question asked in a loop appears ONCE,
 * carrying that condition: listing it twice would leave a branch that names it
 * pointing at two positions, and the sequence resolves branches by marker.
 */
export const InterfaceSequenceNodeSchema = z
  .object({
    /** The question, by the `marker` of the command's own prompt fact. */
    prompt: z.string().min(1),
    /** How it is answered, the same vocabulary that prompt fact uses. */
    kind: InterfacePromptKindSchema,
    /** The earlier answer that reveals it. Absent = asked on the main run. */
    after: InterfaceSequenceBranchSchema.optional(),
    /** The one condition it is re-asked under, when it sits in a loop. */
    repeats: z.string().min(1).optional(),
  })
  .strict()
export type InterfaceSequenceNode = z.infer<typeof InterfaceSequenceNodeSchema>

/**
 * The QUESTION SEQUENCE of an interactive command: its questions in the order
 * they arrive, branching where a question is revealed by a particular earlier
 * answer. This is what makes an interactive command scriptable from the interface
 * alone, a generator writes the scripted answers without first running it.
 *
 * The array order is ARRIVAL order: no question below is asked before a question
 * above it. Two questions that cannot both arise (their prompt facts carry
 * exclusive `when`s, "a skill is missing" against "a skill was updated") are
 * still listed in the order they would arrive; the order between them is vacuous
 * rather than a claim, because at most one of them ever appears.
 *
 * {@link INTERFACE_UNKNOWN} is a first-class value: a dialogue the extraction could
 * not establish is an interface the mapper still OWES, and saying so is the whole
 * point, a plausible order invented here scripts a scenario into a hang.
 */
export const InterfaceSequenceSchema = z.union([
  z.literal(INTERFACE_UNKNOWN),
  z
    .array(InterfaceSequenceNodeSchema)
    .min(1)
    .superRefine((nodes, ctx) => {
      const seen = new Set<string>()
      nodes.forEach((node, i) => {
        if (seen.has(node.prompt)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i, 'prompt'],
            message: `\`${node.prompt}\` is already in the sequence, a re-ask is \`repeats\`, not a second node`,
          })
        }
        // Checked BEFORE this node joins the set, so `after` can never name it.
        if (node.after && !seen.has(node.after.prompt)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i, 'after', 'prompt'],
            message: `\`${node.after.prompt}\` is not asked before this question, a branch points backward`,
          })
        }
        seen.add(node.prompt)
      })
    }),
])
export type InterfaceSequence = z.infer<typeof InterfaceSequenceSchema>

/**
 * What a command takes in BEYOND its argv, the grammar above already says what
 * it accepts on the command line, so nothing here repeats it. What remains is
 * what a scenario must supply from outside: the questions it must answer, the
 * variables it must set, and the files and state it must seed.
 */
export const InterfaceConsumesSchema = z
  .object({
    prompts: z.array(InterfacePromptFactSchema).optional(),
    env: z.array(InterfaceEnvFactSchema).optional(),
    reads: z.array(InterfaceReadFactSchema).optional(),
  })
  .strict()
export type InterfaceConsumes = z.infer<typeof InterfaceConsumesSchema>

/** What a command puts out, the assertion targets, straight from the surface. */
export const InterfaceProducesSchema = z
  .object({
    output: z.array(InterfaceOutputFactSchema).optional(),
    /** The shape of its enumerated / tabular lines, see {@link InterfaceRowFactSchema}. */
    rows: z.array(InterfaceRowFactSchema).optional(),
    exits: z.array(InterfaceExitFactSchema).optional(),
    writes: z.array(InterfaceWriteFactSchema).optional(),
  })
  .strict()
export type InterfaceProduces = z.infer<typeof InterfaceProducesSchema>

/** A command's input/output contract. */
export const InterfaceIoSchema = z
  .object({
    consumes: InterfaceConsumesSchema.optional(),
    produces: InterfaceProducesSchema.optional(),
  })
  .strict()
export type InterfaceIo = z.infer<typeof InterfaceIoSchema>

/**
 * One command of the tree: its grammar, its io, facts, never prose, and, for an
 * interactive one, the order its questions arrive in.
 *
 * The SEQUENCE is a region of its own, deliberately NOT an io fact. An io fact is
 * a discrete thing a scenario acts on (a marker to assert, a path to seed, a
 * question to answer); the sequence introduces none, it is the ORDER over
 * questions `io.consumes.prompts` already carries. Folding it into the io would
 * count every question twice and put a non-fact inside the facts-only region.
 *
 * It is cross-validated against those prompts, because a sequence that names a
 * question the command does not ask is not an ordering of anything: every node
 * must name one of them, with the kind that prompt records, and a sequence is
 * refused outright on a command whose prompt list is absent (nothing to order
 * yet) or established as EMPTY (no dialogue exists, so `unknown` would be a
 * dialogue claimed where the extraction proved there is none).
 */
export const InterfaceCommandContractSchema = z
  .object({
    /** The argv a user types, program name first, `["truecourse","rules","list"]`. */
    path: z.array(z.string()).min(1),
    description: z.string().optional(),
    options: z.array(InterfaceOptionSchema).optional(),
    positionals: z.array(InterfacePositionalSchema).optional(),
    /** Subcommands this command registers, in registration order. */
    subcommands: z.array(z.string()).optional(),
    io: InterfaceIoSchema.optional(),
    /** The question sequence, see {@link InterfaceSequenceSchema}. */
    sequence: InterfaceSequenceSchema.optional(),
  })
  .strict()
  .superRefine((command, ctx) => {
    if (command.sequence === undefined) return
    const refuse = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sequence'], message })

    const prompts = command.io?.consumes?.prompts
    if (prompts === undefined) {
      refuse('a sequence orders the command’s prompts, and none are established')
      return
    }
    if (prompts.length === 0) {
      refuse('this command is established as asking nothing, there is no dialogue to order')
      return
    }
    if (command.sequence === INTERFACE_UNKNOWN) return

    const byMarker = new Map(prompts.map((prompt) => [prompt.marker, prompt]))
    command.sequence.forEach((node, i) => {
      const prompt = byMarker.get(node.prompt)
      if (!prompt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sequence', i, 'prompt'],
          message: `\`${node.prompt}\` is not a question this command asks`,
        })
        return
      }
      if (prompt.kind !== node.kind) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sequence', i, 'kind'],
          message: `\`${node.prompt}\` is answered as a \`${prompt.kind}\`, not a \`${node.kind}\``,
        })
      }
      if (!node.after) return
      const earlier = byMarker.get(node.after.prompt)
      if (!earlier) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sequence', i, 'after', 'prompt'],
          message: `\`${node.after.prompt}\` is not a question this command asks`,
        })
        return
      }
      // A confirm has exactly two answers, so a branch off one says which.
      if (earlier.kind === 'confirm' && node.after.answer !== 'yes' && node.after.answer !== 'no') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sequence', i, 'after', 'answer'],
          message: `a confirm is answered \`yes\` or \`no\`, \`${node.after.answer}\` is neither`,
        })
      }
    })
  })
export type InterfaceCommandContract = z.infer<typeof InterfaceCommandContractSchema>

// ---------------------------------------------------------------------------
// THE API OPERATION CONTRACT, the api surface's own half of the union below,
// written in HTTP's vocabulary (2026-08-14, the SOM restructure). Before it, an
// api interface's contract wore a cli COSTUME: the operation's identity rode in
// a command `path` of `["GET", "/x"]`, response-body markers were `stream:
// "stdout"` output facts, and HTTP statuses were `exit` codes. Nothing read it
// back as HTTP, and the request half (the body/query fields the handler reads)
// could not live here at all, it travelled beside the catalog as a separate
// analysis product, joined at prompt time.
//
// The fact KINDS are reused wholesale, because they were never cli-specific: an
// env var, a read path, a written path and the row grammar say the same thing on
// a server that they say in a terminal. What changes is the three that were
// costume, a status is a status, a response-body marker has no stream, and what
// a handler reads off the request is a first-class region.
// ---------------------------------------------------------------------------

/**
 * One field an operation reads off the request, the shape of
 * `RequestField` (the analyzer's product, which is exactly what the mapper
 * merges in) WIDENED by the descriptive fields a hand-authored contract can
 * establish and a static derivation cannot: the placeholder a value takes, the
 * closed set it is drawn from, what applies when it is absent, and the one line
 * that says what it is. Every widening is OPTIONAL, so a derived
 * `{ name, required }` is a valid field here and the mapper writes exactly what
 * it read, the widening never asks the derivation for something it does not
 * have.
 *
 * `required: 'unknown'` keeps its meaning verbatim: the field is read, and
 * nothing established whether it may be absent. That is not `false`.
 */
export const InterfaceRequestFieldSchema = z
  .object({
    name: z.string().min(1),
    required: z.union([z.boolean(), z.literal('unknown')]),
    /** The value placeholder, when the surface names one, `uuid`, `absolute path`. */
    hint: z.string().min(1).optional(),
    /** The closed value set, when the surface declares one. */
    choices: z.array(z.string()).optional(),
    /** What applies when the field is absent, as the surface declares it. */
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    /**
     * The field may be given more than once and the operation reads them all -
     * a repeated query parameter (`?tag=a&tag=b`), a repeatable multipart part.
     * The api analog of a cli positional's `variadic`: it changes how a caller
     * WRITES the field, so a scenario that sends one value where the operation
     * expects a list is wrong in a way no other field property would catch.
     */
    repeatable: z.boolean().optional(),
    description: z.string().optional(),
  })
  .strict()
export type InterfaceRequestField = z.infer<typeof InterfaceRequestFieldSchema>

/**
 * What an operation takes IN, split by where the caller puts it: `params` in the
 * path template, `query` in the query string, `headers` in the request headers,
 * `body` in the request body. Four arrays rather than one list with a `in:` tag,
 * because the four are addressed differently by every caller and a scenario has
 * to know which is which.
 *
 * `headers` joined the other three on 2026-08-17, having been missed when this
 * region was written: the corpus it was validated against was cli-heavy, and the
 * three hand-authored api corpora turned out to carry 305 of them, more than
 * they carry query parameters. They are not all credentials. Strapi alone
 * declares `Authorization` on every one of its 55 operations, and beside it
 * `Content-Type`, `Accept`, `MCP-Protocol-Version`, a session id and two vendor
 * toggles: content negotiation and protocol versioning are request inputs a
 * caller gets wrong at the same cost as a missing body field.
 *
 * `Authorization` is a header here and nothing more. WHICH secret fills it is the
 * recipe's `provides.credentials` to say and a scenario's `${credential:…}` to
 * write, naming it twice would give one fact two sources.
 *
 * There is deliberately no `multipart` region. The split is by WHERE a caller
 * puts a value, not by how it is encoded, and a multipart part is in the body -
 * that the body is multipart is what its `Content-Type` header says. A fifth
 * region would only make "is a part a body field?" ambiguous, and it is one.
 *
 * The absence rule of the contract region applies per array: OMITTED means the
 * extraction established nothing there, EMPTY means it established "none".
 */
export const InterfaceApiRequestSchema = z
  .object({
    /** Path-template parameters, the `{name}`s of the entry's own path. */
    params: z.array(InterfaceRequestFieldSchema).optional(),
    query: z.array(InterfaceRequestFieldSchema).optional(),
    /** Request headers, `Authorization`, `Content-Type`, whatever the operation reads. */
    headers: z.array(InterfaceRequestFieldSchema).optional(),
    body: z.array(InterfaceRequestFieldSchema).optional(),
  })
  .strict()
export type InterfaceApiRequest = z.infer<typeof InterfaceApiRequestSchema>

/**
 * What an operation's SERVER SIDE consumes, the same two fact kinds a command
 * consumes, and for the same reason: an author seeds a file (or exports a
 * variable) precisely because the handler reads it. There are no `prompts`: an
 * HTTP handler asks nobody anything, and a field that could never be filled
 * would be a region claiming a dialogue exists.
 */
export const InterfaceApiConsumesSchema = z
  .object({
    env: z.array(InterfaceEnvFactSchema).optional(),
    reads: z.array(InterfaceReadFactSchema).optional(),
  })
  .strict()
export type InterfaceApiConsumes = z.infer<typeof InterfaceApiConsumesSchema>

/**
 * One RESPONSE STATUS the operation answers with. A STRING for the same reason
 * an exit status is one, {@link INTERFACE_UNKNOWN} has to be sayable, and one
 * fact per CONDITION, because a 404 reached two ways is two facts a scenario
 * asserts one at a time.
 */
export const InterfaceApiStatusFactSchema = z
  .object({
    /** The HTTP status as a string (`"200"`, `"404"`), or {@link INTERFACE_UNKNOWN}. */
    status: z.string().min(1),
    when: z.string().min(1).optional(),
  })
  .strict()
export type InterfaceApiStatusFact = z.infer<typeof InterfaceApiStatusFactSchema>

/**
 * One RESPONSE-BODY marker: a stable substring of what the operation writes back
 * (a JSON key, an error code, a literal the body always carries). The cli output
 * fact minus its `stream`, which is the only cli-specific thing about it, a
 * response has one body, so naming a stream said nothing.
 */
export const InterfaceApiBodyFactSchema = z
  .object({
    /** The stable substring, as the response really carries it. */
    marker: z.string().min(1),
    when: z.string().min(1).optional(),
  })
  .strict()
export type InterfaceApiBodyFact = z.infer<typeof InterfaceApiBodyFactSchema>

/**
 * One ROW-GRAMMAR fact of a response, {@link InterfaceRowFactSchema} with the
 * stream dropped, sharing the identical template↔slots agreement rule. A
 * collection endpoint's item shape is the same claim a listing command's row
 * shape is, so it is the same grammar and not a second one.
 */
export const InterfaceApiRowFactSchema = z
  .object({
    role: InterfaceRowRoleSchema,
    /** The item as rendered, varying parts written `<name>`. */
    template: z.string().min(1),
    slots: z.array(InterfaceRowSlotSchema).min(1),
    when: z.string().min(1).optional(),
  })
  .strict()
  .superRefine(rowGrammarIssues)
export type InterfaceApiRowFact = z.infer<typeof InterfaceApiRowFactSchema>

/** What an operation puts out, the assertion targets, in HTTP's own words. */
export const InterfaceApiProducesSchema = z
  .object({
    statuses: z.array(InterfaceApiStatusFactSchema).optional(),
    body: z.array(InterfaceApiBodyFactSchema).optional(),
    /** The shape of the response's repeated items, see {@link InterfaceApiRowFactSchema}. */
    rows: z.array(InterfaceApiRowFactSchema).optional(),
    /** Paths the handler writes, the same fact a command's writes are. */
    writes: z.array(InterfaceWriteFactSchema).optional(),
  })
  .strict()
export type InterfaceApiProduces = z.infer<typeof InterfaceApiProducesSchema>

/**
 * ONE HTTP operation's contract. It carries NO method and NO path: the
 * interface's own {@link InterfaceSchema.entry} is the operation's identity, and
 * a second copy here could only drift from it, the references-not-copies rule
 * the whole file runs on. (The cli member's `command.path` is the one deliberate
 * exception, kept because it predates the rule and moving it would re-author
 * nothing while churning every catalog.)
 */
export const InterfaceOperationContractSchema = z
  .object({
    description: z.string().optional(),
    request: InterfaceApiRequestSchema.optional(),
    consumes: InterfaceApiConsumesSchema.optional(),
    produces: InterfaceApiProducesSchema.optional(),
  })
  .strict()
export type InterfaceOperationContract = z.infer<typeof InterfaceOperationContractSchema>

/**
 * The interface's public contract: the full calling grammar of the ONE invocable
 * thing this entry is, in the vocabulary of ITS OWN SURFACE, and NOTHING about
 * the contract itself. There is no shared block (a fact every command inherits
 * is carried by each command that has it, so one entry's contract is the whole
 * answer), no provenance, no behavior prose (a sentence a fact kind cannot carry
 * is not stored at all), and no doc-versus-code diagnostics, discrepancies the
 * mapper finds are run reporting, never stored interface data. Every field here
 * is a field the derivation must be able to produce.
 *
 * A DISCRIMINATED UNION on `surface` (2026-08-14), which is the whole point: an
 * api operation used to be described as a command whose argv was
 * `["GET", "/x"]`, so a reader, and a prompt, and the dashboard, had to decode
 * a costume before it could say anything true about HTTP. Each surface now says
 * what it is in its own words, the union stays closed, and a `web` member lands
 * ADDITIVELY when there is a claim readables cannot carry (deliberately absent
 * today: a web task's contract IS its resource's readables plus the capture
 * vocabulary, and a member invented ahead of a claim would be a shape nothing
 * fills).
 *
 * `surface` must equal the interface's own `type`, cross-checked in
 * {@link InterfacesFileSchema}, because a contract describing another surface's
 * grammar is not a contract for this entry at all.
 *
 * The cli member carries exactly ONE command, singular: one entry is one
 * invocable thing (2026-08-10), so the array this field used to be has been
 * exactly one element long ever since, and the tree lives in the catalog as
 * sibling entries sharing a {@link InterfaceSchema.group} and a
 * {@link InterfaceSchema.resource}.
 */
export const InterfaceCliContractSchema = z
  .object({
    surface: z.literal('cli'),
    /** One line on what this interface covers. */
    summary: z.string().optional(),
    command: InterfaceCommandContractSchema,
  })
  .strict()
export type InterfaceCliContract = z.infer<typeof InterfaceCliContractSchema>

export const InterfaceApiContractSchema = z
  .object({
    surface: z.literal('api'),
    summary: z.string().optional(),
    operation: InterfaceOperationContractSchema,
  })
  .strict()
export type InterfaceApiContract = z.infer<typeof InterfaceApiContractSchema>

export const InterfaceContractSchema = z.discriminatedUnion('surface', [
  InterfaceCliContractSchema,
  InterfaceApiContractSchema,
])
export type InterfaceContract = z.infer<typeof InterfaceContractSchema>

// ---------------------------------------------------------------------------
// RESOURCES, the PLACES of a stateful surface, defined once per area
// (decided 2026-08-12). A web task acts somewhere: a screen, a dialog, a panel.
// Before this region that somewhere was smeared across the catalog, a `group`
// naming a family, and a states registry where most entries were really
// locations (`rules-panel-open` is not a world, it is a place). A resource is
// the place made first-class: WHERE a task happens, WHAT can be read off it,
// and, through the interfaces' own `at`/`to`, how a user gets there.
//
// The unit of IDENTITY does not move: an interface stays one invocable thing
// with its own fingerprint (the 2026-08-10 decision), and nothing in this
// region is ever fingerprinted. A resource is the ENVELOPE, the rendering,
// grounding and reading unit, so the catalog can present a medium number of
// medium-sized resources while drift stays per-interaction.
//
// READABLES are the web analog of the cli io facts: structured facts about what
// a resource visibly shows, in the vocabulary the web driver already asserts
// (`web-steps.ts`) so the generator can compile them to `expect` blocks instead
// of inventing assertions from doc prose, and the visual judge can be handed
// "what this screen is supposed to show". The contract region's absence rule
// applies verbatim: an OMITTED array means the extraction established nothing,
// an EMPTY one established "none", and nothing here is ever guessed.
//
// Every readable takes an optional `id` from day one, deliberately unused by
// anything yet: it is the name a later capture step (`read the header into
// ${captured:…}`) or count assertion will reference, reserved now so those land
// additively, no second format event.
// ---------------------------------------------------------------------------

/**
 * A resource id, kebab-case, one token (`repo-report`, `rules-dialog`), the same
 * enforced shape a state id has and for the same reason: `at`/`to` resolve by
 * equality, and a sentence that slips into the field is a place nothing can
 * ever arrive at.
 */
export const InterfaceResourceIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'a resource id is kebab-case, a sentence is not a resource id')
export type InterfaceResourceId = z.infer<typeof InterfaceResourceIdSchema>

/**
 * What KIND of place it is, per surface, the vocabulary of places a surface
 * HAS, never of the widgets one contains (a dropdown is a control of its
 * resource, never a resource):
 *
 *  - web: a `screen` owns an address (a navigate step reaches it), a `dialog`
 *    opens over one and blocks it, a `panel` is a region of one that swaps in
 *    without leaving it.
 *  - cli: a `command-group` is a node of the command tree, the `spec` family,
 *    the `spec docs` family under it. Its actions are the commands registered in
 *    it; its `of` is the group it is registered under.
 *  - api: a `rest-noun` is the thing a path names, `/api/repos`, and
 *    `/api/repos/{id}/analyses` under it. Its actions are the operations rooted
 *    at it (its own, and those of its instances); its `of` is the enclosing noun.
 *
 * Extended from three to five 2026-08-14: resources were introduced for the web
 * surface, where "where does this happen" had nowhere else to live, but the
 * envelope was never web-specific, a command tree and a REST path are the same
 * "a medium number of medium-sized places, each holding its interactions", and
 * the cli/api surfaces were reading as flat lists of 60-odd entries for want of
 * one. READABLES stay web vocabulary: they are DOM facts, so a cli or api
 * resource simply carries none (omitted, per the absence rule) rather than
 * pretending at an analog.
 */
export const InterfaceResourceKindSchema = z.enum([
  'screen',
  'dialog',
  'panel',
  'command-group',
  'rest-noun',
])
export type InterfaceResourceKind = z.infer<typeof InterfaceResourceKindSchema>

/**
 * A readable's name, same enforced kebab-case as every id here. Optional on
 * every readable, and referenced by NOTHING yet (see the region header): it
 * exists so a future capture/count vocabulary can point at one fact without a
 * format change.
 */
export const InterfaceReadableIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'a readable id is kebab-case')
export type InterfaceReadableId = z.infer<typeof InterfaceReadableIdSchema>

/**
 * One TEXT MARKER a resource shows: a stable visible substring, as the page
 * renders it, never a value, a count, or anything that moves between runs
 * (the varying lines belong to {@link InterfaceRowsReadableSchema}). `within`
 * scopes it to one element the way a web expectation's `within` does; omitted
 * means the resource's whole surface. Compiles to `expect: { within, text }`.
 */
export const InterfaceMarkerReadableSchema = z
  .object({
    id: InterfaceReadableIdSchema.optional(),
    /** The element the text is read from; omitted ⇒ anywhere on the resource. */
    within: GuardWebLocatorSchema.optional(),
    /** The stable substring, as the page renders it. */
    marker: z.string().min(1),
    /** The one condition it appears under. */
    when: z.string().min(1).optional(),
  })
  .strict()
export type InterfaceMarkerReadable = z.infer<typeof InterfaceMarkerReadableSchema>

/**
 * One NON-INTERACTIVE element the resource renders, as a user finds it: role +
 * accessible name (`getByRole` semantics, the locator the driver already uses).
 * The plainest readable, "the thing is there", for elements whose accessible
 * name never appears in the page's text (an `aria-label`led region, a heading).
 * Controls are NOT listed here: what can be clicked is the interactions'
 * business, and a control worth declaring facts about goes in `controls`.
 * Compiles to `expect.visible`.
 */
export const InterfaceElementReadableSchema = z
  .object({
    id: InterfaceReadableIdSchema.optional(),
    element: GuardWebLocatorSchema,
    when: z.string().min(1).optional(),
  })
  .strict()
export type InterfaceElementReadable = z.infer<typeof InterfaceElementReadableSchema>

/**
 * One CONTROL and the ARIA states it EXPOSES, the readable with no cli analog,
 * and the missing grounding for the driver's state assertions: the expect
 * vocabulary can already assert `checked | pressed | selected | expanded |
 * disabled`, but nothing told the generator WHICH controls expose WHICH states,
 * so it could never safely write one. This fact is that answer, per control.
 * These are exactly the facts with no text form, a toggle's position renders
 * as a colour, and only the state assertion states it honestly.
 *
 * `states` declares exposure, never a value: which position the switch is in
 * belongs to a scenario's assertion, not to the catalog.
 */
export const InterfaceControlReadableSchema = z
  .object({
    id: InterfaceReadableIdSchema.optional(),
    control: GuardWebLocatorSchema,
    /** The ARIA states this control exposes, the driver's own closed set. */
    states: z.array(z.enum(GUARD_WEB_STATES)).min(1),
    when: z.string().min(1).optional(),
  })
  .strict()
  .refine((fact) => new Set(fact.states).size === fact.states.length, {
    path: ['states'],
    message: 'a state is declared once',
  })
export type InterfaceControlReadable = z.infer<typeof InterfaceControlReadableSchema>

/**
 * One ROW-GRAMMAR readable: the shape of a REPEATED structure the resource
 * renders, a violation card, a rule row, a repo list item, as the item's
 * rendered text with its varying parts named `<slot>`, exactly the cli row
 * fact's rule ({@link InterfaceRowFactSchema}) transplanted to the DOM. The
 * item is addressed by ROLE (its accessible name varies per item, so a
 * role+name locator cannot say "any of them"), inside the `within` container
 * when the role alone is ambiguous on the page.
 *
 * What it buys today is bounded honestly: "a row whose text contains X exists"
 * (`expect.text` scoped to the container) plus the shape itself for the visual
 * judge and the reader. "Exactly N rows" is NOT assertable, no expect member
 * counts elements, and the vocabulary grows only when a real claim cannot be
 * stated without it. A count a page prints as text is a marker, not a row.
 */
export const InterfaceRowsReadableSchema = z
  .object({
    id: InterfaceReadableIdSchema.optional(),
    /** The container, when the item role alone is ambiguous on the page. */
    within: GuardWebLocatorSchema.optional(),
    /** The repeated element's role, one entry is printed once PER ITEM. */
    item: z.enum(GUARD_WEB_ROLES),
    /** The item's rendered text, varying parts written `<name>`. */
    template: z.string().min(1),
    /** Every slot the template names. At least one, an item with none is a marker. */
    slots: z.array(InterfaceRowSlotSchema).min(1),
    /** The one condition the items appear under. */
    when: z.string().min(1).optional(),
  })
  .strict()
  .superRefine(rowGrammarIssues)
export type InterfaceRowsReadable = z.infer<typeof InterfaceRowsReadableSchema>

/**
 * Everything a resource visibly shows, as structured facts, the four kinds,
 * each optional under the contract region's absence rule (omitted = nothing
 * established; empty = established none).
 */
export const InterfaceReadablesSchema = z
  .object({
    markers: z.array(InterfaceMarkerReadableSchema).optional(),
    elements: z.array(InterfaceElementReadableSchema).optional(),
    controls: z.array(InterfaceControlReadableSchema).optional(),
    rows: z.array(InterfaceRowsReadableSchema).optional(),
  })
  .strict()
export type InterfaceReadables = z.infer<typeof InterfaceReadablesSchema>

/**
 * ONE PLACE of a surface, defined once in its area's registry. Deliberately
 * carries NO opened-by list: how a user gets here is what the interfaces' own
 * `at`/`to` already say (every interface with `to` naming this resource opens
 * it), and a second copy of that relation could only drift from the first -
 * a reader joins it, the way `apiEffects` is joined to its api entries.
 */
export const InterfaceResourceSchema = z
  .object({
    id: InterfaceResourceIdSchema,
    kind: InterfaceResourceKindSchema,
    /** The place's name as a reader knows it, "the Rules dialog". */
    title: z.string().min(1),
    /**
     * The resource this one sits ON (a panel) or OVER (a dialog), by id in the
     * same registry. This is what keeps a flow's location chain CHECKABLE
     * across nesting: a task that arrives `to: repo-report` hands off to one
     * acting `at: violations-list` because the panel's `of` chain reaches the
     * screen, without it the handoff is two ids nothing relates. A screen
     * carries none: it is the thing everything else is `of`. The other surfaces
     * nest the same way and for the same reason: `spec-docs` is `of` `spec`,
     * `/api/repos/{id}/analyses` is `of` `/api/repos`, and a ROOT of either
     * (the program's own group, a path's first noun) carries none, exactly as a
     * screen does.
     */
    of: InterfaceResourceIdSchema.optional(),
    /**
     * WHERE a screen is, as a navigate step writes it, the route template with
     * `{param}` slots ({@link canonicalRoutePath}'s form, the one the api entries
     * already use). A `screen` is defined as the place that owns an address, so
     * this is the field that makes one reachable: without it a derived screen is
     * a title nothing can navigate to.
     *
     * SCREENS ONLY, and enforced below. A dialog opens OVER a screen and a panel
     * swaps in WITHOUT leaving one, neither has an address of its own, and one
     * written on either would be a route that navigates somewhere else.
     * Optional, per the absence rule: a screen a derivation named but could not
     * address (or a hand-authored place written before this field existed)
     * carries none rather than a guess.
     */
    address: z.string().min(1).optional(),
    /** One line on what the place is for. */
    description: z.string().min(1).optional(),
    readables: InterfaceReadablesSchema.optional(),
  })
  .strict()
  .superRefine((resource, ctx) => {
    if (resource.kind === 'screen' && resource.of) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['of'],
        message: 'a screen sits on nothing, `of` belongs to a panel or a dialog',
      })
    }
    if (resource.kind !== 'screen' && resource.address) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['address'],
        message: 'only a screen owns an address, a dialog opens over one, a panel sits on one',
      })
    }
    // A readable id is a NAME, one fact per name, across all four kinds, so a
    // future reference can never point at two facts.
    const seen = new Set<string>()
    for (const kind of ['markers', 'elements', 'controls', 'rows'] as const) {
      resource.readables?.[kind]?.forEach((fact, i) => {
        if (!fact.id) return
        if (seen.has(fact.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['readables', kind, i, 'id'],
            message: `readable \`${fact.id}\` is named twice in this resource`,
          })
        }
        seen.add(fact.id)
      })
    }
  })
export type InterfaceResource = z.infer<typeof InterfaceResourceSchema>

/**
 * WHERE one interface came from: `derived` = a mapping read it off the working
 * tree (`cli` and `api`, the only two surfaces anything derives), `authored` =
 * a human wrote it in `guard/interfaces.authored.json`, which no derivation
 * writes and every mapping merges rather than replaces.
 *
 * Deliberately NOT a value of {@link InterfaceCatalogSourceSchema}: that field
 * answers "how was this AREA derived" and is a degradation marker for one
 * derivation ladder, while authorship is a fact about one ENTRY, a merged
 * catalog can carry both origins inside the same area (an authored operation
 * shadowing a derived one), which no single per-area value could ever say.
 */
export const InterfaceOriginSchema = z.enum(['derived', 'authored'])
export type InterfaceOrigin = z.infer<typeof InterfaceOriginSchema>

export const InterfaceSchema = z
  .object({
    /** `<type>/<slug>`, e.g. `cli/tasks-add`. */
    id: z.string().min(1),
    /** The surface, a driver-registry id (the driver that would run its scenarios). */
    type: GuardDriverIdSchema,
    title: z.string().min(1),
    /**
     * The FAMILY this invocable thing belongs to, the `rules` command tree, the
     * `analyses` route family, the page a web task acts on. One entry is one
     * invocable thing (one command, one operation, one task); the group is the
     * only thing that says which others it sits with, so a reader can still see
     * the tree the per-entry granularity dissolved. Decided 2026-08-10 with the
     * INTERFACE rename; optional so a catalog written before it parses unchanged.
     * Scoped to the entry's `type`, two surfaces may name a family alike (the cli
     * `rules` tree and the api `rules` routes) and mean their own. Never
     * fingerprinted, regrouping is a presentation change, not a change to WHICH
     * thing is invoked (see {@link interfaceFingerprint}).
     */
    group: z.string().min(1).optional(),
    entry: InterfaceEntrySchema,
    steps: z.array(InterfaceStepSchema).min(1),
    /**
     * The world the interface ASSUMES, as a STATE ID from its area's registry -
     * an interface is one task a user can perform from a specific state
     * (`repo-report-open`), and this is that state. Named rather than described
     * (2026-08-11) so an earlier task's `endState` and this one's `startingState`
     * chain by equality; the sentence lives once, in
     * {@link InterfacesFileSchema.states}, and the file refuses an id no registry
     * defines. Optional so cli/api catalogs carrying none parse unchanged, and
     * never fingerprinted: the state a task starts from is not WHICH task it is.
     */
    startingState: InterfaceStateIdSchema.optional(),
    /**
     * The observable world the task LEAVES behind, as a state id from the same
     * registry (`rule-silenced`), what a scenario asserts after walking the
     * steps, and what the next task in a flow starts from. Same registry,
     * optionality and fingerprint rules as `startingState`.
     */
    endState: InterfaceStateIdSchema.optional(),
    /**
     * THE LOCATION CONTRACT, half one: the resource this task acts ON, a
     * resource id from its area's registry ({@link InterfacesFileSchema.resources}).
     * Split out of the state contract 2026-08-12: before resources existed,
     * "where the task happens" rode in `startingState` as pseudo-states
     * (`rules-panel-open`), and the registry filled with places instead of
     * worlds. `at` is the place; `startingState` keeps saying the WORLD, a
     * task can need both ("on the repo report, with a rule silenced").
     * Optional so cli/api catalogs (and web catalogs written before resources)
     * parse unchanged, and never fingerprinted: where a task happens is not
     * WHICH task it is.
     */
    at: InterfaceResourceIdSchema.optional(),
    /**
     * THE OWNING RESOURCE: the place this invocable thing BELONGS TO, the
     * command group it is registered in, the REST noun its path names, as a
     * resource id resolved in its own area's registry, the same area-scoped
     * resolution `at`/`to` use.
     *
     * Why ownership is a REFERENCE and `interfaces[]` stays FLAT (2026-08-14):
     * the unit of identity does not move. An interface is still one invocable
     * thing with its own fingerprint over `type` + `entry` + `steps`, and every
     * consumer that iterates the catalog, the fingerprint set, the drift diff,
     * the scenario grounding, keeps iterating one flat list. Nesting the
     * entries under their resources would have re-shaped all of those to buy a
     * rendering, and a surface whose resource formation degrades (a cli whose
     * tree nobody could read) would have had nowhere to put its interfaces at
     * all. As a reference it is additive: a catalog that establishes no
     * resources carries none, and per-surface degradation stays clean.
     *
     * DISTINCT from `at`, which is the WEB location contract: `at` says where a
     * task is performed and can differ from where the task lives; `resource`
     * says which place OWNS the invocable. Distinct from
     * {@link InterfaceSchema.group} too, which stays exactly what it was, a
     * cosmetic family label, unvalidated and unstructured; `resource` is the
     * structural reference, validated against the registry.
     *
     * Never fingerprinted, by the same rule the rest of this region lives by:
     * which place owns a command is not WHICH command it is.
     */
    resource: InterfaceResourceIdSchema.optional(),
    /**
     * Half two: the resource the task LEAVES THE USER AT, when, and only when -
     * it moves them (`open-repo-report` is at `dashboard-home`, to
     * `repo-report`; closing a dialog is at the dialog, to what it covered).
     * A task that acts in place carries `at` alone: the location contract is
     * authored as one piece, so an omitted `to` on an `at`-bearing task means
     * "stays put", not "unestablished". The join this enables is deliberate:
     * every task with `to` naming a resource IS that resource's opened-by
     * list, which is why the resource itself stores none. Same optionality and
     * fingerprint rules as `at`.
     */
    to: InterfaceResourceIdSchema.optional(),
    /**
     * THE UI-TO-API RELATION: the api operations this task's steps invoke, as
     * {@link InterfaceSchema.id}s of the api entries in the SAME catalog
     * (`api/get-api-repos-id-violations`, …). Ids rather than method+path so the
     * two halves can never drift apart: an operation that is renamed or dropped
     * takes its id with it, and a dangling ref is a visible break instead of a
     * string that still reads plausibly.
     *
     * Why it exists (plan §2): a surface the docs do not promise, today the
     * dashboard server's HTTP API, is a REALIZATION surface, recorded so a
     * scenario can act through it. Without this field the api entries stand
     * unattached: nothing says WHICH screen reaches them, so neither a reader nor
     * a generator can tell a route that serves a promised screen from one nothing
     * reaches. Derived, never authored from docs: the client's own call sites,
     * resolved one hop through its api-client module (§10.4).
     *
     * The absence rule of the contract region applies here too, and both halves
     * are real answers: OMITTED means the extraction established nothing;
     * `[]` means it established NONE, a purely client-side interaction (a
     * filter, a dropdown) that reaches no server at all. A fact the one-hop
     * resolution cannot settle is simply not listed, never guessed.
     *
     * Additive, optional, and NEVER fingerprinted (see
     * {@link interfaceFingerprint}): learning what a click calls says nothing
     * about WHICH task it is, so enriching the relation must not re-author a
     * single scenario.
     */
    apiEffects: z.array(z.string().min(1)).optional(),
    /** `sha256:…` over the surface-visible shape, see {@link interfaceFingerprint}. */
    fingerprint: z.string().min(1),
    /** An OpenAPI operation with NO matching route registration: declared surface the
     *  code-side extraction couldn't find. Provenance, never fingerprinted, a spec-only
     *  interface that fails birth IS the documented-but-unimplemented drift signal. */
    specOnly: z.literal(true).optional(),
    /**
     * THE RPC NAME this operation is: the dotted tRPC procedure
     * (`viewer.bookings.get`) the entry's method + path were composed from, a
     * `.query` under the adapter's mount is that GET, a `.mutation` is that POST.
     *
     * It is both a MARKER and a JOIN KEY, which is why it is a field rather than
     * a flag. As a marker: an entry carrying it was derived from a router tree,
     * not from a route table or an OpenAPI doc, and scenario generation excludes
     * it for now (item 12, authoring `?input=`-encoded tRPC calls is its own
     * decision). As a key: the frontend join (`interface-mapper/web-context.ts`)
     * indexes the catalog by procedure, so a screen calling
     * `trpc.viewer.bookings.get.useQuery` resolves to THIS id and the call lands
     * in `apiEffects` like every other server effect.
     *
     * Top-level, beside `apiEffects` and `specOnly`, and deliberately NOT inside
     * `entry`: the entry is the strict fingerprinted descriptor of WHAT is
     * invoked, and what is invoked here is an HTTP operation. Never fingerprinted
     *, see {@link interfaceFingerprint}.
     */
    procedure: z.string().min(1).optional(),
    /** The full public contract, in this entry's OWN surface vocabulary, see
     *  {@link InterfaceContractSchema}. Absent where the derivation established
     *  the surface's shape only. Never fingerprinted. */
    contract: InterfaceContractSchema.optional(),
    /**
     * WHERE THIS ENTRY CAME FROM, see {@link InterfaceOriginSchema}. STAMPED at
     * merge time by the reader that joins the derived catalog with its authored
     * sibling, never written by the file itself: a field a file DECLARES can
     * disagree with reality (and one did, a 100% hand-written catalog claiming
     * `source: {"web":"tree"}` is what hid the loss for months), while a field
     * the merge computes cannot. Optional because a catalog read on its own has
     * no second half to be distinguished from. Never fingerprinted.
     */
    origin: InterfaceOriginSchema.optional(),
  })
  .strict()
export type Interface = z.infer<typeof InterfaceSchema>

/**
 * How ONE surface's catalog was derived: `tree` = the analyzer's own artifacts
 * (the primary path, every surface), `probes` = the cli fallback ladder for a
 * framework no extractor recognizes, `union` = both ran and were merged (the
 * cli surface when the tree yielded commands AND the program was probed -
 * tree wins descriptions, probes fill what the tree missed, disagreements are
 * run-reported, never stored here). A degradation marker, not a quality claim.
 * Additive: files written before `union` existed parse unchanged.
 */
export const InterfaceCatalogSourceSchema = z.enum(['tree', 'probes', 'union'])
export type InterfaceCatalogSource = z.infer<typeof InterfaceCatalogSourceSchema>

/**
 * MAPPER DIAGNOSTICS, the general RUN-REPORTING shape for anything a mapping
 * (or the derived∪authored catalog merge) noticed and did not settle itself. A
 * diagnostic is a statement about THIS working tree at THIS moment: it goes
 * stale the instant the tree moves, so it rides run results
 * (`MapInterfacesResult`, `guard/setup.json`'s step rows) and NEVER enters the
 * interface catalog or any fingerprint, the catalog schema forbids storing
 * doc-vs-code discrepancies in interface data.
 *
 * Lives in shared (rather than `@truecourse/interface-mapper`, which
 * re-exports it) because BOTH ends of the dependency edge produce one:
 * the mapper's cli union and guard-runner's merge-time stale-place report -
 * and guard-runner cannot import the mapper (the mapper depends on it).
 */
export const MapperDiagnosticKindSchema = z.enum([
  /** The probe's help output documents a flag the tree derivation did not register. */
  'tree-missing-flag',
  /** The tree registers a flag the probe's help output does not list. */
  'probe-missing-flag',
  /** The probe's help output lists a command the tree does not register. */
  'tree-missing-command',
  /** The tree registers a command the probe's help output does not list. */
  'probe-missing-command',
  /** An authored screen whose id no derivation produces any more (merge-time). */
  'authored-place-not-derived',
])
export type MapperDiagnosticKind = z.infer<typeof MapperDiagnosticKindSchema>

/**
 * One thing a mapping run reports. `subject` is the display identity, the
 * thing as a user would name it (`relkit add --transport`, an authored place
 * id); `detail` names BOTH sides of the disagreement in one sentence, because
 * the reconcile session's briefing states each diagnostic verbatim and a
 * one-sided detail would brief half a dispute.
 *
 * `command`/`flag` are the STRUCTURED identity of the cli kinds: the command's
 * argv path (never the program name) and, for the flag kinds, the flag itself.
 * `applyReconcileResolutions` matches on them, parsing `subject` back into
 * its parts would break the moment a program name contains a space. Absent on
 * kinds that are not about a cli command.
 */
export const MapperDiagnosticSchema = z
  .object({
    surface: GuardDriverIdSchema,
    kind: MapperDiagnosticKindSchema,
    /** Display identity, e.g. `relkit add --transport` or an authored place id. */
    subject: z.string().min(1),
    /** Both sides of the disagreement, one sentence. */
    detail: z.string().min(1),
    command: z.array(z.string()).readonly().optional(),
    flag: z.string().optional(),
  })
  .strict()
export type MapperDiagnostic = z.infer<typeof MapperDiagnosticSchema>

/**
 * `.truecourse/guard/interfaces.json`, the last mapping's catalog (gitignored).
 *
 * ONE SHAPE, TWO HOMES (2026-08-17): the same shape validates
 * `guard/interfaces.authored.json`, the COMMITTED half a human writes for the
 * surfaces no derivation produces. The two are joined at read time
 * (`readMergedInterfaceCatalog`), authored winning per interface id and per
 * resource id, with each entry stamped {@link InterfaceSchema.origin}. Neither
 * file describes a different thing, so neither gets a schema of its own, the
 * halves are read with {@link InterfacesFragmentSchema} (shape) and the WHOLE
 * is held to this one (shape + the id resolution below), because a reference
 * that crosses the two halves can only be resolved in the merge.
 *
 * **version 2 (2026-08-14)**, the SOM restructure, and THE break the number was
 * reserved for. `version` stayed 1 through every additive growth: the contract
 * fields (a catalog written before them parses unchanged, a catalog written with
 * them parses in a reader that ignores them), and the state contract's move from
 * prose to named ids (2026-08-11), which reached hand-authored web entries only -
 * no extractor had ever written one.
 *
 * This one is different in exactly the way the reserved number describes: the
 * contract became a discriminated union on `surface` (`commands: []` collapsed to
 * a singular `command`; the api member reshaped from the cli costume into HTTP's
 * own vocabulary), and that reaches DATA MAPPERS HAVE SHIPPED, every
 * `interfaces.json` an api mapping ever wrote. Both directions break, so the
 * number moves and the reader accepts 2 alone. The recovery is the designed one
 * and costs nothing: the file is gitignored and derived, so a v1 file fails
 * parse, reads as "no catalog", and the next map re-derives it.
 */
const InterfacesFileShapeSchema = z
  .object({
    version: z.literal(2),
    /** ISO timestamp of the mapping run that wrote the file. */
    generatedAt: z.string(),
    /** The recipe fingerprint the mapping ran against. */
    recipeFingerprint: z.string(),
    interfaces: z.array(InterfaceSchema),
    /**
     * THE STATE REGISTRY, per AREA: interface TYPE (a driver-registry id) → the
     * states that area's tasks assume and leave, each defined once. The same key
     * `source` uses, and deliberately NOT {@link InterfaceSchema.group}: chaining
     * crosses families, the report a `home` task opens is the state every
     * `repos` task starts from, so a group-scoped registry could not express a
     * flow's own walk.
     *
     * A state is a WORLD, never a place (2026-08-12): "a rule is silenced" is a
     * state; "the rules dialog is open" is a location, and locations live in
     * {@link InterfacesFileSchema.resources}, referenced by the interfaces' own
     * `at`/`to`. Before the split most of this registry was places wearing
     * state ids, and two registries describing the same dialog two ways could
     * never be matched.
     *
     * Additive and optional (a catalog that names no states parses unchanged),
     * and never fingerprinted, see {@link interfaceFingerprint}.
     */
    states: z.record(z.string(), z.array(InterfaceStateSchema)).optional(),
    /**
     * THE RESOURCE REGISTRY, per AREA: interface TYPE → the places that area's
     * tasks act on, each defined once with what can be read off it, see the
     * RESOURCES region header. Keyed like `states` and for the same reason:
     * navigation crosses families. Additive, optional, never fingerprinted.
     */
    resources: z.record(z.string(), z.array(InterfaceResourceSchema)).optional(),
    /** Per interface TYPE (a driver-registry id) → how that catalog was derived. */
    source: z.record(z.string(), InterfaceCatalogSourceSchema).optional(),
  })
  .strict()

/**
 * HALF a catalog: the shape above, with the CROSS-REFERENCE rules below left
 * out. This is what `guard/interfaces.authored.json` is read with, and the
 * distinction is forced by the split itself (2026-08-17): the authored file
 * holds the interfaces no derivation produces, and their `at`/`to`/`resource`
 * ids resolve against the MERGED catalog, a web task stands on a screen the
 * derivation writes into the gitignored half. Checking those references against
 * the authored file alone would refuse every task that stands on a derived
 * place, and on a fresh clone (where the derived half does not exist yet) it
 * would refuse the file the clone just inherited from git.
 *
 * So the halves are checked for SHAPE and the WHOLE is checked for references:
 * {@link InterfacesFileSchema}, this schema plus the id resolution, is what a
 * merged catalog is held to, and what the authoring write path validates its
 * fragment against before a byte lands.
 */
export const InterfacesFragmentSchema = InterfacesFileShapeSchema
export type InterfacesFragment = z.infer<typeof InterfacesFragmentSchema>

export const InterfacesFileSchema = InterfacesFileShapeSchema
  .superRefine((file, ctx) => {
    // An id is only a NAME if something defines it. Ids resolve in the registry
    // of the interface's OWN area, so two surfaces may name a state alike and
    // each mean their own, the `type`-scoping `source` and `group` already use.
    const registry = new Map<string, Set<string>>()
    for (const [area, states] of Object.entries(file.states ?? {})) {
      const ids = new Set<string>()
      states.forEach((state, i) => {
        if (ids.has(state.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['states', area, i, 'id'],
            message: `\`${state.id}\` is defined twice in the \`${area}\` registry`,
          })
        }
        ids.add(state.id)
      })
      registry.set(area, ids)
    }
    // The resource registry resolves the same way, scoped to the same key.
    const places = new Map<string, Set<string>>()
    for (const [area, resources] of Object.entries(file.resources ?? {})) {
      const ids = new Set<string>()
      resources.forEach((resource, i) => {
        if (ids.has(resource.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['resources', area, i, 'id'],
            message: `\`${resource.id}\` is defined twice in the \`${area}\` registry`,
          })
        }
        ids.add(resource.id)
      })
      places.set(area, ids)
      // The nesting relation resolves in ITS OWN registry, and never to itself.
      resources.forEach((resource, i) => {
        if (!resource.of) return
        if (resource.of === resource.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['resources', area, i, 'of'],
            message: `\`${resource.id}\` cannot sit on itself`,
          })
        } else if (!ids.has(resource.of)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['resources', area, i, 'of'],
            message: `\`${resource.of}\` is not a resource the \`${area}\` registry defines`,
          })
        }
      })
    }
    // Interfaces resolve by id catalog-wide, not per area: `apiEffects` is a
    // web task naming an api entry, so the lookup crosses surfaces by design.
    const byId = new Map(file.interfaces.map((iface) => [iface.id, iface]))
    file.interfaces.forEach((iface, i) => {
      const known = registry.get(iface.type)
      for (const field of ['startingState', 'endState'] as const) {
        const id = iface[field]
        if (id && !known?.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['interfaces', i, field],
            message: `\`${id}\` is not a state the \`${iface.type}\` registry defines`,
          })
        }
      }
      const knownPlaces = places.get(iface.type)
      // `resource` (the OWNING place) resolves exactly as the location contract
      // does, same registry, same area scoping, same "an id is only a name if
      // something defines it" rule.
      for (const field of ['at', 'to', 'resource'] as const) {
        const id = iface[field]
        if (id && !knownPlaces?.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['interfaces', i, field],
            message: `\`${id}\` is not a resource the \`${iface.type}\` registry defines`,
          })
        }
      }
      // `apiEffects` is a REFERENCE like every other id here, and it resolves
      // the same way: an id that names no api entry names nothing. It was the
      // one reference field nothing checked, and the cost was measured, of the
      // 14 authored tasks that carried the field in the first pilot, 11 named
      // ids that did not exist (`api/post-api-v2-envelope-create` against a
      // catalog that has no such entry), and every one of them landed in the
      // committed file. The field's own rule is "never guessed"; this is what
      // makes that rule true rather than advisory. It resolves against the
      // whole catalog because an authored web task names a DERIVED api entry -
      // which is exactly why it is checked here, on the merge, and not in the
      // half-schema.
      for (const effect of iface.apiEffects ?? []) {
        const target = byId.get(effect)
        if (!target) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['interfaces', i, 'apiEffects'],
            message: `\`${effect}\` is not an interface this catalog defines`,
          })
        } else if (target.type !== 'api') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['interfaces', i, 'apiEffects'],
            message: `\`${effect}\` is a \`${target.type}\` interface, an api effect names an api entry`,
          })
        }
      }
      // A contract describes THIS entry's surface or it describes nothing: an
      // api operation's grammar attached to a cli command is not a contract for
      // that command, it is a decoding error waiting to be read as truth.
      if (iface.contract && iface.contract.surface !== iface.type) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['interfaces', i, 'contract', 'surface'],
          message: `this contract is \`${iface.contract.surface}\`, and the interface is \`${iface.type}\`, a contract describes its own surface`,
        })
      }
    })
  })
export type InterfacesFile = z.infer<typeof InterfacesFileSchema>

/**
 * Canonical form of a route path template: params in `{name}` regardless of the
 * framework that declared them, `/todos/:id` (Express), `/todos/<int:id>` (Flask),
 * `/todos/{id}` (OpenAPI/ASP.NET) all become `/todos/{id}`. One identity per
 * operation, so the code route and its OpenAPI declaration converge on ONE interface
 * whichever side the mapper saw first; leading `/` ensured, trailing `/` dropped.
 */
export function canonicalRoutePath(routePath: string): string {
  const withLead = routePath.startsWith('/') ? routePath : `/${routePath}`
  const canonical = withLead
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) return `{${segment.slice(1)}}`
      const angled = segment.match(/^<(?:[^:>]+:)?([^>]+)>$/)
      if (angled) return `{${angled[1]}}`
      const braced = segment.match(/^\{([^}:]+)(?::[^}]*)?\}$/)
      if (braced) return `{${braced[1]}}`
      return segment
    })
    .join('/')
  const trimmed = canonical.replace(/\/+$/, '')
  return trimmed || '/'
}

/** Whitespace-normalized token, the section-fingerprint rule, per field. */
function normalizeToken(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * A step's fingerprinted identity: its kind plus the SURFACE-VISIBLE payload -
 * the command path and its flag set, the method + path template, the route, the
 * target. `label` is cosmetic and never folded in, and a step carries no state
 * at all: within a task the chain IS step order (2026-08-11), and the task's own
 * two states are ids on the interface, outside the fold. Flags fold as a SET
 * (sorted): which flags a command accepts is the surface, the order help prints
 * them is not.
 */
function stepIdentity(step: InterfaceStep): string {
  switch (step.kind) {
    case 'invoke':
      return [
        step.kind,
        step.command.map(normalizeToken).join(' '),
        [...step.flags].map(normalizeToken).sort().join(' '),
      ].join('\u0000')
    case 'request':
      return [step.kind, normalizeToken(step.method).toUpperCase(), normalizeToken(step.path)].join('\u0000')
    case 'navigate':
      return [step.kind, normalizeToken(step.route)].join('\u0000')
    default:
      return [step.kind, normalizeToken(step.target)].join('\u0000')
  }
}

/**
 * `sha256:<hex>` over an interface's SURFACE-VISIBLE shape: its type, its entry
 * descriptor, and each step's kind + payload, never internal symbol names, file
 * paths, or the call chain behind the surface. A rename/move refactor that leaves
 * what a user can reach unchanged must not move a single fingerprint, or every
 * refactor sprays drift dots across the scenario corpus and the signal dies of
 * alarm fatigue.
 *
 * The CONTRACT is excluded for the same reason: option metadata and io facts
 * describe what a command takes and returns, not WHICH command it is.
 * Learning a flag's choices or an exit code must leave every interface identity
 * (and therefore every scenario's grounding and every author-cache key) where it
 * was, the signature is `Pick<Interface, 'type' | 'entry' | 'steps'>` so a caller
 * cannot accidentally fold one in. {@link InterfaceSchema.apiEffects} is excluded
 * by the same rule: which operations a click reaches is what the task DOES behind
 * the glass, not which task it is. The STATE CONTRACT is excluded too, and always
 * was: the world a task assumes and leaves is not WHICH task it is, so naming the
 * states (2026-08-11) left all 60 reference fingerprints byte-identical. The
 * LOCATION CONTRACT (`at`/`to`) and the resource registry follow the identical
 * rule (2026-08-12): where a task happens is not which task it is, so making
 * places first-class moved no fingerprint either. {@link InterfaceSchema.resource}
 *, the place that OWNS the invocable, is excluded by the same rule and was the
 * whole reason ownership landed as a reference on a flat list (2026-08-14): the
 * SOM restructure reshaped every api contract and left all 114 reference
 * fingerprints byte-identical.
 *
 * {@link InterfaceSchema.procedure} is excluded too (item 12): the RPC name an
 * HTTP operation was composed from is provenance and a join key, not a second
 * identity, a repo that gains the tRPC derivation for operations it already had
 * must not move a fingerprint, and the same procedure reached through the same
 * mount IS the same operation whichever side named it.
 *
 * {@link InterfaceSchema.origin} is excluded by the same rule and for the same
 * stakes (2026-08-17): moving a hand-authored surface out of the derived file
 * and into `interfaces.authored.json` must re-author NOTHING, so where an entry
 * came from cannot be part of which task it is. The reference catalog is the
 * proof, all 114 fingerprints hold with every entry stamped.
 */
export function interfaceFingerprint(
  iface: Pick<Interface, 'type' | 'entry' | 'steps'>,
): string {
  const entryIdentity =
    'command' in iface.entry
      ? iface.entry.command.map(normalizeToken).join(' ')
      : [
          normalizeToken(iface.entry.method).toUpperCase(),
          normalizeToken(iface.entry.path),
        ].join(' ')
  const body = [iface.type, entryIdentity, ...iface.steps.map(stepIdentity)].join('\n')
  return `sha256:${crypto.createHash('sha256').update(body, 'utf-8').digest('hex')}`
}
