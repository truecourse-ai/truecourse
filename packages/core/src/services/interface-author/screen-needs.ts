/**
 * SCREEN NEEDS — the data a screen's source conditions on, stated before the
 * seed runs so the seeded world can show it.
 *
 * A screen observed in a world with one link, one tag and one collection cannot
 * show a pinned link, a merge that needs two tags, or a member's view of a shared
 * collection; its session writes "renders only when…" into `unresolved` and the
 * task is lost. The seed runs BEFORE authoring, so it can be told: every branch a
 * screen's source takes on the size of a list (`links.length === 0`,
 * `tags.length >= 2`) is a need, and so is every `unresolved` line an earlier
 * authoring of that screen wrote about a state the seeded world lacked (kept on
 * its ledger row as `stateGaps`). Both are read deterministically; which of them
 * a seed can meet is the seed session's call.
 */

import type { InterfaceAuthoringRecord } from '@truecourse/shared'

/** One screen's need, as the seed briefing states it. */
export interface ScreenNeed {
  screen: string
  need: string
}

/** How many needs one screen contributes, and the whole list. */
const MAX_NEEDS_PER_SCREEN = 6
export const MAX_SCREEN_NEEDS = 60

/** How much of an `unresolved` line a ledger row keeps. */
const MAX_GAP_CHARS = 240
/** How many of a screen's `unresolved` lines a ledger row keeps. */
const MAX_GAPS_PER_SCREEN = 5

/** An `unresolved` line about a state the seeded world lacked. */
const STATE_GAP = /\bseed(?:ed)?\b|\bonly (?:when|if)\b|\bempty state\b|\bno \w+ (?:exists?|yet)\b|\b(?:is|are|still) (?:pending|queued)\b/i

/** A list-size condition: `<name>.length <op> <n>`, `!<name>.length`. */
const SIZE_CONDITION = /(!\s*)?([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\??\.length\b(?:\s*(===|==|!==|!=|>=|>|<=|<)\s*(\d+))?/g

/** The `unresolved` lines worth keeping on a screen's ledger row: the ones about a missing world state. */
export function stateGaps(unresolved: readonly string[]): string[] {
  return unresolved
    .filter((line) => STATE_GAP.test(line))
    .slice(0, MAX_GAPS_PER_SCREEN)
    .map((line) => (line.length > MAX_GAP_CHARS ? `${line.slice(0, MAX_GAP_CHARS)}…` : line))
}

export interface DeriveScreenNeedsInput {
  /** Screen id → the source files it is grounded on, repo-relative. */
  files: ReadonlyMap<string, readonly string[]>
  /** The authoring ledger, when a setup has authored before: its rows' `stateGaps`. */
  ledger?: Readonly<Record<string, InterfaceAuthoringRecord>>
  readSource: (file: string) => string | undefined
  max?: number
}

/**
 * The needs of every screen: its ledger row's `stateGaps` first (a state an
 * earlier session could not reach), then the list-size conditions of its source,
 * each once, with the file and line it was read at.
 */
export function deriveScreenNeeds(input: DeriveScreenNeedsInput): ScreenNeed[] {
  const screens = new Set([...input.files.keys(), ...Object.keys(input.ledger ?? {})])
  const needs: ScreenNeed[] = []
  for (const screen of screens) {
    const own = [
      ...(input.ledger?.[screen]?.stateGaps ?? []).map((gap) => `the last authoring could not reach: ${gap}`),
      ...sourceConditions(input.files.get(screen) ?? [], input.readSource),
    ]
    needs.push(...[...new Set(own)].slice(0, MAX_NEEDS_PER_SCREEN).map((need) => ({ screen, need })))
  }
  return needs.slice(0, input.max ?? MAX_SCREEN_NEEDS)
}

/** Every distinct list-size condition in `files`: `at least 2 \`tags\` (pages/tags.tsx:42)`. */
function sourceConditions(files: readonly string[], readSource: (file: string) => string | undefined): string[] {
  const seen = new Map<string, string>()
  for (const file of files) {
    const lines = readSource(file)?.split('\n') ?? []
    lines.forEach((line, index) => {
      for (const match of line.matchAll(SIZE_CONDITION)) {
        const need = sizeNeed(match[1] !== undefined, match[2].replace(/\?/g, ''), match[3], match[4])
        if (need && !seen.has(need)) seen.set(need, `${need} (${file}:${index + 1})`)
      }
    })
  }
  return [...seen.values()]
}

/** What a size condition asks the world for, or nothing when it asks for nothing a seed decides. */
function sizeNeed(negated: boolean, name: string, op: string | undefined, bound: string | undefined): string | undefined {
  const subject = `\`${name.split('.').slice(-2).join('.')}\``
  if (negated && op === undefined) return `an empty ${subject} (its empty state)`
  if (op === undefined || bound === undefined) return undefined
  const n = Number(bound)
  if ((op === '===' || op === '==' || op === '<=') && n === 0) return `an empty ${subject} (its empty state)`
  if (op === '<' && n === 1) return `an empty ${subject} (its empty state)`
  // `> n` and `>= n` ask for the list to reach a size; `< n` guards the branch
  // below it, so the other branch needs n; `!== 0` asks for any at all.
  const least = op === '>' ? n + 1 : op === '>=' || op === '<' ? n : (op === '!==' || op === '!=') && n === 0 ? 1 : undefined
  if (least === undefined || least < 1) return undefined
  return least === 1 ? `at least one ${subject}` : `at least ${least} ${subject}`
}
