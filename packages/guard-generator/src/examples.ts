/**
 * Example mining (D3) — the doc's own examples run VERBATIM.
 *
 * A spec section often contains a WORKED EXAMPLE: a fenced code block whose
 * surrounding prose promises an outcome ("this config fails validation", "this
 * request returns 201"). The highest-fidelity test seeds EXACTLY those bytes —
 * a paraphrased or reformatted copy tests a different input than the one the
 * doc promised an outcome for (and silently "fixes" a deliberately-broken
 * example).
 *
 * The byte channel is ENGINE-OWNED end to end, which is what makes "verbatim" a
 * contract instead of a hope:
 *  - the blocks are mined DETERMINISTICALLY from the bound sections' text here
 *    (never echoed through a model, so no echo can drift a byte);
 *  - the authoring prompt repeats each block clearly bounded with a copy-exactly
 *    instruction (see `buildAuthorUserPrompt`) — recognition of WHICH block the
 *    scenario runs stays with the model, which is the only stage that reads the
 *    surrounding prose;
 *  - {@link exampleFidelityDefect} byte-compares the authored scenario's
 *    input-side carriers (seeded file content, cli stdin, api request body —
 *    the "where feasible" set) against the mined blocks and rejects a NEAR-MISS
 *    embedding: content that equals a doc example after whitespace erasure but
 *    not byte-for-byte is a reformatted copy, corrected on the same single
 *    re-ask a composition defect gets.
 *
 * The near-miss rule deliberately fires only on demonstrable paraphrase-of-the-
 * example: a scenario that never uses a block (an output illustration, prose
 * decoration) is untouched, and expectation-side values are judged by the
 * claim-faithfulness rules, not here.
 */

import { isApiRequestStep, type GuardApiStep, type GuardCliStep, type GuardSetup } from '@truecourse/shared'

/** One fenced block mined from a section, byte-exact. */
export interface MinedExampleBlock {
  /** The fence's info-string language token, when it carries one (`json`, `sql`). */
  lang?: string
  /** The exact bytes between the fences (no trailing newline). */
  content: string
}

/** A mined block with the section it came from — what the validator names. */
export interface DocExampleBlock extends MinedExampleBlock {
  doc: string
  anchor: string
}

/** Per-section cap on mined blocks — a section is a spec passage, not a gallery. */
export const MAX_EXAMPLE_BLOCKS_PER_SECTION = 4
/** Blocks larger than this are not seedable examples — skipped, never truncated
 *  (a truncated "example" would be the exact byte-drift this module forbids). */
export const MAX_EXAMPLE_BLOCK_BYTES = 4096
/** Whitespace-erased content shorter than this is too small to compare — a tiny
 *  block ("true", one flag) would collide with unrelated scenario content. */
export const MIN_EXAMPLE_COMPARE_CHARS = 16

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/

/**
 * Mine the fenced code blocks out of one section's text, byte-exact. Line
 * splitting is on `\n` and re-joining restores the original bytes (a `\r` in
 * CRLF text stays inside its line), so the mined content is EXACTLY what the
 * doc fences — including inner indentation. An unclosed fence yields nothing.
 */
export function mineExampleBlocks(sectionText: string): MinedExampleBlock[] {
  const blocks: MinedExampleBlock[] = []
  const lines = sectionText.split('\n')
  for (let i = 0; i < lines.length && blocks.length < MAX_EXAMPLE_BLOCKS_PER_SECTION; i++) {
    const open = FENCE_OPEN.exec(lines[i].replace(/\r$/, ''))
    if (!open) continue
    const fence = open[1]
    const marker = fence[0]
    // A backtick fence's info string may not contain a backtick (CommonMark).
    if (marker === '`' && lines[i].slice(lines[i].indexOf(fence) + fence.length).includes('`')) continue
    let close = -1
    for (let j = i + 1; j < lines.length; j++) {
      const trimmed = lines[j].replace(/\r$/, '').trim()
      if (trimmed.length >= fence.length && trimmed === marker.repeat(trimmed.length)) {
        close = j
        break
      }
    }
    if (close === -1) break // unclosed — nothing after this line can be a block
    const content = lines.slice(i + 1, close).join('\n')
    if (content.length > 0 && content.length <= MAX_EXAMPLE_BLOCK_BYTES) {
      blocks.push({ ...(open[2] ? { lang: open[2] } : {}), content })
    }
    i = close
  }
  return blocks
}

/** Byte equality modulo ONE trailing newline (fence extraction and file seeding
 *  legitimately disagree on whether content ends in `\n`). */
function sameBytes(a: string, b: string): boolean {
  const strip = (s: string): string => (s.endsWith('\n') ? s.slice(0, -1) : s)
  return strip(a) === strip(b)
}

/** The near-miss form: all whitespace erased. Catches re-indentation, collapsed
 *  blank lines, and re-wrapped lines — the reformatting class — while never
 *  matching content that actually differs. */
function looseForm(s: string): string {
  return s.replace(/\s+/g, '')
}

/** One input-side byte carrier of an authored scenario. */
interface ExampleCarrier {
  where: string
  value: string
}

/** The input-side carriers — where a doc example RUNS, and where byte comparison
 *  is feasible: seeded file content, cli stdin, api raw request body. */
function exampleCarriers(
  scenario:
    | { driver: 'cli'; steps: readonly GuardCliStep[]; setup?: GuardSetup }
    | { driver: 'api'; steps: readonly GuardApiStep[]; setup?: GuardSetup },
): ExampleCarrier[] {
  const carriers: ExampleCarrier[] = []
  for (const [file, content] of Object.entries(scenario.setup?.files ?? {})) {
    carriers.push({ where: `setup.files["${file}"]`, value: content })
  }
  if (scenario.driver === 'cli') {
    scenario.steps.forEach((step, i) => {
      if ('stdin' in step && typeof step.stdin === 'string') {
        carriers.push({ where: `step ${i + 1} stdin`, value: step.stdin })
      }
    })
  } else {
    scenario.steps.forEach((step, i) => {
      if (isApiRequestStep(step) && typeof step.request.body === 'string') {
        carriers.push({ where: `step ${i + 1} request.body`, value: step.request.body })
      }
    })
  }
  return carriers
}

/**
 * The example-fidelity defect of ONE authored scenario, or null. For each mined
 * example, a carrier that embeds it BYTE-FOR-BYTE satisfies it; a carrier that
 * embeds a whitespace-reformatted copy (loose-equal, not byte-equal) is the
 * defect — a model-facing one-liner that seeds the same corrective re-ask a
 * composition defect gets. An example no carrier resembles constrains nothing.
 */
export function exampleFidelityDefect(
  scenario:
    | { driver: 'cli'; steps: readonly GuardCliStep[]; setup?: GuardSetup }
    | { driver: 'api'; steps: readonly GuardApiStep[]; setup?: GuardSetup },
  examples: readonly DocExampleBlock[],
): string | null {
  if (examples.length === 0) return null
  const carriers = exampleCarriers(scenario)
  if (carriers.length === 0) return null
  for (const example of examples) {
    const loose = looseForm(example.content)
    if (loose.length < MIN_EXAMPLE_COMPARE_CHARS) continue
    // Byte-exact anywhere ⇒ the example is embedded verbatim; a sibling carrier
    // deriving from it (an excerpt, a transformed copy) is then legitimate.
    if (carriers.some((c) => sameBytes(c.value, example.content))) continue
    const nearMiss = carriers.find((c) => looseForm(c.value) === loose)
    if (nearMiss) {
      return (
        `${nearMiss.where} embeds a REFORMATTED copy of the section's own example ` +
        `(the DOC EXAMPLE from ${example.doc}#${example.anchor}) — the bytes differ only in whitespace. ` +
        `The doc's example must run VERBATIM: copy the DOC EXAMPLE block byte-for-byte — ` +
        `no re-indenting, no collapsed lines, no reformatting, no "fixes".`
      )
    }
  }
  return null
}
