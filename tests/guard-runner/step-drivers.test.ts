/**
 * The step-driver SEAM: a step declares how it acts, the registry says who takes it,
 * and the run loop knows nothing else about surfaces.
 *
 * These are the tests that keep it a seam rather than a decoration — routing is by
 * the driver's own `owns`, a surface can be swapped for a stand-in without touching
 * the runner, and every driver's world is closed exactly once however the scenario
 * ended.
 */

import { describe, expect, it } from 'vitest'
import type { GuardSandboxStep } from '@truecourse/shared'
import {
  buildStepDrivers,
  closeStepDrivers,
  driverFor,
  type StepDriver,
  type StepOutcome,
} from '@truecourse/guard-runner'

const runStep = { run: ['version'], expect: { exit: 0 } } as GuardSandboxStep
const gitStep = { git: ['status'], expect: { exit: 0 } } as GuardSandboxStep
const writeStep = { write: { 'a.txt': 'x' } } as GuardSandboxStep
const webStep = { driver: 'web', navigate: '/notes' } as GuardSandboxStep

/** A driver that records what it was asked to do and nothing else. */
function spyDriver(id: StepDriver['id'], owns: (step: GuardSandboxStep) => boolean) {
  const took: GuardSandboxStep[] = []
  let closes = 0
  const driver: StepDriver = {
    id,
    owns,
    async execute(step): Promise<StepOutcome> {
      took.push(step)
      return { status: 'ok', records: [] }
    },
    async close() {
      closes += 1
    },
  }
  return { driver, took, closed: () => closes }
}

describe('the step-driver registry', () => {
  it('routes each step to the driver that claims it', () => {
    const drivers = buildStepDrivers({ resolvedEntry: ['node', 'cli.js'], surface: null })
    expect(driverFor(runStep, drivers).id).toBe('cli')
    expect(driverFor(gitStep, drivers).id).toBe('cli')
    expect(driverFor(writeStep, drivers).id).toBe('cli')
    expect(driverFor(webStep, drivers).id).toBe('web')
  })

  it('asks the SPECIFIC driver before the catch-all', () => {
    // The cli driver claims everything no other driver does, so a registry that
    // asked it first would swallow every surface added after it.
    const drivers = buildStepDrivers({ resolvedEntry: ['node', 'cli.js'], surface: null })
    expect(drivers.map((d) => d.id)).toEqual(['web', 'cli'])
    expect(drivers[1].owns(webStep)).toBe(false)
  })

  it('a surface can be swapped for a stand-in without touching the runner', async () => {
    const fake = spyDriver('web', (step) => 'driver' in step && step.driver === 'web')
    const cli = spyDriver('cli', (step) => !('driver' in step))
    const drivers = [fake.driver, cli.driver]
    for (const step of [runStep, webStep, writeStep]) {
      await driverFor(step, drivers).execute(step, {} as never)
    }
    expect(fake.took).toEqual([webStep])
    expect(cli.took).toEqual([runStep, writeStep])
  })

  it('a step nothing claims is a loud error, never a silent skip', () => {
    const onlyWeb = buildStepDrivers({ resolvedEntry: ['node', 'cli.js'], surface: null }).filter(
      (d) => d.id === 'web',
    )
    expect(() => driverFor(runStep, onlyWeb)).toThrow(/no step driver owns this step/)
  })

  it('closes every driver, in reverse, and survives one that throws', async () => {
    const order: string[] = []
    const first: StepDriver = {
      id: 'cli',
      owns: () => true,
      execute: async () => ({ status: 'ok', records: [] }),
      close: async () => {
        order.push('cli')
      },
    }
    const second: StepDriver = {
      id: 'web',
      owns: () => false,
      execute: async () => ({ status: 'ok', records: [] }),
      close: async () => {
        order.push('web')
        throw new Error('teardown blew up')
      },
    }
    // Reverse order: the last world opened is the first one taken down, and one
    // driver's bad teardown must never leave the next one's resources standing.
    await closeStepDrivers([first, second])
    expect(order).toEqual(['web', 'cli'])
  })

  it('the cli driver holds nothing per scenario, so closing it is a no-op', async () => {
    const [, cli] = buildStepDrivers({ resolvedEntry: ['node', 'cli.js'], surface: null })
    await expect(cli.close()).resolves.toBeUndefined()
    await expect(cli.close()).resolves.toBeUndefined()
  })

  it('the web driver still OWNS its steps when the recipe declares no surface', async () => {
    // Refusing to route them would report "unknown step kind"; the honest answer is
    // this driver's own error, naming the missing recipe block.
    const [web] = buildStepDrivers({ resolvedEntry: ['node', 'cli.js'], surface: null })
    expect(web.owns(webStep)).toBe(true)
    const outcome = await web.execute(webStep, { stepIndex: 1, tok: (t: string) => t } as never)
    expect(outcome.status).toBe('error')
    if (outcome.status !== 'error') return
    expect(outcome.message).toContain('recipe.json declares no `web` block')
    // Even that outcome carries the record of what the step MEANT to do.
    expect(outcome.records[0]?.web?.command).toBe('navigate /notes')
  })
})
