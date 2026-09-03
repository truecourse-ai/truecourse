/**
 * THE WEB LOCATOR VOCABULARY — how a step, an interface, or a resource addresses
 * ONE element of a page: by the handles a USER perceives, never by a selector.
 *
 * Two decisions are load-bearing and documented at their schemas:
 *   - the LOCATOR is closed to the handles a user perceives ({@link GuardWebLocatorSchema});
 *   - the ARIA STATES are closed to the ones a user can perceive ({@link GUARD_WEB_STATES}).
 *
 * The web driver's step verbs are not here: the executor that runs them has not
 * shipped, and the locator half is what the interface catalog needs today.
 */

import { z } from 'zod'

/**
 * THE LOCATOR VOCABULARY: the ARIA roles a web step may name. Closed on purpose —
 * the primary locator is a role plus an accessible name (`getByRole` semantics),
 * and the members beside it ({@link GuardWebLocatorSchema}) are the OTHER ways a
 * user perceives an element. No CSS, no XPath, no test ids: those address the
 * IMPLEMENTATION, and a scenario that addresses the implementation stops being a
 * user-replayable probe of the promise. An element no user-perceivable handle
 * reaches is not guessed at — the claim that needs it is a gap naming the
 * unlocatable element. Deliberate side effect: coverage rewards accessible markup.
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
 * The two escapes EVERY locator member carries, whichever handle it addresses the
 * element by — the strictness rules are a property of locating, not of one member.
 *
 * The match is case-insensitive and substring by default (the way a reader would
 * say "the Save button"); `exact` demands the whole string, for the case where one
 * value is a prefix of another.
 *
 * The locator is STRICT: it must resolve to exactly one element. Two elements
 * reading the same is a genuine ambiguity — the step fails saying how many it
 * found, rather than silently acting on the first and passing for the wrong reason.
 *
 * `pick: first` is the one authored exception: a page can legitimately show many
 * controls that read the same (a grid of slot buttons, a list of identical rows)
 * where ANY of them serves the flow. Declaring it says "many matches are expected;
 * act on the first" — the intent is on the page, not guessed by the driver, so an
 * UNDECLARED ambiguity still fails as loudly as ever.
 */
const locatorEscapes = {
  /** Demand the WHOLE value rather than a case-insensitive substring. */
  exact: z.boolean().optional(),
  /** Act on the FIRST of several legitimate matches. See the strictness note above. */
  pick: z.literal('first').optional(),
} as const

/**
 * The locator MEMBERS, as raw shapes — kept as shapes rather than schemas because
 * {@link GuardWebStateSchema} is each of them with the ARIA-state fields added, and
 * a union cannot be `.extend`ed.
 */
const roleShape = {
  role: z.enum(GUARD_WEB_ROLES),
  /** The element's accessible name (its label, its text, its `aria-label`). */
  name: z.string().min(1),
  ...locatorEscapes,
} as const
/** The prompt text INSIDE an empty input — what a user reads before typing. */
const placeholderShape = { placeholder: z.string().min(1), ...locatorEscapes } as const
/** The visible LABEL of a form control, as `getByLabel` computes it. */
const labelShape = { label: z.string().min(1), ...locatorEscapes } as const
/** The element's own visible TEXT — the plainest handle a reader has. */
const textShape = { text: z.string().min(1), ...locatorEscapes } as const
/** The `title` attribute — the tooltip a user hovers to read. */
const titleShape = { title: z.string().min(1), ...locatorEscapes } as const
/** An image's ALT TEXT — what a user is told the picture is. */
const altShape = { alt: z.string().min(1), ...locatorEscapes } as const

/**
 * ONE element of the page under test, addressed the way a USER finds it: by its
 * ROLE and ACCESSIBLE NAME (the primary member, and the one to reach for), or by
 * one of the five other handles a person actually perceives — the placeholder they
 * read inside an empty box, the label beside a field, the words on the element, the
 * tooltip they hover, the alt text of a picture. `${…}` tokens interpolate in every
 * one of those values, so a step can click the row an earlier step created.
 *
 * The family is closed at those six, and the exclusions are the point: a CSS
 * selector, an XPath and a test id are all names the IMPLEMENTATION gave itself,
 * invisible to every user of the app, and a scenario written in them stops being a
 * user-replayable probe of the promise — it passes for markup nobody can operate
 * and breaks on a refactor that changed nothing a user sees. The members here are
 * all things a person can point at on the screen; that is the whole membership rule,
 * and it is why the family can grow without ever growing a selector.
 *
 * Each member is exclusive (they are strict objects, so two handles at once is a
 * parse error) and each carries the same `exact` / `pick` escapes — see
 * {@link locatorEscapes} for the strictness discipline they belong to.
 */
export const GuardWebLocatorSchema = z.union([
  z.object(roleShape).strict(),
  z.object(placeholderShape).strict(),
  z.object(labelShape).strict(),
  z.object(textShape).strict(),
  z.object(titleShape).strict(),
  z.object(altShape).strict(),
])

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

export type GuardWebRole = (typeof GUARD_WEB_ROLES)[number]
export type GuardWebLocator = z.infer<typeof GuardWebLocatorSchema>

// --- Presentation: the words a step list and a failure both use --------

/** The field a locator member keeps its authored value in. See {@link webLocatorValueKey}. */
export type GuardWebLocatorValueKey = 'name' | 'placeholder' | 'label' | 'text' | 'title' | 'alt'

/**
 * WHICH field of a locator carries its authored value — the one string `${…}`
 * tokens interpolate in, and the one a compiler passes to the browser. Takes any
 * object, because a state expectation is a locator with more on it and must resolve
 * its handle the same way. One source of truth: a member added to the family here
 * is described, interpolated and compiled from this answer.
 */
export function webLocatorValueKey(locator: object): GuardWebLocatorValueKey {
  if ('role' in locator) return 'name'
  if ('placeholder' in locator) return 'placeholder'
  if ('label' in locator) return 'label'
  if ('text' in locator) return 'text'
  if ('title' in locator) return 'title'
  return 'alt'
}

/**
 * The HANDLE a locator addresses its element by — which member it is, and the
 * value it carries — in the one place every renderer and the driver's compiler
 * read it from, so a new member can never be described one way and compiled another.
 */
export function webLocatorHandle(locator: GuardWebLocator): {
  key: GuardWebLocatorValueKey
  kind: string
  value: string
} {
  const key = webLocatorValueKey(locator)
  const value = (locator as unknown as Record<GuardWebLocatorValueKey, string>)[key]
  // The role member reads as its ROLE ("button “Save”"); the others read as the
  // handle they are ("placeholder “Search”"), because that is what a reader must
  // go looking for on the page.
  const kind = 'role' in locator ? locator.role : key === 'alt' ? 'alt text' : key
  return { key, kind, value }
}

/** `button “Save”` / `first placeholder “Search”` — one locator, in a reader's words. */
export function describeWebLocator(locator: GuardWebLocator): string {
  const { kind, value } = webLocatorHandle(locator)
  return `${locator.pick === 'first' ? 'first ' : ''}${kind} “${value}”${locator.exact ? ' (exact)' : ''}`
}
