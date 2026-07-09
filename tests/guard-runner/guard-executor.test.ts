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
})
