/**
 * The step PRIMITIVES every driver's verb vocabulary is built from — the pieces
 * that are not about cli, api or web, but about what a STEP is.
 *
 * They live apart from `scenario.ts` for one structural reason: the driver
 * vocabularies are separate modules (`web-steps.ts`, and the cli/api sets still in
 * `scenario.ts`), and the scenario schema composes them. If the shared pieces sat
 * inside the scenario module, every driver module would import the module that
 * imports it. One direction only: primitives → driver vocabularies → the scenario.
 *
 * Nothing driver-specific belongs here. A matcher, a milestone reference, and the
 * three fields any step may carry — that is the whole charter.
 */

import { z } from 'zod'
import { GuardComparisonSchema, describeComparison, type GuardComparison } from './capture.js'

// --- Regex sources ---------------------------------------------------

/**
 * The flags a scenario regex may carry beside its source: `i` (ignore case), `m`
 * (`^`/`$` match at line breaks), `s` (`.` matches a newline). JavaScript has no
 * inline `(?i)` group, so this field is the only way to ask for them.
 */
export const GuardRegexFlagsSchema = z
  .string()
  .regex(/^[ims]{1,3}$/, 'flags is a combination of i, m and s, e.g. "i"')
  .refine((f) => new Set(f).size === f.length, 'flags names each of i, m and s at most once')
  .describe('Flags of the regex: any of i (ignore case), m (multiline), s (dotAll). Never inline (?i).')

/** `/source/flags` — how a scenario regex reads in a description or a failure. */
export function regexLiteral(pattern: string, flags?: string): string {
  return `/${pattern}/${flags ?? ''}`
}

/**
 * Whether a regex source leads with a PCRE/Python inline flag group (`(?i)…`),
 * which JavaScript rejects. The usual reason a model-written regex does not
 * compile, so an error names the field that carries flags instead.
 */
export function hasInlineFlagGroup(pattern: string): boolean {
  return /^\(\?[a-zA-Z]+\)/.test(pattern)
}

// --- Text matchers ---------------------------------------------------

/**
 * The matcher vocabulary for anything that is TEXT: a cli stream, an api response
 * body or header, a web page's visible text or address. One of the four, compared
 * post-normalization.
 */
export const GuardStreamMatcherSchema = z
  .object({
    equals: z.string().optional(),
    contains: z.string().optional(),
    /** Regex source; matched with `new RegExp(matches, flags).test(value)`. */
    matches: z.string().optional(),
    /** The flags of `matches`. */
    flags: GuardRegexFlagsSchema.optional(),
    /**
     * A NUMERIC comparison on what the text carries — the form a CAPTURED value
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
  .refine((m) => m.flags === undefined || m.matches !== undefined, {
    message: '`flags` belongs to `matches`; a matcher without `matches` carries none',
  })

export type GuardStreamMatcher = z.infer<typeof GuardStreamMatcherSchema>

/** `contains “x”` / `matches /x/i` / `is “x”` / `at most N` — one text matcher. */
export function describeStreamMatcher(m: GuardStreamMatcher): string {
  if (m.equals !== undefined) return `is “${m.equals}”`
  if (m.contains !== undefined) return `contains “${m.contains}”`
  if (m.matches !== undefined) return `matches ${regexLiteral(m.matches, m.flags)}`
  return describeComparison(m.compare!)
}

/**
 * One regex source a step carries: where it sits, the source, its flags, and
 * whether its field has a `flags` beside it at all (a capture's slicer does not).
 */
export interface StepPattern {
  where: string
  pattern: string
  flags?: string
  takesFlags: boolean
}

/** The two regex sources one matcher can carry, with the paths that name them. */
export function matcherPatterns(
  where: string,
  m: { matches?: string; flags?: string; compare?: GuardComparison },
): StepPattern[] {
  const out: StepPattern[] = []
  if (m.matches !== undefined) out.push({ where, pattern: m.matches, flags: m.flags, takesFlags: true })
  if (m.compare?.number !== undefined) {
    out.push({ where: `${where}.compare.number`, pattern: m.compare.number, takesFlags: false })
  }
  return out
}

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

/** The `milestone` field as every step declares it — optional, any driver. */
export const stepMilestone = GuardStepMilestoneSchema.optional()

/** Source case ids actually asserted by this step. Not coverage until reviewed. */
export const stepChecks = z.array(z.string().min(1)).min(1).optional()

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

// --- The three fields any step may carry -----------------------------

/**
 * Sandbox-relative working directory for ONE step, resolved against the sandbox
 * cwd. A scenario that drives a second repository, a linked worktree or a fresh
 * clone needs it: those are sibling directories, and every step would otherwise
 * run in the sandbox root. A path escaping the sandbox is a scenario defect.
 */
export const stepCwd = z.string().min(1).optional()

/** Free-text authoring note: why THIS assertion is the falsifiable form of the claim. */
export const stepNote = z.string().min(1).optional()

/**
 * Wall-clock budget for ONE step, in milliseconds. Omitted ⇒ the runner's default
 * for that driver, which is sized for an action that answers immediately.
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
 * Additive and optional: a scenario that declares none parses and runs exactly
 * as it did before.
 */
export const stepTimeoutMs = z.number().int().positive().max(3_600_000).optional()

// --- What a step DRIVES ----------------------------------------------

/**
 * WHAT a step drives — the surface it acts on, never how it fared. A reader
 * scanning a step list wants to know which of these a row is before reading its
 * command: `cli` runs the program under test, `git` runs git beside it, `file`
 * writes or deletes sandbox files, `api` speaks to the booted server (a request, or
 * a lifecycle action against it), `web` drives the browser against the served web
 * surface.
 *
 * A closed vocabulary rather than a free-form string every renderer re-invents.
 */
export type GuardStepKind = 'cli' | 'git' | 'file' | 'api' | 'web'
