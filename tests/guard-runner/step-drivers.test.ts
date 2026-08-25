/**
 * The step-driver SEAM: a step declares how it acts, the registry says who takes it,
 * and the run loop knows nothing else about surfaces.
 *
 * These are the tests that keep it a seam rather than a decoration — routing is by
 * the driver's own `owns`, a surface can be swapped for a stand-in without touching
 * the runner, every driver's world is closed exactly once however the scenario
 * ended, and the world they SHARE goes down after all of them.
 */

import { describe, expect, it } from 'vitest'
import type { GuardSandboxStep } from '@truecourse/shared'
import {
  apiStepDriver,
  buildStepDrivers,
  closeStepDrivers,
  driverFor,
  sandboxSurface,
  NO_SCHEMA_BINDING_INFRA,
  NO_SERVED_SURFACE_INFRA,
  type StepDriver,
  type StepOutcome,
} from '@truecourse/guard-runner'

const runStep = { run: ['version'], expect: { exit: 0 } } as GuardSandboxStep
const gitStep = { git: ['status'], expect: { exit: 0 } } as GuardSandboxStep
const writeStep = { write: { 'a.txt': 'x' } } as GuardSandboxStep
const webStep = { driver: 'web', navigate: '/notes' } as GuardSandboxStep
const requestStep = {
  request: { method: 'GET', path: '/api/notes' },
  expect: { status: 200 },
} as GuardSandboxStep

/** The drivers of one scenario, in routing order. */
function driversOf(surface: Parameters<typeof buildStepDrivers>[0]['surface'] = null): StepDriver[] {
  return buildStepDrivers({ resolvedEntry: ['node', 'cli.js'], surface }).drivers
}

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
    const drivers = driversOf()
    expect(driverFor(runStep, drivers).id).toBe('cli')
    expect(driverFor(gitStep, drivers).id).toBe('cli')
    expect(driverFor(writeStep, drivers).id).toBe('cli')
    expect(driverFor(webStep, drivers).id).toBe('web')
    expect(driverFor(requestStep, drivers).id).toBe('api')
  })

  it('asks the SPECIFIC drivers before the catch-all', () => {
    // The cli driver claims everything no other driver does, so a registry that
    // asked it first would swallow every surface added after it. Its exclusions are
    // named too, so the catch-all cannot quietly take a verb it has no executor for.
    const drivers = driversOf()
    expect(drivers.map((d) => d.id)).toEqual(['web', 'api', 'cli'])
    const cli = drivers[2]
    expect(cli.owns(webStep)).toBe(false)
    expect(cli.owns(requestStep)).toBe(false)
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
    const onlyWeb = driversOf().filter((d) => d.id === 'web')
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
    const cli = driversOf()[2]
    await expect(cli.close()).resolves.toBeUndefined()
    await expect(cli.close()).resolves.toBeUndefined()
  })

  it('the web driver still OWNS its steps when the recipe declares no surface', async () => {
    // Refusing to route them would report "unknown step kind"; the honest answer is
    // this driver's own error, naming the missing recipe block.
    const [web] = driversOf()
    expect(web.owns(webStep)).toBe(true)
    const outcome = await web.execute(webStep, { stepIndex: 1, tok: (t: string) => t } as never)
    expect(outcome.status).toBe('error')
    if (outcome.status !== 'error') return
    expect(outcome.message).toContain('recipe.json declares no `web` block')
    // Even that outcome carries the record of what the step MEANT to do.
    expect(outcome.records[0]?.web?.command).toBe('navigate /notes')
  })

  it('the api driver OWNS request steps when the recipe declares no surface — in its OWN words', async () => {
    // Same rule as the web driver's, said to the reader of a request step: a request
    // with nowhere to send it is the same missing recipe block, and the message has
    // to name the verb that needs it.
    const [, api] = driversOf()
    expect(api.owns(requestStep)).toBe(true)
    const outcome = await api.execute(requestStep, { stepIndex: 1, tok: (t: string) => t } as never)
    expect(outcome.status).toBe('error')
    if (outcome.status !== 'error') return
    expect(outcome.message).toBe(NO_SERVED_SURFACE_INFRA)
    expect(outcome.message).toContain('`request` steps')
    expect(outcome.records[0]?.api?.command).toBe('GET /api/notes')
  })

  it('`expect.schema` in a sandbox scenario is a loud error, never a silent pass', async () => {
    // The assertion resolves its schema from a BOUND OpenAPI operation, and a sandbox
    // scenario binds none. Passing it quietly would be an assertion that checks nothing.
    const served = sandboxSurface(null)
    const api = apiStepDriver({ served: { ...served, declared: true } })
    const step = {
      request: { method: 'GET', path: '/api/notes' },
      expect: { status: 200, schema: true },
    } as GuardSandboxStep
    const outcome = await api.execute(step, { stepIndex: 1, tok: (t: string) => t } as never)
    expect(outcome.status).toBe('error')
    if (outcome.status !== 'error') return
    expect(outcome.message).toBe(NO_SCHEMA_BINDING_INFRA)
  })

  it('closes the shared surface AFTER every driver that was talking to it', async () => {
    // The browser must let go before the server dies, or the evidence fills with
    // connection errors from a page whose backend just vanished.
    const order: string[] = []
    const world = buildStepDrivers({ resolvedEntry: ['node', 'cli.js'], surface: null })
    for (const driver of world.drivers) {
      const id = driver.id
      Object.assign(driver, {
        close: async () => {
          order.push(id)
        },
      })
    }
    Object.assign(world.served, {
      close: async () => {
        order.push('surface')
      },
    })
    await world.close()
    expect(order).toEqual(['cli', 'api', 'web', 'surface'])
  })
})
