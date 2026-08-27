/**
 * The CLI driver's verb vocabulary, the per-driver closed sub-schema the driver
 * registry (`drivers.ts`) describes, in its own module because a driver's verbs are
 * its own business: the scenario ENVELOPE is frozen across drivers, and only this
 * grows.
 *
 * Five step kinds: `run` (argv appended to the recipe entrypoint), `git` (argv
 * handed to `git`, the one other program a scenario may invoke, because hooks only
 * trigger through it and the docs state their claims in git terms), `write` /
 * `delete` (sandbox file mutation BETWEEN runs, which is what a two-state claim -
 * new vs resolved, enabled then disabled, needs), and `patch` (ONE key path of a
 * JSON document set or removed, for the file a test must edit but does not own) -
 * with `expect` matchers on exit code, streams, the combined output, and files.
 */

import { z } from 'zod'
import { GuardCliCapturesSchema, capturingGroupCount } from './capture'
import { suppliedTokenRefs } from './dependencies'
import {
  GuardStreamMatcherSchema,
  describeStreamMatcher,
  matcherPatterns,
  stepCwd as cwd,
  stepMilestone as milestone,
  stepNote as note,
  stepTimeoutMs as timeoutMs,
  type GuardStepKind,
} from './step-parts'



// --- File matchers ---------------------------------------------------
// (the TEXT matcher every driver shares lives in `step-parts.ts`)

/** File matcher, presence or content of a path under the sandbox cwd. */
export const GuardFileMatcherSchema = z
  .object({
    exists: z.boolean().optional(),
    absent: z.boolean().optional(),
    equals: z.string().optional(),
    contains: z.string().optional(),
  })
  .strict()
  .refine(
    (m) =>
      m.exists !== undefined ||
      m.absent !== undefined ||
      m.equals !== undefined ||
      m.contains !== undefined,
    { message: 'file matcher needs one of exists | absent | equals | contains' },
  )

export const GuardExpectSchema = z
  .object({
    exit: z.number().int().optional(),
    stdout: GuardStreamMatcherSchema.optional(),
    stderr: GuardStreamMatcherSchema.optional(),
    /**
     * Matcher on stdout and stderr TOGETHER (stdout first, then stderr), compared
     * post-normalization. The honest matcher for a message no interface pins to a
     * stream, a warning or an error text the contract never places, where
     * asserting one stream would encode a guess. It is also the whole output of a
     * `tty: true` step, whose pseudo-terminal carries one channel by construction.
     */
    output: GuardStreamMatcherSchema.optional(),
    /** Sandbox-relative path → matcher. */
    files: z.record(z.string(), GuardFileMatcherSchema).optional(),
  })
  .strict()

/** What a `write`/`delete` step may assert: file state only, it runs no process. */
export const GuardFileExpectSchema = z
  .object({ files: z.record(z.string(), GuardFileMatcherSchema) })
  .strict()

// --- Steps (cli driver) ----------------------------------------------
// (milestone attribution and the shared `cwd`/`note`/`timeoutMs` fields live in
// `step-parts.ts`; the web driver's verbs live in `web-steps.ts`)

/**
 * What this step takes OUT of its own output for the steps after it: name → the
 * pattern whose single capturing group is the value. Later steps reach it as
 * `${captured:<name>}` in their argv, env, written content and EXPECTATIONS. See
 * {@link GuardCliCapturesSchema}; the rules that span steps (single assignment,
 * no forward or self reference) are {@link captureDefects}, checked at load.
 *
 * Additive and optional (the `timeoutMs` precedent): a scenario that captures
 * nothing parses and runs exactly as it did.
 */
const capture = GuardCliCapturesSchema.optional()

/**
 * An argv pair that is only there when the machine has something to put in it:
 * `optional: ["--base-url", "${supplied:llm-api-credentials.base-url}"]`.
 *
 * A registration may DECLARE a variable optional, the program has a working
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
 * always been. The value must therefore carry a `${supplied:…}` token, a pair with
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
 * A `run` argv as WORDS, every optional pair flattened to its two halves. The
 * display form (a step list, a validate rule): it shows what the step means to run,
 * which is not always what a given machine runs. Only the runner resolves the drops.
 */
export function runArgvWords(run: readonly GuardRunArg[]): string[] {
  return run.flatMap((arg) => (isOptionalArg(arg) ? [...arg.optional] : [arg]))
}

/**
 * ONE scripted terminal answer, KEYED TO THE QUESTION IT ANSWERS: the marker is
 * the question's stable substring (the interface contract's `prompts[].marker`),
 * and the answer is the keystrokes typed once that marker has appeared in the
 * child's output, submit key included, because which key submits is part of the
 * answer (`y` for a confirm that takes a printable, `\r` for a select that only
 * accepts a carriage return).
 *
 * The marker is matched against what the program WROTE, with the terminal's own
 * doing removed: ANSI escapes stripped and `\r\n` folded to `\n`, the same text
 * an `expect.output` matcher sees. Keep it short, one distinctive fragment of the
 * question, never a whole rendered line, whose framing characters and colors are
 * the prompt library's, not the program's.
 */
export const GuardTtyAnswerSchema = z
  .object({
    /** The question's stable substring, what must appear before this is typed. */
    marker: z.string().min(1),
    /** The keystrokes typed once the marker appears, submit key included. */
    answer: z.string().min(1),
  })
  .strict()

/**
 * A step's scripted input, in either of its two forms.
 *
 * A STRING is the bytes themselves: piped to the child's stdin on an ordinary
 * step, and, on a `tty` step, typed at the terminal on the runner's silence
 * heuristic (the child goes quiet, the next answer is typed). That heuristic is
 * what a long non-prompt phase defeats: a login preflight with a spinner has
 * quiet gaps of its own, they spend the answers before the real question is ever
 * asked, and the step then hangs at the prompt until its budget runs out.
 *
 * A LIST of {@link GuardTtyAnswerSchema} is the prompt-keyed form, and the
 * discipline for anything interactive: each answer names the question it replies
 * to, and the runner types it only once that question has actually been asked.
 * Nothing is guessed from timing, so a preflight of any length changes nothing -
 * and an answer whose question never comes is the step FAILING with the marker as
 * evidence, not a wait to the timeout.
 *
 * Prompt-keyed answers require `tty: true`: a question is only asked of a
 * terminal, so keying answers to questions a piped step can never be asked would
 * be a scenario that cannot mean what it says.
 *
 * Additive (the `timeoutMs` precedent): every committed scenario that scripted
 * a string still parses and still runs the way it did.
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
        'prompt-keyed answers are typed at a terminal, the step must declare `tty: true` ' +
        '(a piped step is never asked a question)',
      path: ['stdin'],
    })
  }
}

/**
 * THE HELD-COMMAND TERMINATOR: run until this line appears, then stop the child.
 *
 * A documented command that does not return is unreachable otherwise. `truecourse
 * dashboard` in console mode holds the terminal by design; a log follower follows;
 * a dev server serves. A step can only await EXIT, so each of them spends its whole
 * budget and is SIGKILLed, and the runner reports that, correctly, for a step that
 * declared nothing, as an infrastructure error that stops the scenario. The claim
 * ("it starts and says where it is listening") is perfectly observable; only the
 * command's ending was ever the problem.
 *
 * So the step names the line it is waiting for. The runner watches what the command
 * writes, and the moment the marker appears it terminates the child and settles the
 * step on the output produced SO FAR, the expectation is evaluated against exactly
 * that, and a pass is a pass. Nothing here is a timer: the marker is observable
 * state, the same discipline the web driver's waiting follows.
 *
 * The marker is matched against what the PROGRAM wrote, with the terminal's own
 * doing removed (ANSI escapes stripped, `\r\n` folded to `\n`), the same text an
 * `expect.output` matcher sees, and the same rule {@link GuardTtyAnswerSchema}'s
 * marker follows. Keep it short: one distinctive fragment of the line.
 *
 * A marker that NEVER appears is the step FAILING with the marker as its
 * expectation, the same verdict an unasked prompt earns, and for the same reason:
 * the line the docs promise was not printed, which is a finding about the program,
 * not about the machine.
 */
export const GuardStepUntilSchema = z
  .object({
    /** The line's stable substring, what ends the step when it appears. */
    marker: z.string().min(1),
  })
  .strict()
export type GuardStepUntil = z.infer<typeof GuardStepUntilSchema>

/**
 * The rule the step object cannot state field-by-field: a step the runner stops on
 * purpose has NO exit code of its own, the code it reports is the signal that
 * stopped it, so asserting one could only ever be a lie. Assert the output.
 */
export function markerTerminationHasNoExit(
  step: { until?: GuardStepUntil; expect?: GuardExpect },
  ctx: z.RefinementCtx,
): void {
  if (step.until !== undefined && step.expect?.exit !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'a step that runs `until` a marker is terminated by the runner, so it has no exit code of its own, ' +
        'assert what it printed (`expect.output` / `expect.stdout`) instead',
      path: ['expect', 'exit'],
    })
  }
}

/**
 * The `run` step's FIELDS, before {@link promptKeysNeedATerminal} is applied.
 *
 * THE AUTHORING BASE, deliberately: `@truecourse/guard-generator` extends exactly
 * this object for the scenario schema it embeds in the authoring prompt, so every
 * field here is prompt bytes and any change to it rolls `GENERATE_PROMPT_FINGERPRINT`
 * and re-authors every cli flow in the corpus. Runner-only vocabulary is added to
 * {@link GuardRunStepObjectSchema} below instead, the `patch` precedent, applied to
 * a field rather than a step kind.
 */
export const GuardStepObjectSchema = z
  .object({
    /** Argv appended to the recipe entrypoint. May be empty (run the bare entry). */
    run: z.array(GuardRunArgSchema),
    stdin: GuardStepStdinSchema.optional(),
    /**
     * Env overlay for THIS step's child process only, applied on top of the
     * scenario-global `setup.env` (last layer wins). Sibling steps are unaffected,
     * so one scenario can observe the same command under several environments -
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
     * answers, written to the terminal as if typed, prompt-keyed (each answer
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

/**
 * The `run` step as the RUNNER accepts it: the authoring base plus the vocabulary a
 * model never writes. `until` is hand-authored, it says how a command that never
 * returns is ended, which is knowledge about a specific documented command, not
 * something an authoring pass can infer, and keeping it out of
 * {@link GuardStepObjectSchema} is what keeps the authoring prompt (and every
 * author cache key built from it) byte-identical.
 */
export const GuardRunStepObjectSchema = GuardStepObjectSchema.extend({
  /** Run until this line appears, then stop the child. See {@link GuardStepUntilSchema}. */
  until: GuardStepUntilSchema.optional(),
})

/** ONE `run` step, the program under test, invoked with argv and scripted input. */
export const GuardStepSchema = GuardRunStepObjectSchema.superRefine((step, ctx) => {
  promptKeysNeedATerminal(step, ctx)
  markerTerminationHasNoExit(step, ctx)
})

/**
 * Invoke `git` in the sandbox, the ONE program besides the entrypoint a scenario
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
 * first step, which cannot express a claim about what changes BETWEEN two runs -
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

/** Remove sandbox files mid-scenario, the other half of the two-state claim. */
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
 * A value a `set` may write, the closed set of things a JSON document can hold.
 *
 * ONE gate does the checking: {@link jsonValueDefect} walks the value to its leaves
 * and returns the first thing JSON cannot carry, named by its position. A zod union
 * of the six JSON forms would state the same rule and report it far worse, six
 * member failures for one typo, none of them the sentence that helps, and, being
 * recursive, would render as a cyclic JSON Schema in a structured-output request.
 *
 * `undefined` is not a member, and neither is anything JSON cannot carry (a Date -
 * which is what a bare `2026-08-09` in YAML parses to, a function, `NaN`, an
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

/** The first non-JSON leaf inside a value, named by its position, else null. */
function jsonValueDefect(value: unknown, at: string): string | null {
  if (value === null) return null
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return null
    case 'number':
      return Number.isFinite(value) ? null : `${at || 'the value'} is ${value}, which JSON cannot carry`
    case 'undefined':
      return `${at || 'the value'} has no value, write it under \`remove\` to take the key away`
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
 * A key path's SEGMENTS, the JSON object keys it addresses, in order, or the
 * sentence naming why the text is not a key path.
 *
 * A path is dot-separated (`api.build.command`). A key that CONTAINS a dot is
 * written with the dot escaped (`scripts.build\.prod` addresses `scripts`, then
 * `build.prod`), and a literal backslash is `\\`; nothing else may follow a
 * backslash. An empty segment (`a..b`, a leading or trailing dot) is rejected too:
 * both it and a dangling escape are typos that would otherwise silently address a
 * key nobody meant, and a patch's whole promise is that it changes what it names.
 *
 * Object keys only, a numeric segment is a KEY named "0", never an array index.
 * Arrays are values a patch sets and reads back whole; addressing INTO one would
 * need index and bounds semantics the configs and manifests these flows patch do
 * not use.
 */
export function guardKeyPathSegments(path: string): { segments: string[] } | { error: string } {
  const segments: string[] = []
  let current = ''
  const empty = (): { error: string } => ({
    error: `key path "${path}" has an empty segment, every key must be named (write \\. for a dot inside a key)`,
  })
  for (let i = 0; i < path.length; i++) {
    const ch = path[i]
    if (ch === '\\') {
      const next = path[i + 1]
      if (next === undefined) {
        return { error: `key path "${path}" ends in a lone backslash, write \\\\ for a literal backslash` }
      }
      if (next !== '.' && next !== '\\') {
        return {
          error: `key path "${path}" has an unknown escape "\\${next}", the only escapes are \\. (a dot inside a key) and \\\\ (a backslash)`,
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
 * Segments rendered back as a key path, the inverse of {@link guardKeyPathSegments}.
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
     * Key path → the value to write there. The FINAL key may be new, setting a
     * field the document does not carry yet is the point, but every intermediate
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
 *  - the file is not there (never created, a patch edits, it does not seed);
 *  - the file is not valid JSON (reported with the position the parser stopped at);
 *  - a `set`'s intermediate container is missing (never conjured) or is not an
 *    object (reported with the type that is actually there);
 *  - a `remove`'s key path does not exist in full.
 * Failures name the deepest key path that DOES exist, and a step that fails on any
 * one of its operations writes NONE of them, one edit or none, never half.
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
          message: `"${file}" is not a JSON file, a patch edits JSON documents only (the path must end in .json)`,
          path: ['patch', file],
        })
      }
      const paths = [...Object.keys(ops.set ?? {}), ...(ops.remove ?? [])]
      if (paths.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${file}" is patched with no operations, name a \`set\`, a \`remove\`, or both`,
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

/** ONE cli step, one action: run the program, run git, or mutate sandbox files. */
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

// --- Presentation: what a cli step DOES and ASSERTS --------------------

/** `exists` / `is absent` / `is “x”` / `contains “x”`, one file matcher. */
export function describeFileMatcher(m: GuardFileMatcher): string {
  if (m.exists) return 'exists'
  if (m.absent) return 'is absent'
  if (m.equals !== undefined) return `is “${m.equals}”`
  return `contains “${m.contains}”`
}

export function describeCliExpect(expect: GuardExpect | GuardFileExpect | undefined): string {
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

/** `set a.b, remove c`, one file's patch operations, in declaration order. */
export function describePatchOperations(ops: GuardPatchOperations): string {
  return [
    ...Object.keys(ops.set ?? {}).map((p) => `set ${p}`),
    ...(ops.remove ?? []).map((p) => `remove ${p}`),
  ].join(', ')
}

/** What a cli step DOES, in the words a reader needs, one line per step kind. */
export function describeCliCommand(step: GuardCliStep): string {
  if (isRunStep(step)) {
    const argv = runArgvWords(step.run).join(' ')
    // A held command's ending is part of what the step DOES: a reader scanning the
    // list must see that this row stops itself rather than waiting for an exit.
    return step.until ? `${argv} (until “${step.until.marker}”)` : argv
  }
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

/** What a cli step DRIVES, the program, git, or the sandbox's files. */
export function cliStepKind(step: GuardCliStep): GuardStepKind {
  if (isRunStep(step)) return 'cli'
  if (isGitStep(step)) return 'git'
  // Write, delete and patch are one kind: all three act on the sandbox tree and
  // none spawns anything. What they do to it is the command's job to say.
  return 'file'
}

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

// --- Cross-step passes, the cli driver's half --------------------------

/** Every regex source a cli step carries, with the path that names it. */
export function cliStepPatterns(step: GuardCliStep): Array<{ where: string; pattern: string }> {
  // The file steps assert on file state only, no text matcher, no regex.
  if (!isProcessStep(step)) return []
  return [
    ...(step.expect.stdout ? matcherPatterns('expect.stdout', step.expect.stdout) : []),
    ...(step.expect.stderr ? matcherPatterns('expect.stderr', step.expect.stderr) : []),
    ...(step.expect.output ? matcherPatterns('expect.output', step.expect.output) : []),
    // A capture pattern runs against real output on a real run; a source that does
    // not compile must die at load like every other one, not mid-scenario.
    ...Object.entries(step.capture ?? {}).map(([name, c]) => ({
      where: `capture.${name}`,
      pattern: c.pattern,
    })),
  ]
}

/** The capture names one cli step assigns, in declaration order. */
export function cliStepCaptureNames(step: GuardCliStep): string[] {
  // A file step writes, deletes or patches; it spawns nothing and so produces no output.
  if (!isProcessStep(step)) return []
  return Object.keys(step.capture ?? {})
}
