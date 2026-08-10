/**
 * INTERFACES — the code-side unit (WITH WHAT to test), derived deterministically
 * from the app's own surfaces (commands, routes, screens) with no LLM in the loop.
 * What is stored is the CALLING INTERFACE, not a user's path: ONE entry per
 * INVOCABLE THING — one command, one HTTP operation, one web task — each carrying
 * its own contract and its own fingerprint, with a {@link InterfaceSchema.group}
 * naming the family it sits in (the `rules` command tree, the `analyses` route
 * family). Never a tree of commands folded into one entry, and never independent
 * invocations rendered as sequential steps (decided 2026-08-10). A scenario is one
 * spec flow realized through the interfaces its steps actually invoke.
 *
 * Shared (not under `guard/`) because the analyze side renders the same shape.
 * The catalog snapshot lives at `.truecourse/guard/interfaces.json` — gitignored and
 * re-derived from the working tree; the clone-portable part is the interface
 * FINGERPRINTS embedded in scenario YAMLs and the manifest.
 *
 * The step vocabulary is ONE envelope across every surface: a closed union keyed
 * by `kind`, so an api or web extractor lands additively (no new step schema, no
 * format event). An interface's `type` is a driver-registry id — the driver that
 * would execute its scenarios.
 */

import crypto from 'node:crypto'
import { z } from 'zod'
import { GuardDriverIdSchema } from './guard/drivers.js'

/** The closed step vocabulary, shared by every surface. */
export const InterfaceStepKindSchema = z.enum([
  'invoke',
  'request',
  'navigate',
  'input',
  'activate',
])
export type InterfaceStepKind = z.infer<typeof InterfaceStepKindSchema>

/**
 * A step's STATE HANDOFF — every step is one user action, and these two fields
 * are the observable world on either side of it: `input` the state the action
 * needs (a dropdown already open, a panel visible), `output` the interaction
 * change it produces (the dropdown IS open, the rule's cards are gone). They
 * chain: the first step's input restates the interface's `startingState`, each
 * step's output is the next step's input, and the last step's output restates
 * the interface's `endState` — {@link InterfaceSchema} enforces all three, so an
 * interface can never claim a path whose middle doesn't connect. One plain
 * sentence each; optional (a catalog written before them parses unchanged);
 * prose about state, so never fingerprinted — see {@link stepIdentity}.
 */
const interfaceStepStateFields = {
  input: z.string().min(1).optional(),
  output: z.string().min(1).optional(),
}

/** Run a command (cli / tui): the argv PATH plus the flags that command accepts. */
export const InterfaceInvokeStepSchema = z
  .object({
    kind: z.literal('invoke'),
    /** Argv path of the command, e.g. `["tasks", "add"]` — never the binary path. */
    command: z.array(z.string()).min(1),
    /** Flags the command accepts, e.g. `["--json", "--force"]`. */
    flags: z.array(z.string()).default([]),
    /** Human one-liner for display; cosmetic — never fingerprinted. */
    label: z.string().optional(),
    ...interfaceStepStateFields,
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
    ...interfaceStepStateFields,
  })
  .strict()

/** Move to a screen (web / desktop / mobile): the route as the surface declares it. */
export const InterfaceNavigateStepSchema = z
  .object({
    kind: z.literal('navigate'),
    route: z.string().min(1),
    label: z.string().optional(),
    ...interfaceStepStateFields,
  })
  .strict()

/** Put a value into a field — the target as the surface names it. */
export const InterfaceInputStepSchema = z
  .object({
    kind: z.literal('input'),
    target: z.string().min(1),
    label: z.string().optional(),
    ...interfaceStepStateFields,
  })
  .strict()

/** Click / tap / submit — the target as the surface names it. */
export const InterfaceActivateStepSchema = z
  .object({
    kind: z.literal('activate'),
    target: z.string().min(1),
    label: z.string().optional(),
    ...interfaceStepStateFields,
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

/** An interface rooted at a cli command — the argv path it starts from. */
export const InterfaceCommandEntrySchema = z
  .object({
    /** Argv path the interface is rooted at — at least one token (a root interface is
     *  rooted at the program's own command name). Never the resolved binary path. */
    command: z.array(z.string()).min(1),
  })
  .strict()
export type InterfaceCommandEntry = z.infer<typeof InterfaceCommandEntrySchema>

/** An interface rooted at an HTTP operation — the method + path template it serves. */
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

/** One display/identity string for any entry shape — `spec docs` or `GET /todos/{id}`. */
export function interfaceEntryLabel(entry: InterfaceEntry): string {
  return 'command' in entry
    ? entry.command.join(' ')
    : `${entry.method.toUpperCase()} ${entry.path}`
}

// ---------------------------------------------------------------------------
// The interface CONTRACT — the CALLING INTERFACE and nothing else: the full public
// grammar of every command in the tree and each command's input/output as
// STRUCTURED FACTS. Everything below is ADDITIVE and
// OPTIONAL: a catalog that carries only the command tree (the derivation's floor)
// stays valid, and the fields never enter {@link interfaceFingerprint} — grammar
// detail is what a command TAKES, not which command it is, so enriching an interface
// must never roll its identity or re-author a single scenario.
//
// Two absences are distinguished everywhere, and neither is ever guessed:
// an OMITTED field means the extraction established nothing; an EMPTY array
// means it established "none". A fact a probe could not settle is recorded
// as {@link INTERFACE_UNKNOWN}.
// ---------------------------------------------------------------------------

/** A fact the extraction and its probes could not establish — recorded, never guessed. */
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
    /** The value placeholder help prints — `n`, `mode`, `list`. */
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
 * text the program really prints) and `when` — ONE short condition, not a
 * description. A fact that cannot be stated in one of these shapes is not
 * contract material at all: the artifact is 100% structured facts, so there is
 * nowhere for a sentence about behavior to go.
 */

/** Which stream a marker appears on. `combined` = the interleaved pair. */
export const InterfaceStreamSchema = z.enum(['stdout', 'stderr', 'combined'])
export type InterfaceStream = z.infer<typeof InterfaceStreamSchema>

/**
 * One output fact: a STABLE SUBSTRING the command writes to a stream. The marker
 * is what a scenario matches on, so it carries the invariant part only — never a
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
 * once, before and after them. Nothing here claims a block HAS rows — a command
 * that totals a set without listing it prints the footer alone, and its `when`
 * says so.
 */
export const InterfaceRowRoleSchema = z.enum(['header', 'row', 'footer'])
export type InterfaceRowRole = z.infer<typeof InterfaceRowRoleSchema>

/**
 * The value vocabulary a template slot draws from — three members, deliberately:
 *
 *  - `count` — an integer the program renders (`2 shown`, `of 15 violations`).
 *  - `enum` — one of a CLOSED set the program can print, carried in `values`.
 *  - `text` — anything else the program renders into the line: a name, a title,
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
    /** The closed value set — required for `enum`, rejected for the others. */
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
 * One ROW-GRAMMAR fact: the SHAPE of a line of enumerated or tabular output —
 * the literal text the program prints with its varying parts named as `<slot>`
 * placeholders, plus what each slot may hold. This is the one fact kind that
 * describes a line a scenario cannot match verbatim, because every run renders
 * different values into it.
 *
 * It does NOT replace an output fact: a marker is the invariant SUBSTRING a
 * scenario matches on, a template is the whole line's grammar around it. A
 * command with both carries both, and they are read together — match the marker,
 * read the shape to know what varies and what it may vary over.
 *
 * ONE kind covers every shape, because the shapes differ only in three ways:
 * where the line sits (`role`), what the literal text is (`template`), and what
 * the slots hold (`slots`). A per-shape fact kind would be six copies of this
 * one with the literals baked in, and every new listing in the program would
 * need a seventh.
 *
 * The template and its slots must agree exactly — every `<name>` declared, every
 * declared slot used — so a template can never promise a value the slots do not
 * describe, and a slot can never describe a value the line does not print.
 */
export const InterfaceRowFactSchema = z
  .object({
    role: InterfaceRowRoleSchema,
    stream: InterfaceStreamSchema,
    /** The line as printed, varying parts written `<name>`; no leading indent. */
    template: z.string().min(1),
    /** Every slot the template names. At least one — a line with none is a marker. */
    slots: z.array(InterfaceRowSlotSchema).min(1),
    /** The one condition the line appears under. */
    when: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((fact, ctx) => {
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
  })
export type InterfaceRowFact = z.infer<typeof InterfaceRowFactSchema>

/**
 * One exit fact. The status is a STRING so {@link INTERFACE_UNKNOWN} is sayable:
 * a status neither the extraction nor a probe settled is recorded, never rounded
 * to a plausible 0 or 1. One fact per CONDITION — a code reached three ways is
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

/** One path the command writes — the file assertion a scenario reads off. */
export const InterfaceWriteFactSchema = z
  .object({
    path: z.string().min(1),
    when: z.string().min(1).optional(),
  })
  .strict()
export type InterfaceWriteFact = z.infer<typeof InterfaceWriteFactSchema>

/**
 * One path or state the command READS — the mirror of {@link InterfaceWriteFactSchema},
 * and the other half of the calling interface: an author seeds a file precisely
 * because the command reads it. `path` is the subject as the surface names it (a
 * store file, a config, or the state a scenario must arrange — a git index, a
 * working tree); `when` is the ONE condition it is read under.
 */
export const InterfaceReadFactSchema = z
  .object({
    path: z.string().min(1),
    when: z.string().min(1).optional(),
  })
  .strict()
export type InterfaceReadFact = z.infer<typeof InterfaceReadFactSchema>

/** One environment variable the command reads — something a scenario must set. */
export const InterfaceEnvFactSchema = z
  .object({
    var: z.string().min(1),
    when: z.string().min(1).optional(),
  })
  .strict()
export type InterfaceEnvFact = z.infer<typeof InterfaceEnvFactSchema>

/** How a question is answered — which is how a TTY step must script its answer. */
export const InterfacePromptKindSchema = z.enum(['confirm', 'select', 'text'])
export type InterfacePromptKind = z.infer<typeof InterfacePromptKindSchema>

/**
 * How an answer is SUBMITTED — the keystroke that ends it, and the one thing a
 * scripted TTY answer has to get right. The vocabulary is the two delivery
 * classes the runner's terminal layer actually has (`guard-runner/src/pty.ts`),
 * and no more:
 *
 *  - `enter` — the answer is a value followed by the ENTER key. The pty layer
 *    types it on its own turn, because a carriage return only survives once the
 *    prompt has raw mode on; before that the line discipline rewrites it.
 *  - `char` — a single printable keypress IS the answer and submits it, with no
 *    Enter at all (a `y`/`n` confirm). The answer splitter keeps such a fragment
 *    as an answer of its own.
 *
 * OMITTED means the extraction established nothing, per the rule above — never
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
    /** The offered answers or default — what a scripted answer picks from. */
    answerHint: z.string().min(1).optional(),
    /** The keystroke that submits the answer — see {@link InterfacePromptSubmitSchema}. */
    submit: InterfacePromptSubmitSchema.optional(),
    when: z.string().min(1).optional(),
  })
  .strict()
export type InterfacePromptFact = z.infer<typeof InterfacePromptFactSchema>

/**
 * The earlier ANSWER that reveals a later question. `prompt` is that earlier
 * question's marker (it must already have been asked — a sequence never points
 * forward), `answer` the answer CLASS that opens this branch, drawn from the
 * vocabulary the earlier prompt itself offers: `yes`/`no` on a confirm (the only
 * two answers it has, and the schema holds it to them), otherwise a value out of
 * that prompt's `answerHint` — one option (`bedrock`), or the closed set of
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
 * `repeats` is the ONE condition the question is re-asked under — the same
 * one-short-condition rule `when` obeys. A question asked in a loop appears ONCE,
 * carrying that condition: listing it twice would leave a branch that names it
 * pointing at two positions, and the sequence resolves branches by marker.
 */
export const InterfaceSequenceNodeSchema = z
  .object({
    /** The question, by the `marker` of the command's own prompt fact. */
    prompt: z.string().min(1),
    /** How it is answered — the same vocabulary that prompt fact uses. */
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
 * alone — a generator writes the scripted answers without first running it.
 *
 * The array order is ARRIVAL order: no question below is asked before a question
 * above it. Two questions that cannot both arise (their prompt facts carry
 * exclusive `when`s — "a skill is missing" against "a skill was updated") are
 * still listed in the order they would arrive; the order between them is vacuous
 * rather than a claim, because at most one of them ever appears.
 *
 * {@link INTERFACE_UNKNOWN} is a first-class value: a dialogue the extraction could
 * not establish is an interface the mapper still OWES, and saying so is the whole
 * point — a plausible order invented here scripts a scenario into a hang.
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
            message: `\`${node.prompt}\` is already in the sequence — a re-ask is \`repeats\`, not a second node`,
          })
        }
        // Checked BEFORE this node joins the set, so `after` can never name it.
        if (node.after && !seen.has(node.after.prompt)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [i, 'after', 'prompt'],
            message: `\`${node.after.prompt}\` is not asked before this question — a branch points backward`,
          })
        }
        seen.add(node.prompt)
      })
    }),
])
export type InterfaceSequence = z.infer<typeof InterfaceSequenceSchema>

/**
 * What a command takes in BEYOND its argv — the grammar above already says what
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

/** What a command puts out — the assertion targets, straight from the surface. */
export const InterfaceProducesSchema = z
  .object({
    output: z.array(InterfaceOutputFactSchema).optional(),
    /** The shape of its enumerated / tabular lines — see {@link InterfaceRowFactSchema}. */
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
 * One command of the tree: its grammar, its io — facts, never prose — and, for an
 * interactive one, the order its questions arrive in.
 *
 * The SEQUENCE is a region of its own, deliberately NOT an io fact. An io fact is
 * a discrete thing a scenario acts on (a marker to assert, a path to seed, a
 * question to answer); the sequence introduces none — it is the ORDER over
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
    /** The argv a user types, program name first — `["truecourse","rules","list"]`. */
    path: z.array(z.string()).min(1),
    description: z.string().optional(),
    options: z.array(InterfaceOptionSchema).optional(),
    positionals: z.array(InterfacePositionalSchema).optional(),
    /** Subcommands this command registers, in registration order. */
    subcommands: z.array(z.string()).optional(),
    io: InterfaceIoSchema.optional(),
    /** The question sequence — see {@link InterfaceSequenceSchema}. */
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
      refuse('this command is established as asking nothing — there is no dialogue to order')
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
          message: `a confirm is answered \`yes\` or \`no\` — \`${node.after.answer}\` is neither`,
        })
      }
    })
  })
export type InterfaceCommandContract = z.infer<typeof InterfaceCommandContractSchema>

/**
 * The interface's public contract: its OWN command's grammar, its io and (where
 * the command is interactive) its question sequence, and NOTHING about the
 * contract itself. One entry is one invocable thing, so a cli entry carries
 * exactly ONE command here — the tree lives in the catalog as sibling entries
 * sharing a {@link InterfaceSchema.group}, never as a list folded into one
 * entry's contract. There is no shared block (a fact every command inherits is
 * carried by each command that has it, so one command's contract is the whole
 * answer), no provenance, no behavior prose (a sentence a fact kind cannot carry
 * is not stored at all), and no doc-versus-code diagnostics — discrepancies the
 * mapper finds are run reporting, never stored interface data. Every field here
 * is a field the derivation must be able to produce.
 */
export const InterfaceContractSchema = z
  .object({
    /** One line on what this interface covers. */
    summary: z.string().optional(),
    commands: z.array(InterfaceCommandContractSchema).min(1),
  })
  .strict()
export type InterfaceContract = z.infer<typeof InterfaceContractSchema>

export const InterfaceSchema = z
  .object({
    /** `<type>/<slug>`, e.g. `cli/tasks-add`. */
    id: z.string().min(1),
    /** The surface — a driver-registry id (the driver that would run its scenarios). */
    type: GuardDriverIdSchema,
    title: z.string().min(1),
    /**
     * The FAMILY this invocable thing belongs to — the `rules` command tree, the
     * `analyses` route family, the page a web task acts on. One entry is one
     * invocable thing (one command, one operation, one task); the group is the
     * only thing that says which others it sits with, so a reader can still see
     * the tree the per-entry granularity dissolved. Decided 2026-08-10 with the
     * INTERFACE rename; optional so a catalog written before it parses unchanged.
     * Scoped to the entry's `type` — two surfaces may name a family alike (the cli
     * `rules` tree and the api `rules` routes) and mean their own. Never
     * fingerprinted — regrouping is a presentation change, not a change to WHICH
     * thing is invoked (see {@link interfaceFingerprint}).
     */
    group: z.string().min(1).optional(),
    entry: InterfaceEntrySchema,
    steps: z.array(InterfaceStepSchema).min(1),
    /**
     * The world the interface ASSUMES, one plain sentence — an interface is one task a
     * user can perform from a specific state ("on an analyzed repository's page
     * with violation cards visible"), and this is that state. Decided 2026-08-11
     * for the web surface; optional so cli/api catalogs written before it parse
     * unchanged. Never fingerprinted: prose about the state is not WHICH task
     * the interface is.
     */
    startingState: z.string().min(1).optional(),
    /**
     * The observable world the task LEAVES behind, one plain sentence ("the rule
     * is disabled and its violation cards have left the list") — what a scenario
     * asserts after walking the steps. Same optionality and fingerprint rules as
     * `startingState`.
     */
    endState: z.string().min(1).optional(),
    /** `sha256:…` over the surface-visible shape — see {@link interfaceFingerprint}. */
    fingerprint: z.string().min(1),
    /** An OpenAPI operation with NO matching route registration: declared surface the
     *  code-side extraction couldn't find. Provenance, never fingerprinted — a spec-only
     *  interface that fails birth IS the documented-but-unimplemented drift signal. */
    specOnly: z.literal(true).optional(),
    /** The full public contract (grammar + io). Absent where the derivation
     *  established the command tree only. Never fingerprinted. */
    contract: InterfaceContractSchema.optional(),
  })
  .strict()
  .superRefine((iface, ctx) => {
    // THE STATE CHAIN — where both sides of a handoff are stated, they must
    // agree (whitespace-normalized, the corpus-wide prose rule): the first
    // step's input restates `startingState`, each step's output is the next
    // step's input, and the last step's output restates `endState`. A step
    // that states neither side is tolerated (older catalogs, cli trees); a
    // stated mismatch is a path whose middle doesn't connect, refused here
    // rather than discovered by a scenario that hangs on a dropdown that was
    // never opened.
    const same = (a: string, b: string) => normalizeToken(a) === normalizeToken(b)
    const refuse = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })

    const first = iface.steps[0]
    if (iface.startingState && first?.input && !same(iface.startingState, first.input)) {
      refuse(['steps', 0, 'input'], 'the first step’s input must restate the interface’s startingState')
    }
    iface.steps.forEach((step, i) => {
      const next = iface.steps[i + 1]
      if (next && step.output && next.input && !same(step.output, next.input)) {
        refuse(['steps', i + 1, 'input'], `step ${i + 2}’s input must restate step ${i + 1}’s output — the handoff doesn’t connect`)
      }
    })
    const last = iface.steps[iface.steps.length - 1]
    if (iface.endState && last?.output && !same(iface.endState, last.output)) {
      refuse(['steps', iface.steps.length - 1, 'output'], 'the last step’s output must restate the interface’s endState')
    }
  })
export type Interface = z.infer<typeof InterfaceSchema>

/**
 * How ONE surface's catalog was derived: `tree` = the analyzer's own artifacts
 * (the primary path, every surface), `probes` = the cli fallback ladder for a
 * framework no extractor recognizes. A degradation marker, not a quality claim.
 */
export const InterfaceCatalogSourceSchema = z.enum(['tree', 'probes'])
export type InterfaceCatalogSource = z.infer<typeof InterfaceCatalogSourceSchema>

/**
 * `.truecourse/guard/interfaces.json` — the last mapping's catalog (gitignored).
 *
 * `version` stays 1 as the contract fields land: they are additive and optional,
 * so a catalog written before them parses unchanged and a catalog written with
 * them parses in a reader that ignores them. The number is reserved for a change
 * that BREAKS one of those two directions.
 */
export const InterfacesFileSchema = z
  .object({
    version: z.literal(1),
    /** ISO timestamp of the mapping run that wrote the file. */
    generatedAt: z.string(),
    /** The recipe fingerprint the mapping ran against. */
    recipeFingerprint: z.string(),
    interfaces: z.array(InterfaceSchema),
    /** Per interface TYPE (a driver-registry id) → how that catalog was derived. */
    source: z.record(z.string(), InterfaceCatalogSourceSchema).optional(),
  })
  .strict()
export type InterfacesFile = z.infer<typeof InterfacesFileSchema>

/**
 * Canonical form of a route path template: params in `{name}` regardless of the
 * framework that declared them — `/todos/:id` (Express), `/todos/<int:id>` (Flask),
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

/** Whitespace-normalized token — the section-fingerprint rule, per field. */
function normalizeToken(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * A step's fingerprinted identity: its kind plus the SURFACE-VISIBLE payload —
 * the command path and its flag set, the method + path template, the route, the
 * target. `label` is cosmetic and never folded in, and the state handoff
 * (`input`/`output`) is prose about the world around the action, not WHICH
 * action it is — rewording a dropdown's description must never re-author a
 * scenario. Flags fold as a SET (sorted):
 * which flags a command accepts is the surface, the order help prints them is not.
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
 * descriptor, and each step's kind + payload — never internal symbol names, file
 * paths, or the call chain behind the surface. A rename/move refactor that leaves
 * what a user can reach unchanged must not move a single fingerprint, or every
 * refactor sprays drift dots across the scenario corpus and the signal dies of
 * alarm fatigue.
 *
 * The CONTRACT is excluded for the same reason: option metadata and io facts
 * describe what a command takes and returns, not WHICH command it is.
 * Learning a flag's choices or an exit code must leave every interface identity
 * (and therefore every scenario's grounding and every author-cache key) where it
 * was — the signature is `Pick<Interface, 'type' | 'entry' | 'steps'>` so a caller
 * cannot accidentally fold one in.
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
