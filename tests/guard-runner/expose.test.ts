/**
 * RECIPE `expose` — the program under test, on the sandbox PATH under its real
 * binary name.
 *
 * The property under test is not "a file exists": it is that a scenario which drives
 * the program through SOMETHING ELSE (a git hook, a Makefile, another tool) reaches
 * THIS build. Without it those scenarios silently grade whatever copy of the program
 * the machine happens to have installed, and every verdict they reach is about that
 * copy — the defect that made TrueCourse's own pre-commit-hook scenarios test a
 * published release instead of the working tree.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createSandbox, runGuard } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeRecipe, writeScenario, scenario, specBinds, FIXTURE_BIN } from './helpers.js'

const repos: string[] = []
const sandboxes: { cleanup(): void }[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
  while (sandboxes.length) sandboxes.pop()!.cleanup()
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

function writeRecipeWithExpose(r: string, expose: Record<string, string | string[]>): void {
  writeRecipe(r)
  const file = path.join(r, '.truecourse', 'scenarios', 'recipe.json')
  const recipe = JSON.parse(fs.readFileSync(file, 'utf-8'))
  recipe.expose = expose
  fs.writeFileSync(file, JSON.stringify(recipe, null, 2))
}

describe('createSandbox — the shim directory', () => {
  it('writes an executable shim per entry and puts it FIRST on PATH', () => {
    const sandbox = createSandbox({
      repoRoot: process.cwd(),
      expose: { relkit: ['node', FIXTURE_BIN] },
    })
    sandboxes.push(sandbox)

    const shim = path.join(sandbox.shimDir!, 'relkit')
    expect(fs.existsSync(shim)).toBe(true)
    expect(fs.statSync(shim).mode & 0o111).toBeTruthy()
    expect(sandbox.env.PATH!.split(path.delimiter)[0]).toBe(sandbox.shimDir)
    // Prepended, never substituted: node/git and the rest of the toolchain a program
    // legitimately needs must still resolve.
    expect(sandbox.env.PATH!.split(path.delimiter).length).toBeGreaterThan(1)
  })

  /**
   * The shim dir is `<sandbox root>/node_modules/.bin`, and the location is
   * load-bearing rather than cosmetic. PATH is the ecosystem-neutral contract, but
   * node's package managers do not consult PATH: `npx <name>` walks UP from the
   * working directory looking for `node_modules/.bin/<name>` and, failing that,
   * installs a published copy from the registry. A shim only on PATH would therefore
   * lose to a download for exactly the case `expose` exists to fix.
   *
   * This asserts the contract the way npm resolves it — an upward walk from the
   * scenario cwd — so the guarantee survives any refactor of where the dir lives.
   */
  it('sits where a node package manager’s upward bin walk finds it, above the scenario cwd', () => {
    const sandbox = createSandbox({
      repoRoot: process.cwd(),
      expose: { relkit: ['node', FIXTURE_BIN] },
    })
    sandboxes.push(sandbox)

    const walkUpForBin = (from: string, bin: string): string | null => {
      let dir = from
      for (;;) {
        const candidate = path.join(dir, 'node_modules', '.bin', bin)
        if (fs.existsSync(candidate)) return candidate
        const parent = path.dirname(dir)
        if (parent === dir) return null
        dir = parent
      }
    }
    expect(walkUpForBin(sandbox.cwd, 'relkit')).toBe(path.join(sandbox.shimDir!, 'relkit'))
    // Above the cwd, so it never appears in the working tree a scenario asserts on.
    expect(fs.existsSync(path.join(sandbox.cwd, 'node_modules'))).toBe(false)
  })

  it('exposes nothing when the recipe declares nothing', () => {
    const sandbox = createSandbox({ repoRoot: process.cwd() })
    sandboxes.push(sandbox)
    expect(sandbox.shimDir).toBeNull()
    expect(sandbox.env.PATH).toBe(process.env.PATH ?? '')
  })
})

describe('runGuard — a child that invokes the program by name', () => {
  it('runs the exposed build, not whatever the machine has installed', async () => {
    const r = repo()
    writeRecipeWithExpose(r, { 'relkit-under-test': ['node', FIXTURE_BIN] })
    writeScenario(
      r,
      'cli/exposed.yaml',
      scenario({
        id: 'exposed',
        binds: specBinds('cli/version'),
        // `run-child` spawns a binary resolved through PATH — the shape a git hook,
        // a Makefile or a plugin uses to reach the program under test.
        steps: [
          {
            run: ['run-child', 'relkit-under-test', 'version'],
            expect: { exit: 0, stdout: { matches: '^\\d+\\.\\d+\\.\\d+' } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].outcome).toBe('pass')
  })

  it('leaves an unexposed name unresolvable — the sandbox gains nothing it was not given', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/unexposed.yaml',
      scenario({
        id: 'unexposed',
        binds: specBinds('cli/version'),
        steps: [{ run: ['run-child', 'relkit-under-test', 'version'], expect: { exit: 0 } }],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].outcome).toBe('fail')
  })
})

describe('the recipe schema', () => {
  it('rejects a binary name carrying a path separator', async () => {
    const { RecipeSchema } = await import('@truecourse/guard-runner')
    expect(
      RecipeSchema.safeParse({ build: 'true', entry: ['node', 'x'], expose: { 'a/b': ['node', 'x'] } }).success,
    ).toBe(false)
    expect(
      RecipeSchema.safeParse({ build: 'true', entry: ['node', 'x'], expose: { tool: 'dist/cli.js' } }).success,
    ).toBe(true)
  })
})
