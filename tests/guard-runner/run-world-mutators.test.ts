/**
 * BLAST-RADIUS SCHEDULING (plan item 143): a scenario declaring
 * `world: mutates` runs LAST, serialized, and the world is restored afterwards
 * through `api.services.reset` — so a delete-account/change-password scenario
 * can no longer poison the scenarios beside it (documenso 2026-08-28: one
 * committed delete-account scenario cost the run 452 sign-in failures) or the
 * run after it. The `.world-dirty` marker survives a run that could not
 * restore, and the next world boot resets before building on the damage.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runGuard, guardWorldDirtyMarkerPath } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeApiRecipe, writeScenario, apiScenario, specBinds } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

const worldLog = (r: string): string[] => {
  const file = path.join(r, 'world.log')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean) : []
}

function logServices(r: string, withReset: boolean) {
  const log = path.join(r, 'world.log')
  return {
    up: `printf 'up\\n' >> ${log}`,
    down: `printf 'down\\n' >> ${log}`,
    ...(withReset ? { reset: `printf 'reset\\n' >> ${log}` } : {}),
  }
}

const sharedScenario = () =>
  apiScenario({
    id: 'shared-list',
    binds: specBinds('cli/version'),
    steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 } }],
  })

const mutatorScenario = () =>
  apiScenario({
    id: 'mutator-wipe',
    world: 'mutates',
    binds: specBinds('cli/whoami'),
    steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 } }],
  })

describe('runGuard — the world-mutator tail', () => {
  it('runs the mutator last, resets the world after it, and clears the marker', async () => {
    const r = repo()
    writeApiRecipe(r, { services: logServices(r, true) })
    writeScenario(r, 'api/shared.yaml', sharedScenario())
    writeScenario(r, 'api/mutator.yaml', mutatorScenario())

    const settled: string[] = []
    const res = await runGuard({
      repoRoot: r,
      skipBuild: true,
      onScenarioSettled: (_done, _total, result) => settled.push(result.id),
    })

    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    // The tail runs only after every shared scenario settled.
    expect(settled[settled.length - 1]).toBe('mutator-wipe')
    // …and the world was restored: reset ran, so the finally's `down` had
    // nothing left to stop.
    expect(worldLog(r)).toEqual(['up', 'reset'])
    expect(fs.existsSync(guardWorldDirtyMarkerPath(r))).toBe(false)
    expect(res.latest.run.worldLeftDirty).toBeUndefined()
  }, 60_000)

  it('without a declared reset the run reports the world left dirty and keeps the marker', async () => {
    const r = repo()
    writeApiRecipe(r, { services: logServices(r, false) })
    writeScenario(r, 'api/shared.yaml', sharedScenario())
    writeScenario(r, 'api/mutator.yaml', mutatorScenario())

    const res = await runGuard({ repoRoot: r, skipBuild: true })

    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.run.worldLeftDirty).toBe(true)
    // The marker survives — the honest record for a later run that CAN reset.
    expect(fs.existsSync(guardWorldDirtyMarkerPath(r))).toBe(true)
    expect(worldLog(r)).toEqual(['up', 'down'])
  }, 60_000)

  it('a surviving marker makes the next world boot reset before `up`', async () => {
    const r = repo()
    writeApiRecipe(r, { services: logServices(r, true) })
    writeScenario(r, 'api/shared.yaml', sharedScenario())
    fs.mkdirSync(path.dirname(guardWorldDirtyMarkerPath(r)), { recursive: true })
    fs.writeFileSync(guardWorldDirtyMarkerPath(r), 'previous-run\n')

    const res = await runGuard({ repoRoot: r, skipBuild: true })

    expect(res.status).toBe('ok')
    // Restored FIRST, then the ordinary lifecycle; no mutators ran this time.
    expect(worldLog(r)).toEqual(['reset', 'up', 'down'])
    expect(fs.existsSync(guardWorldDirtyMarkerPath(r))).toBe(false)
  }, 60_000)
})
