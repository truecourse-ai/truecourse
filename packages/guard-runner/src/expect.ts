/**
 * Expectation evaluation. Streams arrive already normalized; file content is
 * normalized here with the same set before comparison. Checks run in a fixed
 * order — exit, stdout, stderr, output, files — and the FIRST mismatch is returned
 * (the step's failure), so the compact inline `{ expected, actual }` is deterministic.
 */

import fs from 'node:fs'
import path from 'node:path'
import type {
  GuardComparand,
  GuardComparison,
  GuardExpect,
  GuardStreamMatcher,
  GuardFileMatcher,
} from '@truecourse/shared'

export interface ExpectMismatch {
  /**
   * What disagreed. Two subjects no matcher produces: `prompt` — a scripted answer
   * whose question the command never asked (see `pty.ts`) — and `capture` — a
   * capture pattern that found nothing in the output it named. Both are reported
   * by the runner rather than by an expectation, and both are the step's own
   * failure, never a value quietly flowing on.
   */
  subject:
    | 'exit'
    | 'stdout'
    | 'stderr'
    | 'output'
    | 'files'
    | 'stub'
    | 'prompt'
    | 'capture'
    // The WEB driver's three: an element the step addressed that the page never
    // showed (or showed more than once), the page's visible text, and the address.
    | 'target'
    | 'text'
    | 'url'
    // The API driver's, for a `request` step taken in the sandbox: the response's
    // status line, one of its headers, its body as text, its conformance to a
    // declared schema, and the value at one json path.
    | 'status'
    | 'headers'
    | 'body'
    | 'schema'
    | 'json'
  /** Compact description of what was required. */
  expected: string
  /** Compact description of what was observed. */
  actual: string
  /** Fuller lines for the evidence transcript. */
  detail: string[]
}

export interface EvaluateExpectParams {
  expect: GuardExpect
  exitCode: number | null
  /** Already-normalized stdout. */
  stdout: string
  /** Already-normalized stderr. */
  stderr: string
  sandboxCwd: string
  /** Applies the scenario's normalizers (used for file-content comparison). */
  normalizeText: (text: string) => string
}

export function evaluateExpect(params: EvaluateExpectParams): ExpectMismatch | null {
  const { expect } = params

  if (expect.exit !== undefined && params.exitCode !== expect.exit) {
    return {
      subject: 'exit',
      expected: `exit ${expect.exit}`,
      actual: `exit ${params.exitCode ?? '(none)'}`,
      detail: [`expected exit code ${expect.exit}, got ${params.exitCode ?? '(no exit code — killed by signal)'}`],
    }
  }

  if (expect.stdout) {
    const m = matchStream('stdout', expect.stdout, params.stdout)
    if (m) return m
  }
  if (expect.stderr) {
    const m = matchStream('stderr', expect.stderr, params.stderr)
    if (m) return m
  }
  if (expect.output) {
    // The two streams as the user saw them: stdout first, then stderr. A tty step
    // has only the one channel, so this is simply everything the child wrote.
    const m = matchStream('output', expect.output, params.stdout + params.stderr)
    if (m) return m
  }

  if (expect.files) {
    for (const [rel, matcher] of Object.entries(expect.files)) {
      const m = matchFile(rel, matcher, params.sandboxCwd, params.normalizeText)
      if (m) return m
    }
  }

  return null
}

export function truncate(value: string, max = 400): string {
  return value.length > max ? `${value.slice(0, max)}… (${value.length} chars)` : value
}

/**
 * ONE text matcher as a whole assertion, in the words a mismatch uses — `the page
 * text contains "x" and matches /y/`.
 *
 * Where {@link matchTextMatcher} names the ONE member that missed, this names EVERY
 * member the matcher declares, because it is what a RECORD says the step asserted.
 * A record naming half an assertion is the same lie as a check skipping half of it.
 */
export function describeTextMatcher(label: string, matcher: GuardStreamMatcher): string {
  const parts: string[] = []
  if (matcher.equals !== undefined) parts.push(`equals ${JSON.stringify(truncate(matcher.equals))}`)
  if (matcher.contains !== undefined) parts.push(`contains ${JSON.stringify(matcher.contains)}`)
  if (matcher.matches !== undefined) parts.push(`matches /${matcher.matches}/`)
  if (matcher.compare) parts.push(describeComparison(matcher.compare))
  return `${label} ${parts.join(' and ')}`
}

/** The comparison half of a matcher, in the same words its mismatch uses. */
function describeComparison(compare: GuardComparison): string {
  const parts: string[] = []
  if (compare.number !== undefined) parts.push(`carries a number matching /${compare.number}/`)
  for (const { key, phrase } of COMPARATORS) {
    const operand = compare[key]
    if (operand !== undefined) parts.push(`is ${phrase} ${String(operand)}`)
  }
  return parts.join(' and ')
}

/**
 * A stream matcher against a stream — the cli subjects, whose LABEL is the subject
 * word itself ("stdout contains …").
 */
function matchStream(
  subject: 'stdout' | 'stderr' | 'output',
  matcher: GuardStreamMatcher,
  value: string,
): ExpectMismatch | null {
  return matchTextMatcher(subject, subject, matcher, value)
}

/**
 * THE text-matcher semantics, once: the four matchers (`equals`, `contains`,
 * `matches`, `compare`) against one piece of text, in a fixed order, with the first
 * miss reported.
 *
 * `subject` is what the mismatch is filed under; `label` is how it reads in the
 * message. They differ for the web driver, whose subjects are a page and an address
 * rather than a stream ("the page text contains …") — the same matcher vocabulary,
 * so it must not be a second implementation of it.
 *
 * `limit` is the CHANNEL's width — how much of the value the compact `actual` line
 * carries. It defaults to the compact 400, and a driver whose channel is wider
 * passes its own cap (the web driver's page text carries 2000): a mismatch that
 * re-truncated the value below what the assertion saw would cut the deciding
 * content out of its own evidence.
 */
export function matchTextMatcher(
  subject: ExpectMismatch['subject'],
  label: string,
  matcher: GuardStreamMatcher,
  value: string,
  limit = 400,
): ExpectMismatch | null {
  // EVERY matcher the subject declares is evaluated, in this fixed order, and the
  // first that misses is the failure. A matcher that holds must never end the
  // check: `{ contains: "cost", compare: { atMost: … } }` is one assertion in two
  // halves, and skipping the second because the first passed would report a green
  // step that never compared anything.
  if (matcher.equals !== undefined && value !== matcher.equals) {
    const caseOnly = value.toLowerCase() === matcher.equals.toLowerCase()
    return {
      subject,
      expected: `${label} equals ${JSON.stringify(truncate(matcher.equals))}`,
      actual: `${label} was ${JSON.stringify(truncate(value, limit))}${caseNote(caseOnly)}`,
      detail: [
        `--- expected ${label} (equals) ---`,
        matcher.equals,
        `--- actual ${label} ---`,
        value,
        ...caseDetail(subject, caseOnly),
      ],
    }
  }
  if (matcher.contains !== undefined && !value.includes(matcher.contains)) {
    const caseOnly = value.toLowerCase().includes(matcher.contains.toLowerCase())
    return {
      subject,
      expected: `${label} contains ${JSON.stringify(matcher.contains)}`,
      actual: `${label} was ${JSON.stringify(truncate(value, limit))}${caseNote(caseOnly)}`,
      detail: [
        `expected ${label} to contain:`,
        matcher.contains,
        `--- actual ${label} ---`,
        value,
        ...caseDetail(subject, caseOnly),
      ],
    }
  }
  if (matcher.matches !== undefined) {
    let re: RegExp | null = null
    let reError = ''
    try {
      re = new RegExp(matcher.matches)
    } catch (e) {
      reError = e instanceof Error ? e.message : String(e)
    }
    if (!re || !re.test(value)) {
      const caseOnly = re !== null && new RegExp(matcher.matches, 'i').test(value)
      return {
        subject,
        expected: `${label} matches /${matcher.matches}/${reError ? ` (invalid regex: ${reError})` : ''}`,
        actual: `${label} was ${JSON.stringify(truncate(value, limit))}${caseNote(caseOnly)}`,
        detail: [
          `expected ${label} to match /${matcher.matches}/`,
          `--- actual ${label} ---`,
          value,
          ...caseDetail(subject, caseOnly),
        ],
      }
    }
  }
  if (matcher.compare) {
    const m = matchComparison(label, matcher.compare, value, limit)
    if (m) return { ...m, subject }
  }
  return null
}

/**
 * The one diagnosis a text miss makes about itself before a reader starts diffing by
 * eye: the value HAS the expected words, in a different case. In a truncated actual
 * that miss reads exactly like missing content — a misread that once turned a
 * deterministic red into a phantom driver bug — so the mismatch says which of the
 * two the reader has.
 */
function caseNote(caseOnly: boolean): string {
  return caseOnly ? ' — differs only in letter case' : ''
}

/** The case-only line of the transcript, with the web-text WHY: CSS renders the case. */
function caseDetail(subject: ExpectMismatch['subject'], caseOnly: boolean): string[] {
  if (!caseOnly) return []
  return subject === 'text'
    ? [
        'the miss is letter case alone: the page text is what CSS RENDERS, so a text-transform (an uppercased heading) changes the case the driver reads — assert the case the page shows',
      ]
    : ['the miss is letter case alone']
}

// --- Numeric comparison (the captured-value matcher) -----------------

/** The three operators, in the order they are checked, with the words they read as. */
const COMPARATORS = [
  { key: 'equals', phrase: 'equals', holds: (a: number, b: number): boolean => a === b },
  { key: 'atMost', phrase: 'at most', holds: (a: number, b: number): boolean => a <= b },
  { key: 'atLeast', phrase: 'at least', holds: (a: number, b: number): boolean => a >= b },
] as const

/** A finite number read out of a written comparand, or null when it is not one. */
function toNumber(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/**
 * Evaluate a numeric comparison against a subject's text — the matcher that makes
 * a CAPTURED value assertable ("the real bill lands at or below the estimate").
 * Both sides are already token-resolved, so a `${captured:…}` operand arrives here
 * as the number the earlier step captured, and every message quotes the RESOLVED
 * values rather than the tokens.
 *
 * Every failure names BOTH raw values, including the two that are not comparisons
 * at all: a subject carrying no number, and an operand that is not one. Neither is
 * ever silently `NaN` — an unmet comparison and an unreadable one look different,
 * and a reader must be able to tell which they have.
 */
export function matchComparison(
  label: string,
  compare: GuardComparison,
  text: string,
  limit = 400,
): Omit<ExpectMismatch, 'subject'> | null {
  let raw = text
  if (compare.number !== undefined) {
    let found: RegExpExecArray | null = null
    let reError = ''
    try {
      found = new RegExp(compare.number).exec(text)
    } catch (e) {
      reError = e instanceof Error ? e.message : String(e)
    }
    if (!found || found[1] === undefined) {
      return {
        expected: `${label} to carry a number matching /${compare.number}/${reError ? ` (invalid regex: ${reError})` : ''}`,
        actual: `${label} was ${JSON.stringify(truncate(text, limit))}`,
        detail: [
          `expected to read a number out of ${label} with /${compare.number}/, but it did not match`,
          `--- actual ${label} ---`,
          text,
        ],
      }
    }
    raw = found[1]
  }

  const where = compare.number !== undefined ? `the number in ${label}` : label
  const actual = toNumber(raw)
  if (actual === null) {
    return {
      expected: `${where} to be a number`,
      actual: `${where} was ${JSON.stringify(truncate(raw))}, which is not a number`,
      detail: [`expected a number to compare, read ${JSON.stringify(raw)}`, `--- actual ${label} ---`, text],
    }
  }

  for (const { key, phrase, holds } of COMPARATORS) {
    const operand: GuardComparand | undefined = compare[key]
    if (operand === undefined) continue
    const rawOperand = String(operand)
    const expected = toNumber(rawOperand)
    if (expected === null) {
      return {
        expected: `${where} ${phrase} ${rawOperand}`,
        actual: `the comparison value ${JSON.stringify(rawOperand)} is not a number (${where} was ${raw})`,
        detail: [
          `expected ${where} ${phrase} ${JSON.stringify(rawOperand)}, which is not a number`,
          `--- actual ${label} ---`,
          text,
        ],
      }
    }
    if (holds(actual, expected)) continue
    return {
      expected: `${where} ${phrase} ${rawOperand}`,
      actual: `${where} was ${raw}`,
      detail: [
        `expected ${where} ${phrase} ${expected}, got ${actual}`,
        `--- actual ${label} ---`,
        text,
      ],
    }
  }
  return null
}

/**
 * Presence or content of one path. EXISTENCE is about the path, whatever is at it:
 * a store is created as a directory, and `exists: true` on one is the plainest way
 * to say so — reporting it "missing" (what a file-only stat did) reads like a
 * product failure and pushes authors onto a proxy file. CONTENT is file-only,
 * because a directory has none: `contains`/`equals` on one is an authoring mistake
 * and says so, rather than throwing EISDIR out of `readFileSync`.
 */
function matchFile(
  rel: string,
  matcher: GuardFileMatcher,
  sandboxCwd: string,
  normalizeText: (text: string) => string,
): ExpectMismatch | null {
  const target = path.resolve(sandboxCwd, rel)
  const stat = fs.existsSync(target) ? fs.statSync(target) : null
  const exists = stat !== null

  if (matcher.exists === true || matcher.absent === false) {
    if (!exists) return fileMiss(rel, 'to exist', 'missing')
  }
  if (matcher.absent === true || matcher.exists === false) {
    if (exists) return fileMiss(rel, 'to be absent', stat.isDirectory() ? 'present (a directory)' : 'present')
  }

  if (matcher.equals !== undefined || matcher.contains !== undefined) {
    if (!exists) return fileMiss(rel, 'to exist for a content check', 'missing')
    if (stat.isDirectory()) {
      return {
        subject: 'files',
        expected: `${rel} to be a file with content`,
        actual: `${rel} is a directory`,
        detail: [
          `expected the content of ${rel}, but it is a DIRECTORY, which has none.`,
          'Assert a file inside it, or use `exists` to assert the directory itself.',
        ],
      }
    }
    const content = normalizeText(fs.readFileSync(target, 'utf-8'))
    if (matcher.equals !== undefined && content !== matcher.equals) {
      return {
        subject: 'files',
        expected: `${rel} equals ${JSON.stringify(truncate(matcher.equals))}`,
        actual: `${rel} was ${JSON.stringify(truncate(content))}`,
        detail: [`--- expected ${rel} (equals) ---`, matcher.equals, `--- actual ${rel} ---`, content],
      }
    }
    if (matcher.contains !== undefined && !content.includes(matcher.contains)) {
      return {
        subject: 'files',
        expected: `${rel} contains ${JSON.stringify(matcher.contains)}`,
        actual: `${rel} was ${JSON.stringify(truncate(content))}`,
        detail: [`expected ${rel} to contain:`, matcher.contains, `--- actual ${rel} ---`, content],
      }
    }
  }

  return null
}

function fileMiss(rel: string, expectedPhrase: string, actualState: string): ExpectMismatch {
  return {
    subject: 'files',
    expected: `${rel} ${expectedPhrase}`,
    actual: `${rel} ${actualState}`,
    detail: [`expected file ${rel} ${expectedPhrase}, but it was ${actualState}`],
  }
}
