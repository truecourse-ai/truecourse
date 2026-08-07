/**
 * Expectation evaluation. Streams arrive already normalized; file content is
 * normalized here with the same set before comparison. Checks run in a fixed
 * order — exit, stdout, stderr, output, files — and the FIRST mismatch is returned
 * (the step's failure), so the compact inline `{ expected, actual }` is deterministic.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { GuardExpect, GuardStreamMatcher, GuardFileMatcher } from '@truecourse/shared'

export interface ExpectMismatch {
  subject: 'exit' | 'stdout' | 'stderr' | 'output' | 'files' | 'stub'
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

function truncate(value: string, max = 400): string {
  return value.length > max ? `${value.slice(0, max)}… (${value.length} chars)` : value
}

function matchStream(
  subject: 'stdout' | 'stderr' | 'output',
  matcher: GuardStreamMatcher,
  value: string,
): ExpectMismatch | null {
  if (matcher.equals !== undefined) {
    if (value === matcher.equals) return null
    return {
      subject,
      expected: `${subject} equals ${JSON.stringify(truncate(matcher.equals))}`,
      actual: `${subject} was ${JSON.stringify(truncate(value))}`,
      detail: [`--- expected ${subject} (equals) ---`, matcher.equals, `--- actual ${subject} ---`, value],
    }
  }
  if (matcher.contains !== undefined) {
    if (value.includes(matcher.contains)) return null
    return {
      subject,
      expected: `${subject} contains ${JSON.stringify(matcher.contains)}`,
      actual: `${subject} was ${JSON.stringify(truncate(value))}`,
      detail: [`expected ${subject} to contain:`, matcher.contains, `--- actual ${subject} ---`, value],
    }
  }
  // matches
  let re: RegExp | null = null
  let reError = ''
  try {
    re = new RegExp(matcher.matches as string)
  } catch (e) {
    reError = e instanceof Error ? e.message : String(e)
  }
  if (re && re.test(value)) return null
  return {
    subject,
    expected: `${subject} matches /${matcher.matches}/${reError ? ` (invalid regex: ${reError})` : ''}`,
    actual: `${subject} was ${JSON.stringify(truncate(value))}`,
    detail: [`expected ${subject} to match /${matcher.matches}/`, `--- actual ${subject} ---`, value],
  }
}

function matchFile(
  rel: string,
  matcher: GuardFileMatcher,
  sandboxCwd: string,
  normalizeText: (text: string) => string,
): ExpectMismatch | null {
  const target = path.resolve(sandboxCwd, rel)
  const exists = fs.existsSync(target) && fs.statSync(target).isFile()

  if (matcher.exists === true || matcher.absent === false) {
    if (!exists) return fileMiss(rel, 'to exist', 'missing')
  }
  if (matcher.absent === true || matcher.exists === false) {
    if (exists) return fileMiss(rel, 'to be absent', 'present')
  }

  if (matcher.equals !== undefined || matcher.contains !== undefined) {
    if (!exists) return fileMiss(rel, 'to exist for a content check', 'missing')
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
