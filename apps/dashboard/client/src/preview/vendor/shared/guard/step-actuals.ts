/**
 * The ACTUAL half of a step: what one step of one scenario really did in one run.
 * Its counterpart is the AUTHORED half ({@link GuardScenarioStepView}, what the step
 * asserts), the test detail renders the pair, so every step reads the same way:
 * expected, actual, output.
 *
 * The run's EVIDENCE BUNDLE is where this lives: `invocation.json` already carries one
 * record per executed step (index, exit code / status, duration) and is written for
 * every executed outcome, `pass` included. Its per-step output is head-truncated at
 * write time, so nothing read back here is unbounded, and the whole bundle is
 * gitignored run data, the committable `LATEST.json` stays inline-compact.
 *
 * A step that never executed, the run stopped at an earlier failure, or was cancelled
 *, has no record and therefore no actual. Nothing is invented for it.
 */

import { z } from 'zod'
import { OutputExcerptsSchema } from './excerpts'

/**
 * ONE member of a web step's expectation beside the page's own answer to it. A web
 * step can assert an address, the page's words and a control's presence at once, and
 * each has its own answer: rendering one of them (the address) as "the actual" of all
 * three reads as a failure on a step that passed.
 */
export const GuardStepWebCheckSchema = z
  .object({
    // `state`, `attribute` and `class` joined the three original subjects when the
    // observation channels landed (2026-08-11). Additive: a bundle written before
    // them carries none, and one written with them reads in any reader that only
    // renders `expected` / `actual` / `ok`, which is every renderer there is.
    subject: z.enum(['url', 'text', 'visible', 'state', 'attribute', 'class']),
    /** The assertion in full, `the page text contains "Filtered by"`. */
    expected: z.string(),
    /** What the page had for THAT assertion. */
    actual: z.string(),
    ok: z.boolean(),
  })
  .strict()
export type GuardStepWebCheck = z.infer<typeof GuardStepWebCheckSchema>

/**
 * The FILE an upload step handed the page, its identity, never its content. Name,
 * size and digest are what a reader checks ("that is the seed's canonical PDF, and
 * the app is showing its name"); the bytes themselves are a payload no record needs
 * and, for an authored `text` file, may be the very data the scenario is about.
 */
export const GuardStepWebUploadSchema = z
  .object({
    /** The filename the app was shown. */
    name: z.string(),
    /** Decoded size in bytes. */
    bytes: z.number().int().nonnegative(),
    /** sha256 of the bytes, hex, auditable against a seed's published digest. */
    sha256: z.string(),
  })
  .strict()
export type GuardStepWebUpload = z.infer<typeof GuardStepWebUploadSchema>

/**
 * What a WEB step did, in its own vocabulary. A browser step spawns nothing, so it
 * has no exit code and no streams: it has an action, an address, what it asserted
 * and what answered each assertion, the page's own words, and a picture.
 */
export const GuardStepWebActualSchema = z
  .object({
    /** What the browser did, `navigate /notes`, `click button “Save”`. */
    action: z.string(),
    /** The address after the step, as `pathname + search`. */
    url: z.string(),
    /** The step's screenshot in the run's evidence bundle, by filename. */
    screenshot: z.string().optional(),
    /** Each member of the expectation with the page's answer to it, in step order. */
    checks: z.array(GuardStepWebCheckSchema).default([]),
    /** What the page showed, the browser's answer to "what did it print". */
    text: z.string().optional(),
    /** Console lines and page errors seen during the step. */
    console: z.array(z.string()).optional(),
    /**
     * The file an `upload` step handed the page. Additive and optional (the
     * `failure.visual` precedent): a bundle written before the verb carries none.
     */
    upload: GuardStepWebUploadSchema.optional(),
  })
  .strict()
export type GuardStepWebActual = z.infer<typeof GuardStepWebActualSchema>

/**
 * ONE member of an API request step's expectation beside the response's own answer
 * to it, the same honest pairing a web step records, in the api vocabulary. A
 * request can assert a status, a header, the body and several json paths at once;
 * showing the status as "the actual" of all of them reads as a failure on a step
 * that passed.
 */
export const GuardStepApiCheckSchema = z
  .object({
    subject: z.enum(['status', 'headers', 'body', 'schema', 'json']),
    /** The assertion in full, `json total is 2`. */
    expected: z.string(),
    /** What the response had for THAT assertion. */
    actual: z.string(),
    ok: z.boolean(),
  })
  .strict()
export type GuardStepApiCheck = z.infer<typeof GuardStepApiCheckSchema>

export const GuardStepActualSchema = z
  .object({
    /** 1-based step index, the same position `GuardScenarioStepView.n` names. */
    n: z.number().int().positive(),
    /**
     * What the step returned, one line: `exit 0` (cli), `status 200` (an api request),
     * `timed out`, or the spawn/request error. Absent when the step returns nothing to
     * report, a `write`/`delete` that spawns no process, an api lifecycle step.
     */
    actual: z.string().optional(),
    /** Wall clock of the step's last executed iteration. */
    durationMs: z.number().nonnegative(),
    /**
     * The browser's record, on a web step, see {@link GuardStepWebActualSchema}. Its
     * presence is what tells a reader (and a renderer) that this step's record speaks
     * pages and addresses rather than exit codes and streams.
     */
    web: GuardStepWebActualSchema.optional(),
    /**
     * Each member of the step's expectation beside the answer it got, recorded by an
     * API REQUEST step, whose response answers a status assertion, a header assertion
     * and each json path separately. Absent when the step records no pairs (every cli
     * step, and a request step that never got a response); a web step's pairs ride in
     * {@link GuardStepWebActualSchema}.checks, beside the page they were read from.
     */
    checks: z.array(GuardStepApiCheckSchema).optional(),
    /**
     * What the step printed, head-truncated at write time; each stream omitted when it
     * was empty. An api request's response body rides as `stdout`, the same mapping the
     * api driver's failure excerpts use. A web step has neither, its `web.text` is
     * what it "printed".
     */
    ...OutputExcerptsSchema.shape,
  })
  .strict()
export type GuardStepActual = z.infer<typeof GuardStepActualSchema>

/**
 * One `invocation.json` step record, as either driver writes it. Deliberately
 * permissive: the bundle carries far more per step (argv, headers, captures) than the
 * actual half needs, and a bundle written before per-step output was retained must
 * still read, it simply yields records with no output.
 */
const InvocationStepSchema = z
  .object({
    index: z.number().int().positive(),
    kind: z.string().optional(),
    /** cli: the process exit code; `null` when the child was killed. */
    exitCode: z.number().nullable().optional(),
    /** api: the response status; `null` when no response arrived. */
    status: z.number().nullable().optional(),
    timedOut: z.boolean().optional(),
    /**
     * cli: the marker this step was RUN UNTIL, present when the runner stopped the
     * child at it. The exit code is then the runner's signal, not the command's, so
     * this is what the actual line reports instead.
     */
    endedAtMarker: z.string().optional(),
    spawnError: z.string().optional(),
    requestError: z.string().optional(),
    durationMs: z.number().nonnegative().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    /** api: the response body excerpt (the cli `stdout` analog). */
    body: z.string().optional(),
    /** web: the address the step ended at, `pathname + search`. */
    url: z.string().optional(),
    /**
     * web: the browser's own record, the action, the address, each expectation
     * beside its answer, the page text, the screenshot. Read permissively (a bundle
     * written before checks were recorded still reads, with none).
     */
    web: z
      .object({
        command: z.string().optional(),
        url: z.string().optional(),
        screenshot: z.string().optional(),
        checks: z.array(GuardStepWebCheckSchema).optional(),
        visibleText: z.string().optional(),
        console: z.array(z.string()).optional(),
        upload: GuardStepWebUploadSchema.optional(),
      })
      .passthrough()
      .optional(),
    /**
     * api (a request step taken in a SANDBOX scenario): the request line and each
     * expectation beside the response's answer to it. Read permissively for the same
     * reason the web record is, a bundle written before a field existed still reads.
     */
    api: z
      .object({
        command: z.string().optional(),
        expectation: z.string().optional(),
        checks: z.array(GuardStepApiCheckSchema).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

const InvocationSchema = z.object({ steps: z.array(InvocationStepSchema).default([]) }).passthrough()

type InvocationStep = z.infer<typeof InvocationStepSchema>

/** The step kinds that spawn nothing and return nothing, they have no actual line. */
const NO_RESULT_KINDS = new Set(['write', 'delete', 'patch', 'boot', 'signal', 'logs'])

/** The one-line actual of a record: what the step returned, or nothing when it returns nothing. */
function actualLine(step: InvocationStep): string | undefined {
  if (step.spawnError) return `failed to spawn: ${step.spawnError}`
  if (step.requestError) return `no response: ${step.requestError}`
  if (step.timedOut) return 'timed out'
  // A step the runner stopped at its marker never had an exit code of its own -
  // `exit (killed)` would report our own SIGKILL as the command's outcome.
  if (step.endedAtMarker) return `stopped at “${step.endedAtMarker}”`
  // A web step returns no code and no status, what it "returned" is where the
  // browser ended up, which is the one line a reader wants beside the screenshot.
  if (step.kind === 'web') return step.url ? `at ${step.url}` : undefined
  // A request step returns a STATUS. Asked before the exit-code branch because a
  // sandbox bundle carries both fields in one record shape, and `exit (killed)` on a
  // step that spawned nothing would be an invention.
  if (step.kind === 'api') return step.status == null ? undefined : `status ${step.status}`
  if (step.kind && NO_RESULT_KINDS.has(step.kind)) return undefined
  if ('exitCode' in step) return step.exitCode == null ? 'exit (killed)' : `exit ${step.exitCode}`
  if ('status' in step) return step.status == null ? undefined : `status ${step.status}`
  return undefined
}

/**
 * The BROWSER's half of a record, when the step had one. A web step's record is not
 * an exit code with a page attached: it is the action, the address, each expectation
 * beside what answered it, and what the page showed, which is why it travels as its
 * own field rather than as `stdout` under a cli name.
 */
function webActual(step: InvocationStep): { web?: GuardStepWebActual } {
  if (step.kind !== 'web' || !step.web) return {}
  const web = step.web
  return {
    web: {
      action: web.command ?? '',
      url: web.url ?? step.url ?? '',
      ...(web.screenshot ? { screenshot: web.screenshot } : {}),
      checks: web.checks ?? [],
      ...(web.visibleText ? { text: web.visibleText } : {}),
      ...(web.console && web.console.length > 0 ? { console: web.console } : {}),
      ...(web.upload ? { upload: web.upload } : {}),
    },
  }
}

/**
 * Read an evidence bundle's `invocation.json` as the per-step actuals of that
 * scenario's run. Anything that does not parse as a bundle yields an empty list, the
 * detail then shows the authored half alone, which is the honest reading of "no record
 * of this run exists", never a half-invented one.
 */
export function parseGuardStepActuals(source: string | unknown): GuardStepActual[] {
  let raw: unknown = source
  if (typeof source === 'string') {
    try {
      raw = JSON.parse(source)
    } catch {
      return []
    }
  }
  const parsed = InvocationSchema.safeParse(raw)
  if (!parsed.success) return []
  return parsed.data.steps.map((step) => {
    const line = actualLine(step)
    const stdout = step.stdout ?? step.body
    const checks = step.api?.checks ?? []
    return {
      n: step.index,
      ...(line !== undefined ? { actual: line } : {}),
      durationMs: step.durationMs ?? 0,
      ...webActual(step),
      ...(checks.length > 0 ? { checks } : {}),
      ...(stdout ? { stdout } : {}),
      ...(step.stderr ? { stderr: step.stderr } : {}),
    }
  })
}
