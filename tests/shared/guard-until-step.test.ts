/**
 * RUN-UNTIL-MARKER — the schema half of the held-terminal step (`until`).
 *
 * A command that never returns (a dev server, a log follower, `truecourse
 * dashboard` in console mode) has no exit to wait for: the step declares the line
 * it is waiting for, the runner stops the child the moment that line appears, and
 * the expectation is evaluated against the output produced so far.
 *
 * Two schema rules carry the whole meaning, and both are pinned here: the field is
 * RUNNER-ONLY (it never enters the authoring schema, so `GENERATE_PROMPT_FINGERPRINT`
 * cannot move for it), and a step the runner terminates on purpose may not assert an
 * `exit` code it was never going to have.
 */

import { describe, expect, it } from 'vitest'
import {
    GuardScenarioSchema,
  GuardSandboxStepSchema,
  GuardStepObjectSchema,
  describeCliCommand,
  describeGuardScenarioSteps,
  type GuardCliStep,
} from '@truecourse/shared'

const binds = [{ doc: 'docs/spec.md', section: 'a/b', fingerprint: 'sha256:x' }]

function cliScenario(steps: unknown[]): unknown {
  return { id: 'f.cli.1', title: 't', binds, steps, normalize: [] }
}

describe('the `until` field on a run step', () => {
  it('parses on a run step, marker only', () => {
    const parsed = GuardSandboxStepSchema.parse({
      run: ['dashboard'],
      until: { marker: 'Dashboard running at' },
      expect: { output: { contains: 'Dashboard running at' } },
    }) as GuardCliStep & { until?: { marker: string } }
    expect(parsed.until?.marker).toBe('Dashboard running at')
  })

  it('needs a marker, and takes nothing else', () => {
    expect(() => GuardSandboxStepSchema.parse({ run: ['dashboard'], until: {}, expect: {} })).toThrow()
    expect(() => GuardSandboxStepSchema.parse({ run: ['dashboard'], until: { marker: '' }, expect: {} })).toThrow()
    expect(() =>
      GuardSandboxStepSchema.parse({
        run: ['dashboard'],
        until: { marker: 'up', after: 100 },
        expect: {},
      }),
    ).toThrow()
  })

  it('a step the runner stops has no exit code to assert', () => {
    expect(() =>
      GuardSandboxStepSchema.parse({
        run: ['dashboard'],
        until: { marker: 'Dashboard running at' },
        expect: { exit: 0 },
      }),
    ).toThrow()
  })

  it('is not part of the AUTHORING vocabulary — the generate prompt cannot move for it', () => {
    // `GuardStepObjectSchema` is what the authoring schema extends. A runner-only
    // verb that leaked into it would re-author every cli flow in the corpus (the
    // `patch` precedent, plan §schemas).
    expect(() =>
      GuardStepObjectSchema.parse({ run: ['dashboard'], until: { marker: 'up' }, expect: {} }),
    ).toThrow()
  })

  it('a `git` step has no `until` — only the program under test is ever held', () => {
    expect(() =>
      GuardSandboxStepSchema.parse({ git: ['status'], until: { marker: 'up' }, expect: {} }),
    ).toThrow()
  })

  it('the step list says what it is waiting for', () => {
    expect(
      describeCliCommand({
        run: ['dashboard'],
        until: { marker: 'Dashboard running at' },
        expect: {},
      } as GuardCliStep),
    ).toBe('dashboard (until “Dashboard running at”)')

    const views = describeGuardScenarioSteps(
      cliScenario([
        { run: ['dashboard'], until: { marker: 'Dashboard running at' }, expect: { output: { contains: 'at' } } },
      ]),
    )
    expect(views[0].command).toBe('dashboard (until “Dashboard running at”)')
  })

  it('`until` is additive runner-only vocabulary — prior scenarios parse unchanged', () => {
    expect(GuardScenarioSchema.parse(cliScenario([{ run: ['version'], expect: { exit: 0 } }])).steps).toHaveLength(
      1,
    )
  })
})
