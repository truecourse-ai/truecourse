/**
 * The WEB driver's verb vocabulary — the per-driver closed sub-schema the driver
 * registry (`drivers.ts`) describes, in its own module because a driver's verbs are
 * its own business: the scenario ENVELOPE is frozen across drivers, and only this
 * grows.
 *
 * A web step is taken by a real browser against the web surface the sandbox serves.
 * There is no model anywhere in it: navigate, click, fill, assert — declarative,
 * deterministic, and waiting only on observable state.
 *
 * Four decisions are load-bearing here, and each is documented at its schema:
 *   - the LOCATOR is role + accessible name, closed ({@link GuardWebLocatorSchema});
 *   - the step declares its own DRIVER ({@link webDriver});
 *   - the address is asserted ORIGIN-STRIPPED ({@link GuardWebExpectSchema});
 *   - the verb set is CLOSED at four ({@link GuardWebStepSchema}).
 */

import { z } from 'zod'
import {
  GuardStreamMatcherSchema,
  describeStreamMatcher,
  matcherPatterns,
  stepMilestone as milestone,
  stepNote as note,
  stepTimeoutMs as timeoutMs,
} from './step-parts.js'

/**
 * THE LOCATOR VOCABULARY: the ARIA roles a web step may name. Closed on purpose —
 * a locator is a role plus an accessible name (`getByRole` semantics) and nothing
 * else. No CSS, no XPath, no test ids: those address the IMPLEMENTATION, and a
 * scenario that addresses the implementation stops being a user-replayable probe
 * of the promise. An element with no role and no accessible name is not guessed
 * at — the claim that needs it is a gap naming the unlocatable element. Deliberate
 * side effect: coverage rewards accessible markup.
 *
 * The list is the ARIA role set the browser engine resolves, verbatim; narrowing
 * it further would only mean refusing markup that is perfectly locatable.
 */
export const GUARD_WEB_ROLES = [
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'definition',
  'deletion',
  'dialog',
  'directory',
  'document',
  'emphasis',
  'feed',
  'figure',
  'form',
  'generic',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'insertion',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'meter',
  'navigation',
  'none',
  'note',
  'option',
  'paragraph',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'strong',
  'subscript',
  'superscript',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'time',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
] as const

/**
 * ONE element of the page under test, addressed the way a user finds it: its ROLE
 * and its ACCESSIBLE NAME. `${…}` tokens interpolate in the name, so a step can
 * click the row an earlier step created.
 *
 * The match is on the accessible name as the browser computes it, case-insensitive
 * and substring by default (the way a reader would say "the Save button"); `exact`
 * demands the whole name, for the case where one name is a prefix of another.
 *
 * The locator is STRICT: it must resolve to exactly one element. Two elements with
 * the same role and name is a genuine ambiguity — the step fails saying how many it
 * found, rather than silently acting on the first and passing for the wrong reason.
 */
export const GuardWebLocatorSchema = z
  .object({
    role: z.enum(GUARD_WEB_ROLES),
    /** The element's accessible name (its label, its text, its `aria-label`). */
    name: z.string().min(1),
    /** Demand the WHOLE accessible name rather than a case-insensitive substring. */
    exact: z.boolean().optional(),
  })
  .strict()

/**
 * What a web step asserts about the page, once its action has been taken. Every
 * field is WAITED on until the step's budget runs out — the page is asynchronous,
 * and the discipline (§10.2) is to wait for OBSERVABLE STATE, never for a duration:
 * there is no sleep verb and there never will be one, because a timed wait either
 * makes a passing test slow or makes a failing test flaky.
 *
 *  - `text` — the page's visible text (or, with `within`, one element's), matched
 *    with the same four matchers a stream carries, so the vocabulary a reader
 *    already knows from a cli step means the same thing here.
 *  - `url` — the address as `pathname + search`, with the ORIGIN STRIPPED: the
 *    sandbox's port is allocated per run and asserting on it would assert on the
 *    runner. `/notes?title=x` is what a scenario writes and what a failure quotes.
 *  - `visible` — an element that must be present and visible. The plainest form of
 *    "the page arrived": no text to quote, just the thing that must be there.
 */
export const GuardWebExpectSchema = z
  .object({
    text: GuardStreamMatcherSchema.optional(),
    /** Read `text` from THIS element instead of the whole page. */
    within: GuardWebLocatorSchema.optional(),
    /** Matcher on `pathname + search` — never the origin. See above. */
    url: GuardStreamMatcherSchema.optional(),
    /** An element that must be present and visible. */
    visible: GuardWebLocatorSchema.optional(),
  })
  .strict()
  .refine((e) => e.text !== undefined || e.url !== undefined || e.visible !== undefined, {
    message: 'a web expectation needs one of text | url | visible',
  })
  .refine((e) => e.within === undefined || e.text !== undefined, {
    message: '`within` scopes the `text` matcher — a scope with nothing to match is not an assertion',
  })

/**
 * THE STEP-LEVEL DRIVER, made explicit. A step says how it acts; the scenario does
 * not say it for them (§2, 2026-08-09). The cli verbs (`run`, `git`, `write`,
 * `delete`, `patch`) are self-naming and keep meaning what they always did, so they
 * declare nothing; a web verb declares `driver: web`, and that is what selects the
 * browser executor for it.
 *
 * It is a field rather than an inference for the one step in this vocabulary that a
 * reader could not otherwise place: a step whose only verb is `expect` — assert
 * something about the page without acting on it — would be ambiguous against every
 * other step's `expect` BLOCK. Naming the driver on all four web verbs (not only
 * the ambiguous one) keeps the rule readable: if it says `web`, the browser does it.
 */
const webDriver = z.literal('web')

/**
 * Go to a path of the web surface the recipe declares. The path is
 * SURFACE-RELATIVE (`/analyses/42`) and never an origin: the sandbox allocates the
 * port, so a scenario that wrote one would be addressing a machine, not an app.
 *
 * Readiness is the navigation completing and the document being parsed; anything
 * the page then fetches is waited for by the EXPECTATION, which is where waiting
 * belongs (a navigation that "settles" on network silence is a sleep in disguise).
 */
export const GuardWebNavigateStepSchema = z
  .object({
    driver: webDriver,
    /** Surface-relative path, `/`-rooted. `${…}` tokens interpolate. */
    navigate: z.string().regex(/^\//, 'a navigate path must start with / (it is surface-relative)'),
    expect: GuardWebExpectSchema.optional(),
    timeoutMs,
    note,
    milestone,
  })
  .strict()

/** Activate an element — the click a user makes, on the element a user would find. */
export const GuardWebClickStepSchema = z
  .object({
    driver: webDriver,
    click: GuardWebLocatorSchema,
    expect: GuardWebExpectSchema.optional(),
    timeoutMs,
    note,
    milestone,
  })
  .strict()

/**
 * Type a value into an input, addressed by its LABEL (a labelled input's
 * accessible name is its label, so `{ role: textbox, name: "Title" }` is how a user
 * would describe it). The value carries the same `${…}` tokens every other authored
 * string does — including `${captured:…}`, which is what makes "take the id the CLI
 * printed and search for it in the UI" a scenario.
 */
export const GuardWebFillStepSchema = z
  .object({
    driver: webDriver,
    fill: GuardWebLocatorSchema,
    /** The text typed into it; may be empty (clearing a field is an action too). */
    value: z.string(),
    expect: GuardWebExpectSchema.optional(),
    timeoutMs,
    note,
    milestone,
  })
  .strict()

/**
 * Assert on the page without acting on it — the milestone-bearing step of a web
 * journey, and the reason the step-level `driver` field is explicit (see
 * {@link webDriver}). Its `expect` is required: a step that neither acts nor
 * asserts would be a no-op with a step number.
 */
export const GuardWebExpectStepSchema = z
  .object({
    driver: webDriver,
    expect: GuardWebExpectSchema,
    timeoutMs,
    note,
    milestone,
  })
  .strict()

/**
 * ONE web step — one action, or one assertion, taken by a real browser against the
 * web surface the sandbox serves. The verbs are closed at four: navigate, click,
 * fill, expect. There is deliberately no hover, no scroll, no keyboard: each would
 * be a promise about how the page is OPERATED rather than what it PROMISES, and the
 * vocabulary grows only when a real claim cannot be stated without it.
 */
export const GuardWebStepSchema = z.union([
  GuardWebNavigateStepSchema,
  GuardWebClickStepSchema,
  GuardWebFillStepSchema,
  GuardWebExpectStepSchema,
])

export type GuardWebRole = (typeof GUARD_WEB_ROLES)[number]
export type GuardWebLocator = z.infer<typeof GuardWebLocatorSchema>
export type GuardWebExpect = z.infer<typeof GuardWebExpectSchema>
export type GuardWebNavigateStep = z.infer<typeof GuardWebNavigateStepSchema>
export type GuardWebClickStep = z.infer<typeof GuardWebClickStepSchema>
export type GuardWebFillStep = z.infer<typeof GuardWebFillStepSchema>
export type GuardWebExpectStep = z.infer<typeof GuardWebExpectStepSchema>
export type GuardWebStep = z.infer<typeof GuardWebStepSchema>

/**
 * True when the step is driven by the browser rather than by the sandbox shell.
 * Takes any step object, so the cross-step passes that walk a whole scenario (regex
 * validation, capture composition, step rendering) can ask the question once.
 */
export function isWebStep(step: object): step is GuardWebStep {
  return 'driver' in step && (step as { driver?: unknown }).driver === 'web'
}

/** True when the web step goes to a path of the surface. */
export function isWebNavigateStep(step: GuardWebStep): step is GuardWebNavigateStep {
  return 'navigate' in step
}

/** True when the web step activates an element. */
export function isWebClickStep(step: GuardWebStep): step is GuardWebClickStep {
  return 'click' in step
}

/** True when the web step types into an input. */
export function isWebFillStep(step: GuardWebStep): step is GuardWebFillStep {
  return 'fill' in step
}

/** True when the web step only asserts (it takes no action on the page). */
export function isWebExpectStep(step: GuardWebStep): step is GuardWebExpectStep {
  return !isWebNavigateStep(step) && !isWebClickStep(step) && !isWebFillStep(step)
}

/** Every regex source a web step carries, with the path that names it. */
export function webStepPatterns(step: GuardWebStep): Array<{ where: string; pattern: string }> {
  return [
    ...(step.expect?.text ? matcherPatterns('expect.text', step.expect.text) : []),
    ...(step.expect?.url ? matcherPatterns('expect.url', step.expect.url) : []),
  ]
}

// --- Presentation: the words a step list and a failure both use --------

/** `button “Save”` — one locator, in the words a reader (and a failure) uses. */
export function describeWebLocator(locator: GuardWebLocator): string {
  return `${locator.role} “${locator.name}”${locator.exact ? ' (exact)' : ''}`
}

/** What a web step asserts, one line — `address is “/notes” · page text contains “x”`. */
export function describeWebExpect(expect: GuardWebExpect | undefined): string {
  if (!expect) return ''
  const parts: string[] = []
  if (expect.url) parts.push(`address ${describeStreamMatcher(expect.url)}`)
  if (expect.text) {
    const where = expect.within ? `${describeWebLocator(expect.within)} text` : 'page text'
    parts.push(`${where} ${describeStreamMatcher(expect.text)}`)
  }
  if (expect.visible) parts.push(`${describeWebLocator(expect.visible)} is visible`)
  return parts.join(' · ')
}

/** What a web step DOES — one line per verb, the same rendering evidence uses. */
export function describeWebCommand(step: GuardWebStep): string {
  if (isWebNavigateStep(step)) return `navigate ${step.navigate}`
  if (isWebClickStep(step)) return `click ${describeWebLocator(step.click)}`
  if (isWebFillStep(step)) return `fill ${describeWebLocator(step.fill)} with “${step.value}”`
  return 'check the page'
}
