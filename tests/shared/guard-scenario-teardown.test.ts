/**
 * The scenario schema's `teardown:` field and its whole-scenario passes — the
 * execution sequence (`guardExecutionSteps`) and the step-list presentation, both
 * of which number teardown steps continuously after the main steps.
 */

import { describe, it, expect } from 'vitest'
import {
  GuardCliScenarioSchema,
  describeGuardScenarioSteps,
  guardExecutionSteps,
  type GuardApiScenario,
  type GuardCliScenario,
} from '@truecourse/shared'

const base: GuardCliScenario = {
  guard: 3,
  id: 'svc.cli.1',
  title: 'installs and removes a service',
  binds: [{ doc: 'docs/spec.md', section: 'a/b', fingerprint: 'sha256:x' }],
  driver: 'cli',
  steps: [
    { run: ['install'], expect: { exit: 0 } },
    { run: ['status'], expect: { exit: 0 } },
  ],
  teardown: [
    { run: ['stop'], expect: { exit: 0 } },
    { run: ['uninstall'], expect: { exit: 0 }, milestone: 'uninstall-claim' },
  ],
  normalize: [],
}

describe('GuardCliScenarioSchema.teardown', () => {
  it('parses a scenario carrying teardown steps', () => {
    const parsed = GuardCliScenarioSchema.safeParse(base)
    expect(parsed.success).toBe(true)
  })

  it('rejects an EMPTY teardown list — nothing to restore is spelled by omission', () => {
    const parsed = GuardCliScenarioSchema.safeParse({ ...base, teardown: [] })
    expect(parsed.success).toBe(false)
  })

  it('stays optional — a scenario without it parses exactly as before', () => {
    const { teardown: _teardown, ...bare } = base
    expect(GuardCliScenarioSchema.safeParse(bare).success).toBe(true)
  })
})

describe('guardExecutionSteps', () => {
  it('concatenates steps and teardown for a cli scenario, in order', () => {
    const steps = guardExecutionSteps(base)
    expect(steps).toHaveLength(4)
    expect(steps[2]).toBe(base.teardown![0])
    expect(steps[3]).toBe(base.teardown![1])
  })

  it('returns the plain step list when there is no teardown (cli and api alike)', () => {
    const { teardown: _teardown, ...bare } = base
    expect(guardExecutionSteps(bare)).toHaveLength(2)
    const api: GuardApiScenario = {
      guard: 3,
      id: 'api.1',
      title: 'an api scenario',
      binds: base.binds,
      driver: 'api',
      steps: [{ request: { method: 'GET', path: '/health' }, expect: { status: 200 } }],
      normalize: [],
    }
    expect(guardExecutionSteps(api)).toHaveLength(1)
  })
})

describe('describeGuardScenarioSteps — teardown rows', () => {
  it('numbers teardown steps continuously and flags them', () => {
    const rows = describeGuardScenarioSteps(base)
    expect(rows.map((r) => r.n)).toEqual([1, 2, 3, 4])
    expect(rows.map((r) => r.teardown)).toEqual([undefined, undefined, true, true])
    expect(rows[3].command).toContain('uninstall')
    // The milestone half reads exactly as it does on a main step.
    expect(rows[3].claims).toEqual(['uninstall-claim'])
  })
})
