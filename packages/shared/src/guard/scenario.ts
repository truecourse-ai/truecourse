/**
 * Guard scenario format v3 — the committed, declarative test that realizes ONE
 * spec flow on ONE surface. One YAML file per scenario under
 * `.truecourse/scenarios/<area>/`.
 *
 * A scenario is the executable product of a FLOW (spec-side: what to test) and a
 * JOURNEY path (code-side: how to test it): assertions come from the flow's spec
 * claims, steps from the journey, the driver from the journey's surface. It
 * carries `flow` (id + fingerprint), `journey` (the realization path + its
 * fingerprints), and the flow's section bindings DENORMALIZED into `binds`, so the
 * runner resolves staleness with no flow lookup. Hand-written scenarios omit
 * `flow`/`journey` and group under the Manual pseudo-flow.
 *
 * Ids are `<flow-id>.<surface>.<n>`.
 *
 * The envelope (`guard`, `id`, `title`, `flow`, `journey`, `binds`, `driver`,
 * `setup`, `steps`, `normalize`) is frozen across drivers; only the per-driver
 * verb sub-schema (keyed by `driver`) grows. The `cli` driver has five step
 * kinds — `run` (argv appended to the recipe entrypoint), `git` (argv handed to
 * `git`, the one other program a scenario may invoke, because hooks only trigger
 * through it and the docs state their claims in git terms), `write` /
 * `delete` (sandbox file mutation BETWEEN runs, which is what a two-state claim
 * — new vs resolved, enabled then disabled — needs), and `patch` (ONE key path of
 * a JSON document set or removed, for the file a test must edit but does not own)
 * — with `expect` matchers on
 * exit code, streams, the combined output, and files. The `api` driver boots the
 * recipe's HTTP server and drives it with `request` steps, with `expect` matchers
 * on status, headers, body text, and JSON paths — plus the process-lifecycle steps
 * `boot` / `signal` / `logs`, which make startup, configuration, shutdown, logging
 * and restart-persistence claims assertable on the same surface. Every step MAY
 * carry the `milestone`s it realizes.
 */

import { z } from 'zod'
import {
  GuardCliCapturesSchema,
  GuardComparisonSchema,
  capturedNamesIn,
  capturingGroupCount,
  describeComparison,
  type GuardComparison,
} from './capture.js'
import { suppliedTokenRefs } from './dependencies.js'
import type { GuardStepActual } from './step-actuals.js'

/**
 * Scenario format version carried in every file and echoed into the run store.
 *
 * v3 grew the cli step vocabulary (`git`, `write`, `delete`, per-step `cwd`/`tty`/
 * `note`), the combined-stream `expect.output` matcher, `${sandbox}` interpolation,
 * git identity/root in setup, and milestones as a LIST of references. Steps written
 * for v2 parse unchanged under it — only the version number moves.
 *
 * WHAT THE NUMBER GATES, and why the `patch` step did not move it (2026-08-09).
 * The loader accepts this number and no other: an older file is turned away with
 * "re-run `truecourse guard generate`" instead of a schema error. So the number
 * buys ONE thing — BACKWARD readability, the promise that a build can still read
 * what earlier builds wrote — and it must move exactly when that promise breaks.
 *
 * It is not forward compatibility for older builds: every schema here is
 * `.strict()`, so ANY growth already fails an older parser. `timeoutMs`, `capture`,
 * `needs`, `promise`, `server` and prompt-keyed `stdin` each did, and none of them
 * bumped. A new step KIND is the same case, not a worse one — an older build
 * rejects a patch-bearing file loudly either way, and every file written before
 * `patch` existed parses unchanged under this build. Bumping would instead turn
 * away the ENTIRE committed corpus and force a full re-author over a vocabulary
 * no existing file uses, which is a cost with no promise behind it.
 */
export const GUARD_FORMAT_VERSION = 3

// --- Stream & file matchers -----------------------------------------

/** Stream (stdout/stderr) matcher — one of the four, compared post-normalization. */
export const GuardStreamMatcherSchema = z
  .object({
    equals: z.string().optional(),
    contains: z.string().optional(),
    /** Regex source; matched with `RegExp(pattern).test(stream)`. */
    matches: z.string().optional(),
    /**
     * A NUMERIC comparison on what the stream carries — the form a CAPTURED value
     * makes assertable (`atMost: "${captured:estimate}"`). See
     * {@link GuardComparisonSchema}; the other three matchers say everything there
     * is to say about text.
     */
    compare: GuardComparisonSchema.optional(),
  })
  .strict()
  .refine(
    (m) =>
      m.equals !== undefined ||
      m.contains !== undefined ||
      m.matches !== undefined ||
      m.compare !== undefined,
    { message: 'stream matcher needs one of equals | contains | matches | compare' },
  )

/** File matcher — presence or content of a path under the sandbox cwd. */
export const GuardFileMatcherSchema = z
  .object({
    exists: z.boolean().optional(),
    absent: z.boolean().optional(),
    equals: z.string().optional(),
    contains: z.string().optional(),
    /**
     * Regex source; matched with `RegExp(pattern).test(content)` against the file's
     * WHOLE text (post-normalization), exactly as the stream matcher's `matches`
     * works — same compile path, same load-time rejection of a source `new RegExp`
     * refuses. Anchoring is the pattern's own business.
     *
     * What `contains` cannot say: several INDEPENDENT markers in one file, in no
     * fixed order — `^(?=[\s\S]*alpha)(?=[\s\S]*beta)[\s\S]*$`. Written as separate
     * `contains` assertions they would need separate paths, and a file matcher is
     * keyed BY path, so the second would silently replace the first.
     */
    matches: z.string().optional(),
  })
  .strict()
  .refine(
    (m) =>
      m.exists !== undefined ||
      m.absent !== undefined ||
      m.equals !== undefined ||
      m.contains !== undefined ||
      m.matches !== undefined,
    { message: 'file matcher needs one of exists | absent | equals | contains | matches' },
  )

export const GuardExpectSchema = z
  .object({
    exit: z.number().int().optional(),
    stdout: GuardStreamMatcherSchema.optional(),
    stderr: GuardStreamMatcherSchema.optional(),
    /**
     * Matcher on stdout and stderr TOGETHER (stdout first, then stderr), compared
     * post-normalization. The honest matcher for a message no journey pins to a
     * stream — a warning or an error text the contract never places — where
     * asserting one stream would encode a guess. It is also the whole output of a
     * `tty: true` step, whose pseudo-terminal carries one channel by construction.
     */
    output: GuardStreamMatcherSchema.optional(),
    /** Sandbox-relative path → matcher. */
    files: z.record(z.string(), GuardFileMatcherSchema).optional(),
  })
  .strict()

/** What a `write`/`delete` step may assert: file state only — it runs no process. */
export const GuardFileExpectSchema = z
  .object({ files: z.record(z.string(), GuardFileMatcherSchema) })
  .strict()

// --- Milestone attribution (every driver's steps) --------------------

/**
 * ONE milestone a step realizes, as a reference: the flow milestone's 1-based
 * `order`, or the CLAIM IDENTITY it proves. Position is what the engine emits
 * today (flow milestones have no stored id yet); an identity is what an authored
 * corpus tags, and what survives a flow being reordered or renumbered. Both are
 * accepted so the two can coexist while the claims store lands.
 */
export const GuardMilestoneRefSchema = z.union([z.number().int().positive(), z.string().min(1)])
export type GuardMilestoneRef = z.infer<typeof GuardMilestoneRefSchema>

/**
 * The milestone(s) a step realizes — one reference or several. Several is not a
 * convenience: when two docs restate the same behavior, ONE observation proves
 * both claims, and inventing a second weaker step per claim would be assertion
 * theater. Authoring emits it; the engine validates every milestone is realized by
 * at least one step. A step with no milestone is plumbing (login, seeding) and
 * paints neutral in a flow instance.
 */
export const GuardStepMilestoneSchema = z.union([
  GuardMilestoneRefSchema,
  z.array(GuardMilestoneRefSchema).min(1),
])
export type GuardStepMilestone = z.infer<typeof GuardStepMilestoneSchema>

const milestone = GuardStepMilestoneSchema.optional()

/** Every milestone reference a step carries, as a list (empty when it carries none). */
export function milestoneRefs(value: GuardStepMilestone | undefined): GuardMilestoneRef[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** True when the step realizes at least one milestone (i.e. it is not plumbing). */
export function hasMilestone(value: GuardStepMilestone | undefined): boolean {
  return milestoneRefs(value).length > 0
}

/**
 * The flow-milestone POSITION a step realizes — the first positional reference it
 * carries, or undefined when it carries none (a step tagged only with claim
 * identities has no position until the claims store can resolve them). This is what
 * `failedMilestone` and the flow-instance paint read.
 */
export function milestoneOrder(value: GuardStepMilestone | undefined): number | undefined {
  return milestoneRefs(value).find((ref): ref is number => typeof ref === 'number')
}

/** The claim identities a step is tagged with, in order. */
export function milestoneClaims(value: GuardStepMilestone | undefined): string[] {
  return milestoneRefs(value).filter((ref): ref is string => typeof ref === 'string')
}

// --- Steps (cli driver) ----------------------------------------------

/**
 * Sandbox-relative working directory for ONE step, resolved against the sandbox
 * cwd. A scenario that drives a second repository, a linked worktree or a fresh
 * clone needs it: those are sibling directories, and every step would otherwise
 * run in the sandbox root. A path escaping the sandbox is a scenario defect.
 */
const cwd = z.string().min(1).optional()

/** Free-text authoring note: why THIS assertion is the falsifiable form of the claim. */
const note = z.string().min(1).optional()

/**
 * Wall-clock budget for ONE step's child process, in milliseconds. Omitted ⇒ the
 * runner's default, which is sized for a command that answers immediately.
 *
 * Some documented commands do not: a run that sends source code to a model, a
 * build, an install. Their claim is still "exit 0 and print N files", and the only
 * thing standing between that claim and a verdict is time — so the honest place to
 * say how much time is the step, beside the command that needs it, not a run-wide
 * flag that would slacken every other step with it. A step that overruns is still
 * infrastructure (`error`), never a `fail`: the budget says what patience the claim
 * requires, it does not assert speed. Assert speed with `expect`, not with this.
 *
 * The cap is one hour — long enough for any single command a scenario may
 * legitimately wait on, short enough that a typo cannot hang a run for a day.
 *
 * Additive and optional, so no `GUARD_FORMAT_VERSION` bump: a scenario that
 * declares none parses and runs exactly as it did before.
 */
const timeoutMs = z.number().int().positive().max(3_600_000).optional()

/**
 * What this step takes OUT of its own output for the steps after it: name → the
 * pattern whose single capturing group is the value. Later steps reach it as
 * `${captured:<name>}` in their argv, env, written content and EXPECTATIONS. See
 * {@link GuardCliCapturesSchema}; the rules that span steps (single assignment,
 * no forward or self reference) are {@link captureDefects}, checked at load.
 *
 * Additive and optional, so no `GUARD_FORMAT_VERSION` bump (the `timeoutMs`
 * precedent): a scenario that captures nothing parses and runs exactly as it did.
 */
const capture = GuardCliCapturesSchema.optional()

/**
 * An argv pair that is only there when the machine has something to put in it:
 * `optional: ["--base-url", "${supplied:llm-api-credentials.base-url}"]`.
 *
 * A registration may DECLARE a variable optional — the program has a working
 * default for it (a provider's own endpoint), so leaving it blank is a legitimate
 * answer that never holds the dependency back. The scenario still has to name the
 * flag somewhere, and a plain argv element cannot express "…unless nobody
 * registered one": the token would either resolve to a value or blow the run up.
 * This element says it. When the field IS registered the pair behaves like the two
 * strings it is; when the field is a declared-optional one the user left blank,
 * BOTH halves drop out of the argv and the program falls back to its own default.
 *
 * Scoped to exactly that case, deliberately: a token naming a REQUIRED field that
 * is unregistered still blocks the scenario before it runs, and one naming a field
 * the registration does not declare at all is still the loud authoring error it has
 * always been. The value must therefore carry a `${supplied:…}` token — a pair with
 * nothing to be optional about would never drop, and saying "optional" about it
 * would be a lie the loader can catch.
 */
export const GuardOptionalArgSchema = z
  .object({ optional: z.tuple([z.string().min(1), z.string().min(1)]) })
  .strict()
  .superRefine((arg, ctx) => {
    if (suppliedTokenRefs(arg.optional[1]).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'an optional argv pair is dropped when its `${supplied:…}` field is unregistered, ' +
          'so its value must reference one',
        path: ['optional', 1],
      })
    }
  })
export type GuardOptionalArg = z.infer<typeof GuardOptionalArgSchema>

/** ONE element of a `run` argv: a plain argument, or an omittable pair. */
export const GuardRunArgSchema = z.union([z.string(), GuardOptionalArgSchema])
export type GuardRunArg = z.infer<typeof GuardRunArgSchema>

/** True when this argv element is a pair that may drop out. See {@link GuardOptionalArgSchema}. */
export function isOptionalArg(arg: GuardRunArg): arg is GuardOptionalArg {
  return typeof arg !== 'string'
}

/**
 * A `run` argv as WORDS — every optional pair flattened to its two halves. The
 * display form (a step list, a validate rule): it shows what the step means to run,
 * which is not always what a given machine runs. Only the runner resolves the drops.
 */
export function runArgvWords(run: readonly GuardRunArg[]): string[] {
  return run.flatMap((arg) => (isOptionalArg(arg) ? [...arg.optional] : [arg]))
}

/**
 * ONE scripted terminal answer, KEYED TO THE QUESTION IT ANSWERS: the marker is
 * the question's stable substring (the journey contract's `prompts[].marker`),
 * and the answer is the keystrokes typed once that marker has appeared in the
 * child's output — submit key included, because which key submits is part of the
 * answer (`y` for a confirm that takes a printable, `\r` for a select that only
 * accepts a carriage return).
 *
 * The marker is matched against what the program WROTE, with the terminal's own
 * doing removed: ANSI escapes stripped and `\r\n` folded to `\n`, the same text
 * an `expect.output` matcher sees. Keep it short — one distinctive fragment of the
 * question, never a whole rendered line, whose framing characters and colors are
 * the prompt library's, not the program's.
 */
export const GuardTtyAnswerSchema = z
  .object({
    /** The question's stable substring — what must appear before this is typed. */
    marker: z.string().min(1),
    /** The keystrokes typed once the marker appears, submit key included. */
    answer: z.string().min(1),
  })
  .strict()

/**
 * A step's scripted input, in either of its two forms.
 *
 * A STRING is the bytes themselves: piped to the child's stdin on an ordinary
 * step, and — on a `tty` step — typed at the terminal on the runner's silence
 * heuristic (the child goes quiet, the next answer is typed). That heuristic is
 * what a long non-prompt phase defeats: a login preflight with a spinner has
 * quiet gaps of its own, they spend the answers before the real question is ever
 * asked, and the step then hangs at the prompt until its budget runs out.
 *
 * A LIST of {@link GuardTtyAnswerSchema} is the prompt-keyed form, and the
 * discipline for anything interactive: each answer names the question it replies
 * to, and the runner types it only once that question has actually been asked.
 * Nothing is guessed from timing, so a preflight of any length changes nothing —
 * and an answer whose question never comes is the step FAILING with the marker as
 * evidence, not a wait to the timeout.
 *
 * Prompt-keyed answers require `tty: true`: a question is only asked of a
 * terminal, so keying answers to questions a piped step can never be asked would
 * be a scenario that cannot mean what it says.
 *
 * Additive, so no `GUARD_FORMAT_VERSION` bump (the `timeoutMs` precedent): every
 * committed scenario that scripted a string still parses and still runs the way
 * it did.
 */
export const GuardStepStdinSchema = z.union([z.string(), z.array(GuardTtyAnswerSchema).min(1)])

/** True when a step's scripted input names the prompt each answer replies to. */
export function isPromptKeyedStdin(
  stdin: string | readonly GuardTtyAnswer[] | undefined,
): stdin is readonly GuardTtyAnswer[] {
  return Array.isArray(stdin)
}

/**
 * The one rule the step object cannot state field-by-field: prompt-keyed answers
 * are typed AT A TERMINAL, so the step must declare one. Applied to the runner's
 * step schema and to the authoring schema that narrows it, so a committed
 * scenario and a freshly authored one are rejected by the same sentence.
 */
export function promptKeysNeedATerminal(
  step: { stdin?: string | readonly GuardTtyAnswer[]; tty?: true },
  ctx: z.RefinementCtx,
): void {
  if (isPromptKeyedStdin(step.stdin) && step.tty !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'prompt-keyed answers are typed at a terminal — the step must declare `tty: true` ' +
        '(a piped step is never asked a question)',
      path: ['stdin'],
    })
  }
}

/** The `run` step's FIELDS, before {@link promptKeysNeedATerminal} is applied. */
export const GuardStepObjectSchema = z
  .object({
    /** Argv appended to the recipe entrypoint. May be empty (run the bare entry). */
    run: z.array(GuardRunArgSchema),
    stdin: GuardStepStdinSchema.optional(),
    /**
     * Env overlay for THIS step's child process only, applied on top of the
     * scenario-global `setup.env` (last layer wins). Sibling steps are unaffected,
     * so one scenario can observe the same command under several environments —
     * the world-state a claim like "prints `disabled` when `X=0`" needs. `cli` only:
     * an api step drives a server whose env is fixed at boot.
     */
    env: z.record(z.string(), z.string()).optional(),
    /** Sandbox-relative working directory for this step. See {@link cwd}. */
    cwd,
    /**
     * Run the command on a PSEUDO-TERMINAL instead of pipes. A prompt-path claim is
     * only reachable this way: a command that asks a question checks `isTTY` and
     * exits instead of asking when its stdin is a pipe. `stdin` carries the scripted
     * answers, written to the terminal as if typed — prompt-keyed (each answer
     * naming its question, see {@link GuardStepStdinSchema}) for anything
     * interactive. A terminal has ONE output channel, so everything the child
     * writes arrives as stdout (and as `expect.output`); `expect.stderr` on a tty
     * step asserts against an empty stream, which is why the combined matcher exists.
     */
    tty: z.literal(true).optional(),
    /** Run the step N times; every iteration must satisfy `expect`. Default 1. */
    repeat: z.number().int().positive().optional(),
    /**
     * How long this command may take before the runner kills it. See
     * {@link timeoutMs}. Applies to EACH `repeat` iteration, as the default does.
     */
    timeoutMs,
    expect: GuardExpectSchema,
    /** What later steps may reuse from this step's output. See {@link capture}. */
    capture,
    /** Why this assertion is the falsifiable form of the claim. See {@link note}. */
    note,
    /** The flow milestone(s) this step realizes. See {@link GuardStepMilestoneSchema}. */
    milestone,
  })
  .strict()

/** ONE `run` step — the program under test, invoked with argv and scripted input. */
export const GuardStepSchema = GuardStepObjectSchema.superRefine(promptKeysNeedATerminal)

/**
 * Invoke `git` in the sandbox — the ONE program besides the entrypoint a scenario
 * may run, and only because the behavior under test is stated in git's terms: a
 * pre-commit hook's only trigger IS `git commit`, and claims like "the baseline is
 * committable" or "a fresh clone inherits it" are assertions about `git add`,
 * `git check-ignore`, `git worktree`. There is no shell: `git` is spawned directly
 * with this argv.
 *
 * Identity is never the developer's: the step's own `identity`, else the
 * scenario's `setup.git.identity`, else the runner's pinned constant. The child's
 * HOME is the sandbox and both global and system git config are switched off, so
 * nothing on the host machine can perturb the result.
 */
export const GuardGitStepSchema = z
  .object({
    /** Argv passed to `git` (the program name is NOT repeated here). */
    git: z.array(z.string()).min(1),
    stdin: z.string().optional(),
    /** Env overlay for this invocation only (same layering as a `run` step). */
    env: z.record(z.string(), z.string()).optional(),
    /** Sandbox-relative working directory for this step. See {@link cwd}. */
    cwd,
    /** Commit identity for THIS invocation, overriding the scenario's. */
    identity: z.object({ name: z.string().min(1), email: z.string().min(1) }).strict().optional(),
    /** How long this invocation may take. See {@link timeoutMs}. */
    timeoutMs,
    expect: GuardExpectSchema,
    /** What later steps may reuse from this invocation's output (a commit sha,
     *  a branch name). Same block a `run` step carries. See {@link capture}. */
    capture,
    note,
    milestone,
  })
  .strict()

/**
 * Materialize files MID-SCENARIO: sandbox-relative path → content, written (and
 * parent-dir-created) in declaration order. `setup.files` seeds only before the
 * first step, which cannot express a claim about what changes BETWEEN two runs —
 * a violation introduced then resolved, a policy file edited then re-read.
 */
export const GuardWriteStepSchema = z
  .object({
    write: z.record(z.string(), z.string()),
    /** File-state assertions after the write. See {@link GuardFileExpectSchema}. */
    expect: GuardFileExpectSchema.optional(),
    /** Sandbox-relative base the written paths resolve against. See {@link cwd}. */
    cwd,
    note,
    milestone,
  })
  .strict()

/** Remove sandbox files mid-scenario — the other half of the two-state claim. */
export const GuardDeleteStepSchema = z
  .object({
    delete: z.array(z.string().min(1)).min(1),
    expect: GuardFileExpectSchema.optional(),
    /** Sandbox-relative base the deleted paths resolve against. See {@link cwd}. */
    cwd,
    note,
    milestone,
  })
  .strict()

// --- The `patch` step: one key path of a JSON document ----------------

/**
 * A value a `set` may write — the closed set of things a JSON document can hold.
 *
 * ONE gate does the checking: {@link jsonValueDefect} walks the value to its leaves
 * and returns the first thing JSON cannot carry, named by its position. A zod union
 * of the six JSON forms would state the same rule and report it far worse — six
 * member failures for one typo, none of them the sentence that helps — and, being
 * recursive, would render as a cyclic JSON Schema in a structured-output request.
 *
 * `undefined` is not a member, and neither is anything JSON cannot carry (a Date —
 * which is what a bare `2026-08-09` in YAML parses to — a function, `NaN`, an
 * infinity). Each of them would be silently dropped or rewritten by
 * `JSON.stringify`, which is exactly the silent partial apply this step must never
 * perform.
 */
export type GuardJsonValue =
  | string
  | number
  | boolean
  | null
  | GuardJsonValue[]
  | { [key: string]: GuardJsonValue }

/** The first non-JSON leaf inside a value, named by its position — else null. */
function jsonValueDefect(value: unknown, at: string): string | null {
  if (value === null) return null
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return null
    case 'number':
      return Number.isFinite(value) ? null : `${at || 'the value'} is ${value}, which JSON cannot carry`
    case 'undefined':
      return `${at || 'the value'} has no value — write it under \`remove\` to take the key away`
    case 'object':
      break
    default:
      return `${at || 'the value'} is a ${typeof value}, not a JSON value`
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const defect = jsonValueDefect(value[i], `${at}[${i}]`)
      if (defect) return defect
    }
    return null
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return `${at || 'the value'} is a ${(value as object).constructor?.name ?? 'class'} instance, not a JSON value`
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const defect = jsonValueDefect(item, at ? `${at}.${key}` : key)
    if (defect) return defect
  }
  return null
}

const GuardJsonValueSchema = z.unknown().superRefine((value, ctx) => {
  const defect = jsonValueDefect(value, '')
  if (defect) ctx.addIssue({ code: z.ZodIssueCode.custom, message: defect })
}) as unknown as z.ZodType<GuardJsonValue>

/**
 * A key path's SEGMENTS — the JSON object keys it addresses, in order — or the
 * sentence naming why the text is not a key path.
 *
 * A path is dot-separated (`api.build.command`). A key that CONTAINS a dot is
 * written with the dot escaped (`scripts.build\.prod` addresses `scripts`, then
 * `build.prod`), and a literal backslash is `\\`; nothing else may follow a
 * backslash. An empty segment (`a..b`, a leading or trailing dot) is rejected too:
 * both it and a dangling escape are typos that would otherwise silently address a
 * key nobody meant, and a patch's whole promise is that it changes what it names.
 *
 * Object keys only — a numeric segment is a KEY named "0", never an array index.
 * Arrays are values a patch sets and reads back whole; addressing INTO one would
 * need index and bounds semantics the configs and manifests these flows patch do
 * not use.
 */
export function guardKeyPathSegments(path: string): { segments: string[] } | { error: string } {
  const segments: string[] = []
  let current = ''
  const empty = (): { error: string } => ({
    error: `key path "${path}" has an empty segment — every key must be named (write \\. for a dot inside a key)`,
  })
  for (let i = 0; i < path.length; i++) {
    const ch = path[i]
    if (ch === '\\') {
      const next = path[i + 1]
      if (next === undefined) {
        return { error: `key path "${path}" ends in a lone backslash — write \\\\ for a literal backslash` }
      }
      if (next !== '.' && next !== '\\') {
        return {
          error: `key path "${path}" has an unknown escape "\\${next}" — the only escapes are \\. (a dot inside a key) and \\\\ (a backslash)`,
        }
      }
      current += next
      i++
      continue
    }
    if (ch === '.') {
      if (current === '') return empty()
      segments.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current === '') return empty()
  segments.push(current)
  return { segments }
}

/**
 * Segments rendered back as a key path — the inverse of {@link guardKeyPathSegments}.
 * Every failure message names the offending path THIS way, so what a reader is told
 * can be pasted straight back into the scenario.
 */
export function guardKeyPathText(segments: readonly string[]): string {
  return segments.map((s) => s.replace(/\\/g, '\\\\').replace(/\./g, '\\.')).join('.')
}

/** True when a patch target is a JSON document, which is the only format it edits. */
function isJsonTarget(file: string): boolean {
  return /\.json$/i.test(file)
}

/** One file's operations: key path → value to set, and key paths to remove. */
export const GuardPatchOperationsSchema = z
  .object({
    /**
     * Key path → the value to write there. The FINAL key may be new — setting a
     * field the document does not carry yet is the point — but every intermediate
     * container must already exist and be an object; see {@link GuardPatchStepSchema}.
     */
    set: z.record(z.string(), GuardJsonValueSchema).optional(),
    /** Key paths to delete. Each must exist in full, or the step fails. */
    remove: z.array(z.string().min(1)).optional(),
  })
  .strict()

/**
 * Set (or remove) named key paths in JSON documents, leaving everything else as
 * found: `patch` maps a sandbox-relative file to its operations.
 *
 * This is the edit a `write` step cannot make. `write` replaces a whole file, so a
 * test can only use it on a file it OWNS every byte of; the file a flow usually
 * needs to change is one the program itself produced (a recipe, a config, a
 * manifest), where inventing the other fields would be asserting a shape the test
 * was never told. A patch names one key and one value and leaves the rest alone.
 *
 * Every way a patch could quietly mean something else is the STEP FAILING instead:
 *  - the file is not there (never created — a patch edits, it does not seed);
 *  - the file is not valid JSON (reported with the position the parser stopped at);
 *  - a `set`'s intermediate container is missing (never conjured) or is not an
 *    object (reported with the type that is actually there);
 *  - a `remove`'s key path does not exist in full.
 * Failures name the deepest key path that DOES exist, and a step that fails on any
 * one of its operations writes NONE of them — one edit or none, never half.
 *
 * FORMATTING IS NORMALIZED, not preserved: the document is re-serialized with
 * 2-space indent and a trailing newline (the store convention). A patch is an edit
 * to a document's CONTENT; asserting on its byte layout afterwards is asserting on
 * this rule, not on the program.
 *
 * JSON only, enforced on the authored path's suffix so it fails at load rather than
 * after a sandbox has been paid for. Another structured format would arrive as an
 * explicit format field, never as content sniffing.
 */
export const GuardPatchStepSchema = z
  .object({
    /** Sandbox-relative `.json` path → the operations applied to it, in file order. */
    patch: z.record(z.string().min(1), GuardPatchOperationsSchema),
    /** File-state assertions after the patch. See {@link GuardFileExpectSchema}. */
    expect: GuardFileExpectSchema.optional(),
    /** Sandbox-relative base the patched paths resolve against. See {@link cwd}. */
    cwd,
    note,
    milestone,
  })
  .strict()
  .superRefine((step, ctx) => {
    const files = Object.entries(step.patch)
    if (files.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a patch step names at least one file to edit',
        path: ['patch'],
      })
    }
    for (const [file, ops] of files) {
      if (!isJsonTarget(file)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${file}" is not a JSON file — a patch edits JSON documents only (the path must end in .json)`,
          path: ['patch', file],
        })
      }
      const paths = [...Object.keys(ops.set ?? {}), ...(ops.remove ?? [])]
      if (paths.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${file}" is patched with no operations — name a \`set\`, a \`remove\`, or both`,
          path: ['patch', file],
        })
      }
      for (const keyPath of paths) {
        const parsed = guardKeyPathSegments(keyPath)
        if ('error' in parsed) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: parsed.error, path: ['patch', file] })
        }
      }
    }
  })

/** ONE cli step — one action: run the program, run git, or mutate sandbox files. */
export const GuardCliStepSchema = z.union([
  GuardStepSchema,
  GuardGitStepSchema,
  GuardWriteStepSchema,
  GuardDeleteStepSchema,
  GuardPatchStepSchema,
])

/** True when the step invokes the program under test. */
export function isRunStep(step: GuardCliStep): step is GuardStep {
  return 'run' in step
}

/** True when the step invokes `git`. */
export function isGitStep(step: GuardCliStep): step is GuardGitStep {
  return 'git' in step
}

/** True when the step writes sandbox files. */
export function isWriteStep(step: GuardCliStep): step is GuardWriteStep {
  return 'write' in step
}

/** True when the step deletes sandbox files. */
export function isDeleteStep(step: GuardCliStep): step is GuardDeleteStep {
  return 'delete' in step
}

/** True when the step edits key paths inside sandbox JSON documents. */
export function isPatchStep(step: GuardCliStep): step is GuardPatchStep {
  return 'patch' in step
}

/** True when the step spawns a process (and therefore has an exit code and streams). */
export function isProcessStep(step: GuardCliStep): step is GuardStep | GuardGitStep {
  return isRunStep(step) || isGitStep(step)
}

// --- Steps (api driver) ----------------------------------------------

/** The closed HTTP method set an api step may use. */
export const GUARD_HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const

/**
 * One HTTP request against the recipe's booted server. `path` (and header/body
 * string values) may reference earlier `capture`s as `${name}`; the engine
 * interpolates before sending. Exactly one body form: `body` (raw text, sent
 * as-is) or `json` (a JSON value, serialized with `content-type: application/json`).
 */
export const GuardHttpRequestSchema = z
  .object({
    method: z.enum(GUARD_HTTP_METHODS),
    /** Request path incl. query, e.g. `/todos/${id}?full=1`. Must start with `/`. */
    path: z.string().regex(/^\//, 'path must start with /'),
    headers: z.record(z.string(), z.string()).optional(),
    /** Raw request body, sent byte-for-byte. */
    body: z.string().optional(),
    /** JSON request body; serialized and sent with `content-type: application/json`. */
    json: z.unknown().optional(),
  })
  .strict()
  .refine((r) => r.body === undefined || r.json === undefined, {
    message: 'a request carries `body` or `json`, not both',
  })

/**
 * Matcher on the value at one JSON path of the response body. `equals` compares
 * the JSON value (scalars compared strictly; objects/arrays structurally);
 * `contains`/`matches` compare against the value's string form.
 */
export const GuardJsonMatcherSchema = z
  .object({
    equals: z.unknown().optional(),
    contains: z.string().optional(),
    /** Regex source; matched with `RegExp(pattern).test(String(value))`. */
    matches: z.string().optional(),
    exists: z.boolean().optional(),
    absent: z.boolean().optional(),
    /**
     * A NUMERIC comparison on the value at this path — the json subject's half of
     * the captured-value vocabulary. The value is usually already a number, so
     * `compare.number` is rarely needed here. See {@link GuardComparisonSchema}.
     */
    compare: GuardComparisonSchema.optional(),
  })
  .strict()
  .refine(
    (m) =>
      m.equals !== undefined ||
      m.contains !== undefined ||
      m.matches !== undefined ||
      m.exists !== undefined ||
      m.absent !== undefined ||
      m.compare !== undefined,
    { message: 'json matcher needs one of equals | contains | matches | exists | absent | compare' },
  )

export const GuardApiExpectSchema = z
  .object({
    /** Exact HTTP status code. */
    status: z.number().int().optional(),
    /** Header name (case-insensitive) → matcher on its value. */
    headers: z.record(z.string(), GuardStreamMatcherSchema).optional(),
    /** Matcher on the raw response body text, compared post-normalization. */
    body: GuardStreamMatcherSchema.optional(),
    /** JSON path (`a.b[0].c`, `""` for the root) → matcher on the value there. */
    json: z.record(z.string(), GuardJsonMatcherSchema).optional(),
    /**
     * Response-schema conformance (B5): `true` asserts the whole response body
     * conforms to the JSON response schema the BOUND OpenAPI operation declares for
     * this step's `expect.status`. A bare boolean, not an anchor — the runner resolves
     * the schema from the bound operation at run time (freshness comes from the stale
     * gate). Requires the scenario to bind to an OpenAPI operation that declares a JSON
     * response schema for the asserted status, else the scenario errors (never a silent
     * pass). Additive — no GUARD_FORMAT_VERSION bump; old scenarios parse unchanged.
     */
    schema: z.boolean().optional(),
  })
  .strict()

export const GuardApiRequestStepSchema = z
  .object({
    request: GuardHttpRequestSchema,
    /**
     * Variable name → JSON path into THIS step's response body. Captured values
     * are available to later steps as `${name}` in path/header/body strings.
     * A path that resolves to nothing fails the step.
     */
    capture: z.record(z.string(), z.string()).optional(),
    /**
     * Variable name → RESPONSE HEADER name (case-insensitive) on THIS step's
     * response. The sibling of {@link GuardApiRequestStepSchema}.capture for everything
     * that rides a header rather than the body: `x-auth-token`, an `ETag`, or the
     * `Location` of a 3xx (the runner never follows redirects, so the redirect
     * target IS observable). Captured values join the same `${name}` namespace as
     * body captures — one name has one source — and a header the response does not
     * carry fails the step exactly like a body path that resolves to nothing.
     * `Set-Cookie` needs no capture: the per-scenario cookie jar replays session
     * cookies onto later steps automatically.
     */
    captureHeaders: z.record(z.string(), z.string()).optional(),
    /** Run the step N times; every iteration must satisfy `expect`. Default 1. */
    repeat: z.number().int().positive().optional(),
    expect: GuardApiExpectSchema,
    /** The flow milestone this step realizes. See {@link milestone}. */
    milestone,
  })
  .strict()

// --- Steps (api driver) — the SERVER PROCESS lifecycle ---------------

/**
 * What a `boot` step asserts about the process it starts. `ready: true` (the
 * default when `expect` is omitted) means the server must become HEALTHY — the
 * implicit boot every api scenario has always done, now sayable. `exitCode` /
 * `stderrContains` mean the opposite: the process must EXIT within the recipe's
 * ready budget, which is how "an invalid configuration fails startup with a
 * non-zero exit code and a descriptive error" is asserted. The two are mutually
 * exclusive — a process cannot both serve traffic and be dead.
 */
export const GuardBootExpectSchema = z
  .object({
    /** The server must answer the recipe's health path with 2xx. */
    ready: z.literal(true).optional(),
    /** The process must exit with exactly this code. */
    exitCode: z.number().int().optional(),
    /** Substrings that must ALL appear in what the exiting process wrote to stderr. */
    stderrContains: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .refine(
    (e) => e.ready !== undefined || e.exitCode !== undefined || e.stderrContains !== undefined,
    { message: 'boot expectation needs one of ready | exitCode | stderrContains' },
  )
  .refine((e) => e.ready === undefined || (e.exitCode === undefined && e.stderrContains === undefined), {
    message: 'a boot expects `ready` OR an exit (`exitCode`/`stderrContains`), never both',
  })

/**
 * (Re)start the server process under test. A scenario with NO `boot` step keeps
 * the implicit boot the api driver has always done, so every existing scenario is
 * unchanged; a scenario that carries one owns its own lifecycle from the first
 * step on. `env` layers OVER the recipe's env and the scenario's `setup.env` for
 * THIS boot only — the world-state channel a claim about configuration needs —
 * and every boot allocates a FRESH port, so `${PORT}` in the serve argv/env
 * resolves per boot exactly as it does for the implicit one.
 */
export const GuardBootSchema = z
  .object({
    /**
     * Env overlay for this boot only (last layer wins over `setup.env`).
     * `${unique}` and `${HTTP_STUB:<name>}` resolve in the values, as in `setup.env`.
     * There is no removal channel: a variable the recipe sets is always set.
     */
    env: z.record(z.string(), z.string()).optional(),
    /** What the boot must do. Omitted ⇒ `{ ready: true }`. */
    expect: GuardBootExpectSchema.optional(),
  })
  .strict()

/** The signals a scenario may send the running server. */
export const GUARD_PROCESS_SIGNALS = ['SIGTERM', 'SIGINT'] as const

/**
 * Send a signal to the RUNNING server process and, optionally, assert how it
 * goes down — the graceful-shutdown claim ("exits with code 0 on SIGTERM"). With
 * no `expect` the step only delivers the signal (the first half of a restart).
 */
export const GuardSignalSchema = z
  .object({
    name: z.enum(GUARD_PROCESS_SIGNALS),
    expect: z
      .object({
        /** The process must exit with exactly this code (a signal-killed process has none). */
        exitCode: z.number().int().optional(),
        /** Budget for the exit; a default is applied when omitted. */
        withinMs: z.number().int().positive().max(600_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

/** A log-line matcher: a plain substring, or `{ pattern }` as a regex source. */
export const GuardLogMatchSchema = z.union([
  z.string().min(1),
  z.object({ pattern: z.string().min(1) }).strict(),
])

/**
 * Assert on what the server process WROTE. The runner already captures the
 * server's stdout/stderr for evidence; this reads that buffer, per LINE, so
 * "one stdout log line per request, carrying method, path, status and duration"
 * is a first-class assertion instead of an invisible behavior.
 *
 * `sinceLastStep` narrows the window to output that arrived after the previous
 * step began — the way a log line is attributed to the request that caused it.
 * Output is matched RAW: `normalize` deliberately does not apply, because the
 * volatile parts (a duration, a timestamp) are often the very thing a claim is
 * about. The buffer spans the whole scenario, so a restart's earlier output is
 * still readable after the second boot.
 */
export const GuardLogsSchema = z
  .object({
    stream: z.enum(['stdout', 'stderr']),
    match: GuardLogMatchSchema,
    /** Match only output that arrived after the previous step began. Default false. */
    sinceLastStep: z.boolean().optional(),
    /**
     * Exact number of matching LINES in the window. Omitted ⇒ at least one.
     * `0` asserts no line has matched (checked immediately, with no wait).
     */
    count: z.number().int().nonnegative().optional(),
    /** How long to wait for the expected lines to appear; a default is applied. */
    withinMs: z.number().int().positive().max(600_000).optional(),
  })
  .strict()

export const GuardApiBootStepSchema = z
  .object({ boot: GuardBootSchema, milestone })
  .strict()

export const GuardApiSignalStepSchema = z
  .object({ signal: GuardSignalSchema, milestone })
  .strict()

export const GuardApiLogsStepSchema = z
  .object({ logs: GuardLogsSchema, milestone })
  .strict()

/**
 * ONE api step — one action. A `request` drives the server over HTTP; `boot`,
 * `signal` and `logs` drive and observe the server PROCESS, which is what makes
 * startup, configuration, shutdown, logging and restart-persistence claims
 * testable on this surface. All three are additive and optional: no
 * `GUARD_FORMAT_VERSION` bump, and a scenario made only of `request` steps parses
 * and runs exactly as it did before.
 */
export const GuardApiStepSchema = z.union([
  GuardApiRequestStepSchema,
  GuardApiBootStepSchema,
  GuardApiSignalStepSchema,
  GuardApiLogsStepSchema,
])

/** True when the step drives the server over HTTP (the original step kind). */
export function isApiRequestStep(step: GuardApiStep): step is GuardApiRequestStep {
  return 'request' in step
}

/** True when the step (re)starts the server process. */
export function isApiBootStep(step: GuardApiStep): step is GuardApiBootStep {
  return 'boot' in step
}

/** True when the step signals the running server process. */
export function isApiSignalStep(step: GuardApiStep): step is GuardApiSignalStep {
  return 'signal' in step
}

/** True when the step asserts on the server process's captured output. */
export function isApiLogsStep(step: GuardApiStep): step is GuardApiLogsStep {
  return 'logs' in step
}

// --- The closed normalizer set --------------------------------------

export const GuardNormalizerSchema = z.enum([
  'timestamps',
  'abs-paths',
  'versions',
  'durations',
])

// --- Setup capabilities (world-state vocabulary) --------------------

/**
 * One commit in a declared git history: stage `files` and commit them. Every
 * path must already exist in the sandbox — seeded by `setup.files` or created by
 * an earlier commit. The engine materializes the commit with pinned
 * author/committer/date, so declaring the same history twice yields the same
 * commit hash.
 */
export const GuardGitCommitSchema = z
  .object({
    /** Sandbox-relative paths to stage for this commit; each must already exist. */
    files: z.array(z.string()).min(1),
    /** Commit message; a fixed constant is used when omitted. */
    message: z.string().optional(),
  })
  .strict()

/**
 * Declarative git world-state a scenario needs. Presence of the block — even an
 * empty `git: {}` — means "initialize a repo in the sandbox cwd". The scenario
 * declares WHAT the repo looks like (its commits, its staged working-index, its
 * branch); the engine's git provider materializes it deterministically after
 * `setup.files` seeding. There is no HOW here — no commands, no shell.
 */
export const GuardGitSchema = z
  .object({
    /** Ordered commit history, built after `setup.files` are seeded. */
    commits: z.array(GuardGitCommitSchema).optional(),
    /** Paths staged but left uncommitted (the working index), applied after all commits. */
    staged: z.array(z.string()).optional(),
    /** Initial branch name; defaults to `main`. */
    branch: z.string().optional(),
    /**
     * The `user.name` / `user.email` every commit in this scenario is made under —
     * and the identity its `git` STEPS commit with. The runner pins one either way;
     * declaring it makes visible what a reader would otherwise have to trust: the
     * developer's own identity is never used inside a sandbox.
     */
    identity: z.object({ name: z.string().min(1), email: z.string().min(1) }).strict().optional(),
    /**
     * Sandbox-relative directory the repository is initialized in; the sandbox cwd
     * itself when omitted. A flow that needs SIBLINGS of the checkout (a linked
     * worktree, a fresh clone, a second repository) puts the repo in a subdirectory
     * so those siblings still live inside the sandbox. `commits[].files` and
     * `staged` are relative to this root, as they are to a real repository.
     */
    root: z.string().min(1).optional(),
  })
  .strict()

/**
 * Assertions on the REQUEST the app under test sends to a stub route, evaluated
 * every time the route is hit. A violated assertion fails the SCENARIO (the app
 * called the third party wrongly is a red test, not an invisible pass), reported
 * with the received value excerpted. All declared assertions must hold.
 */
export const GuardHttpStubExpectSchema = z
  .object({
    /** Substrings that must all appear in the RAW request body. */
    bodyContains: z.array(z.string().min(1)).min(1).optional(),
    /** Query parameter name → its exact expected value. */
    query: z.record(z.string(), z.string()).optional(),
    /** Dotted path into the JSON request body (`a.b[0].c`, `""` = the root) → the expected value. */
    jsonPath: z.record(z.string(), z.unknown()).optional(),
    /** Request header name (case-insensitive) → its exact expected value. */
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .refine(
    (e) =>
      e.bodyContains !== undefined ||
      e.query !== undefined ||
      e.jsonPath !== undefined ||
      e.headers !== undefined,
    { message: 'stub request assertion needs one of bodyContains | query | jsonPath | headers' },
  )

/**
 * One scripted route of a stub server: what it answers, and what the app must
 * have sent to reach it. Routes are matched in declaration order; the first whose
 * method and path match wins. Exactly one body form: `body` (raw text, sent
 * as-is) or `json` (a JSON value, sent with `content-type: application/json`).
 */
export const GuardHttpStubRouteSchema = z
  .object({
    method: z.enum(GUARD_HTTP_METHODS),
    /**
     * Request PATH to match — the pathname only (a query string is never part of
     * the match; assert on it with `expect.query`). Must start with `/`. Matching
     * is exact, except for a single trailing `*` segment (`/v1/orders/*`) which
     * matches any one-or-more-segment remainder.
     */
    path: z.string().regex(/^\//, 'path must start with /'),
    /** Response status code; 200 when omitted. */
    status: z.number().int().min(100).max(599).optional(),
    /** Response headers. */
    headers: z.record(z.string(), z.string()).optional(),
    /** Raw response body, sent byte-for-byte. */
    body: z.string().optional(),
    /** JSON response body; serialized and sent with `content-type: application/json`. */
    json: z.unknown().optional(),
    /** Assertions on the request that hit this route. See {@link GuardHttpStubExpectSchema}. */
    expect: GuardHttpStubExpectSchema.optional(),
    /**
     * Exact number of times this route must be hit over the scenario, checked at
     * scenario end. `0` asserts the app NEVER calls it. Omitted ⇒ any count.
     */
    calls: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((r) => r.body === undefined || r.json === undefined, {
    message: 'a stub route carries `body` or `json`, not both',
  })

/**
 * One scripted HTTP stub server — a fake third party the app under test talks to.
 * The engine boots it on loopback BEFORE the app starts and exposes its origin as
 * `${HTTP_STUB:<name>}`, which the scenario points the app's base-URL env var at
 * through `setup.env`. The scenario declares WHAT the third party answers and
 * what the app must send it; there is no HOW here — no code, no shell.
 */
export const GuardHttpStubSchema = z
  .object({
    /** Scripted routes, matched in declaration order. */
    routes: z.array(GuardHttpStubRouteSchema).min(1),
    /**
     * What a request matching NO route means. `error` (the default) fails the
     * scenario naming the method and path received — an unscripted call is a
     * contract mismatch, never a silent pass; `404` tolerates it (the stub still
     * answers 404). Either way the stub never proxies anywhere.
     */
    unmatched: z.enum(['error', '404']).optional(),
  })
  .strict()

/**
 * The `http` setup capability: stub name → its scripted server. The name is what
 * `${HTTP_STUB:<name>}` refers to, so it is restricted to `[A-Za-z0-9_-]`.
 */
export const GuardHttpStubsSchema = z.record(
  z.string().regex(/^[A-Za-z0-9_-]+$/, 'stub name must be [A-Za-z0-9_-]'),
  GuardHttpStubSchema,
)

// --- The externals fault script ----------------------------

/**
 * Which of a provided external service's calls a fault rule applies to. Both
 * fields are optional and AND together; a rule with no `match` applies to every
 * call. `path` uses the same language as a stub route — exact on the pathname,
 * except for a single trailing `*` segment; a query string is never matched.
 */
export const GuardExternalFaultMatchSchema = z
  .object({
    method: z.enum(GUARD_HTTP_METHODS).optional(),
    /** Request PATH to match (pathname only). Must start with `/`. */
    path: z.string().regex(/^\//, 'path must start with /').optional(),
  })
  .strict()
  .refine((m) => m.method !== undefined || m.path !== undefined, {
    message: 'a fault match needs `method` or `path` (omit `match` entirely to match every call)',
  })

/**
 * The response a fault rule serves INSTEAD of forwarding the call upstream.
 * Exactly one body form: `body` (raw text) or `json` (serialized, sent with
 * `content-type: application/json`).
 */
export const GuardExternalFaultResponseSchema = z
  .object({
    status: z.number().int().min(100).max(599),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    json: z.unknown().optional(),
  })
  .strict()
  .refine((r) => r.body === undefined || r.json === undefined, {
    message: 'a fault response carries `body` or `json`, not both',
  })

/**
 * ONE fault rule for a provided external service. Rules are consulted in
 * declaration order on every call the app makes to that service; the FIRST
 * un-consumed rule whose `match` applies wins, and a call matching no rule is
 * forwarded upstream untouched. The vocabulary is deliberately small:
 *   - `respond` — answer the call from the scenario instead of the upstream;
 *   - `delayMs` — wait first, then do whatever else the rule says (respond, or
 *     forward): the way "slower than the app's timeout" is scripted;
 *   - `refuse` — destroy the connection unanswered (the app sees a network error,
 *     exactly as it would if the upstream were down);
 *   - `once` — consume the rule after it fires, so `[{refuse, once}, {}]` scripts
 *     "the first call fails, the retry succeeds".
 * A rule carrying only `match` is an explicit passthrough — useful as the tail of
 * a sequence, and identical to the default for unmatched calls.
 */
export const GuardExternalFaultSchema = z
  .object({
    /** Which calls this rule applies to; omitted ⇒ every call. */
    match: GuardExternalFaultMatchSchema.optional(),
    /** Serve this response instead of forwarding upstream. */
    respond: GuardExternalFaultResponseSchema.optional(),
    /** Wait this long before responding/forwarding — the upstream-timeout script. */
    delayMs: z.number().int().positive().max(600_000).optional(),
    /** Destroy the connection without answering (a refused/reset upstream). */
    refuse: z.literal(true).optional(),
    /** Fire at most once, then advance to the next rule — per-call sequencing. */
    once: z.boolean().optional(),
  })
  .strict()
  .refine((f) => !(f.respond !== undefined && f.refuse !== undefined), {
    message: 'a fault rule carries `respond` or `refuse`, not both',
  })
  .refine(
    (f) =>
      f.respond !== undefined ||
      f.refuse !== undefined ||
      f.delayMs !== undefined ||
      f.match !== undefined,
    {
      message:
        'a fault rule needs one of respond | delayMs | refuse | match (`match` alone is an explicit passthrough)',
    },
  )

/**
 * One provided external service as a scenario scripts it. The runner ALWAYS
 * routes a provided service's traffic through its own loopback proxy, so a
 * scenario needs no wiring: it declares only the faults it wants and, optionally,
 * how many calls the service must receive.
 */
export const GuardExternalSchema = z
  .object({
    /** Fault rules, consulted in declaration order. See {@link GuardExternalFaultSchema}. */
    faults: z.array(GuardExternalFaultSchema).min(1).optional(),
    /**
     * Exact number of calls this service must receive over the scenario (across
     * ALL of its endpoints), checked at scenario end. `0` asserts the app never
     * calls it; `1` is how "it does not retry" is asserted. Omitted ⇒ any count.
     */
    calls: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((e) => e.faults !== undefined || e.calls !== undefined, {
    message: 'an externals entry needs `faults` or `calls`',
  })

/**
 * The `externals` setup block: service name → its fault script for THIS scenario.
 * The name must be a service the recipe declares under `api.externals` AND that is
 * actually provided on this machine; anything else is a scenario defect (an
 * `error`, never a silent pass).
 */
export const GuardExternalsSchema = z.record(z.string().min(1), GuardExternalSchema)

// --- Setup & binding ------------------------------------------------

export const GuardSetupSchema = z
  .object({
    /** Declarative sandbox seeding: sandbox-relative path → file content. */
    files: z.record(z.string(), z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    /**
     * The `git` setup capability — declare a git repo (commits, staged files,
     * branch) the test needs. Optional and additive: scenarios without it are
     * unaffected. See {@link GuardGitSchema}.
     */
    git: GuardGitSchema.optional(),
    /**
     * The `http` setup capability — declare scripted third-party HTTP stubs the
     * test needs. Each stub's origin is exposed as `${HTTP_STUB:<name>}`, which
     * `setup.env` VALUES substitute, so the app under test reaches the stub
     * wherever it reads that dependency's base URL from the environment.
     * Optional and additive. See {@link GuardHttpStubSchema}.
     */
    http: GuardHttpStubsSchema.optional(),
    /**
     * The `externals` setup capability — script FAULTS on a third party the user
     * PROVIDED an account for. Every provided external is already reached
     * through a runner-managed loopback proxy, so unscripted traffic passes through
     * to the real service untouched; this block only says which calls must fail,
     * stall, or be refused, and how many the service must receive. Optional and
     * additive. See {@link GuardExternalSchema}.
     */
    externals: GuardExternalsSchema.optional(),
  })
  .strict()

export const GuardBindsSchema = z
  .object({
    /** Repo-relative path of the spec document. */
    doc: z.string().min(1),
    /** Slugified heading path (the section anchor). */
    section: z.string().min(1),
    /** `sha256:…` over the normalized section text. */
    fingerprint: z.string().min(1),
  })
  .strict()

/**
 * The flow this scenario realizes. `fingerprint` is the flow's milestone
 * composition at authoring time — when it moves, synthesis reorganized what the
 * flow tests and the scenario re-authors at the next generate.
 */
export const GuardScenarioFlowRefSchema = z
  .object({
    id: z.string().min(1),
    fingerprint: z.string().min(1),
  })
  .strict()

/**
 * The journey path that grounds this scenario — the realization plan's journey
 * ids and their fingerprints at authoring time. A fingerprint mismatch against the
 * live catalog is a DRIFT ANNOTATION, never a run outcome: the steps are frozen
 * and remain a valid probe of the spec claims.
 */
export const GuardScenarioJourneyRefSchema = z
  .object({
    path: z.array(z.string().min(1)).min(1),
    fingerprints: z.array(z.string().min(1)).min(1),
  })
  .strict()

// --- The scenario ---------------------------------------------------

/** The driver-independent envelope fields (frozen across drivers). */
const envelope = {
  guard: z.literal(GUARD_FORMAT_VERSION),
  /** `<flow-id>.<surface>.<n>` for a generated scenario. */
  id: z.string().min(1),
  /** Restates in one line what the scenario verifies. */
  title: z.string().min(1),
  /**
   * The PROMISE this test defends, in the flow's own plain words — its `goal`,
   * denormalized at write time so the promise rides the artifact: a reader of the
   * file alone knows what it is FOR without resolving `flow.id`
   * against `flows.json`, which is regenerated and may no longer name it. Written
   * by the engine, never authored by the model. Additive and optional, so no
   * format bump — absent on a hand-written scenario and on any file written
   * before the field (the `journeyDrifted`/`server` precedent).
   */
  promise: z.string().min(1).optional(),
  /** The flow realized here; absent on a hand-written scenario (Manual pseudo-flow). */
  flow: GuardScenarioFlowRefSchema.optional(),
  /** The grounding journey path; absent on a hand-written scenario. */
  journey: GuardScenarioJourneyRefSchema.optional(),
  /** Every section the flow's milestones come from — denormalized at write time. */
  binds: z.array(GuardBindsSchema).min(1),
  /**
   * SUPPLIED dependencies this scenario binds, by catalog entry name
   * (`scenarios/dependencies.json`). State the engine must never fabricate — a
   * codebase to analyze, an authenticated config dir, provider credentials — is
   * BOUND here, never built: the runner resolves the user-registered instance and
   * copies it into the sandbox, and with no instance registered the scenario
   * settles `blocked` naming the dependency instead of running against a stand-in.
   *
   * Declared explicitly so a binding that carries no `${supplied:…}` token (an
   * authenticated HOME the program finds by itself) is still visible; a scenario
   * that DOES carry tokens binds those names too, whether or not they are listed.
   * Additive and optional, so no format bump.
   */
  needs: z.array(z.string().min(1)).optional(),
  setup: GuardSetupSchema.optional(),
  normalize: z.array(GuardNormalizerSchema).default([]),
}

export const GuardCliScenarioSchema = z
  .object({
    ...envelope,
    driver: z.literal('cli'),
    steps: z.array(GuardCliStepSchema).min(1),
  })
  .strict()

export const GuardApiScenarioSchema = z
  .object({
    ...envelope,
    driver: z.literal('api'),
    /**
     * The recipe server this scenario runs against (an `api.servers` key).
     * ENGINE-ASSIGNED at authoring from the app that serves the flow's operations;
     * absent ⇒ the recipe's default server, which is what every pre-multi-server
     * scenario means. An additive optional field, so no format bump — the
     * `journeyDrifted`/`corpusFingerprint` precedent.
     */
    server: z.string().min(1).optional(),
    steps: z.array(GuardApiStepSchema).min(1),
  })
  .strict()

/** A committed scenario — the per-driver variants, keyed by `driver`. */
export const GuardScenarioSchema = z.discriminatedUnion('driver', [
  GuardCliScenarioSchema,
  GuardApiScenarioSchema,
])

export type GuardStreamMatcher = z.infer<typeof GuardStreamMatcherSchema>
export type GuardFileMatcher = z.infer<typeof GuardFileMatcherSchema>
export type GuardExpect = z.infer<typeof GuardExpectSchema>
export type GuardFileExpect = z.infer<typeof GuardFileExpectSchema>
export type GuardTtyAnswer = z.infer<typeof GuardTtyAnswerSchema>
export type GuardStepStdin = z.infer<typeof GuardStepStdinSchema>
export type GuardStep = z.infer<typeof GuardStepSchema>
export type GuardGitStep = z.infer<typeof GuardGitStepSchema>
export type GuardWriteStep = z.infer<typeof GuardWriteStepSchema>
export type GuardDeleteStep = z.infer<typeof GuardDeleteStepSchema>
export type GuardPatchOperations = z.infer<typeof GuardPatchOperationsSchema>
export type GuardPatchStep = z.infer<typeof GuardPatchStepSchema>
export type GuardCliStep = z.infer<typeof GuardCliStepSchema>
export type GuardHttpMethod = (typeof GUARD_HTTP_METHODS)[number]
export type GuardHttpRequest = z.infer<typeof GuardHttpRequestSchema>
export type GuardJsonMatcher = z.infer<typeof GuardJsonMatcherSchema>
export type GuardApiExpect = z.infer<typeof GuardApiExpectSchema>
export type GuardApiRequestStep = z.infer<typeof GuardApiRequestStepSchema>
export type GuardBootExpect = z.infer<typeof GuardBootExpectSchema>
export type GuardBoot = z.infer<typeof GuardBootSchema>
export type GuardProcessSignal = (typeof GUARD_PROCESS_SIGNALS)[number]
export type GuardSignal = z.infer<typeof GuardSignalSchema>
export type GuardLogMatch = z.infer<typeof GuardLogMatchSchema>
export type GuardLogs = z.infer<typeof GuardLogsSchema>
export type GuardApiBootStep = z.infer<typeof GuardApiBootStepSchema>
export type GuardApiSignalStep = z.infer<typeof GuardApiSignalStepSchema>
export type GuardApiLogsStep = z.infer<typeof GuardApiLogsStepSchema>
export type GuardApiStep = z.infer<typeof GuardApiStepSchema>
export type GuardNormalizer = z.infer<typeof GuardNormalizerSchema>
export type GuardGitCommit = z.infer<typeof GuardGitCommitSchema>
export type GuardGit = z.infer<typeof GuardGitSchema>
export type GuardHttpStubExpect = z.infer<typeof GuardHttpStubExpectSchema>
export type GuardHttpStubRoute = z.infer<typeof GuardHttpStubRouteSchema>
export type GuardHttpStub = z.infer<typeof GuardHttpStubSchema>
export type GuardHttpStubs = z.infer<typeof GuardHttpStubsSchema>
export type GuardExternalFaultMatch = z.infer<typeof GuardExternalFaultMatchSchema>
export type GuardExternalFaultResponse = z.infer<typeof GuardExternalFaultResponseSchema>
export type GuardExternalFault = z.infer<typeof GuardExternalFaultSchema>
export type GuardExternal = z.infer<typeof GuardExternalSchema>
export type GuardExternals = z.infer<typeof GuardExternalsSchema>
export type GuardSetup = z.infer<typeof GuardSetupSchema>
export type GuardBinds = z.infer<typeof GuardBindsSchema>
export type GuardScenarioFlowRef = z.infer<typeof GuardScenarioFlowRefSchema>
export type GuardScenarioJourneyRef = z.infer<typeof GuardScenarioJourneyRefSchema>
export type GuardCliScenario = z.infer<typeof GuardCliScenarioSchema>
export type GuardApiScenario = z.infer<typeof GuardApiScenarioSchema>
export type GuardScenario = z.infer<typeof GuardScenarioSchema>

// --- Regex-matcher validation ---------------------------------------

/**
 * A regex source in a scenario that does not compile — the offending step
 * (1-based), where in the step it sits, the source, and the `new RegExp` error
 * text. Both the authoring validate path and the committed-scenario loader report
 * an uncompilable pattern from this same evidence.
 */
export interface InvalidMatchPattern {
  /** 1-based index of the offending step. */
  step: number
  /** Where in the step the pattern sits — `expect.stdout`, `expect.json.data.id`, `logs.match`. */
  where: string
  /** The regex source that failed to compile. */
  pattern: string
  /** The `new RegExp` compile-error message. */
  error: string
}

/** Every regex source one step carries, with the path that names it. */
function stepPatterns(step: GuardCliStep | GuardApiStep): Array<{ where: string; pattern: string }> {
  const out: Array<{ where: string; pattern: string }> = []
  const add = (where: string, pattern: string | undefined): void => {
    if (pattern !== undefined) out.push({ where, pattern })
  }
  /** A matcher's two regex sources: the text matcher, and a comparison's extractor. */
  const matcher = (where: string, m: { matches?: string; compare?: GuardComparison }): void => {
    add(where, m.matches)
    add(`${where}.compare.number`, m.compare?.number)
  }
  /** A file expectation's regexes, named by the path each sits under. */
  const files = (expect: { files?: Record<string, { matches?: string }> } | undefined): void => {
    for (const [path, m] of Object.entries(expect?.files ?? {})) add(`expect.files.${path}`, m.matches)
  }
  if ('run' in step || 'git' in step) {
    if (step.expect.stdout) matcher('expect.stdout', step.expect.stdout)
    if (step.expect.stderr) matcher('expect.stderr', step.expect.stderr)
    if (step.expect.output) matcher('expect.output', step.expect.output)
    files(step.expect)
    // A capture pattern runs against real output on a real run; a source that does
    // not compile must die at load like every other one, not mid-scenario.
    for (const [name, c] of Object.entries(step.capture ?? {})) add(`capture.${name}`, c.pattern)
    return out
  }
  // The file steps assert on file state only — no stream matcher, but a file
  // matcher's `matches` is a regex the runner compiles like any other.
  if ('write' in step || 'delete' in step || 'patch' in step) {
    files(step.expect)
    return out
  }
  if (isApiRequestStep(step)) {
    if (step.expect.body) matcher('expect.body', step.expect.body)
    for (const [name, m] of Object.entries(step.expect.headers ?? {})) matcher(`expect.headers.${name}`, m)
    for (const [path, m] of Object.entries(step.expect.json ?? {})) matcher(`expect.json.${path || '(root)'}`, m)
    return out
  }
  if (isApiLogsStep(step) && typeof step.logs.match !== 'string') add('logs.match', step.logs.match.pattern)
  return out
}

/**
 * The first step carrying a regex source that does not compile under `new RegExp`
 * — the exact call the runner makes when it evaluates the matcher (no flags).
 * Returns null when every pattern compiles (or none is present). A non-compiling
 * pattern is always a bug: the log matcher throws outright and the stream/body/json
 * matchers turn into an unconditional mismatch, so it is rejected before birth
 * (authoring) and at load (committed scenarios) rather than after a wasted run.
 */
export function firstInvalidMatchPattern(
  steps: readonly (GuardCliStep | GuardApiStep)[],
): InvalidMatchPattern | null {
  for (let i = 0; i < steps.length; i++) {
    for (const { where, pattern } of stepPatterns(steps[i])) {
      try {
        new RegExp(pattern)
      } catch (e) {
        return { step: i + 1, where, pattern, error: e instanceof Error ? e.message : String(e) }
      }
    }
  }
  return null
}

// --- Capture composition (cross-step) ---------------------------------

/**
 * The capture names ONE step assigns, in declaration order — whichever driver it
 * belongs to. The two api channels (`capture` from the body, `captureHeaders`
 * from a header) share one namespace, so one name has exactly one source.
 */
export function stepCaptureNames(step: GuardCliStep | GuardApiStep): string[] {
  if ('run' in step || 'git' in step) return Object.keys(step.capture ?? {})
  // A file step writes, deletes or patches; it spawns nothing and so produces no output.
  if ('write' in step || 'delete' in step || 'patch' in step) return []
  if (isApiRequestStep(step)) {
    return [...Object.keys(step.capture ?? {}), ...Object.keys(step.captureHeaders ?? {})]
  }
  return []
}

/**
 * A capture rule a scenario breaks, in the words the reporting surface prints.
 * `step` is the 1-based offender, or `null` when the defect is in `setup`.
 */
export interface CaptureDefect {
  step: number | null
  message: string
}

/**
 * Every capture rule a scenario breaks — the checks that need the WHOLE step list,
 * so the schema cannot state them and the runner must never discover them mid-run:
 *
 *  - SINGLE ASSIGNMENT — a name is captured once. A second capture of it would
 *    silently change what every earlier reference meant, depending on where the
 *    scenario had got to.
 *  - NO FORWARD REFERENCE — `${captured:x}` reads a value that must already exist.
 *    A reference no step captures at all is the same defect with a worse ending.
 *  - NO SELF REFERENCE — a step's own capture is resolved AFTER its expectation
 *    holds, so a step cannot use what it captures. Order is the whole mechanism.
 *  - NOTHING IN SETUP — `setup` materializes before the first step runs, so a
 *    `${captured:…}` there can never resolve.
 *
 * Reported ALL at once (not first-only): they are independent authoring mistakes,
 * and a corpus owner fixing them wants the list. Pure — the caller decides whether
 * they are load errors (committed scenarios) or a corrective re-ask (authoring).
 */
export function captureDefects(
  steps: readonly (GuardCliStep | GuardApiStep)[],
  setup?: GuardSetup,
): CaptureDefect[] {
  const defects: CaptureDefect[] = []
  /** name → the 1-based step that captured it. */
  const captured = new Map<string, number>()

  for (const name of capturedNamesIn(setup ?? {})) {
    defects.push({
      step: null,
      message:
        `setup references \${captured:${name}}, but setup materializes BEFORE the first step — ` +
        'nothing is captured yet',
    })
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const stepNumber = i + 1
    const declares = new Set(stepCaptureNames(step))

    for (const name of capturedNamesIn(step)) {
      if (captured.has(name)) continue
      if (declares.has(name)) {
        defects.push({
          step: stepNumber,
          message:
            `step ${stepNumber} references \${captured:${name}}, which it captures itself — a captured ` +
            'value is readable only by LATER steps (a capture resolves after the step it belongs to)',
        })
        continue
      }
      const available = [...captured.keys()]
      defects.push({
        step: stepNumber,
        message:
          `step ${stepNumber} references \${captured:${name}}, which no earlier step captures — ${
            available.length > 0
              ? `the values captured before it are ${available.map((n) => `\${captured:${n}}`).join(', ')}`
              : 'no step before it captures anything'
          }`,
      })
    }

    for (const name of stepCaptureNames(step)) {
      const prior = captured.get(name)
      if (prior !== undefined) {
        defects.push({
          step: stepNumber,
          message:
            prior === stepNumber
              ? `step ${stepNumber} captures "${name}" twice — a step's body and header captures share ` +
                'ONE namespace, so a name has exactly one source'
              : `step ${stepNumber} captures "${name}", which step ${prior} already captured — a capture ` +
                'name is assigned ONCE per scenario',
        })
        continue
      }
      captured.set(name, stepNumber)
    }
  }

  return defects
}

// --- Presentation: a committed scenario as a STEP LIST ----------------

/**
 * WHAT a step drives — the surface it acts on, never how it fared. A reader
 * scanning a step list wants to know which of these a row is before reading its
 * command: `cli` runs the program under test, `git` runs git beside it, `file`
 * writes or deletes sandbox files, `api` speaks to the booted server (a request,
 * or a lifecycle action against it).
 *
 * `web` is declared and not yet produced: the browser driver is the one surface
 * guard does not drive today, and naming it here is what keeps the label a closed
 * vocabulary rather than a free-form string every renderer re-invents.
 */
export type GuardStepKind = 'cli' | 'git' | 'file' | 'api' | 'web'

/**
 * One step of a committed test, in the words a reader needs: what it does, the
 * world it does it in, and what it asserts. The dashboard renders this instead of
 * raw YAML (which stays available as the file's source).
 *
 * Everything here is AUTHORED — read out of the file, true of the test whether or
 * not it ever ran. The one recorded field is {@link GuardScenarioStepView.actual},
 * merged in when the read names a run.
 */
export interface GuardScenarioStepView {
  /** 1-based position — the number a failure's `step` names. */
  n: number
  /** What the step drives — every step is one of these, so every row can say so. */
  kind: GuardStepKind
  /**
   * What the step DOES: the argv line (cli), `METHOD /path` (an api request), or
   * the lifecycle action (`boot the server`, `signal SIGTERM`, `read server stdout`).
   */
  command: string
  /** Env overlay for THIS step only, as `K=V` (a cli step, or an api `boot`); absent when none. */
  env?: string[]
  /** What it asserts, one line — "exit 0 · stdout contains “added”". */
  expectation: string
  /** The flow milestone POSITION this step realizes, when it names one. */
  milestone?: number
  /** The claim identities this step is tagged with, when it names any. */
  claims?: string[]
  /** Repeat count when the step runs more than once. */
  repeat?: number
  /** Sandbox-relative working directory, when the step declares one. */
  cwd?: string
  /** True when the step runs on a pseudo-terminal. */
  tty?: true
  /** The authoring note — why this assertion is the falsifiable form of the claim. */
  note?: string
  /**
   * What this step ACTUALLY did in the run the read named — merged in from that run's
   * evidence bundle (see {@link GuardStepActual}). Absent when the read named no run,
   * and when the step never executed in it: the detail then shows the authored half
   * alone, which is all that is true about such a step.
   */
  actual?: GuardStepActual
}

/** `contains “x”` / `matches /x/` / `is “x”` / `at most N` — one text matcher. */
function describeStreamMatcher(m: GuardStreamMatcher): string {
  if (m.equals !== undefined) return `is “${m.equals}”`
  if (m.contains !== undefined) return `contains “${m.contains}”`
  if (m.matches !== undefined) return `matches /${m.matches}/`
  return describeComparison(m.compare!)
}

function describeFileMatcher(m: GuardFileMatcher): string {
  if (m.exists) return 'exists'
  if (m.absent) return 'is absent'
  if (m.equals !== undefined) return `is “${m.equals}”`
  if (m.contains !== undefined) return `contains “${m.contains}”`
  return `matches /${m.matches}/`
}

function describeJsonMatcher(m: GuardJsonMatcher): string {
  if (m.exists) return 'exists'
  if (m.absent) return 'is absent'
  if (m.equals !== undefined) return `is ${JSON.stringify(m.equals)}`
  if (m.contains !== undefined) return `contains “${m.contains}”`
  if (m.matches !== undefined) return `matches /${m.matches}/`
  return describeComparison(m.compare!)
}

function describeCliExpect(expect: GuardExpect | GuardFileExpect | undefined): string {
  const parts: string[] = []
  if (!expect) return ''
  if ('exit' in expect && expect.exit !== undefined) parts.push(`exit ${expect.exit}`)
  if ('stdout' in expect && expect.stdout) parts.push(`stdout ${describeStreamMatcher(expect.stdout)}`)
  if ('stderr' in expect && expect.stderr) parts.push(`stderr ${describeStreamMatcher(expect.stderr)}`)
  if ('output' in expect && expect.output) parts.push(`output ${describeStreamMatcher(expect.output)}`)
  for (const [path, m] of Object.entries(expect.files ?? {})) {
    parts.push(`${path} ${describeFileMatcher(m)}`)
  }
  return parts.join(' · ')
}

/** `set a.b, remove c` — one file's patch operations, in declaration order. */
function describePatchOperations(ops: GuardPatchOperations): string {
  return [
    ...Object.keys(ops.set ?? {}).map((p) => `set ${p}`),
    ...(ops.remove ?? []).map((p) => `remove ${p}`),
  ].join(', ')
}

/** What a cli step DOES, in the words a reader needs — one line per step kind. */
function describeCliCommand(step: GuardCliStep): string {
  if (isRunStep(step)) return runArgvWords(step.run).join(' ')
  if (isGitStep(step)) return `git ${step.git.join(' ')}`
  if (isWriteStep(step)) return `write ${Object.keys(step.write).join(', ')}`
  if (isPatchStep(step)) {
    const files = Object.entries(step.patch).map(
      ([file, ops]) => `${file} (${describePatchOperations(ops)})`,
    )
    return `patch ${files.join(', ')}`
  }
  return `delete ${step.delete.join(', ')}`
}

/** What a cli step DRIVES — the program, git, or the sandbox's files. */
function cliStepKind(step: GuardCliStep): GuardStepKind {
  if (isRunStep(step)) return 'cli'
  if (isGitStep(step)) return 'git'
  // Write, delete and patch are one kind: all three act on the sandbox tree and
  // none spawns anything. What they do to it is the command's job to say.
  return 'file'
}

function describeApiExpect(expect: GuardApiExpect): string {
  const parts: string[] = []
  if (expect.status !== undefined) parts.push(`status ${expect.status}`)
  for (const [name, m] of Object.entries(expect.headers ?? {})) {
    parts.push(`${name} ${describeStreamMatcher(m)}`)
  }
  if (expect.body) parts.push(`body ${describeStreamMatcher(expect.body)}`)
  for (const [path, m] of Object.entries(expect.json ?? {})) {
    parts.push(`${path || '$'} ${describeJsonMatcher(m)}`)
  }
  if (expect.schema) parts.push('matches the declared response schema')
  return parts.join(' · ')
}

/** `“x”` / `/x/` — one log-line matcher, in the words a reader needs. */
function describeLogMatch(m: GuardLogMatch): string {
  return typeof m === 'string' ? `“${m}”` : `/${m.pattern}/`
}

/**
 * One lifecycle step as a command + expectation pair — the SINGLE rendering both
 * the dashboard step list and the runner's evidence transcript use, so the two can
 * never describe the same step differently.
 */
export function describeApiLifecycleStep(
  step: GuardApiBootStep | GuardApiSignalStep | GuardApiLogsStep,
): { command: string; expectation: string; env?: string[] } {
  if (isApiBootStep(step)) {
    const env = Object.entries(step.boot.env ?? {}).map(([k, v]) => `${k}=${v}`)
    const e = step.boot.expect
    const parts: string[] = []
    if (!e || e.ready) parts.push('becomes healthy')
    if (e?.exitCode !== undefined) parts.push(`exits ${e.exitCode}`)
    if (e?.stderrContains) parts.push(...e.stderrContains.map((s) => `stderr contains “${s}”`))
    return { command: 'boot the server', expectation: parts.join(' · '), ...(env.length > 0 ? { env } : {}) }
  }
  if (isApiSignalStep(step)) {
    const parts: string[] = []
    if (step.signal.expect?.exitCode !== undefined) parts.push(`exits ${step.signal.expect.exitCode}`)
    if (step.signal.expect?.withinMs !== undefined) parts.push(`within ${step.signal.expect.withinMs}ms`)
    return { command: `signal ${step.signal.name}`, expectation: parts.join(' · ') }
  }
  const { stream, match, count, sinceLastStep } = step.logs
  const window = sinceLastStep ? ' since the previous step' : ''
  const n = count === undefined ? 'a line' : `exactly ${count} line${count === 1 ? '' : 's'}`
  return {
    command: `read server ${stream}`,
    expectation: `${n} matching ${describeLogMatch(match)}${window}`,
  }
}

/**
 * A parsed scenario as its step list. Anything that doesn't parse as a known
 * driver yields an empty list — the caller falls back to the raw source, never to
 * a half-rendered guess.
 */
export function describeGuardScenarioSteps(scenario: unknown): GuardScenarioStepView[] {
  const parsed = GuardScenarioSchema.safeParse(scenario)
  if (!parsed.success) return []
  const s = parsed.data
  /** The milestone half of a step view — position and claim identities, when named. */
  const milestoneView = (value: GuardStepMilestone | undefined): Partial<GuardScenarioStepView> => {
    const order = milestoneOrder(value)
    const claims = milestoneClaims(value)
    return {
      ...(order != null ? { milestone: order } : {}),
      ...(claims.length > 0 ? { claims } : {}),
    }
  }

  if (s.driver === 'api') {
    return s.steps.map((step, i) => {
      // Every step of this driver acts on the booted server — the requests it
      // makes and the lifecycle actions that surround them alike.
      const base = { n: i + 1, kind: 'api' as const, ...milestoneView(step.milestone) }
      if (!isApiRequestStep(step)) return { ...base, ...describeApiLifecycleStep(step) }
      return {
        ...base,
        command: `${step.request.method} ${step.request.path}`,
        expectation: describeApiExpect(step.expect),
        ...(step.repeat != null ? { repeat: step.repeat } : {}),
      }
    })
  }
  return s.steps.map((step, i) => {
    const env = isProcessStep(step)
      ? Object.entries(step.env ?? {}).map(([k, v]) => `${k}=${v}`)
      : []
    return {
      n: i + 1,
      kind: cliStepKind(step),
      command: describeCliCommand(step),
      ...(env.length > 0 ? { env } : {}),
      expectation: describeCliExpect(step.expect),
      ...milestoneView(step.milestone),
      ...(isRunStep(step) && step.repeat != null ? { repeat: step.repeat } : {}),
      ...(step.cwd != null ? { cwd: step.cwd } : {}),
      ...(isRunStep(step) && step.tty ? { tty: true as const } : {}),
      ...(step.note != null ? { note: step.note } : {}),
    }
  })
}

// --- Presentation: a committed scenario's STARTING WORLD ---------------

/**
 * The world a test STARTS in — the `setup:` block the runner materializes before
 * the first step, in the words a reader needs. Read beside the step list, which
 * only ever shows what the test DOES from here.
 *
 * The scripted-third-party capabilities (`http`, `externals`) are not part of it:
 * those say what the test TALKS TO, not the state it begins from.
 */
export interface GuardScenarioSetupView {
  /** Seeded files in declaration order: sandbox-relative path → its content. */
  files?: { path: string; content: string }[]
  /** The declared git world state, one line each. */
  git?: string[]
  /** The scenario-global env overlay as `K=V` — the shape a step's own overlay uses. */
  env?: string[]
}

/**
 * The declared git world as one line per fact. The block's PRESENCE means "there
 * is a repository here", so it always leads with that; everything after it is a
 * line only when the scenario declares it.
 */
function describeGuardGitSetup(git: GuardGit): string[] {
  const lines = [
    git.root ? `initializes a git repository in ${git.root}` : 'initializes a git repository',
  ]
  if (git.branch) lines.push(`on branch ${git.branch}`)
  if (git.identity) lines.push(`commits as ${git.identity.name} <${git.identity.email}>`)
  git.commits?.forEach((commit, i) => {
    const message = commit.message ? ` “${commit.message}”` : ''
    lines.push(`commit ${i + 1}${message} — ${commit.files.join(', ')}`)
  })
  if (git.staged && git.staged.length > 0) lines.push(`staged, uncommitted — ${git.staged.join(', ')}`)
  return lines
}

/**
 * A parsed scenario's setup as the detail reads it. `undefined` when the file
 * doesn't parse as a known driver, when it declares no setup at all, and when
 * everything it declares is outside this view — the surface then renders nothing
 * rather than an empty heading.
 */
export function describeGuardScenarioSetup(scenario: unknown): GuardScenarioSetupView | undefined {
  const parsed = GuardScenarioSchema.safeParse(scenario)
  if (!parsed.success || !parsed.data.setup) return undefined
  const setup = parsed.data.setup
  const files = Object.entries(setup.files ?? {}).map(([path, content]) => ({ path, content }))
  const git = setup.git ? describeGuardGitSetup(setup.git) : []
  const env = Object.entries(setup.env ?? {}).map(([k, v]) => `${k}=${v}`)
  const view: GuardScenarioSetupView = {
    ...(files.length > 0 ? { files } : {}),
    ...(git.length > 0 ? { git } : {}),
    ...(env.length > 0 ? { env } : {}),
  }
  return Object.keys(view).length > 0 ? view : undefined
}
