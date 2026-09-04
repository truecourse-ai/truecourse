/**
 * The WEB driver's verb vocabulary — the per-driver closed sub-schema the driver
 * registry (`drivers.ts`) describes, in its own module because a driver's verbs are
 * its own business: the scenario ENVELOPE is frozen across drivers, and only this
 * grows.
 *
 * A web step is taken by a real browser against the web surface the sandbox serves.
 * There is no model anywhere in it: navigate, click, fill, upload, assert —
 * declarative, deterministic, and waiting only on observable state.
 *
 * Five decisions are load-bearing here, and each is documented at its schema:
 *   - the LOCATOR is closed to the handles a USER perceives ({@link GuardWebLocatorSchema});
 *   - the step declares its own DRIVER ({@link webDriver});
 *   - the address is asserted ORIGIN-STRIPPED ({@link GuardWebExpectSchema});
 *   - the verb set is CLOSED at seven ({@link GuardWebStepSchema});
 *   - a step may CAPTURE what the page shows ({@link GuardWebCaptureSchema}), into
 *     the same scenario-wide namespace a cli or api step captures into.
 */

import { z } from 'zod'
import { GuardCaptureNameSchema, oneCapturingGroup } from './capture.js'
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

/** The ARIA-state assertions {@link GuardWebStateSchema} adds to a locator member. */
const stateShape = {
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
} as const

/** One locator member with the state assertions on it — see {@link GuardWebStateSchema}. */
function stateMember<S extends z.ZodRawShape>(shape: S) {
  return z
    .object({ ...shape, ...stateShape })
    .strict()
    .refine((s) => GUARD_WEB_STATES.some((state) => s[state] !== undefined), {
      message: `a state expectation names at least one of ${GUARD_WEB_STATES.join(' | ')}`,
    })
}

/**
 * ONE element and the ARIA state(s) it must be in — the `visible` matcher's shape
 * with the assertion added: a locator (any member of the family), and what that
 * element's state must BE. Several states of the same element may be named at once
 * (a tab that is selected AND not disabled); each is evaluated and recorded on its own.
 */
export const GuardWebStateSchema = z.union([
  stateMember(roleShape),
  stateMember(placeholderShape),
  stateMember(labelShape),
  stateMember(textShape),
  stateMember(titleShape),
  stateMember(altShape),
])

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

// --- What a web step CAPTURES ----------------------------------------

/**
 * WHAT is read off the located element. Closed at the five things a page actually
 * holds a value in, and each of them is a value a USER can see or a screen reader
 * can be told:
 *
 *  - `text` — the element's rendered text, the default and the one a reader means;
 *  - `value` — an input's CURRENT value, which is a DOM property and appears in no
 *    page text at all: before this getter, "the field is prefilled with the name you
 *    signed up under" could not be carried forward by anything;
 *  - `count` — how many elements the locator matches, and the ONE getter exempt from
 *    the single-match rule (counting is the question "how many", so several matches
 *    are the answer, not an ambiguity);
 *  - `{ state }` — one ARIA state, as `"true"` / `"false"`, the same three-valued
 *    reading the `state` expectation makes (a state nothing exposes is a failure,
 *    never a quiet `"false"`);
 *  - `{ attribute }` — one attribute's raw value, for what a page keeps outside its
 *    text (an `href`, a `data-` fact).
 */
export const GuardWebGetterSchema = z.union([
  z.enum(['text', 'value', 'count']),
  z.object({ state: z.enum(GUARD_WEB_STATES) }).strict(),
  z.object({ attribute: z.string().min(1) }).strict(),
])
export type GuardWebGetter = z.infer<typeof GuardWebGetterSchema>

/** True when the getter reads TEXT — the three a `number` slicer can cut a value out of. */
export function webGetterIsTextual(get: GuardWebGetter | undefined): boolean {
  return get === undefined || get === 'text' || get === 'value' || (typeof get === 'object' && 'attribute' in get)
}

/**
 * ONE value a web step takes off the page for the steps after it — the web half of
 * the capture vocabulary `capture.ts` documents, in the web driver's own terms: an
 * ELEMENT (any locator member) and WHAT to read off it.
 *
 * The failure discipline is that module's, verbatim: a locator that resolves to
 * nothing — or a `number` that does not match what was read — is THAT STEP FAILING
 * with the page as evidence, never an empty value flowing on into a later
 * assertion that then passes for the wrong reason.
 *
 * `number` is the same one-capturing-group rule a cli capture's `pattern` follows,
 * and it exists because a page writes its numbers in sentences ("seats left: 3"):
 * the value a delta claim compares is the 3, not the sentence. It belongs only to
 * the getters that read TEXT — a `count` is already a number, and a state is not one.
 */
export const GuardWebCaptureSchema = z
  .object({
    /** The element to read. Any locator member — see {@link GuardWebLocatorSchema}. */
    from: GuardWebLocatorSchema,
    /** What to read off it. Omitted ⇒ `text`, the way a cli capture defaults to `stdout`. */
    get: GuardWebGetterSchema.optional(),
    /** Regex source with EXACTLY ONE capturing group: the number inside the read text. */
    number: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.number === undefined) return
    if (!webGetterIsTextual(c.get)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['number'],
        message:
          '`number` slices a value out of TEXT — it belongs to the `text`, `value` and ' +
          '`attribute` getters. A `count` is already a number and a state is not one.',
      })
      return
    }
    oneCapturingGroup(c.number, ctx, ['number'])
  })

/**
 * A web step's whole capture block: name → what to take off the page. The names are
 * the SCENARIO's, not the driver's — a cli step, an api step and a web step all
 * assign into one namespace, single-assignment, checked at load (`captureDefects`),
 * which is what lets a browser hand a value to an HTTP request and back again.
 */
export const GuardWebCapturesSchema = z.record(GuardCaptureNameSchema, GuardWebCaptureSchema)

/** The capture block as every web verb declares it — additive and optional. */
const capture = GuardWebCapturesSchema.optional()

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
    capture,
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
    capture,
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
    capture,
    timeoutMs,
    note,
    milestone,
  })
  .strict()

/**
 * THE MIME TYPES a file can be typed by its NAME. Closed, and closed at the formats
 * an app actually asks a user for — because the type is what the page's own accept
 * filter reads, and a file offered as the wrong type is rejected by the app before
 * any claim is tested. A name this table cannot type is refused at LOAD (`type:`
 * names it explicitly), which is the same discipline the locator follows: guess
 * nothing, and make the author say what they mean.
 */
export const GUARD_WEB_FILE_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  csv: 'text/csv',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
  xml: 'application/xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/**
 * DECODED ceiling for one uploaded file. A scenario states a promise about an app,
 * not about how much memory the runner will hold: the payload travels through the
 * runner as a single buffer, and a fixture that grew a hundred megabytes would take
 * the whole run down instead of naming its own mistake.
 */
export const GUARD_WEB_FILE_MAX_BYTES = 10 * 1024 * 1024

/**
 * What the two naming helpers below need of a file, structurally. Spelled out rather
 * than taken from the schema because the schema's own refinement CALLS them: a
 * parameter typed as the schema's inferred output would make the schema's type
 * depend on itself.
 */
interface WebFileNaming {
  as?: string
  path?: string
  type?: string
}

/**
 * The filename the app is shown: the authored `as`, else the basename of the path
 * the bytes came from. One function, because the transcript, the type derivation and
 * the payload the browser receives must never disagree about what the file is called.
 */
export function webFileName(file: WebFileNaming): string {
  if (file.as !== undefined) return file.as
  const from = file.path ?? ''
  return from.slice(from.lastIndexOf('/') + 1)
}

/**
 * The MIME type a file is offered under — the declared `type`, else the one its
 * extension names. `null` when neither answers, which the schema refuses at load:
 * guessing `application/octet-stream` would send a real file under a type every
 * accept filter rejects, and the scenario would fail for a reason it never stated.
 */
export function webFileType(file: WebFileNaming): string | null {
  if (file.type !== undefined) return file.type
  const name = webFileName(file)
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  return GUARD_WEB_FILE_TYPES[name.slice(dot + 1).toLowerCase()] ?? null
}

/**
 * THE BYTES a step hands the page, and the identity they arrive under. Exactly ONE
 * byte source, because two sources is two answers to "what did the user pick":
 *
 *  - `base64` — the seeded-binary channel, and the primary one. A real PDF, a real
 *    PNG, published by the seed as a fixture field and referenced as
 *    `{{fixture:pdf.base64}}` — one canonical document across every surface that
 *    uploads it, rather than N copies of an unreviewable blob in the corpus.
 *  - `text` — bytes an author can READ in the scenario: a CSV import, a config
 *    file. UTF-8; anything else is base64's business.
 *  - `path` — a file the scenario's OWN world already holds, sandbox-relative (a
 *    cli step wrote it, or `setup.files` seeded it). It is the only source that
 *    names itself, so `as` is optional for it alone.
 *
 * `as` is the filename the APP sees, and it interpolates: apps routinely make the
 * filename the resource's title, so a `${unique}`-bearing name is what keeps two
 * runs of one scenario from colliding in the app's own data.
 */
export const GuardWebFileSchema = z
  .object({
    /** Bytes as base64 — the seeded-binary channel. `{{fixture:…}}` interpolates. */
    base64: z.string().min(1).optional(),
    /** Bytes as authored text, UTF-8 encoded. `${…}` tokens interpolate. */
    text: z.string().optional(),
    /** A sandbox-relative file the scenario's own world holds. */
    path: z.string().min(1).optional(),
    /** The filename the app sees. `${…}` tokens interpolate. */
    as: z.string().min(1).optional(),
    /** The MIME type the app is offered; read from the name's extension when omitted. */
    type: z.string().min(1).optional(),
  })
  .strict()
  .refine((f) => [f.base64, f.text, f.path].filter((v) => v !== undefined).length === 1, {
    message: 'a file names exactly one of `base64` | `text` | `path` — two byte sources is two answers',
  })
  .refine((f) => f.path !== undefined || f.as !== undefined, {
    message: '`base64`/`text` bytes have no name of their own — name the file with `as`',
  })
  .refine((f) => webFileType(f) !== null, {
    message:
      'the file’s type could not be read from its name — name it with `type`, or use a known extension',
  })

/**
 * Hand a file to the control a USER would operate — the button beside the drop
 * zone, the labelled input — and let the browser's own file chooser carry the bytes.
 *
 * The verb's value is the LOCATOR for the same reason `fill`'s is: the thing a
 * scenario names is the thing a reader clicks. The hidden `input[type=file]` behind
 * a styled upload button has no role and no accessible name — it is deliberately
 * unreachable by this vocabulary — and addressing it by selector would skip the
 * disabled state, the tooltip gate and the app's own click handler, going green on a
 * control a user cannot reach.
 *
 * The step asserts only that it could TAKE the action: the target resolved, a
 * chooser opened, and the chooser took the files. Everything about the EFFECT — the
 * document appearing, the accept filter refusing the type, a quota message — is the
 * ordinary `expect` block. The action acts, the expectation judges.
 */
export const GuardWebUploadStepSchema = z
  .object({
    driver: webDriver,
    /** The control a user would operate to pick a file — never the hidden input. */
    upload: GuardWebLocatorSchema,
    /** The bytes handed to the chooser, and the name they arrive under. */
    file: GuardWebFileSchema,
    expect: GuardWebExpectSchema.optional(),
    capture,
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
    capture,
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
    capture,
    timeoutMs,
    note,
    milestone,
  })
  .strict()

/**
 * THE PRINCIPAL VERB: `credential` installs one of the world's credentials — a
 * secret the recipe declares or the seed minted, the same `{{cred:<name>}}` set
 * an api step puts in a header — into the browser, so the scenario starts SIGNED
 * IN. A `Cookie` credential becomes the surface's cookies; any other header
 * rides every request the page makes. The value is never authored and never
 * shown: the step names the credential, the runner holds the secret.
 *
 * Why a verb and not a scenario-level default: whether the browser is signed in
 * is a FACT ABOUT THE SCENARIO — a flow about the anonymous experience must not
 * inherit a session — so it is declared where every other fact about a step is.
 * Why not the login form: the seed already minted the session, and every form
 * login re-spends the app's login rate limit (documenso 2026-09-03: 52 of 95
 * browser sessions never got past the sign-in page once the limit tripped).
 */
export const GuardWebCredentialStepSchema = z
  .object({
    driver: webDriver,
    /** The credential's NAME as the recipe/seed declares it — never its value. */
    credential: z.string().min(1),
    expect: GuardWebExpectSchema.optional(),
    capture,
    timeoutMs,
    note,
    milestone,
  })
  .strict()

/**
 * ONE web step — one action, or one assertion, taken by a real browser against the
 * web surface the sandbox serves. The verbs are closed at seven: navigate, click,
 * fill, upload, history, credential, expect. There is deliberately no hover, no scroll, no
 * keyboard: each would be a promise about how the page is OPERATED rather than what
 * it PROMISES, and the vocabulary grows only when a real claim cannot be stated
 * without it — which is exactly what `history` was (2026-08-11: "Back and Forward
 * move through the views" had no verb, and rode as a re-navigation that proved a
 * different sentence) and what `upload` is (2026-08-14: a document app's central
 * promise is "you can put a file into it", and no combination of click and fill
 * states it — a file chooser is not a text field).
 */
export type GuardWebRole = (typeof GUARD_WEB_ROLES)[number]
export type GuardWebLocator = z.infer<typeof GuardWebLocatorSchema>
export type GuardWebCapture = z.infer<typeof GuardWebCaptureSchema>
export type GuardWebCaptures = z.infer<typeof GuardWebCapturesSchema>
export type GuardWebStateExpect = z.infer<typeof GuardWebStateSchema>
export type GuardWebAttributeExpect = z.infer<typeof GuardWebAttributeSchema>
export type GuardWebClassExpect = z.infer<typeof GuardWebClassSchema>
export type GuardWebExpect = z.infer<typeof GuardWebExpectSchema>
export type GuardWebFile = z.infer<typeof GuardWebFileSchema>
export type GuardWebNavigateStep = z.infer<typeof GuardWebNavigateStepSchema>
export type GuardWebClickStep = z.infer<typeof GuardWebClickStepSchema>
export type GuardWebFillStep = z.infer<typeof GuardWebFillStepSchema>
export type GuardWebUploadStep = z.infer<typeof GuardWebUploadStepSchema>
export type GuardWebHistoryStep = z.infer<typeof GuardWebHistoryStepSchema>
export type GuardWebCredentialStep = z.infer<typeof GuardWebCredentialStepSchema>
export type GuardWebExpectStep = z.infer<typeof GuardWebExpectStepSchema>
/** The union is spelled out from its members (not inferred from the schema)
 *  because the schema below is annotated with it: seven strict members exceed
 *  what tsc will serialize into a declaration (TS7056), and the explicit alias
 *  keeps every schema built on the union emittable. */
export type GuardWebStep =
  | GuardWebNavigateStep
  | GuardWebClickStep
  | GuardWebFillStep
  | GuardWebUploadStep
  | GuardWebHistoryStep
  | GuardWebCredentialStep
  | GuardWebExpectStep

export const GuardWebStepSchema: z.ZodType<GuardWebStep, z.ZodTypeDef, unknown> = z.union([
  GuardWebNavigateStepSchema,
  GuardWebClickStepSchema,
  GuardWebFillStepSchema,
  GuardWebUploadStepSchema,
  GuardWebHistoryStepSchema,
  GuardWebCredentialStepSchema,
  GuardWebExpectStepSchema,
])

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

/** True when the web step hands a file to a control a user would operate. */
export function isWebUploadStep(step: GuardWebStep): step is GuardWebUploadStep {
  return 'upload' in step
}

/** True when the web step presses the browser's Back or Forward. */
export function isWebHistoryStep(step: GuardWebStep): step is GuardWebHistoryStep {
  return 'history' in step
}

export function isWebCredentialStep(step: GuardWebStep): step is GuardWebCredentialStep {
  return 'credential' in step
}

/**
 * True when the web step only asserts (it takes no action on the page).
 *
 * Defined by NEGATION, which makes it the one place a new ACTION verb must be
 * wired or it silently becomes an assert-only step: the executor would take no
 * action, the token pass would drop its authored strings, the transcript would say
 * "check the page" — and the step would go green having done nothing at all.
 */
export function isWebExpectStep(step: GuardWebStep): step is GuardWebExpectStep {
  return (
    !isWebNavigateStep(step) &&
    !isWebClickStep(step) &&
    !isWebFillStep(step) &&
    !isWebUploadStep(step) &&
    !isWebHistoryStep(step) &&
    !isWebCredentialStep(step)
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
    // A capture's slicer is a regex the browser step would otherwise discover was
    // uncompilable only after a sandbox, a build and a browser had been paid for.
    ...Object.entries(step.capture ?? {}).flatMap(([name, spec]) =>
      spec.number !== undefined ? [{ where: `capture.${name}.number`, pattern: spec.number }] : [],
    ),
  ]
}

/** The capture names ONE web step assigns, in declaration order. */
export function webStepCaptureNames(step: GuardWebStep): string[] {
  return Object.keys(step.capture ?? {})
}

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

/**
 * The LOCATOR half of a state expectation — the same object without the ARIA-state
 * fields, so the members that carry a locator plus something else (a state) can be
 * described and compiled by the locator machinery rather than by a second copy of it.
 */
export function webLocatorOf(state: GuardWebStateExpect): GuardWebLocator {
  const { checked, pressed, selected, expanded, disabled, ...locator } = state
  void checked, pressed, selected, expanded, disabled
  return locator as GuardWebLocator
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
  const target = describeWebLocator(webLocatorOf(state))
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
  // The file's NAME and the control, and never a byte of the payload: a base64
  // fixture is unreadable noise in a step list and a `text` file may be data the
  // scenario is about. Its size and digest ride the evidence instead.
  if (isWebUploadStep(step)) {
    return `upload “${webFileName(step.file)}” to ${describeWebLocator(step.upload)}`
  }
  if (isWebHistoryStep(step)) return `go ${step.history}`
  // The NAME only — the value is a secret the runner holds.
  if (isWebCredentialStep(step)) return `sign in as ${step.credential}`
  return 'check the page'
}
