/**
 * JOURNEYS — the code-side unit (HOW to test), derived deterministically from the
 * app's own surfaces (commands, routes, screens) with no LLM in the loop. A
 * journey is an entry-rooted interaction path over ONE surface; a scenario is one
 * spec flow realized through a journey path.
 *
 * Shared (not under `guard/`) because the analyze side renders the same shape.
 * The catalog snapshot lives at `.truecourse/guard/journeys.json` — gitignored and
 * re-derived from the working tree; the clone-portable part is the journey
 * FINGERPRINTS embedded in scenario YAMLs and the manifest.
 *
 * The step vocabulary is ONE envelope across every surface: a closed union keyed
 * by `kind`, so an api or web extractor lands additively (no new step schema, no
 * format event). A journey's `type` is a driver-registry id — the driver that
 * would execute its scenarios.
 */

import crypto from 'node:crypto'
import { z } from 'zod'
import { GuardDriverIdSchema } from './guard/drivers.js'

/** The closed step vocabulary, shared by every surface. */
export const JourneyStepKindSchema = z.enum([
  'invoke',
  'request',
  'navigate',
  'input',
  'activate',
])
export type JourneyStepKind = z.infer<typeof JourneyStepKindSchema>

/** Run a command (cli / tui): the argv PATH plus the flags that command accepts. */
export const JourneyInvokeStepSchema = z
  .object({
    kind: z.literal('invoke'),
    /** Argv path of the command, e.g. `["tasks", "add"]` — never the binary path. */
    command: z.array(z.string()).min(1),
    /** Flags the command accepts, e.g. `["--json", "--force"]`. */
    flags: z.array(z.string()).default([]),
    /** Human one-liner for display; cosmetic — never fingerprinted. */
    label: z.string().optional(),
  })
  .strict()

/** One HTTP request (api): the operation's method + path template. */
export const JourneyRequestStepSchema = z
  .object({
    kind: z.literal('request'),
    method: z.string().min(1),
    /** Path template as the surface declares it, e.g. `/tasks/:id`. */
    path: z.string().min(1),
    label: z.string().optional(),
  })
  .strict()

/** Move to a screen (web / desktop / mobile): the route as the surface declares it. */
export const JourneyNavigateStepSchema = z
  .object({
    kind: z.literal('navigate'),
    route: z.string().min(1),
    label: z.string().optional(),
  })
  .strict()

/** Put a value into a field — the target as the surface names it. */
export const JourneyInputStepSchema = z
  .object({
    kind: z.literal('input'),
    target: z.string().min(1),
    label: z.string().optional(),
  })
  .strict()

/** Click / tap / submit — the target as the surface names it. */
export const JourneyActivateStepSchema = z
  .object({
    kind: z.literal('activate'),
    target: z.string().min(1),
    label: z.string().optional(),
  })
  .strict()

export const JourneyStepSchema = z.discriminatedUnion('kind', [
  JourneyInvokeStepSchema,
  JourneyRequestStepSchema,
  JourneyNavigateStepSchema,
  JourneyInputStepSchema,
  JourneyActivateStepSchema,
])
export type JourneyInvokeStep = z.infer<typeof JourneyInvokeStepSchema>
export type JourneyRequestStep = z.infer<typeof JourneyRequestStepSchema>
export type JourneyNavigateStep = z.infer<typeof JourneyNavigateStepSchema>
export type JourneyInputStep = z.infer<typeof JourneyInputStepSchema>
export type JourneyActivateStep = z.infer<typeof JourneyActivateStepSchema>
export type JourneyStep = z.infer<typeof JourneyStepSchema>

/** A journey rooted at a cli command — the argv path it starts from. */
export const JourneyCommandEntrySchema = z
  .object({
    /** Argv path the journey is rooted at — at least one token (a root journey is
     *  rooted at the program's own command name). Never the resolved binary path. */
    command: z.array(z.string()).min(1),
  })
  .strict()
export type JourneyCommandEntry = z.infer<typeof JourneyCommandEntrySchema>

/** A journey rooted at an HTTP operation — the method + path template it serves. */
export const JourneyOperationEntrySchema = z
  .object({
    method: z.string().min(1),
    /** Canonical path template, params in `{name}` form (see `canonicalRoutePath`). */
    path: z.string().min(1),
  })
  .strict()
export type JourneyOperationEntry = z.infer<typeof JourneyOperationEntrySchema>

/** The surface-visible root of a journey, typed by the surface that declares it. */
export const JourneyEntrySchema = z.union([
  JourneyCommandEntrySchema,
  JourneyOperationEntrySchema,
])
export type JourneyEntry = z.infer<typeof JourneyEntrySchema>

/** One display/identity string for any entry shape — `spec docs` or `GET /todos/{id}`. */
export function journeyEntryLabel(entry: JourneyEntry): string {
  return 'command' in entry
    ? entry.command.join(' ')
    : `${entry.method.toUpperCase()} ${entry.path}`
}

// ---------------------------------------------------------------------------
// The journey CONTRACT — the full public grammar plus each command's input and
// output. Everything below is ADDITIVE and OPTIONAL: a catalog that carries only
// the command tree (the derivation's floor) stays valid, and the fields never
// enter {@link journeyFingerprint} — grammar detail is what a command TAKES, not
// which command it is, so enriching a journey must never roll its identity or
// re-author a single scenario.
//
// Two absences are distinguished everywhere, and neither is ever guessed:
// an OMITTED field means the extraction established nothing; an EMPTY array
// means it established "none". A fact a probe could not settle is recorded
// as {@link JOURNEY_UNKNOWN}.
// ---------------------------------------------------------------------------

/** A fact the extraction and its probes could not establish — recorded, never guessed. */
export const JOURNEY_UNKNOWN = 'unknown'

/** Where an option is passed: on the command itself, or before it (program-level). */
export const JourneyOptionScopeSchema = z.enum(['command', 'program'])
export type JourneyOptionScope = z.infer<typeof JourneyOptionScopeSchema>

/** One flag of a command's grammar, with everything a caller must know to pass it. */
export const JourneyOptionSchema = z
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
    scope: JourneyOptionScopeSchema.optional(),
    /** Registered but withheld from help output. */
    hidden: z.boolean().optional(),
    description: z.string().optional(),
  })
  .strict()
export type JourneyOption = z.infer<typeof JourneyOptionSchema>

/** One positional argument of a command. */
export const JourneyPositionalSchema = z
  .object({
    name: z.string().min(1),
    required: z.boolean(),
    /** Consumes the rest of the argv (`<files...>`). */
    variadic: z.boolean().optional(),
    description: z.string().optional(),
  })
  .strict()
export type JourneyPositional = z.infer<typeof JourneyPositionalSchema>

/**
 * One stdin interaction: a wizard, a confirmation, a password. A command that
 * never reads stdin says so as an entry named `none` carrying the REASON in
 * `when` — an empty list means the same thing without one.
 */
export const JourneyPromptSchema = z
  .object({
    /** What asks — the wizard or confirmation by name, or `none`. */
    name: z.string().min(1),
    /** The condition under which it fires (or never fires). */
    when: z.string().optional(),
    /** The individual questions, as the program words them. */
    prompts: z.array(z.string()).optional(),
  })
  .strict()
export type JourneyPrompt = z.infer<typeof JourneyPromptSchema>

/** State the command READS — a file, a directory, a git repository. */
export const JourneyIoReadSchema = z
  .object({
    path: z.string().min(1),
    /** What the command uses it for. */
    as: z.string().optional(),
  })
  .strict()
export type JourneyIoRead = z.infer<typeof JourneyIoReadSchema>

/** State the command WRITES. */
export const JourneyIoWriteSchema = z
  .object({
    path: z.string().min(1),
    /** The condition under which the write happens. */
    when: z.string().optional(),
    /** What lands in it. */
    content: z.string().optional(),
    note: z.string().optional(),
  })
  .strict()
export type JourneyIoWrite = z.infer<typeof JourneyIoWriteSchema>

/** One promise about an output stream — the assertion target a scenario reads off. */
export const JourneyOutputSchema = z
  .object({
    /** What the stream carries, named ("help page", "violations summary"). */
    shape: z.string().min(1),
    /** When this output appears. */
    when: z.string().optional(),
    /** The text itself, as precisely as the extraction established it. */
    content: z.string().optional(),
  })
  .strict()
export type JourneyOutput = z.infer<typeof JourneyOutputSchema>

/** One exit status and what it means. */
export const JourneyExitCodeSchema = z
  .object({
    /** The status as a STRING, so {@link JOURNEY_UNKNOWN} is sayable and a qualified
     *  code ("0 (early)") survives — an unestablished code is recorded, never invented. */
    code: z.string().min(1),
    means: z.string().min(1),
  })
  .strict()
export type JourneyExitCode = z.infer<typeof JourneyExitCodeSchema>

/** What a command takes in. */
export const JourneyConsumesSchema = z
  .object({
    /** Prose about the positional contract that the positional list itself can't carry. */
    positionalsNote: z.string().optional(),
    /** Prose about the flag contract. */
    flagsNote: z.string().optional(),
    stdin: z.array(JourneyPromptSchema).optional(),
    reads: z.array(JourneyIoReadSchema).optional(),
    /** Environment variables the command reads, and what each does. */
    environment: z.array(z.string()).optional(),
  })
  .strict()
export type JourneyConsumes = z.infer<typeof JourneyConsumesSchema>

/** What a command puts out. */
export const JourneyProducesSchema = z
  .object({
    stdout: z.array(JourneyOutputSchema).optional(),
    stderr: z.array(JourneyOutputSchema).optional(),
    writes: z.array(JourneyIoWriteSchema).optional(),
    exitCodes: z.array(JourneyExitCodeSchema).optional(),
    /** Effects outside the process's own output and state (a stash, a subprocess, an event). */
    sideEffects: z.array(z.string()).optional(),
  })
  .strict()
export type JourneyProduces = z.infer<typeof JourneyProducesSchema>

/** A command's input/output contract — the assertion targets, straight from the surface. */
export const JourneyIoSchema = z
  .object({
    consumes: JourneyConsumesSchema.optional(),
    produces: JourneyProducesSchema.optional(),
  })
  .strict()
export type JourneyIo = z.infer<typeof JourneyIoSchema>

/** The journey-level shared blocks a command can also carry. */
export const JourneySharedBlockSchema = z.enum([
  'stdin',
  'reads',
  'writes',
  'exitCodes',
  'environment',
  'files',
  'enumerations',
  'notes',
])
export type JourneySharedBlock = z.infer<typeof JourneySharedBlockSchema>

/**
 * "The journey's shared X applies here too." Stated once at journey level and
 * REFERENCED per command, so a fact every command in a tree inherits (a
 * program-level wizard, a config file every subcommand reads) is one fact, not
 * one copy per command that can drift apart.
 */
export const JourneySharedRefSchema = z
  .object({
    block: JourneySharedBlockSchema,
    /** What this command adds to, or narrows about, the shared block. */
    note: z.string().optional(),
  })
  .strict()
export type JourneySharedRef = z.infer<typeof JourneySharedRefSchema>

/** One command of the tree: its grammar, its io, and the behavior neither states. */
export const JourneyCommandContractSchema = z
  .object({
    /** The argv a user types, program name first — `["truecourse","rules","list"]`. */
    path: z.array(z.string()).min(1),
    description: z.string().optional(),
    options: z.array(JourneyOptionSchema).optional(),
    positionals: z.array(JourneyPositionalSchema).optional(),
    /** Subcommands this command registers, in registration order. */
    subcommands: z.array(z.string()).optional(),
    io: JourneyIoSchema.optional(),
    /** Behavior a caller must know that the grammar and the io do not state. */
    notes: z.array(z.string()).optional(),
    inheritsShared: z.array(JourneySharedRefSchema).optional(),
  })
  .strict()
export type JourneyCommandContract = z.infer<typeof JourneyCommandContractSchema>

/** A named value set the commands validate against (severities, categories, languages). */
export const JourneyEnumerationSchema = z
  .object({
    name: z.string().min(1),
    values: z.array(z.string()),
    note: z.string().optional(),
  })
  .strict()
export type JourneyEnumeration = z.infer<typeof JourneyEnumerationSchema>

/** A file the command tree reads or writes, with the keys it carries. */
export const JourneyContractFileSchema = z
  .object({
    path: z.string().min(1),
    keys: z.array(z.string()).optional(),
    note: z.string().optional(),
  })
  .strict()
export type JourneyContractFile = z.infer<typeof JourneyContractFileSchema>

/** Facts that hold for EVERY command of the tree — stated once, referenced per command. */
export const JourneySharedContractSchema = z
  .object({
    /** Why the block exists / how its commands reference it. */
    note: z.string().optional(),
    stdin: z.array(JourneyPromptSchema).optional(),
    reads: z.array(JourneyIoReadSchema).optional(),
    writes: z.array(JourneyIoWriteSchema).optional(),
    exitCodes: z.array(JourneyExitCodeSchema).optional(),
    environment: z.array(z.string()).optional(),
    enumerations: z.array(JourneyEnumerationSchema).optional(),
    files: z.array(JourneyContractFileSchema).optional(),
    /** Tree-wide rules (how the repository root resolves, what every command requires). */
    notes: z.array(z.string()).optional(),
  })
  .strict()
export type JourneySharedContract = z.infer<typeof JourneySharedContractSchema>

/**
 * A deliberate modelling decision the contract records about ITSELF — a place the
 * journey knowingly departs from what the program does today, with what that
 * costs. Never a guess: a decision names its consequences.
 */
export const JourneyDecisionSchema = z
  .object({
    id: z.string().min(1),
    decision: z.string().min(1),
    /** Consequences the contract deliberately does not model. */
    consequencesNotModeled: z.array(z.string()).optional(),
  })
  .strict()
export type JourneyDecision = z.infer<typeof JourneyDecisionSchema>

/** The journey's full public contract: the command tree with grammar and io. */
export const JourneyContractSchema = z
  .object({
    /** One line on what this journey covers. */
    summary: z.string().optional(),
    /** Where the contract came from — the registrations read, the probes run. */
    derivedFrom: z.array(z.string()).optional(),
    commands: z.array(JourneyCommandContractSchema).min(1),
    shared: JourneySharedContractSchema.optional(),
    decisions: z.array(JourneyDecisionSchema).optional(),
  })
  .strict()
export type JourneyContract = z.infer<typeof JourneyContractSchema>

/**
 * One finding ABOUT the contract — the doc-versus-code feed. Not a scenario
 * failure and not drift: a place the documentation and the program disagree (or
 * verifiably agree), or a place one derivation source saw what another missed.
 * `kind` is an open label because the vocabulary grows with the derivation
 * sources; `right` is the verdict as the finding records it.
 */
export const JourneyDiagnosticSchema = z
  .object({
    /** `docs-missing-behavior`, `grammar-agreement`, `tree-missing-flag`, … */
    kind: z.string().min(1),
    /** What the finding is about — a flag, a command, a behavior. */
    subject: z.string().min(1),
    detail: z.string().min(1),
    /** Which side is right (`code`, `both agree`, …). Absent when unsettled. */
    right: z.string().optional(),
  })
  .strict()
export type JourneyDiagnostic = z.infer<typeof JourneyDiagnosticSchema>

export const JourneySchema = z
  .object({
    /** `<type>/<slug>`, e.g. `cli/tasks-add`. */
    id: z.string().min(1),
    /** The surface — a driver-registry id (the driver that would run its scenarios). */
    type: GuardDriverIdSchema,
    title: z.string().min(1),
    entry: JourneyEntrySchema,
    steps: z.array(JourneyStepSchema).min(1),
    /** `sha256:…` over the surface-visible shape — see {@link journeyFingerprint}. */
    fingerprint: z.string().min(1),
    /** An OpenAPI operation with NO matching route registration: declared surface the
     *  code-side extraction couldn't find. Provenance, never fingerprinted — a spec-only
     *  journey that fails birth IS the documented-but-unimplemented drift signal. */
    specOnly: z.literal(true).optional(),
    /** The full public contract (grammar + io). Absent where the derivation
     *  established the command tree only. Never fingerprinted. */
    contract: JourneyContractSchema.optional(),
    /** Doc-versus-code findings for this journey. Never fingerprinted. */
    diagnostics: z.array(JourneyDiagnosticSchema).optional(),
  })
  .strict()
export type Journey = z.infer<typeof JourneySchema>

/**
 * How ONE surface's catalog was derived: `tree` = the analyzer's own artifacts
 * (the primary path, every surface), `probes` = the cli fallback ladder for a
 * framework no extractor recognizes. A degradation marker, not a quality claim.
 */
export const JourneyCatalogSourceSchema = z.enum(['tree', 'probes'])
export type JourneyCatalogSource = z.infer<typeof JourneyCatalogSourceSchema>

/**
 * `.truecourse/guard/journeys.json` — the last mapping's catalog (gitignored).
 *
 * `version` stays 1 as the contract fields land: they are additive and optional,
 * so a catalog written before them parses unchanged and a catalog written with
 * them parses in a reader that ignores them. The number is reserved for a change
 * that BREAKS one of those two directions.
 */
export const JourneysFileSchema = z
  .object({
    version: z.literal(1),
    /** ISO timestamp of the mapping run that wrote the file. */
    generatedAt: z.string(),
    /** The recipe fingerprint the mapping ran against. */
    recipeFingerprint: z.string(),
    journeys: z.array(JourneySchema),
    /** Per journey TYPE (a driver-registry id) → how that catalog was derived. */
    source: z.record(z.string(), JourneyCatalogSourceSchema).optional(),
  })
  .strict()
export type JourneysFile = z.infer<typeof JourneysFileSchema>

/**
 * Canonical form of a route path template: params in `{name}` regardless of the
 * framework that declared them — `/todos/:id` (Express), `/todos/<int:id>` (Flask),
 * `/todos/{id}` (OpenAPI/ASP.NET) all become `/todos/{id}`. One identity per
 * operation, so the code route and its OpenAPI declaration converge on ONE journey
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
 * target. `label` is cosmetic and never folded in. Flags fold as a SET (sorted):
 * which flags a command accepts is the surface, the order help prints them is not.
 */
function stepIdentity(step: JourneyStep): string {
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
 * `sha256:<hex>` over a journey's SURFACE-VISIBLE shape: its type, its entry
 * descriptor, and each step's kind + payload — never internal symbol names, file
 * paths, or the call chain behind the surface. A rename/move refactor that leaves
 * what a user can reach unchanged must not move a single fingerprint, or every
 * refactor sprays drift dots across the scenario corpus and the signal dies of
 * alarm fatigue.
 *
 * The CONTRACT is excluded for the same reason: option metadata, io promises and
 * diagnostics describe what a command takes and returns, not WHICH command it is.
 * Learning a flag's choices or an exit code must leave every journey identity
 * (and therefore every scenario's grounding and every author-cache key) where it
 * was — the signature is `Pick<Journey, 'type' | 'entry' | 'steps'>` so a caller
 * cannot accidentally fold one in.
 */
export function journeyFingerprint(
  journey: Pick<Journey, 'type' | 'entry' | 'steps'>,
): string {
  const entryIdentity =
    'command' in journey.entry
      ? journey.entry.command.map(normalizeToken).join(' ')
      : [
          normalizeToken(journey.entry.method).toUpperCase(),
          normalizeToken(journey.entry.path),
        ].join(' ')
  const body = [journey.type, entryIdentity, ...journey.steps.map(stepIdentity)].join('\n')
  return `sha256:${crypto.createHash('sha256').update(body, 'utf-8').digest('hex')}`
}
