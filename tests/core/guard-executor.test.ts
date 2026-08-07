/**
 * The core-side `GuardExecutor` registry (the run-execution analogue of the
 * `GuardStore` seam) plus the run flow's use of it. The registry defaults to the
 * OSS `defaultGuardExecutor`, swaps via `setGuardExecutor`, and restores via
 * `resetGuardExecutor`. `guardRunInProcess` must source the recipe + scenarios
 * locally (mapping no-recipe / no-scenarios WITHOUT invoking the executor) and run
 * everything else through the seam — provable with an injected fake.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import {
  getGuardExecutor,
  setGuardExecutor,
  resetGuardExecutor,
  type GuardExecInput,
  type GuardExecReport,
} from '../../packages/core/src/lib/guard-executor'
import { defaultGuardExecutor } from '@truecourse/guard-runner'
import { guardRunInProcess } from '../../packages/core/src/commands/guard-in-process'
import type { GuardLatest } from '../../packages/shared/src/index'
import {
  FIXTURE_BIN,
  makeTempRepo,
  rmrf,
  scenario,
  writeRecipe,
  writeScenario,
} from '../guard-runner/helpers'

const repos: string[] = []
beforeEach(() => resetGuardExecutor())
afterEach(() => {
  resetGuardExecutor()
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

function writeVersionScenario(r: string, id: string): void {
  writeScenario(r, `cli/${id}.yaml`, scenario({ id, steps: [{ run: ['--version'], expect: { exit: 0 } }] }))
}

function cannedReport(latest: GuardLatest): GuardExecReport {
  return { status: 'ok', latest, latestPath: '', loadErrors: [], manifest: null }
}

function emptyLatest(): GuardLatest {
  return {
    run: {
      runId: 'run-1',
      ranAt: new Date().toISOString(),
      branch: null,
      commit: null,
      recipeFingerprint: 'sha256:deadbeef',
      scenarioFormat: 3,
    },
    summary: { total: 0, pass: 0, fail: 0, stale: 0, orphaned: 0, error: 0 },
    scenarios: [],
    sections: [],
  }
}

describe('GuardExecutor registry', () => {
  it('defaults to defaultGuardExecutor', () => {
    expect(getGuardExecutor()).toBe(defaultGuardExecutor)
  })

  it('setGuardExecutor swaps the active executor', () => {
    const fake = async (): Promise<GuardExecReport> => cannedReport(emptyLatest())
    setGuardExecutor(fake)
    expect(getGuardExecutor()).toBe(fake)
  })

  it('resetGuardExecutor restores the default', () => {
    setGuardExecutor(async () => cannedReport(emptyLatest()))
    resetGuardExecutor()
    expect(getGuardExecutor()).toBe(defaultGuardExecutor)
  })
})

describe('guardRunInProcess through the executor seam', () => {
  it('sources recipe + scenarios locally and drives the injected executor with persist:true', async () => {
    const r = repo()
    writeRecipe(r)
    writeVersionScenario(r, 'ver')

    let seen: GuardExecInput | undefined
    const latest = emptyLatest()
    setGuardExecutor(async (input) => {
      seen = input
      return cannedReport(latest)
    })

    const result = await guardRunInProcess(r)

    // The fake was driven with the loaded recipe + corpus and a real run's persist.
    expect(seen).toBeDefined()
    expect(seen!.checkoutDir).toBe(r)
    expect(seen!.persist).toBe(true)
    expect(seen!.recipe).toMatchObject({ build: 'true', entry: ['node', FIXTURE_BIN] })
    expect(seen!.scenarios.map((s) => s.id)).toEqual(['ver'])
    // The caller returns exactly what the seam produced (zero spawns above it).
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.latest).toBe(latest)
  })

  it('maps a missing recipe to no-recipe WITHOUT invoking the executor', async () => {
    const r = repo()
    writeVersionScenario(r, 'ver') // scenarios but no recipe.json

    let called = false
    setGuardExecutor(async () => {
      called = true
      return cannedReport(emptyLatest())
    })

    const result = await guardRunInProcess(r)
    expect(result.status).toBe('no-recipe')
    expect(called).toBe(false)
  })

  it('maps an empty corpus to no-scenarios WITHOUT invoking the executor', async () => {
    const r = repo()
    writeRecipe(r) // recipe but no scenarios

    let called = false
    setGuardExecutor(async () => {
      called = true
      return cannedReport(emptyLatest())
    })

    const result = await guardRunInProcess(r)
    expect(result.status).toBe('no-scenarios')
    expect(called).toBe(false)
  })
})
