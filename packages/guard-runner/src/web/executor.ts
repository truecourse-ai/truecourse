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
  describeWebCommand,
  describeWebExpect,
  describeWebLocator,
  isWebClickStep,
  isWebFillStep,
  isWebNavigateStep,
  type GuardWebExpect,
  type GuardWebLocator,
  type GuardWebStep,
} from '@truecourse/shared'
import { describeTextMatcher, matchTextMatcher, truncate, type ExpectMismatch } from '../expect.js'

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
  subject: 'url' | 'text' | 'visible'
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

/** The locator for one authored target — role plus accessible name, nothing else. */
export function webLocator(page: Page, target: GuardWebLocator): Locator {
  return page.getByRole(target.role, { name: target.name, exact: target.exact ?? false })
}

/**
 * The elements that DO carry the role a missed target named, by their visible text
 * — the single most useful line in a "no such control" failure, because the answer
 * is almost always "it is called something else now".
 */
async function roleInventory(page: Page, target: GuardWebLocator): Promise<string[]> {
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
  const actual =
    found === 0
      ? `no ${target.role} named “${target.name}” is on the page`
      : `${found} elements match ${describeWebLocator(target)} — a target must be unambiguous`
  return {
    subject: 'target',
    expected: `${what} ${describeWebLocator(target)}`,
    actual,
    detail: [
      `expected ${what} ${describeWebLocator(target)} at ${pageAddress(page)}`,
      inventory.length > 0
        ? `the ${target.role} elements on the page are: ${inventory.map((t) => `“${t}”`).join(', ')}`
        : `the page has no ${target.role} elements at all`,
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

/** What one pass over a web expectation saw: every member, and the first miss. */
interface WebObservation {
  checks: WebCheck[]
  /** The FIRST member that missed, in the fixed order — the step's failure. */
  mismatch: ExpectMismatch | null
}

/**
 * Evaluate a web expectation ONCE, in a fixed order (address, then text, then
 * presence). EVERY declared member is evaluated — a member that holds must never
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
        { subject: 'text', expected, actual: `${label} was ${JSON.stringify(truncate(scoped.text))}` },
        matchTextMatcher('text', label, expect.text, scoped.text),
      )
    }
  }
  if (expect.visible) {
    const target = expect.visible
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

  const shot = await screenshot(page, opts.evidenceDir, opts.stepIndex)
  return {
    url: pageAddress(page),
    visibleText: await readVisibleText(page),
    ...(shot ? { screenshot: shot } : {}),
    durationMs: Date.now() - started,
    checks,
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
