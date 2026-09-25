/**
 * The `${repeat:<count>:<text>}` token: a long value written short. A claim about a
 * size limit ("a body longer than 16,000 characters is rejected") can only be proved
 * by sending a value past it, and a scenario has no other way to hold one than to
 * spell every character out, which an author cannot do reliably at that length.
 *
 * Unlike `${unique}` it depends on nothing about the run, so it is expanded ONCE,
 * over every string of the scenario, before the scenario reaches its driver: every
 * surface gets it, and the other tokens' passes see the expanded text. `<count>` is
 * a positive integer up to {@link MAX_REPEAT_COUNT}; `<text>` is any text without a
 * `}`. A `${repeat:` that does not fit is a load error (see {@link repeatDefects}),
 * never text sent as written.
 */

import type { GuardScenario } from '@truecourse/shared'

/** The longest a single token may expand to, in repetitions: enough for any size limit a document states. */
export const MAX_REPEAT_COUNT = 1_000_000

const REPEAT_TOKEN = /\$\{repeat:([1-9][0-9]*):([^}]+)\}/g
const REPEAT_OPENING = '${repeat:'

/** Expand every well-formed `${repeat:…}` in one string. */
export function expandRepeat(text: string): string {
  if (!text.includes(REPEAT_OPENING)) return text
  return text.replace(REPEAT_TOKEN, (token, count: string, unit: string) =>
    Number(count) > MAX_REPEAT_COUNT ? token : unit.repeat(Number(count)),
  )
}

/** The scenario with every string value expanded. Keys are left as written. */
export function expandScenarioRepeats<S extends GuardScenario>(scenario: S): S {
  return mapStrings(scenario, expandRepeat) as S
}

/**
 * What is wrong with the `${repeat:…}` tokens in a scenario, or in a draft of one,
 * one sentence each: a token that does not fit the grammar, or asks for more than
 * {@link MAX_REPEAT_COUNT}.
 */
export function repeatDefects(scenario: unknown): string[] {
  const defects: string[] = []
  for (const text of stringsIn(scenario)) {
    if (!text.includes(REPEAT_OPENING)) continue
    for (const [token, count] of text.matchAll(REPEAT_TOKEN)) {
      if (Number(count) > MAX_REPEAT_COUNT) {
        defects.push(`${token.slice(0, 40)}… repeats ${count} times; the most is ${MAX_REPEAT_COUNT}.`)
      }
    }
    const leftover = text.replace(REPEAT_TOKEN, '')
    const at = leftover.indexOf(REPEAT_OPENING)
    if (at >= 0) {
      defects.push(
        `"${leftover.slice(at, at + 40)}" is not a repeat token: write \${repeat:<count>:<text>}, a positive count and text without "}".`,
      )
    }
  }
  return defects
}

function mapStrings(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === 'string') return fn(value)
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, fn)]))
  }
  return value
}

function* stringsIn(value: unknown): Generator<string> {
  if (typeof value === 'string') yield value
  else if (Array.isArray(value)) for (const item of value) yield* stringsIn(item)
  else if (value !== null && typeof value === 'object') for (const item of Object.values(value)) yield* stringsIn(item)
}
