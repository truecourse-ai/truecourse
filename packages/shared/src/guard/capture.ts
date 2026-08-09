/**
 * CAPTURE — a step names a piece of its own output, and later steps use the value.
 *
 * Real workflows chain: a command prints an id and the next command takes it, a
 * response carries a token and the next request sends it, a run prints an ESTIMATE
 * and the run after it must land at or below it. Without capture every argument is
 * a literal, so any claim of the form "take what it produced and pass it on" is
 * untestable, and every claim that compares two observations is unreachable.
 *
 * The vocabulary is three small things, and this module holds all three so the
 * schema, the runner, the loader and the authoring validator can never disagree
 * about what a capture is:
 *
 *   1. WHAT is captured — a regex with ONE capturing group over a cli step's
 *      output ({@link GuardCliCaptureSchema}); a response field path for an api
 *      step (that one predates this module and lives on the api step itself).
 *   2. HOW it is referenced — `${captured:<name>}` ({@link CAPTURED_TOKEN}), the
 *      same surgical substring token `${supplied:…}` and `${sandbox}` are, valid in
 *      a later step's argv, env, written content, request fields, and in its
 *      EXPECTATION values.
 *   3. WHAT can be asserted with it — {@link GuardComparisonSchema}, a numeric
 *      comparison (`equals` / `atMost` / `atLeast`) between the value a subject
 *      carries and a captured value, which is what makes "the real bill lands at
 *      or below the estimate" a test instead of a sentence.
 *
 * Determinism discipline, in both halves: a capture whose pattern does not match
 * is THAT STEP failing with its output as evidence — never an empty value flowing
 * on — and a comparison whose either side is not a number is a mismatch quoting
 * both raw values, never a silent `NaN` verdict.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/**
 * A capture name is an IDENTIFIER, so it can be addressed as `${captured:<name>}`
 * (and, on the api driver, by the bare `${<name>}` spelling that predates the
 * token). A name that no reference could ever spell is not a name.
 */
export const CAPTURE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export const GuardCaptureNameSchema = z
  .string()
  .regex(CAPTURE_NAME_PATTERN, 'a capture name must be an identifier: [A-Za-z_][A-Za-z0-9_]*')

// ---------------------------------------------------------------------------
// Regex sources that must isolate ONE value
// ---------------------------------------------------------------------------

/**
 * How many CAPTURING GROUPS a regex source declares, or `null` when it does not
 * compile at all (the loader's own regex check reports that, with the compile
 * error — this returns null rather than guessing).
 *
 * Counted by compiling `source|` and matching the empty string: the trailing
 * alternation always matches, and the result's length is 1 + the group count, for
 * any pattern, without parsing the source ourselves (nested groups, escaped
 * parens, character classes and non-capturing groups all count correctly).
 */
export function capturingGroupCount(source: string): number | null {
  try {
    return new RegExp(`${source}|`).exec('')!.length - 1
  } catch {
    return null
  }
}

/**
 * The one rule a pattern that must isolate a value cannot state field-by-field:
 * EXACTLY ONE capturing group, because the captured value IS that group. Zero
 * groups captures nothing; two leaves which one is meant to an implicit rule
 * nobody would guess the same way twice. A source that does not compile is left
 * to the loader's regex check, which reports it with the compile error.
 */
function oneCapturingGroup(source: string, ctx: z.RefinementCtx, path: (string | number)[]): void {
  const groups = capturingGroupCount(source)
  if (groups === null || groups === 1) return
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message:
      groups === 0
        ? 'the pattern needs ONE capturing group — the group is the captured value, e.g. "cost \\$([0-9.]+)"'
        : `the pattern declares ${groups} capturing groups; it needs exactly ONE — the group is the captured value`,
    path,
  })
}

// ---------------------------------------------------------------------------
// What a cli step captures
// ---------------------------------------------------------------------------

/** Which of a cli step's output channels a capture reads. */
export const GuardCaptureStreamSchema = z.enum(['stdout', 'stderr', 'output'])

/**
 * ONE value a cli step takes out of its own output: a regex whose single
 * capturing group IS the value, read from `stdout` (the default), `stderr`, or
 * both together (`output` — the whole of what a `tty` step wrote).
 *
 * The pattern runs against the RAW stream, deliberately: `normalize` exists to
 * REPLACE the volatile parts of output, and a run-generated id, version or cost is
 * exactly what a capture is for — capturing a normalizer's placeholder would defeat
 * the mechanism. (The same rule the `logs` matcher follows, for the same reason.)
 */
export const GuardCliCaptureSchema = z
  .object({
    /** Regex source with EXACTLY ONE capturing group; group 1 of the FIRST match. */
    pattern: z.string().min(1),
    /** Which stream to read. Omitted ⇒ `stdout`. */
    from: GuardCaptureStreamSchema.optional(),
  })
  .strict()
  .superRefine((c, ctx) => oneCapturingGroup(c.pattern, ctx, ['pattern']))

/**
 * A cli step's whole capture block: name → what to take out of its output. Names
 * are scenario-scoped and SINGLE-ASSIGNMENT — re-capturing one is a load error
 * (see `captureDefects`), never a value that silently changes under a later step.
 */
export const GuardCliCapturesSchema = z.record(GuardCaptureNameSchema, GuardCliCaptureSchema)

export type GuardCaptureStream = z.infer<typeof GuardCaptureStreamSchema>
export type GuardCliCapture = z.infer<typeof GuardCliCaptureSchema>
export type GuardCliCaptures = z.infer<typeof GuardCliCapturesSchema>

// ---------------------------------------------------------------------------
// The `${captured:…}` token
// ---------------------------------------------------------------------------

/**
 * `${captured:<name>}` — how a later step reaches a value an earlier one captured.
 * The same surgical substring replacement as `${supplied:…}` and `${sandbox}`
 * (never a parser), applied to scenario-AUTHORED strings only: a step's argv, its
 * env overlay, the content and paths it writes, an api request's fields, and its
 * EXPECTATION values.
 *
 * A reference no earlier step captures is a LOAD error, not a run-time surprise,
 * and so is a reference to a name the SAME step captures — a capture is readable
 * only by the steps after it. Both are `captureDefects`.
 */
export const CAPTURED_TOKEN = /\$\{captured:([A-Za-z_][A-Za-z0-9_]*)\}/g

/** Every capture name a string references, in first-seen order (deduped). */
export function capturedTokenRefs(value: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of value.matchAll(CAPTURED_TOKEN)) {
    if (seen.has(m[1])) continue
    seen.add(m[1])
    out.push(m[1])
  }
  return out
}

/**
 * Every capture name referenced anywhere in `value` — a deep walk of strings,
 * arrays and objects, in first-seen order. Object KEYS are walked too: an
 * `expect.files` key is an asserted path, and a step can legitimately assert on a
 * file it named with a captured value.
 */
export function capturedNamesIn(value: unknown): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  const add = (text: string): void => {
    for (const name of capturedTokenRefs(text)) {
      if (seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
  }
  const walk = (node: unknown): void => {
    if (typeof node === 'string') return add(node)
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node && typeof node === 'object') {
      for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
        add(key)
        walk(item)
      }
    }
  }
  walk(value)
  return names
}

// ---------------------------------------------------------------------------
// Comparison — what a captured value makes assertable
// ---------------------------------------------------------------------------

/**
 * One side of a comparison as a scenario writes it: a literal number, or a string
 * — which is how a `${captured:…}` reference is written, and how a number quoted
 * in YAML arrives. Either way the runner reads it as a number and says so loudly
 * when it is not one.
 */
export const GuardComparandSchema = z.union([z.number(), z.string().min(1)])

/**
 * A NUMERIC comparison on a subject that already has a matcher vocabulary
 * (`stdout`, `stderr`, `output`, an api header, the response body, a json path).
 * The point of it is the captured value: `atMost: "${captured:estimate}"` is how
 * "the real bill lands at or below the estimate" becomes a verdict instead of a
 * sentence — capture the estimate in one step, compare the actual in a later one.
 *
 * `number` locates the number inside the subject's TEXT (one capturing group, the
 * `capture` rule); omit it when the subject IS the number — a json path holding
 * `12`, or a stream whose whole text is one. Every operator present must hold.
 *
 * Numeric by design and only numeric: `equals`/`contains`/`matches` already say
 * everything there is to say about text, and an ordering on text is a comparison
 * nobody means.
 */
export const GuardComparisonSchema = z
  .object({
    /** Regex with ONE capturing group locating the number in the subject's text. */
    number: z.string().min(1).optional(),
    /** The subject's number must equal this (numeric equality: `0.30` is `0.3`). */
    equals: GuardComparandSchema.optional(),
    /** The subject's number must be ≤ this. */
    atMost: GuardComparandSchema.optional(),
    /** The subject's number must be ≥ this. */
    atLeast: GuardComparandSchema.optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.equals === undefined && c.atMost === undefined && c.atLeast === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a numeric comparison needs one of equals | atMost | atLeast',
      })
    }
    if (c.number !== undefined) oneCapturingGroup(c.number, ctx, ['number'])
  })

export type GuardComparand = z.infer<typeof GuardComparandSchema>
export type GuardComparison = z.infer<typeof GuardComparisonSchema>

/** `at most 0.42` / `at least 3 · equals 7` — one comparison, in a reader's words. */
export function describeComparison(c: GuardComparison): string {
  const parts: string[] = []
  if (c.equals !== undefined) parts.push(`equals ${c.equals}`)
  if (c.atMost !== undefined) parts.push(`at most ${c.atMost}`)
  if (c.atLeast !== undefined) parts.push(`at least ${c.atLeast}`)
  const where = c.number !== undefined ? ` (the number matching /${c.number}/)` : ''
  return `${parts.join(' · ')}${where}`
}
