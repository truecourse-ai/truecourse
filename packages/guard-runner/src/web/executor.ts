/**
 * Execute ONE web step against the scenario's page.
 *
 * THE DETERMINISM RULE, and every line here follows from it: a web step waits for
 * OBSERVABLE STATE and never for a duration. There is no sleep verb, and there is
 * no retry — a flaky pass is worse than a red (§10.2). Waiting is one poll loop
 * over the SAME predicate the assertion is made of, bounded by the step's budget:
 * the moment the predicate holds the step is done, and when the budget runs out the
 * failure reported is the LAST OBSERVED one, so the message describes the page as
 * it actually stayed rather than as it was at some arbitrary first glance.
 *
 * A target that never appears is the step FAILING (a `fail`, not an `error`): the
 * page not showing a control the claim promises is exactly the drift a web scenario
 * exists to catch. Infrastructure — the navigation itself erroring, the browser
 * going away — stays an `error`, the same line the cli driver draws between a
 * command that ran and disagreed and a command that could not run.
 */

import path from 'node:path'
import type { Locator, Page } from 'playwright-core'
import {
  describeWebAttribute,
  describeWebClass,
  describeWebCommand,
  describeWebExpect,
  describeWebLocator,
  describeWebSubject,
  isWebClickStep,
  isWebFillStep,
  isWebHistoryStep,
  isWebNavigateStep,
  isWebUploadStep,
  webStateAssertions,
  webVisibleTargets,
  type GuardWebCapture,
  type GuardWebCaptures,
  type GuardWebExpect,
  type GuardWebLocator,
  type GuardWebState,
  type GuardWebStep,
} from '@truecourse/shared'
import { describeTextMatcher, matchTextMatcher, truncate, type ExpectMismatch } from '../expect.js'
import type { ArmedFileChooser } from './browser.js'
import type { WebFilePayload } from './upload.js'

/**
 * Default budget for one web step's observable state to arrive. Shorter than the
 * cli step default (30s) on purpose: a page that has not shown what the claim
 * promises within ten seconds has not shown it, and a long default only makes a
 * red board slow to reach.
 */
export const DEFAULT_WEB_STEP_TIMEOUT_MS = 10_000

/** How often the wait loop re-reads the page. */
const POLL_INTERVAL_MS = 100

/** Cap on the visible-text excerpt carried into a failure and the transcript. */
export const WEB_TEXT_LIMIT = 2_000

/** Cap on how many same-role elements a "target not found" failure lists. */
const ROLE_INVENTORY_LIMIT = 20

/** The screenshot filename a given step leaves in the evidence directory. */
export function webScreenshotFile(stepIndex: number): string {
  return `step-${stepIndex}.png`
}

/**
 * ONE member of a web expectation, with the page's OWN ANSWER to that member.
 *
 * The record of a web step is made of these, and that is the point: a step asserting
 * an address and a page's words has two answers, and reporting one of them beside
 * both assertions (the address standing in as the "actual" of a text check) reads as
 * a failure on a green step. Every declared member produces exactly one of these,
 * whether it held or not.
 */
export interface WebCheck {
  subject: 'url' | 'text' | 'visible' | 'state' | 'attribute' | 'class'
  /** The assertion in full, in the words a mismatch uses. */
  expected: string
  /** What the page had FOR THIS MEMBER — never another member's value. */
  actual: string
  ok: boolean
}

export interface WebStepResult {
  /** The address after the step, as `pathname + search` (never the ephemeral origin). */
  url: string
  /** What the page showed at the end of the step, head-truncated. */
  visibleText: string
  /** The screenshot's filename in the evidence dir — always written, pass or fail. */
  screenshot?: string
  /** Wall clock of the step. */
  durationMs: number
  /**
   * Every member of the step's expectation with what the page answered it. Empty
   * when the step asserted nothing AND when it never got to assert (its action
   * failed first) — the record tells those apart by whether the step declared one.
   */
  checks: readonly WebCheck[]
  /**
   * What this step took off the page for the steps after it — present only when it
   * declared captures AND every one of them was read. A step that failed publishes
   * nothing, which is what keeps a captured value a fact rather than a guess.
   */
  captured?: Record<string, string>
  /** The unmet expectation, when the step failed. */
  mismatch?: ExpectMismatch
  /** The infrastructure reason, when the step could not be taken at all. */
  infra?: string
}

export interface ExecuteWebStepOptions {
  page: Page
  /** `http://127.0.0.1:<port>` — what a `navigate` path is appended to. */
  baseUrl: string
  /** The step, with every `${…}` token already resolved. */
  step: GuardWebStep
  /** 1-based step index — it names the screenshot. */
  stepIndex: number
  /** Absolute directory screenshots are written into (the scenario's evidence dir). */
  evidenceDir: string
  /** This step's budget. */
  timeoutMs: number
  /**
   * The materialized file an `upload` step hands the chooser. The DRIVER resolves
   * the declaration into bytes, because the sandbox a `path:` file is read from is
   * the driver's context and not this module's — the executor drives the page, and
   * a step whose payload could not be materialized never reaches it.
   */
  file?: WebFilePayload
  /** Arm the page for the next file chooser — the session's, per step. */
  armFileChooser?: () => ArmedFileChooser
  /** Run-level cancellation. */
  signal?: AbortSignal
}

/** The address as a scenario writes it: path + query, with the origin dropped. */
export function pageAddress(page: Page): string {
  const raw = page.url()
  try {
    const url = new URL(raw)
    return `${url.pathname}${url.search}`
  } catch {
    // `about:blank` before the first navigation, and anything else non-absolute.
    return raw
  }
}

/** What the page shows a reader, head-truncated — the web driver's "stdout". */
async function readVisibleText(page: Page): Promise<string> {
  try {
    const text = await page.locator('body').innerText({ timeout: 1_000 })
    return text.slice(0, WEB_TEXT_LIMIT)
  } catch {
    return ''
  }
}

/**
 * The locator for one authored target — the handle the member names, compiled 1:1
 * to the browser engine's own query for it (`getByRole` for the primary member,
 * `getByPlaceholder` / `getByLabel` / `getByText` / `getByTitle` / `getByAltText`
 * for the five other things a user perceives). Nothing here can address the
 * implementation: there is no branch that takes a selector, because the schema has
 * no member that carries one.
 *
 * An authored `pick: first` narrows to the first match, so downstream counting sees
 * 0 or 1 and the strict must-be-unambiguous check never fires for declared grids.
 */
export function webLocator(page: Page, target: GuardWebLocator): Locator {
  const exact = target.exact ?? false
  const base =
    'role' in target
      ? page.getByRole(target.role, { name: target.name, exact })
      : 'placeholder' in target
        ? page.getByPlaceholder(target.placeholder, { exact })
        : 'label' in target
          ? page.getByLabel(target.label, { exact })
          : 'text' in target
            ? page.getByText(target.text, { exact })
            : 'title' in target
              ? page.getByTitle(target.title, { exact })
              : page.getByAltText(target.alt, { exact })
  return target.pick === 'first' ? base.first() : base
}

/**
 * The elements that DO carry the role a missed target named, by their visible text
 * — the single most useful line in a "no such control" failure, because the answer
 * is almost always "it is called something else now".
 *
 * Only the ROLE member has such an inventory: "every element with this placeholder"
 * is the query that just found nothing, and there is no wider set to list. For the
 * other members the page's own visible text (always in the detail) is the evidence.
 */
async function roleInventory(page: Page, target: GuardWebLocator): Promise<string[]> {
  if (!('role' in target)) return []
  try {
    const texts = await page.getByRole(target.role).allInnerTexts()
    return texts.map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t.length > 0).slice(0, ROLE_INVENTORY_LIMIT)
  } catch {
    return []
  }
}

/** The `target` mismatch for an element the page never showed exactly once. */
async function targetMismatch(
  page: Page,
  target: GuardWebLocator,
  found: number,
  what: string,
): Promise<ExpectMismatch> {
  const inventory = await roleInventory(page, target)
  const text = await readVisibleText(page)
  const missing =
    'role' in target
      ? `no ${target.role} named “${target.name}” is on the page`
      : `nothing on the page matches ${describeWebLocator(target)}`
  const actual =
    found === 0
      ? missing
      : `${found} elements match ${describeWebLocator(target)} — a target must be unambiguous`
  return {
    subject: 'target',
    expected: `${what} ${describeWebLocator(target)}`,
    actual,
    detail: [
      `expected ${what} ${describeWebLocator(target)} at ${pageAddress(page)}`,
      ...('role' in target
        ? [
            inventory.length > 0
              ? `the ${target.role} elements on the page are: ${inventory.map((t) => `“${t}”`).join(', ')}`
              : `the page has no ${target.role} elements at all`,
          ]
        : []),
      '--- visible page text ---',
      text,
    ],
  }
}

/** Sleep between polls — the only place a duration appears, and it waits on nothing. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
}

/**
 * Resolve a locator to EXACTLY ONE visible element, waiting for it to appear until
 * the deadline. Ambiguity is refused as loudly as absence: two controls with the
 * same accessible name means the step's target is a guess, and a guess that passes
 * is worse than a red.
 */
async function awaitTarget(
  page: Page,
  target: GuardWebLocator,
  what: string,
  deadline: number,
  signal?: AbortSignal,
): Promise<{ locator: Locator } | { mismatch: ExpectMismatch }> {
  let found = 0
  for (;;) {
    if (signal?.aborted) return { mismatch: await targetMismatch(page, target, found, what) }
    const locator = webLocator(page, target)
    try {
      found = await locator.count()
      if (found === 1 && (await locator.isVisible())) return { locator }
    } catch {
      // A navigation mid-poll destroys the execution context; the next poll re-reads.
      found = 0
    }
    if (Date.now() >= deadline) return { mismatch: await targetMismatch(page, target, found, what) }
    await tick()
  }
}

/**
 * ONE element, resolved at a GLANCE (no waiting of its own): the members that read
 * an element's state, attribute or class are evaluated inside the expectation's own
 * poll loop, so waiting here would be a second, nested wait racing the first.
 */
async function resolveOne(
  page: Page,
  target: GuardWebLocator,
  what: string,
): Promise<{ locator: Locator } | { mismatch: ExpectMismatch }> {
  const locator = webLocator(page, target)
  const found = await locator.count().catch(() => 0)
  if (found === 1) return { locator }
  return { mismatch: await targetMismatch(page, target, found, what) }
}

/**
 * What ONE state assertion read: the state's value as the page exposes it, or
 * `null` when the page exposes NOTHING for it — which is a real answer, and the one
 * a control whose position is drawn in colour alone gives.
 */
interface StateReading {
  value: boolean | null
  /** The page's own answer, in the words the check records. */
  actual: string
}

/** `aria-*` state values are a three-valued vocabulary; only two are booleans. */
function ariaBoolean(raw: string | null): boolean | null {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return null
}

/**
 * Every ARIA state of one element, read in ONE round trip. The `aria-*` attribute
 * wins where it is present (it is what a screen reader is told); the element's own
 * state answers for the native controls that carry no ARIA — a checkbox, an
 * `<option>`, a `disabled` button — because those ARE exposed to a user.
 */
async function readElementStates(
  locator: Locator,
  target: GuardWebLocator,
): Promise<Record<GuardWebState, StateReading>> {
  // The callback runs in the PAGE, which this package has no DOM types for (and
  // deliberately does not pull in: the runner is a node program). The structural
  // shape below is erased at compile time, so what is serialized to the browser is
  // exactly the plain function it reads as.
  const raw = await locator.evaluate((node) => {
    const el = node as unknown as {
      tagName: string
      type?: string
      checked?: boolean
      selected?: boolean
      getAttribute(name: string): string | null
      matches(selector: string): boolean
    }
    const tag = el.tagName.toLowerCase()
    return {
      checked: el.getAttribute('aria-checked'),
      pressed: el.getAttribute('aria-pressed'),
      selected: el.getAttribute('aria-selected'),
      expanded: el.getAttribute('aria-expanded'),
      disabled: el.getAttribute('aria-disabled'),
      nativeChecked:
        tag === 'input' && (el.type === 'checkbox' || el.type === 'radio') ? Boolean(el.checked) : null,
      nativeSelected: tag === 'option' ? Boolean(el.selected) : null,
      nativeDisabled: el.matches(':disabled'),
    }
  })
  const who = describeWebLocator(target)
  /** One state: the ARIA attribute, then the element's own state, then nothing. */
  const read = (state: GuardWebState, attr: string | null, native: boolean | null): StateReading => {
    if (attr !== null) {
      const value = ariaBoolean(attr)
      return {
        value,
        actual:
          value === null
            ? `${who} has aria-${state}="${attr}", which is neither true nor false`
            : `${who} is ${value ? '' : 'not '}${state}`,
      }
    }
    if (native !== null) return { value: native, actual: `${who} is ${native ? '' : 'not '}${state}` }
    return {
      value: null,
      // The finding a colour-only control earns: nothing about its position is
      // exposed to anyone — not to this step, and not to a screen reader.
      actual: `${who} exposes no aria-${state} state`,
    }
  }
  return {
    checked: read('checked', raw.checked, raw.nativeChecked),
    pressed: read('pressed', raw.pressed, null),
    selected: read('selected', raw.selected, raw.nativeSelected),
    expanded: read('expanded', raw.expanded, null),
    disabled: read('disabled', raw.disabled, raw.nativeDisabled),
  }
}

/**
 * The subject an `attribute` / `class` member reads: one element, or the DOCUMENT
 * ELEMENT when the expectation names none. Returns the attribute's raw value
 * (`null` when the attribute is absent) or the miss that stopped it.
 */
async function readAttribute(
  page: Page,
  of: GuardWebLocator | undefined,
  name: string,
): Promise<{ value: string | null } | { mismatch: ExpectMismatch }> {
  if (!of) {
    // `document.documentElement` — the one element with no role and no name, and
    // the one a page keeps its theme, its locale and its feature flags on.
    const value = await page
      .evaluate((attr: string) => {
        const doc = (globalThis as unknown as {
          document: { documentElement: { getAttribute(n: string): string | null } }
        }).document
        return doc.documentElement.getAttribute(attr)
      }, name)
      .catch(() => null)
    return { value }
  }
  const resolved = await resolveOne(page, of, `the ${name} of`)
  if ('mismatch' in resolved) return resolved
  return { value: await resolved.locator.getAttribute(name).catch(() => null) }
}

/** A class attribute read as what it is: a list of tokens. */
function classTokens(value: string | null): string[] {
  return (value ?? '').split(/\s+/).filter((token) => token.length > 0)
}

/** What one pass over a web expectation saw: every member, and the first miss. */
interface WebObservation {
  checks: WebCheck[]
  /** The FIRST member that missed, in the fixed order — the step's failure. */
  mismatch: ExpectMismatch | null
}

/**
 * Evaluate a web expectation ONCE, in a fixed order: address, text, presence (each
 * target in turn), ARIA state, attribute, class — the order they were added, so a
 * step that asserted two things before the observation channels existed still fails
 * on the same one. EVERY declared member is evaluated — a member that holds must never
 * end the pass, or a step asserting an address and a page's words would go green on
 * the address alone — and the FIRST miss is the step's failure, which is the cli
 * `evaluateExpect` contract: one deterministic failure per step, whichever driver
 * produced it.
 *
 * The pass also returns what each member SAW, because that is the step's record: a
 * green step has to be able to show what it checked and what answered it.
 */
async function evaluateWebExpect(page: Page, expect: GuardWebExpect): Promise<WebObservation> {
  const checks: WebCheck[] = []
  let mismatch: ExpectMismatch | null = null
  /** Record one member. The FIRST miss becomes the failure; later ones only record. */
  const record = (check: Omit<WebCheck, 'ok'>, miss: ExpectMismatch | null): void => {
    if (miss) mismatch ??= miss
    checks.push({ ...check, ok: miss === null })
  }

  if (expect.url) {
    const address = pageAddress(page)
    record(
      {
        subject: 'url',
        expected: describeTextMatcher('the address', expect.url),
        actual: `the address was ${JSON.stringify(address)}`,
      },
      matchTextMatcher('url', 'the address', expect.url, address),
    )
  }
  if (expect.text) {
    const label = expect.within ? `the ${describeWebLocator(expect.within)} text` : 'the page text'
    const expected = describeTextMatcher(label, expect.text)
    let scoped: { text: string } | { mismatch: ExpectMismatch }
    if (expect.within) {
      const scope = webLocator(page, expect.within)
      const found = await scope.count().catch(() => 0)
      scoped =
        found === 1
          ? { text: await scope.innerText().catch(() => '') }
          : { mismatch: await targetMismatch(page, expect.within, found, 'the text of') }
    } else {
      scoped = { text: await readVisibleText(page) }
    }
    if ('mismatch' in scoped) {
      // The text could not be read at all — the scope is the miss, and its own
      // words are the honest actual for the text member.
      record({ subject: 'text', expected, actual: scoped.mismatch.actual }, scoped.mismatch)
    } else {
      record(
        // The page-text channel carries WEB_TEXT_LIMIT chars, and the check's actual
        // carries the same width — a narrower cut here once hid the deciding content
        // from the very line that reported the miss.
        { subject: 'text', expected, actual: `${label} was ${JSON.stringify(truncate(scoped.text, WEB_TEXT_LIMIT))}` },
        matchTextMatcher('text', label, expect.text, scoped.text, WEB_TEXT_LIMIT),
      )
    }
  }
  // EVERY presence target, one check each — a list is several assertions, not one,
  // so a toolbar that lost a single button says WHICH one.
  for (const target of webVisibleTargets(expect.visible)) {
    const expected = `${describeWebLocator(target)} is visible`
    const locator = webLocator(page, target)
    const found = await locator.count().catch(() => 0)
    const visible = found === 1 && (await locator.isVisible().catch(() => false))
    if (visible) {
      record({ subject: 'visible', expected, actual: expected }, null)
    } else {
      const miss = await targetMismatch(page, target, found === 1 ? 0 : found, 'to see')
      record(
        {
          subject: 'visible',
          expected,
          // `count === 1` but hidden is the one case the target vocabulary cannot
          // name for itself: the element IS on the page, it just is not shown.
          actual: found === 1 ? `${describeWebLocator(target)} is on the page but not visible` : miss.actual,
        },
        miss,
      )
    }
  }
  if (expect.state) {
    const target = expect.state
    const assertions = webStateAssertions(target)
    const resolved = await resolveOne(page, target, 'the state of')
    if ('mismatch' in resolved) {
      // The element itself is missing: every state it was going to be asked about
      // gets the same honest answer, and the target miss is the failure.
      for (const { state, expected } of assertions) {
        record(
          {
            subject: 'state',
            expected: `${describeWebLocator(target)} is ${expected ? '' : 'not '}${state}`,
            actual: resolved.mismatch.actual,
          },
          resolved.mismatch,
        )
      }
    } else {
      const readings = await readElementStates(resolved.locator, target).catch(() => null)
      for (const { state, expected } of assertions) {
        const wanted = `${describeWebLocator(target)} is ${expected ? '' : 'not '}${state}`
        const reading = readings?.[state]
        const ok = reading !== undefined && reading.value === expected
        const actual = reading?.actual ?? `${describeWebLocator(target)} could not be read`
        record(
          { subject: 'state', expected: wanted, actual },
          ok
            ? null
            : {
                subject: 'state',
                expected: wanted,
                actual,
                detail: [
                  `expected ${wanted} at ${pageAddress(page)}`,
                  actual,
                  ...(reading?.value === null
                    ? [
                        'a state nothing exposes cannot be observed by this step, by a screen reader, ' +
                          'or by anything but a sighted reader of the pixels.',
                      ]
                    : []),
                  '--- visible page text ---',
                  await readVisibleText(page),
                ],
              },
        )
      }
    }
  }
  if (expect.attribute) {
    const attribute = expect.attribute
    const expected = describeWebAttribute(attribute)
    const read = await readAttribute(page, attribute.of, attribute.name)
    if ('mismatch' in read) {
      record({ subject: 'attribute', expected, actual: read.mismatch.actual }, read.mismatch)
    } else {
      const subject = describeWebSubject(attribute.of)
      const actual =
        read.value === null
          ? `${subject} has no ${attribute.name} attribute`
          : `${subject}’s ${attribute.name} was ${JSON.stringify(read.value)}`
      let miss: ExpectMismatch | null = null
      if (attribute.present !== undefined && (read.value !== null) !== attribute.present) {
        miss = { subject: 'attribute', expected, actual, detail: [`expected ${expected}`, actual] }
      }
      if (!miss && attribute.value) {
        // A matcher on an ABSENT attribute compares against the empty string, which
        // would let `contains ""` pass on an element that carries nothing. Say what
        // is actually the case instead.
        miss =
          read.value === null
            ? { subject: 'attribute', expected, actual, detail: [`expected ${expected}`, actual] }
            : matchTextMatcher(
                'attribute',
                `${subject}’s ${attribute.name}`,
                attribute.value,
                read.value,
              )
      }
      record({ subject: 'attribute', expected, actual }, miss)
    }
  }
  if (expect.class) {
    const cls = expect.class
    const expected = describeWebClass(cls)
    const read = await readAttribute(page, cls.of, 'class')
    if ('mismatch' in read) {
      record({ subject: 'class', expected, actual: read.mismatch.actual }, read.mismatch)
    } else {
      const subject = describeWebSubject(cls.of)
      const tokens = classTokens(read.value)
      const actual =
        tokens.length === 0
          ? `${subject} has no classes`
          : `${subject}’s classes are ${tokens.map((t) => `“${t}”`).join(', ')}`
      const wrong =
        (cls.has !== undefined && !tokens.includes(cls.has)) ||
        (cls.absent !== undefined && tokens.includes(cls.absent))
      record(
        { subject: 'class', expected, actual },
        wrong
          ? {
              subject: 'class',
              expected,
              actual,
              detail: [
                `expected ${expected} at ${pageAddress(page)}`,
                actual,
                // The trap this member exists to close: `contains "dark"` on the raw
                // class attribute also passes for `darkroom`.
                'a class assertion matches whole TOKENS, the way `classList.contains` does.',
              ],
            }
          : null,
      )
    }
  }
  return { checks, mismatch }
}

/**
 * Wait for a web expectation to HOLD, until the deadline. The loop is the wait:
 * there is no separate "settle" phase to race, and what is reported when the budget
 * runs out is the LAST observation — the page as it actually stayed.
 */
async function awaitWebExpect(
  page: Page,
  expect: GuardWebExpect,
  deadline: number,
  signal?: AbortSignal,
): Promise<WebObservation> {
  for (;;) {
    const observed = await evaluateWebExpect(page, expect)
    if (!observed.mismatch) return observed
    if (signal?.aborted || Date.now() >= deadline) return observed
    await tick()
  }
}

// --- Capture: what the step takes off the page for the steps after it ------

/**
 * Read ONE capture off the page. Every getter answers with a STRING, because that
 * is what `${captured:…}` substitutes and what the captured-value store holds — a
 * count is its decimal form, an ARIA state is `"true"` / `"false"`.
 *
 * The locator waits exactly as an action's does (`awaitTarget`, same budget, same
 * strictness), with ONE exception: `count`. Counting is the question "how many",
 * so several matches are the answer rather than an ambiguity — and there is no
 * predicate to wait for either, since zero is a legitimate count. It reads at a
 * glance, after the step's own expectation has already done the waiting.
 */
async function readOneCapture(
  page: Page,
  name: string,
  spec: GuardWebCapture,
  deadline: number,
  signal?: AbortSignal,
): Promise<{ value: string } | { mismatch: ExpectMismatch }> {
  const get = spec.get ?? 'text'
  const what = `to capture “${name}” from`

  if (get === 'count') {
    const found = await webLocator(page, spec.from).count().catch(() => 0)
    return { value: String(found) }
  }

  const target = await awaitTarget(page, spec.from, what, deadline, signal)
  if ('mismatch' in target) return target
  const { locator } = target
  const subject = describeWebLocator(spec.from)

  /** One capture that could not be read — the step's failure, with the page attached. */
  const miss = async (expected: string, actual: string): Promise<{ mismatch: ExpectMismatch }> => ({
    mismatch: {
      subject: 'capture',
      expected,
      actual,
      detail: [expected, actual, '--- visible page text ---', await readVisibleText(page)],
    },
  })

  let read: string | null
  if (get === 'text') {
    read = await locator.innerText().catch(() => null)
  } else if (get === 'value') {
    // The input's CURRENT value is a DOM PROPERTY: it is not in the element's
    // text, not in its `value` ATTRIBUTE once a user has typed, and reading either
    // of those is the quiet wrong answer this getter exists to stop.
    read = await locator
      .evaluate((node) => {
        const value = (node as unknown as { value?: unknown }).value
        return typeof value === 'string' ? value : null
      })
      .catch(() => null)
    if (read === null) {
      return await miss(
        `capture “${name}” to read the value of ${subject}`,
        `${subject} has no value property — it is not an input, a textarea or a select`,
      )
    }
  } else if ('state' in get) {
    const readings = await readElementStates(locator, spec.from).catch(() => null)
    const reading = readings?.[get.state]
    if (!reading || reading.value === null) {
      return await miss(
        `capture “${name}” to read the ${get.state} state of ${subject}`,
        reading?.actual ?? `${subject} could not be read`,
      )
    }
    read = String(reading.value)
  } else {
    read = await locator.getAttribute(get.attribute).catch(() => null)
    if (read === null) {
      return await miss(
        `capture “${name}” to read the ${get.attribute} attribute of ${subject}`,
        `${subject} has no ${get.attribute} attribute`,
      )
    }
  }

  if (read === null) {
    return await miss(`capture “${name}” to read the text of ${subject}`, `${subject} could not be read`)
  }
  if (spec.number === undefined) return { value: read }

  // The slicer: a page writes its numbers in sentences, and the value a later step
  // compares is the number, not the sentence. A pattern that does not match is the
  // step failing with what it read — never an empty value flowing on.
  let found: RegExpExecArray | null = null
  let reError = ''
  try {
    found = new RegExp(spec.number).exec(read)
  } catch (e) {
    // The loader and birth validation both reject a source `new RegExp` refuses, so
    // nothing that got here can land in this branch — and a mid-run throw would
    // report an authoring defect as a crashed run.
    reError = e instanceof Error ? e.message : String(e)
  }
  if (!found || found[1] === undefined) {
    return await miss(
      `capture “${name}” to match /${spec.number}/ in ${subject}${reError ? ` (invalid regex: ${reError})` : ''}`,
      `it read ${JSON.stringify(truncate(read, WEB_TEXT_LIMIT))}, which carries no match for it`,
    )
  }
  return { value: found[1] }
}

/**
 * Every capture the step declares, in declaration order — or the FIRST that could
 * not be read, which is the step's failure. Run after the action and after the
 * expectation has held, exactly as a cli step's captures are: a failed step never
 * publishes a value, so the ordering is the mechanism, not a detail.
 */
async function readWebCaptures(
  page: Page,
  captures: GuardWebCaptures,
  deadline: number,
  signal?: AbortSignal,
): Promise<{ values: Record<string, string> } | { mismatch: ExpectMismatch }> {
  const values: Record<string, string> = {}
  for (const [name, spec] of Object.entries(captures)) {
    const read = await readOneCapture(page, name, spec, deadline, signal)
    if ('mismatch' in read) return read
    values[name] = read.value
  }
  return { values }
}

/** Take this step's screenshot; a screenshot that cannot be taken is not fatal. */
async function screenshot(page: Page, dir: string, stepIndex: number): Promise<string | undefined> {
  const file = webScreenshotFile(stepIndex)
  try {
    await page.screenshot({ path: path.join(dir, file), fullPage: true })
    return file
  } catch {
    return undefined
  }
}

/**
 * Take one web step and report what the page did. Every outcome — pass, unmet
 * expectation, infrastructure — leaves a screenshot, because the question a reader
 * asks about a browser step is always "what did it look like".
 */
export async function executeWebStep(opts: ExecuteWebStepOptions): Promise<WebStepResult> {
  const { page, step, timeoutMs } = opts
  const started = Date.now()
  const deadline = started + timeoutMs
  let mismatch: ExpectMismatch | null = null
  let infra: string | undefined
  let checks: readonly WebCheck[] = []

  try {
    if (isWebNavigateStep(step)) {
      // `domcontentloaded`, not `networkidle`: idling on the network is a sleep with
      // a nicer name, and what the page must SHOW is the expectation's business.
      await page.goto(`${opts.baseUrl}${step.navigate}`, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      })
    } else if (isWebClickStep(step)) {
      const target = await awaitTarget(page, step.click, 'to click', deadline, opts.signal)
      if ('mismatch' in target) mismatch = target.mismatch
      else await target.locator.click({ timeout: Math.max(1, deadline - Date.now()) })
    } else if (isWebFillStep(step)) {
      const target = await awaitTarget(page, step.fill, 'to fill', deadline, opts.signal)
      if ('mismatch' in target) mismatch = target.mismatch
      else await target.locator.fill(step.value, { timeout: Math.max(1, deadline - Date.now()) })
    } else if (isWebUploadStep(step)) {
      const target = await awaitTarget(page, step.upload, 'to upload to', deadline, opts.signal)
      if ('mismatch' in target) {
        mismatch = target.mismatch
      } else if (!opts.file || !opts.armFileChooser) {
        // The driver materializes the payload and settles an error when it cannot;
        // reaching here without one means the executor was called by hand.
        infra = 'the upload step reached the browser with no materialized file'
      } else {
        // ARM BEFORE THE CLICK. The chooser opens during the click, and a listener
        // attached after it would race the event it exists to catch.
        const armed = opts.armFileChooser()
        await target.locator.click({ timeout: Math.max(1, deadline - Date.now()) })
        const chooser = await armed.next(Math.max(1, deadline - Date.now()))
        if (!chooser) {
          // The control was there, it took the click, and nothing asked for a file.
          // A real finding about the page — and precisely the one a `setInputFiles`
          // on a CSS-addressed hidden input would have turned into a false pass.
          mismatch = {
            subject: 'target',
            expected: describeWebCommand(step),
            actual: `${describeWebLocator(step.upload)} opened no file chooser — it does not take a file`,
            detail: [
              `expected ${describeWebCommand(step)} at ${pageAddress(page)}`,
              `${describeWebLocator(step.upload)} was found and clicked; nothing asked for a file`,
              '--- visible page text ---',
              await readVisibleText(page),
            ],
          }
        } else {
          await chooser.setFiles(
            { name: opts.file.name, mimeType: opts.file.mimeType, buffer: opts.file.buffer },
            { timeout: Math.max(1, deadline - Date.now()) },
          )
        }
      }
    } else if (isWebHistoryStep(step)) {
      // The RETURN VALUE is deliberately ignored. A same-document traversal — every
      // Back in a single-page app — completes without a navigation response, and
      // treating that `null` as a failure would refuse the very case this verb was
      // added for. What the move DID is the expectation's business.
      const options = { waitUntil: 'domcontentloaded' as const, timeout: timeoutMs }
      if (step.history === 'back') await page.goBack(options)
      else await page.goForward(options)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // The action was addressed at an element the page HAD — so this is the page
    // refusing the interaction (covered, disabled, detached mid-click), which is a
    // finding about the page, not about the machine. A navigation that errors is
    // the machine: there was no page to act on.
    if (isWebNavigateStep(step)) {
      infra = `navigating to ${step.navigate} failed: ${firstLine(message)}`
    } else {
      mismatch = {
        subject: 'target',
        expected: describeWebCommand(step),
        actual: `the page refused the interaction: ${firstLine(message)}`,
        detail: [describeWebCommand(step), message, '--- visible page text ---', await readVisibleText(page)],
      }
    }
  }

  if (!mismatch && !infra && step.expect) {
    const observed = await awaitWebExpect(page, step.expect, deadline, opts.signal)
    checks = observed.checks
    mismatch = observed.mismatch
  }

  // The captures resolve LAST: after the action, and after the expectation has
  // held. A step whose assertion missed never publishes a value — the order is the
  // same one the cli driver follows, for the same reason.
  let captured: Record<string, string> | undefined
  if (!mismatch && !infra && step.capture) {
    const read = await readWebCaptures(page, step.capture, deadline, opts.signal)
    if ('mismatch' in read) mismatch = read.mismatch
    else captured = read.values
  }

  const shot = await screenshot(page, opts.evidenceDir, opts.stepIndex)
  return {
    url: pageAddress(page),
    visibleText: await readVisibleText(page),
    ...(shot ? { screenshot: shot } : {}),
    durationMs: Date.now() - started,
    checks,
    ...(captured ? { captured } : {}),
    ...(mismatch ? { mismatch } : {}),
    ...(infra ? { infra } : {}),
  }
}

/** Playwright errors are multi-line essays; a failure line takes the first line. */
function firstLine(message: string): string {
  return message.split('\n')[0].trim()
}

/** What a web step DOES and what it ASSERTS, for the transcript and the step list. */
export function describeWebStep(step: GuardWebStep): { command: string; expectation: string } {
  return { command: describeWebCommand(step), expectation: describeWebExpect(step.expect) }
}
