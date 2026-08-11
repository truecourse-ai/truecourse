/**
 * Api expectation evaluation. Body text arrives already normalized; JSON-path
 * matchers parse the RAW body (normalizers are text transforms — applying them
 * before JSON.parse could corrupt the syntax) and normalize only the compared
 * string forms. Checks run in a fixed order — status, headers, body, schema, json —
 * and the FIRST mismatch is the step's failure, so the compact inline
 * `{ expected, actual }` is deterministic (mirrors the cli driver's `evaluateExpect`).
 *
 * EVERY declared member is evaluated even after one misses, because the pass also
 * reports what each member SAW ({@link observeApiExpect}): a green step has to be
 * able to show what it checked and what answered it, and one answer standing in for
 * several assertions is the mispairing the web driver already fixed on its side.
 */

import type { GuardApiExpect, GuardJsonMatcher, GuardStreamMatcher } from '@truecourse/shared'
import { describeComparison, describeJsonMatcher } from '@truecourse/shared'
import { validateAgainstSchema } from '@truecourse/shared/openapi'
import { matchComparison, type ExpectMismatch } from '../expect.js'
import { lookupJsonPath, JSON_PATH_MISS, captureValueToString } from './vars.js'

export interface EvaluateApiExpectParams {
  expect: GuardApiExpect
  status: number | null
  /** Response headers, lower-cased names. */
  headers: Record<string, string>
  /** Already-normalized response body text. */
  bodyText: string
  /** RAW response body text (JSON matchers parse this). */
  rawBodyText: string
  /** Applies the scenario's normalizers (for json-value string comparison). */
  normalizeText: (text: string) => string
  /**
   * B5: the JSON response schema the bound OpenAPI operation declares for this
   * step's status — consulted only when `expect.schema === true`. The runner
   * resolves it (and errors before ever calling here when `schema` is requested but
   * the operation declares none), so an undefined value here means the assertion
   * placed no schema constraint.
   */
  responseSchema?: unknown
}

/** An api mismatch reuses the cli mismatch shape; `subject` gains api values. */
export type ApiExpectMismatch = Omit<ExpectMismatch, 'subject'> & {
  subject: 'status' | 'headers' | 'body' | 'schema' | 'json' | 'stub' | 'external' | 'process'
}

/**
 * ONE member of an api expectation with the RESPONSE'S OWN ANSWER to that member —
 * the api half of the honest pairing a web step records. A request can assert a
 * status, a header, the body and several json paths at once, and reporting one
 * answer (the status) beside all of them reads as a failure on a step that passed.
 */
export interface ApiCheck {
  subject: 'status' | 'headers' | 'body' | 'schema' | 'json'
  /** The assertion in full, in the words a mismatch uses. */
  expected: string
  /** What the response had FOR THIS MEMBER — never another member's value. */
  actual: string
  ok: boolean
}

/**
 * A mismatch an EXPECTATION MEMBER produces — the api subjects minus the three the
 * scenario as a whole reports (`stub`, `external`, `process`). Narrower than
 * {@link ApiExpectMismatch} on purpose: these are the only subjects a request step's
 * own failure can carry, which is what lets it travel as a sandbox step outcome.
 */
export type ApiMemberMismatch = Omit<ExpectMismatch, 'subject'> & { subject: ApiCheck['subject'] }

/** What one pass over an api expectation saw: every member, and the first miss. */
export interface ApiObservation {
  checks: ApiCheck[]
  /** The FIRST member that missed, in the fixed order — the step's failure. */
  mismatch: ApiMemberMismatch | null
}

/**
 * Evaluate an api expectation and report EVERY member with what answered it, plus
 * the first miss in the fixed order (status → headers → body → schema → json). The
 * order is the contract {@link evaluateApiExpect} has always had; what is new is that
 * a member which HOLDS no longer ends the pass, because a green step has to be able
 * to show what it checked and what answered it.
 */
export function observeApiExpect(params: EvaluateApiExpectParams): ApiObservation {
  const { expect } = params
  const checks: ApiCheck[] = []
  let mismatch: ApiMemberMismatch | null = null
  /** Record one member. The FIRST miss becomes the failure; later ones only record. */
  const record = (check: Omit<ApiCheck, 'ok'>, miss: ApiMemberMismatch | null): void => {
    if (miss) mismatch ??= miss
    checks.push({ ...check, ok: miss === null })
  }

  if (expect.status !== undefined) {
    const actual = `status ${params.status ?? '(none)'}`
    record(
      { subject: 'status', expected: `status ${expect.status}`, actual },
      params.status === expect.status
        ? null
        : {
            subject: 'status',
            expected: `status ${expect.status}`,
            actual,
            detail: [
              `expected HTTP status ${expect.status}, got ${params.status ?? '(no response)'}`,
              `--- response body ---`,
              params.bodyText,
            ],
          },
    )
  }

  if (expect.headers) {
    for (const [name, matcher] of Object.entries(expect.headers)) {
      const label = `header ${name}`
      const value = params.headers[name.toLowerCase()]
      if (value === undefined) {
        record(
          { subject: 'headers', expected: `${label} to be present`, actual: `${label} missing` },
          {
            subject: 'headers',
            expected: `${label} to be present`,
            actual: `${label} missing`,
            detail: [`expected response header ${name}, present headers: ${Object.keys(params.headers).join(', ') || '(none)'}`],
          },
        )
        continue
      }
      const m = matchText(label, matcher, value)
      record(
        {
          subject: 'headers',
          expected: describeTextExpectation(label, matcher),
          actual: `${label} was ${JSON.stringify(truncate(value))}`,
        },
        m ? { ...m, subject: 'headers' } : null,
      )
    }
  }

  if (expect.body) {
    const m = matchText('body', expect.body, params.bodyText)
    record(
      {
        subject: 'body',
        expected: describeTextExpectation('body', expect.body),
        actual: `body was ${JSON.stringify(truncate(params.bodyText))}`,
      },
      m ? { ...m, subject: 'body' } : null,
    )
  }

  // Response-schema conformance (B5): the whole body must satisfy the bound
  // operation's declared JSON response schema. Ordered after status/headers/body so a
  // wrong status or header wins first, but BEFORE per-field json checks so a dropped
  // required field surfaces as one schema verdict rather than N path misses.
  if (expect.schema === true && params.responseSchema !== undefined) {
    const expected = 'the response body conforms to the declared response schema'
    const parsed = parseJsonBody(params.rawBodyText)
    if ('error' in parsed) {
      record(
        { subject: 'schema', expected, actual: `unparseable body: ${parsed.error}` },
        {
          subject: 'schema',
          expected: 'a JSON response body',
          actual: `unparseable body: ${parsed.error}`,
          detail: ['expected the response body to parse as JSON for schema conformance', '--- actual body ---', params.rawBodyText],
        },
      )
    } else {
      const violation = validateAgainstSchema(parsed.value, params.responseSchema)
      record(
        {
          subject: 'schema',
          expected,
          actual: violation ? `${violation.path}: ${violation.actual}` : 'the body conforms',
        },
        violation
          ? {
              subject: 'schema',
              expected: `${violation.path}: ${violation.expected}`,
              actual: `${violation.path}: ${violation.actual}`,
              detail: [
                'response body does not conform to the declared response schema',
                `path:     ${violation.path}`,
                `expected: ${violation.expected}`,
                `actual:   ${violation.actual}`,
              ],
            }
          : null,
      )
    }
  }

  if (expect.json) {
    const parsed = parseJsonBody(params.rawBodyText)
    if ('error' in parsed) {
      // The body could not be read as JSON at all — one honest answer for every path
      // member, rather than N invented "missing" lines.
      const miss: ApiMemberMismatch = {
        subject: 'json',
        expected: 'a JSON response body',
        actual: `unparseable body: ${parsed.error}`,
        detail: ['expected the response body to parse as JSON', '--- actual body ---', params.rawBodyText],
      }
      for (const [path, matcher] of Object.entries(expect.json)) {
        record(
          {
            subject: 'json',
            expected: `${jsonLabel(path)} ${describeJsonMatcher(matcher)}`,
            actual: miss.actual,
          },
          miss,
        )
      }
    } else {
      for (const [path, matcher] of Object.entries(expect.json)) {
        const label = jsonLabel(path)
        const value = lookupJsonPath(parsed.value, path)
        const m = matchJsonPath(path, matcher, parsed.value, params.normalizeText)
        record(
          {
            subject: 'json',
            expected: `${label} ${describeJsonMatcher(matcher)}`,
            actual:
              value === JSON_PATH_MISS
                ? `${label} is missing`
                : `${label} was ${truncate(JSON.stringify(value) ?? String(value))}`,
          },
          m,
        )
      }
    }
  }

  return { checks, mismatch }
}

/**
 * The first unmet member of an api expectation, or null. The api driver's own
 * verdict path — {@link observeApiExpect} with only its failure half read.
 */
export function evaluateApiExpect(params: EvaluateApiExpectParams): ApiExpectMismatch | null {
  return observeApiExpect(params).mismatch
}

/** `json total is 2` / `json root …` — how a path member names itself. */
function jsonLabel(path: string): string {
  return path === '' ? 'json root' : `json ${path}`
}

/** The assertion a TEXT matcher states, in the words its mismatch would use. */
function describeTextExpectation(label: string, matcher: GuardStreamMatcher): string {
  const parts: string[] = []
  if (matcher.equals !== undefined) parts.push(`${label} equals ${JSON.stringify(truncate(matcher.equals))}`)
  if (matcher.contains !== undefined) parts.push(`${label} contains ${JSON.stringify(matcher.contains)}`)
  if (matcher.matches !== undefined) parts.push(`${label} matches /${matcher.matches}/`)
  if (matcher.compare) parts.push(`${label} ${describeComparison(matcher.compare)}`)
  return parts.join(' · ')
}

/** Parse a response body as JSON, tolerating nothing — the matcher asked for JSON. */
export function parseJsonBody(rawBodyText: string): { value: unknown } | { error: string } {
  try {
    return { value: JSON.parse(rawBodyText) as unknown }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

function truncate(value: string, max = 400): string {
  return value.length > max ? `${value.slice(0, max)}… (${value.length} chars)` : value
}

/** `equals | contains | matches | compare` against a text value (the stream vocabulary). */
function matchText(
  label: string,
  matcher: GuardStreamMatcher,
  value: string,
): Omit<ApiExpectMismatch, 'subject'> | null {
  // Every declared matcher is evaluated, in this fixed order — see the cli
  // driver's `matchStream`: a half that holds must not skip the half after it.
  if (matcher.equals !== undefined && value !== matcher.equals) {
    return {
      expected: `${label} equals ${JSON.stringify(truncate(matcher.equals))}`,
      actual: `${label} was ${JSON.stringify(truncate(value))}`,
      detail: [`--- expected ${label} (equals) ---`, matcher.equals, `--- actual ${label} ---`, value],
    }
  }
  if (matcher.contains !== undefined && !value.includes(matcher.contains)) {
    return {
      expected: `${label} contains ${JSON.stringify(matcher.contains)}`,
      actual: `${label} was ${JSON.stringify(truncate(value))}`,
      detail: [`expected ${label} to contain:`, matcher.contains, `--- actual ${label} ---`, value],
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
      return {
        expected: `${label} matches /${matcher.matches}/${reError ? ` (invalid regex: ${reError})` : ''}`,
        actual: `${label} was ${JSON.stringify(truncate(value))}`,
        detail: [`expected ${label} to match /${matcher.matches}/`, `--- actual ${label} ---`, value],
      }
    }
  }
  // The numeric comparison — the api half of the captured-value vocabulary.
  return matcher.compare ? matchComparison(label, matcher.compare, value) : null
}

function matchJsonPath(
  path: string,
  matcher: GuardJsonMatcher,
  root: unknown,
  normalizeText: (text: string) => string,
): ApiMemberMismatch | null {
  const label = path === '' ? 'json root' : `json ${path}`
  const value = lookupJsonPath(root, path)
  const present = value !== JSON_PATH_MISS

  if (matcher.exists === true || matcher.absent === false) {
    if (!present) return jsonMiss(label, 'to exist', 'missing')
  }
  if (matcher.absent === true || matcher.exists === false) {
    if (present) {
      return jsonMiss(label, 'to be absent', `present (${truncate(captureValueToString(value))})`)
    }
  }

  if (
    matcher.equals !== undefined ||
    matcher.contains !== undefined ||
    matcher.matches !== undefined ||
    matcher.compare !== undefined
  ) {
    if (!present) return jsonMiss(label, 'to exist for a value check', 'missing')

    // `equals` on a json path is a JSON-VALUE comparison, not a text one, so it is
    // checked here rather than through `matchText` — but like every other matcher
    // it only ends the check when it MISSES; the text and numeric halves after it
    // are evaluated too.
    if (matcher.equals !== undefined && !jsonEquals(value, matcher.equals)) {
      return {
        subject: 'json',
        expected: `${label} equals ${JSON.stringify(matcher.equals)}`,
        actual: `${label} was ${JSON.stringify(truncate(JSON.stringify(value)))}`,
        detail: [
          `--- expected ${label} (equals) ---`,
          JSON.stringify(matcher.equals, null, 2),
          `--- actual ${label} ---`,
          JSON.stringify(value, null, 2),
        ],
      }
    }

    const text = normalizeText(captureValueToString(value))
    if (matcher.contains !== undefined || matcher.matches !== undefined) {
      const m = matchText(label, { contains: matcher.contains, matches: matcher.matches }, text)
      if (m) return { ...m, subject: 'json' }
    }
    // The value at a path is usually already a number, so the comparison reads it
    // whole — `compare.number` is only there for the value that states one inside
    // a sentence.
    if (matcher.compare) {
      const m = matchComparison(label, matcher.compare, text)
      if (m) return { ...m, subject: 'json' }
    }
  }

  return null
}

/** Structural JSON equality (key order irrelevant, arrays ordered). */
export function jsonEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => jsonEquals(v, b[i]))
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as Record<string, unknown>)
    const kb = Object.keys(b as Record<string, unknown>)
    return (
      ka.length === kb.length &&
      ka.every((k) => jsonEquals((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
    )
  }
  return false
}

function jsonMiss(label: string, expectedPhrase: string, actualState: string): ApiMemberMismatch {
  return {
    subject: 'json',
    expected: `${label} ${expectedPhrase}`,
    actual: `${label} ${actualState}`,
    detail: [`expected ${label} ${expectedPhrase}, but it was ${actualState}`],
  }
}
