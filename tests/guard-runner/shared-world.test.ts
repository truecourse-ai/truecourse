/**
 * THE SHARED WORLD (shared-world.ts) — the run-level singleton that stops
 * sandbox world lifecycles racing on the recipe's one compose project (the
 * documenso 13-worker P1017 incident, 2026-08-24: concurrent per-sandbox
 * `services.up`/`down` cycles killed the datastore under each other's seeds).
 *
 * Unit half: the single-flight memo's contract. Integration half: `runGuard`
 * with a `sharedWorld` handle boots services + seed ONCE across executions —
 * concurrent ones included — and tears down only at `shutdown()`; without the
 * handle the owned-world behavior is unchanged (pinned by api-run.test.ts).
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createGuardSharedWorld, runGuard } from '@truecourse/guard-runner'
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('createGuardSharedWorld — the single-flight memo', () => {
  it('boots once: concurrent ensures share the first boot, later ones reuse it', async () => {
    const world = createGuardSharedWorld()
    let boots = 0
    const boot = async () => {
      boots++
      await wait(20)
      return { ok: true as const }
    }
    const down = async () => {}
    const [a, b] = await Promise.all([world.ensure(boot, down), world.ensure(boot, down)])
    const c = await world.ensure(boot, down)
    expect(boots).toBe(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('a boot that resolved as retryable clears the memo — the next ensure re-attempts (per-round retry, as before)', async () => {
    const world = createGuardSharedWorld()
    let boots = 0
    const boot = async () => ({ ok: boots++ > 0 })
    const down = async () => {}
    const first = await world.ensure(boot, down, (v) => !v.ok)
    expect(first.ok).toBe(false)
    const second = await world.ensure(boot, down, (v) => !v.ok)
    expect(second.ok).toBe(true)
    expect(boots).toBe(2)
  })

  it('a boot that THREW clears the memo too, and shutdown still sweeps the half-created world', async () => {
    const world = createGuardSharedWorld()
    let downs = 0
    await expect(
      world.ensure(
        async () => {
          throw new Error('compose died')
        },
        async () => {
          downs++
        },
      ),
    ).rejects.toThrow('compose died')
    expect(world.booted()).toBe(true)
    await world.shutdown()
    expect(downs).toBe(1)
  })

  it('shutdown runs the registered teardown ONCE, awaits an in-flight boot first, and no-ops when nothing booted', async () => {
    const idle = createGuardSharedWorld()
    await idle.shutdown() // nothing booted — nothing to do, no throw
    expect(idle.booted()).toBe(false)

    const world = createGuardSharedWorld()
    const order: string[] = []
    const bootP = world.ensure(
      async () => {
        await wait(30)
        order.push('boot-settled')
        return {}
      },
      async () => {
        order.push('down')
      },
    )
    // Shutdown while the boot is in flight — it must wait, never race it
    // (racing the boot is the exact incident this module removes).
    await Promise.all([world.shutdown(), bootP])
    await world.shutdown() // idempotent
    expect(order).toEqual(['boot-settled', 'down'])
  })
})

describe('runGuard with a shared world', () => {
  const scenario = (id: string) =>
    apiScenario({
      id,
      binds: specBinds('a/b'),
      steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 } }],
    })
  const lines = (r: string, file: string): string[] =>
    fs.existsSync(path.join(r, file)) ? fs.readFileSync(path.join(r, file), 'utf8').trim().split('\n').filter(Boolean) : []

  it('services boot once across SEQUENTIAL runs; down runs only at shutdown', async () => {
    const r = repo()
    writeApiRecipe(r, { services: { up: 'echo up >> world.log', down: 'echo down >> world.log' } })
    writeScenario(r, 'api/one.yaml', scenario('one'))

    const world = createGuardSharedWorld()
    const res1 = await runGuard({ repoRoot: r, skipBuild: true, sharedWorld: world })
    const res2 = await runGuard({ repoRoot: r, skipBuild: true, sharedWorld: world })
    expect(res1.status).toBe('ok')
    expect(res2.status).toBe('ok')
    expect(lines(r, 'world.log')).toEqual(['up'])

    await world.shutdown()
    expect(lines(r, 'world.log')).toEqual(['up', 'down'])
  })

  it('services boot once across CONCURRENT runs — the teardown-race incident shape, made impossible', async () => {
    const r = repo()
    writeApiRecipe(r, { services: { up: 'echo up >> world.log', down: 'echo down >> world.log' } })
    writeScenario(r, 'api/one.yaml', scenario('one'))

    const world = createGuardSharedWorld()
    const [res1, res2] = await Promise.all([
      runGuard({ repoRoot: r, skipBuild: true, sharedWorld: world }),
      runGuard({ repoRoot: r, skipBuild: true, sharedWorld: world }),
    ])
    expect(res1.status).toBe('ok')
    expect(res2.status).toBe('ok')
    // ONE up, ZERO downs while executions are alive: no run can kill the
    // world under its sibling's seed any more.
    expect(lines(r, 'world.log')).toEqual(['up'])
    await world.shutdown()
    expect(lines(r, 'world.log')).toEqual(['up', 'down'])
  })

  it('the SEED runs once too, and its credentials reach every sharing run', async () => {
    const r = repo()
    // Hand-written recipe: a counting seed that emits the manifest shape
    // `runSeed` reads (credentials with values), plus counting services.
    fs.writeFileSync(
      path.join(r, 'seed.mjs'),
      [
        "import fs from 'node:fs'",
        "fs.appendFileSync('seed.log', 'seeded\\n')",
        'fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({ credentials: { "api-key": { value: "Bearer k" } }, fixtures: {} }))',
      ].join('\n'),
    )
    writeApiRecipe(r, {
      services: { up: 'echo up >> world.log', down: 'echo down >> world.log' },
    })
    // writeApiRecipe pins the fixture seed command — swap in the counting one.
    const recipePath = path.join(r, '.truecourse', 'scenarios', 'recipe.json')
    const recipe = JSON.parse(fs.readFileSync(recipePath, 'utf8'))
    recipe.api.seed = {
      command: 'node seed.mjs',
      provides: { credentials: { 'api-key': { header: 'Authorization', description: 'seeded' } } },
    }
    fs.writeFileSync(recipePath, JSON.stringify(recipe, null, 2))
    writeScenario(
      r,
      'api/one.yaml',
      apiScenario({
        id: 'one',
        binds: specBinds('a/b'),
        steps: [
          {
            request: { method: 'GET', path: '/echo-auth', headers: { Authorization: '{{cred:api-key}}' } },
            expect: { status: 200 },
          },
        ],
      }),
    )

    const world = createGuardSharedWorld()
    const res1 = await runGuard({ repoRoot: r, skipBuild: true, sharedWorld: world })
    const res2 = await runGuard({ repoRoot: r, skipBuild: true, sharedWorld: world })
    await world.shutdown()
    expect(res1.status).toBe('ok')
    expect(res2.status).toBe('ok')
    expect(lines(r, 'seed.log')).toEqual(['seeded'])
    expect(lines(r, 'world.log')).toEqual(['up', 'down'])
  })

  it('a failing services.up still fails THIS run loudly, and the next shared run re-attempts', async () => {
    const r = repo()
    writeApiRecipe(r, { services: { up: 'echo up >> world.log && false', down: 'echo down >> world.log' } })
    writeScenario(r, 'api/one.yaml', scenario('one'))

    const world = createGuardSharedWorld()
    const res1 = await runGuard({ repoRoot: r, skipBuild: true, sharedWorld: world })
    expect(res1.status).toBe('build-failed')
    const res2 = await runGuard({ repoRoot: r, skipBuild: true, sharedWorld: world })
    expect(res2.status).toBe('build-failed')
    // The failed boot was not memoized as the world — each run re-attempted.
    expect(lines(r, 'world.log')).toEqual(['up', 'up'])
    await world.shutdown()
  })
})
