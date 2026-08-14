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
 *   - the verb set is CLOSED at five ({@link GuardWebStepSchema}).
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
 *
 * `pick: first` is the one authored exception: a page can legitimately show many
 * controls that read the same (a grid of slot buttons, a list of identical rows)
 * where ANY of them serves the flow. Declaring it says "many matches are expected;
 * act on the first" — the intent is on the page, not guessed by the driver, so an
 * UNDECLARED ambiguity still fails as loudly as ever.
 */
export const GuardWebLocatorSchema = z
  .object({
    role: z.enum(GUARD_WEB_ROLES),
    /** The element's accessible name (its label, its text, its `aria-label`). */
    name: z.string().min(1),
    /** Demand the WHOLE accessible name rather than a case-insensitive substring. */
    exact: z.boolean().optional(),
    /** Act on the FIRST of several legitimate matches. See the strictness note above. */
    pick: z.literal('first').optional(),
  })
  .strict()

/**
 * THE ARIA STATES a web step may assert on an element. Closed, and closed at the
 * states a USER can perceive: a control is on or off (`checked`), held down
 * (`pressed`), the current one of a set (`selected`), opened or collapsed
 * (`expanded`), or refused (`disabled`). Everything else an element carries is
 * implementation.
 *
 * Why the vocabulary needs them at all: these are the states with NO text. A tab
 * strip's active tab, a toggle switch's position, a three-way mode selector — the
 * page renders each of them as a colour, and a `text` matcher asserting the label
 * beside them passes whatever position they are in. The state assertion is the only
 * honest form of the claim.
 *
 * The deliberate consequence: an element that exposes NO such state fails the
 * assertion by saying so ("exposes no aria-pressed state") rather than being
 * guessed at from a class or a colour. That failure is a real finding — the control
 * is unobservable to a screen reader too.
 */
export const GUARD_WEB_STATES = ['checked', 'pressed', 'selected', 'expanded', 'disabled'] as const
export type GuardWebState = (typeof GUARD_WEB_STATES)[number]

/**
 * ONE element and the ARIA state(s) it must be in — the `visible` matcher's shape
 * with the assertion added: a role, an accessible name, and what that element's
 * state must BE. Several states of the same element may be named at once (a tab
 * that is selected AND not disabled); each is evaluated and recorded on its own.
 */
export const GuardWebStateSchema = GuardWebLocatorSchema.extend({
  /** `aria-checked` (or a checkbox/radio's own checkedness). */
  checked: z.boolean().optional(),
  /** `aria-pressed` — a toggle button's held-down state. */
  pressed: z.boolean().optional(),
  /** `aria-selected` (or an `<option>`'s own selectedness) — the current one of a set. */
  selected: z.boolean().optional(),
  /** `aria-expanded` — a disclosure, a dropdown, a collapsible section. */
  expanded: z.boolean().optional(),
  /** `aria-disabled`, or the element's own disabled state. */
  disabled: z.boolean().optional(),
})
  .strict()
  .refine((s) => GUARD_WEB_STATES.some((state) => s[state] !== undefined), {
    message: `a state expectation names at least one of ${GUARD_WEB_STATES.join(' | ')}`,
  })

/**
 * The state assertions one `state` member carries, in the fixed order of
 * {@link GUARD_WEB_STATES} — so a step asserting two of them fails on the same one
 * every time, and its record reads the same way on every run.
 */
export function webStateAssertions(
  state: GuardWebStateExpect,
): Array<{ state: GuardWebState; expected: boolean }> {
  return GUARD_WEB_STATES.filter((name) => state[name] !== undefined).map((name) => ({
    state: name,
    expected: state[name] as boolean,
  }))
}

/**
 * ONE attribute of one element — the DOCUMENT ELEMENT (`<html>`) unless the
 * expectation names another.
 *
 * The document element is the default because that is where the facts a page keeps
 * outside its text usually live: a theme (`class="dark"`, `data-theme`), a locale, a
 * feature flag the shell sets. None of them has a role, a name, or a single word of
 * visible text, so before this member a scenario could press the theme button and
 * then assert nothing at all about what it did.
 *
 * `value` is the shared text-matcher vocabulary applied to the attribute's RAW
 * value; `present` asserts only that the attribute is (or is not) there, whatever it
 * says. For `class` specifically, prefer {@link GuardWebClassSchema}: a class
 * attribute is a TOKEN LIST, and `contains "dark"` on it also passes for
 * `darkroom-theme`.
 */
export const GuardWebAttributeSchema = z
  .object({
    /** The element to read it from; omitted ⇒ the document element (`<html>`). */
    of: GuardWebLocatorSchema.optional(),
    /** The attribute's name — `data-theme`, `aria-current`, `href`, `class`. */
    name: z.string().min(1),
    /** What its value must be. Compared against the raw attribute value. */
    value: GuardStreamMatcherSchema.optional(),
    /** Assert only that the attribute is there (`true`) or is not (`false`). */
    present: z.boolean().optional(),
  })
  .strict()
  .refine((a) => a.value !== undefined || a.present !== undefined, {
    message: 'an attribute expectation needs a `value` matcher or `present`',
  })

/**
 * A CLASS TOKEN on one element — the document element unless another is named.
 *
 * Separate from {@link GuardWebAttributeSchema} for one reason that matters: `class`
 * is a whitespace-separated token list, and every text matcher applied to it is
 * wrong in a way that passes. `contains "dark"` holds for `darkroom`, `equals "dark"`
 * breaks the moment any other class joins it, and a regex spelling the token
 * boundaries is a footgun a scenario should never have to write. This member matches
 * the way `classList.contains` does, which is what a reader means by "the dark class
 * is on it".
 */
export const GuardWebClassSchema = z
  .object({
    /** The element to read the class list from; omitted ⇒ the document element. */
    of: GuardWebLocatorSchema.optional(),
    /** A class token the element must carry. */
    has: z.string().min(1).optional(),
    /** A class token the element must NOT carry. */
    absent: z.string().min(1).optional(),
  })
  .strict()
  .refine((c) => c.has !== undefined || c.absent !== undefined, {
    message: 'a class expectation names a `has` or an `absent` token',
  })

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
 *  - `visible` — an element that must be present and visible, or SEVERAL of them.
 *    The plainest form of "the page arrived": no text to quote, just the thing that
 *    must be there. The list form exists because a toolbar of icon buttons is one
 *    claim ("the canvas controls survived the reload"), and their accessible names
 *    are `aria-label`s that never appear in the page's text — so a text matcher
 *    cannot state it and three separate steps would split one claim into three.
 *  - `state` — an ARIA state of one element. See {@link GuardWebStateSchema}.
 *  - `attribute` / `class` — what the page keeps OUTSIDE its text, on the document
 *    element by default. See {@link GuardWebAttributeSchema} / {@link GuardWebClassSchema}.
 *
 * The members are additive and every one of them is optional: an expectation
 * written before they existed asserts exactly what it always did.
 */
export const GuardWebExpectSchema = z
  .object({
    text: GuardStreamMatcherSchema.optional(),
    /** Read `text` from THIS element instead of the whole page. */
    within: GuardWebLocatorSchema.optional(),
    /** Matcher on `pathname + search` — never the origin. See above. */
    url: GuardStreamMatcherSchema.optional(),
    /** An element that must be present and visible — or a list of them. */
    visible: z.union([GuardWebLocatorSchema, z.array(GuardWebLocatorSchema).min(1)]).optional(),
    /** An ARIA state of one element. See {@link GuardWebStateSchema}. */
    state: GuardWebStateSchema.optional(),
    /** One attribute of one element (the document element by default). */
    attribute: GuardWebAttributeSchema.optional(),
    /** A class TOKEN on one element (the document element by default). */
    class: GuardWebClassSchema.optional(),
  })
  .strict()
  .refine(
    (e) =>
      e.text !== undefined ||
      e.url !== undefined ||
      e.visible !== undefined ||
      e.state !== undefined ||
      e.attribute !== undefined ||
      e.class !== undefined,
    { message: 'a web expectation needs one of text | url | visible | state | attribute | class' },
  )
  .refine((e) => e.within === undefined || e.text !== undefined, {
    message: '`within` scopes the `text` matcher — a scope with nothing to match is not an assertion',
  })

/** The presence targets one expectation carries, as a list (empty when it carries none). */
export function webVisibleTargets(
  visible: GuardWebExpect['visible'] | undefined,
): readonly GuardWebLocator[] {
  if (visible === undefined) return []
  return Array.isArray(visible) ? visible : [visible]
}

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
 * Move through the browser's own HISTORY — Back and Forward, the two buttons every
 * browser has and no page draws.
 *
 * It is a verb rather than a re-navigation because the claim is about the BROWSER:
 * "Back returns you to the previous view" is not proved by opening the previous
 * view's address again (that proves a link works). The distinction is load-bearing
 * in a single-page app, where Back restores state without fetching a document at
 * all — the case a re-navigation silently converts into a fresh mount.
 *
 * Nothing is asserted about the traversal itself: a history entry that is not there
 * simply leaves the page where it was, and the step's `expect` — an address, the
 * page's words — is what says whether the move happened. That is the same rule
 * every other web verb follows: the action acts, the expectation judges.
 */
export const GuardWebHistoryStepSchema = z
  .object({
    driver: webDriver,
    /** Which button: the browser's Back, or its Forward. */
    history: z.enum(['back', 'forward']),
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
 * web surface the sandbox serves. The verbs are closed at five: navigate, click,
 * fill, history, expect. There is deliberately no hover, no scroll, no keyboard:
 * each would be a promise about how the page is OPERATED rather than what it
 * PROMISES, and the vocabulary grows only when a real claim cannot be stated
 * without it — which is exactly what `history` was (2026-08-11: "Back and Forward
 * move through the views" had no verb, and rode as a re-navigation that proved a
 * different sentence).
 */
export const GuardWebStepSchema = z.union([
  GuardWebNavigateStepSchema,
  GuardWebClickStepSchema,
  GuardWebFillStepSchema,
  GuardWebHistoryStepSchema,
  GuardWebExpectStepSchema,
])

export type GuardWebRole = (typeof GUARD_WEB_ROLES)[number]
export type GuardWebLocator = z.infer<typeof GuardWebLocatorSchema>
export type GuardWebStateExpect = z.infer<typeof GuardWebStateSchema>
export type GuardWebAttributeExpect = z.infer<typeof GuardWebAttributeSchema>
export type GuardWebClassExpect = z.infer<typeof GuardWebClassSchema>
export type GuardWebExpect = z.infer<typeof GuardWebExpectSchema>
export type GuardWebNavigateStep = z.infer<typeof GuardWebNavigateStepSchema>
export type GuardWebClickStep = z.infer<typeof GuardWebClickStepSchema>
export type GuardWebFillStep = z.infer<typeof GuardWebFillStepSchema>
export type GuardWebHistoryStep = z.infer<typeof GuardWebHistoryStepSchema>
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

/** True when the web step presses the browser's Back or Forward. */
export function isWebHistoryStep(step: GuardWebStep): step is GuardWebHistoryStep {
  return 'history' in step
}

/** True when the web step only asserts (it takes no action on the page). */
export function isWebExpectStep(step: GuardWebStep): step is GuardWebExpectStep {
  return (
    !isWebNavigateStep(step) && !isWebClickStep(step) && !isWebFillStep(step) && !isWebHistoryStep(step)
  )
}

/** Every regex source a web step carries, with the path that names it. */
export function webStepPatterns(step: GuardWebStep): Array<{ where: string; pattern: string }> {
  return [
    ...(step.expect?.text ? matcherPatterns('expect.text', step.expect.text) : []),
    ...(step.expect?.url ? matcherPatterns('expect.url', step.expect.url) : []),
    ...(step.expect?.attribute?.value
      ? matcherPatterns('expect.attribute.value', step.expect.attribute.value)
      : []),
  ]
}

// --- Presentation: the words a step list and a failure both use --------

/** `button “Save”` / `first button “:00”` — one locator, in a reader's words. */
export function describeWebLocator(locator: GuardWebLocator): string {
  return `${locator.pick === 'first' ? 'first ' : ''}${locator.role} “${locator.name}”${locator.exact ? ' (exact)' : ''}`
}

/**
 * WHOSE state, attribute or class is being read — one element, or the document
 * element when the expectation names none. The words a failure and a green check
 * both use, so the two can never describe the same subject differently.
 */
export function describeWebSubject(of: GuardWebLocator | undefined): string {
  return of ? describeWebLocator(of) : 'the document element'
}

/** `tab “Home” is selected` / `switch “LLM rules” is not checked` — one state member. */
export function describeWebState(state: GuardWebStateExpect): string {
  const target = describeWebLocator({ role: state.role, name: state.name, ...(state.exact ? { exact: true } : {}) })
  return webStateAssertions(state)
    .map(({ state: name, expected }) => `${target} is ${expected ? '' : 'not '}${name}`)
    .join(' · ')
}

/** `the document element’s data-theme is “dark”` — one attribute member. */
export function describeWebAttribute(attribute: GuardWebAttributeExpect): string {
  const subject = describeWebSubject(attribute.of)
  if (attribute.value) return `${subject}’s ${attribute.name} ${describeStreamMatcher(attribute.value)}`
  return attribute.present
    ? `${subject} has a ${attribute.name} attribute`
    : `${subject} has no ${attribute.name} attribute`
}

/** `the document element has class “dark”` — one class member. */
export function describeWebClass(cls: GuardWebClassExpect): string {
  const subject = describeWebSubject(cls.of)
  return [
    ...(cls.has !== undefined ? [`${subject} has class “${cls.has}”`] : []),
    ...(cls.absent !== undefined ? [`${subject} does not have class “${cls.absent}”`] : []),
  ].join(' · ')
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
  for (const target of webVisibleTargets(expect.visible)) {
    parts.push(`${describeWebLocator(target)} is visible`)
  }
  if (expect.state) parts.push(describeWebState(expect.state))
  if (expect.attribute) parts.push(describeWebAttribute(expect.attribute))
  if (expect.class) parts.push(describeWebClass(expect.class))
  return parts.join(' · ')
}

/** What a web step DOES — one line per verb, the same rendering evidence uses. */
export function describeWebCommand(step: GuardWebStep): string {
  if (isWebNavigateStep(step)) return `navigate ${step.navigate}`
  if (isWebClickStep(step)) return `click ${describeWebLocator(step.click)}`
  if (isWebFillStep(step)) return `fill ${describeWebLocator(step.fill)} with “${step.value}”`
  if (isWebHistoryStep(step)) return `go ${step.history}`
  return 'check the page'
}
