/**
 * The `GuardExecutor` seam's OSS default. `defaultGuardExecutor` must map a
 * `GuardExecInput` 1:1 onto `runGuard` (checkoutDir → repoRoot, the injected
 * recipe, scenarios, persist), so running through the seam is behaviorally
 * identical to calling the engine directly.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import {
  defaultGuardExecutor,
  loadRecipe,
  recipePath,
  guardLatestPath,
  type Recipe,
} from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeRecipe, writeScenario, scenario, specBinds } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

function recipeOf(r: string): Recipe {
  const loaded = loadRecipe(r, recipePath(r))
  if (!loaded) throw new Error('recipe should load')
  return loaded.recipe
}

describe('defaultGuardExecutor', () => {
  it('maps an empty scenario set onto runGuard’s no-scenarios result', async () => {
    const r = repo()
    writeRecipe(r)
    const report = await defaultGuardExecutor({
      checkoutDir: r,
      recipe: recipeOf(r),
      scenarios: [],
      persist: false,
      skipBuild: true,
    })
    expect(report.status).toBe('no-scenarios')
  })

  it('runs injected scenarios through the engine and honors persist:false', async () => {
    const r = repo()
    writeRecipe(r)
    const sc = scenario({
      id: 'ver',
      binds: specBinds('cli/version'),
      steps: [{ run: ['--version'], expect: { exit: 0 } }],
    })
    const report = await defaultGuardExecutor({
      checkoutDir: r,
      recipe: recipeOf(r),
      scenarios: [sc],
      persist: false,
      skipBuild: true,
      branch: 'feat',
      commit: 'cafe',
    })
    expect(report.status).toBe('ok')
    if (report.status !== 'ok') return
    expect(report.latest.summary).toMatchObject({ total: 1, pass: 1 })
    expect(report.latest.run.branch).toBe('feat')
    expect(report.latest.run.commit).toBe('cafe')
    // persist:false → nothing written to the store.
    expect(fs.existsSync(guardLatestPath(r))).toBe(false)
  })

  it('forwards runTimeoutMs — a hanging scenario surfaces as run-timed-out', async () => {
    const r = repo()
    writeRecipe(r)
    const sc = scenario({
      id: 'hang',
      binds: specBinds('cli/boom'),
      steps: [{ run: ['hang'], expect: { exit: 0 } }],
    })
    const start = Date.now()
    const report = await defaultGuardExecutor({
      checkoutDir: r,
      recipe: recipeOf(r),
      scenarios: [sc],
      persist: false,
      skipBuild: true,
      runTimeoutMs: 500,
    })
    expect(Date.now() - start).toBeLessThan(5_000)
    expect(report.status).toBe('run-timed-out')
    if (report.status !== 'run-timed-out') return
    expect(report.total).toBe(1)
    expect(report.settled).toBe(0)
  })

  it('forwards the abort signal — a pre-aborted input reports aborted at the build phase', async () => {
    const r = repo()
    writeRecipe(r)
    const ac = new AbortController()
    ac.abort()
    const report = await defaultGuardExecutor({
      checkoutDir: r,
      recipe: recipeOf(r),
      scenarios: [scenario({ id: 's', steps: [{ run: ['--version'], expect: { exit: 0 } }] })],
      persist: false,
      signal: ac.signal,
    })
    expect(report).toEqual({ status: 'aborted', phase: 'build' })
  })

  it('forwards buildTimeoutMs — a hanging recipe build fails fast as timed out', async () => {
    const r = repo()
    writeRecipe(r, { build: 'node -e "setInterval(() => {}, 1000)"' })
    const start = Date.now()
    const report = await defaultGuardExecutor({
      checkoutDir: r,
      recipe: recipeOf(r),
      scenarios: [scenario({ id: 's', steps: [{ run: ['--version'], expect: { exit: 0 } }] })],
      persist: false,
      buildTimeoutMs: 200,
    })
    expect(Date.now() - start).toBeLessThan(5_000)
    expect(report.status).toBe('build-failed')
    if (report.status !== 'build-failed') return
    expect(report.build.timedOut).toBe(true)
  })
})
