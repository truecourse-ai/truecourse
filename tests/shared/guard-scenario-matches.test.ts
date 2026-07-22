/**
 * The `expect` `matches` compile check shared by the authoring validate path and
 * the committed-scenario loader: `firstInvalidMatchPattern` locates the first
 * uncompilable stdout/stderr regex (same `new RegExp` call the runner makes) with
 * the step, stream, pattern, and compile-error text — and a valid `matches` pattern
 * still parses through the schema unchanged (back-compat).
 */

import { describe, it, expect } from 'vitest'
import {
  GuardStepSchema,
  GuardScenarioSchema,
  firstInvalidMatchPattern,
  type GuardStep,
} from '@truecourse/shared'

/** A Python-style named group — a realistic model mistake, invalid in the JS engine. */
const BAD_PATTERN = '(?P<num>\\d+)'

function step(partial: unknown): GuardStep {
  return GuardStepSchema.parse(partial)
}

describe('firstInvalidMatchPattern', () => {
  it('returns null when every matches pattern compiles (or none is present)', () => {
    expect(
      firstInvalidMatchPattern([
        step({ run: ['lint'], expect: { exit: 1, stdout: { matches: "unparsable:.*'2'.*'3'" } } }),
        step({ run: ['fmt'], expect: { exit: 0, stderr: { contains: 'ok' } } }),
        step({ run: [], expect: { exit: 0 } }),
      ]),
    ).toBeNull()
  })

  it('locates an uncompilable stdout pattern with its step, stream, pattern, and error', () => {
    const bad = firstInvalidMatchPattern([
      step({ run: ['--version'], expect: { exit: 0 } }),
      step({ run: ['lint'], expect: { exit: 1, stdout: { matches: BAD_PATTERN } } }),
    ])
    expect(bad).not.toBeNull()
    expect(bad!.step).toBe(2) // 1-based
    expect(bad!.stream).toBe('stdout')
    expect(bad!.pattern).toBe(BAD_PATTERN)
    // The error text is exactly what `new RegExp` throws, so the re-ask/loader can quote it.
    let expected = ''
    try {
      new RegExp(BAD_PATTERN)
    } catch (e) {
      expected = (e as Error).message
    }
    expect(expected).not.toBe('')
    expect(bad!.error).toBe(expected)
  })

  it('flags a stderr pattern too', () => {
    const bad = firstInvalidMatchPattern([
      step({ run: ['boom'], expect: { exit: 7, stderr: { matches: '([' } } }),
    ])
    expect(bad!.stream).toBe('stderr')
    expect(bad!.pattern).toBe('([')
  })

  it('leaves a valid matches pattern parsing through the scenario schema unchanged', () => {
    const parsed = GuardScenarioSchema.safeParse({
      guard: 1,
      id: 'ok',
      title: 'prints an unparsable node listing 2 and 3',
      binds: { doc: 'docs/cli.md', section: 'cli/parse', fingerprint: 'sha256:abc' },
      driver: 'cli',
      steps: [{ run: ['parse'], expect: { exit: 1, stdout: { matches: "unparsable:.*'2'.*'3'" } } }],
    })
    expect(parsed.success).toBe(true)
  })
})
