/**
 * `truecourse guard recipe` — the recipe view and its (re-)derivation. The read
 * path is pure rendering (no LLM, no build); `--init` and `--refresh` run the REAL
 * discovery over the dependency-free `speced-api-mini` fixture, so the install →
 * build → boot verification actually happens and the written file is the one a
 * user would commit.
 *
 * Non-interactive by contract: nothing here ever prompts, and every refusal is a
 * printed message + a non-zero exit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { recipePath, writeGuardLatest } from '@truecourse/guard-runner'
import { GUARD_FORMAT_VERSION, type GuardLatest } from '@truecourse/shared'
import { runGuardRecipe } from '../../tools/cli/src/commands/guard-recipe'
import { unifiedDiff } from '../../tools/cli/src/lib/unified-diff'
import { makeTempRepo, rmrf } from '../guard-runner/helpers.js'

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'recipe-propose',
)

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

/** The JS fixture, copied out so a build/boot never touches the checkout. */
function fixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cli-recipe-'))
  repos.push(dir)
  fs.cpSync(path.join(FIXTURES, 'speced-api-mini'), dir, { recursive: true })
  return dir
}

function writeRecipeJson(r: string, recipe: unknown): void {
  const target = recipePath(r)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2) + '\n')
}

/** A run snapshot carrying a recipe fingerprint — the staleness baseline. */
async function writeRunWithFingerprint(r: string, fingerprint: string): Promise<void> {
  const latest: GuardLatest = {
    run: {
      runId: '2026-07-28_abc1',
      ranAt: '2026-07-28T00:00:00.000Z',
      branch: 'main',
      commit: 'deadbeefcafef00d',
      recipeFingerprint: fingerprint,
      scenarioFormat: GUARD_FORMAT_VERSION,
    },
    summary: { total: 0, pass: 0, fail: 0, error: 0, stale: 0, orphaned: 0 },
    scenarios: [],
    sections: [],
  }
  await writeGuardLatest(r, latest)
}

/** The model proposer must never be reached: the fixture decides deterministically,
 *  and the failure case must not depend on a `claude` binary existing. */
const neverCalled = async (): Promise<never> => {
  throw new Error('no model transport in tests')
}

describe('runGuardRecipe — showing the recipe', () => {
  let out: string
  let spy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>
  let exited: number | undefined
  beforeEach(() => {
    out = ''
    exited = undefined
    spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk)
      return true
    })
    // Detail lines go through console.log (the house pattern for indented output),
    // which vitest intercepts before it reaches the stdout stream — capture both.
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      out += args.join(' ') + '\n'
    })
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exited = code;
      throw new Error(`process.exit(${code})`)
    }) as never)
  })
  afterEach(() => {
    spy.mockRestore()
    logSpy.mockRestore()
    exitSpy.mockRestore()
  })

  /** Run the command, swallowing the mocked process.exit so the assertion runs. */
  async function run(opts: Parameters<typeof runGuardRecipe>[0]): Promise<void> {
    try {
      await runGuardRecipe(opts)
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith('process.exit(')) throw e
    }
  }

  it('points at --init when the repo has no recipe', async () => {
    await run({ cwd: repo() })

    expect(out).toContain('No recipe yet')
    expect(out).toContain('guard recipe --init')
    expect(exited).toBeUndefined()
  })

  it('prints every field of an api recipe, masking an inline credential value', async () => {
    const r = repo()
    writeRecipeJson(r, {
      install: 'npm ci',
      build: 'npm run build',
      api: {
        serve: ['node', 'dist/index.js'],
        healthPath: '/healthz',
        services: { up: 'docker compose up -d db', down: 'docker compose down -v' },
        credentials: {
          'api-key': { header: 'X-Api-Key', value: 'sekret-value', description: 'org owner' },
          bearer: { header: 'Authorization', valueFromEnv: 'GUARD_BEARER_TOKEN' },
        },
      },
    })

    await run({ cwd: r })

    expect(out).toContain('npm ci')
    expect(out).toContain('node dist/index.js')
    expect(out).toContain('/healthz')
    expect(out).toContain('docker compose up -d db')
    // The env-var NAME is a capability and prints; the inline value never does.
    expect(out).toContain('$GUARD_BEARER_TOKEN')
    expect(out).toContain('org owner')
    expect(out).not.toContain('sekret-value')
    expect(out).toContain('masked')
  })

  it('reports an unparseable recipe with the loader diagnostic and exits non-zero', async () => {
    const r = repo()
    writeRecipeJson(r, { build: 'npm run build' }) // neither `entry` nor `api`

    await run({ cwd: r })

    expect(out).toContain('does not parse')
    expect(out).toContain('guard recipe --refresh')
    expect(exited).toBe(1)
  })

  it('says there is no baseline when nothing has run, and warns once one has drifted', async () => {
    const r = repo()
    writeRecipeJson(r, { build: 'true', entry: ['node', 'cli.js'] })

    await run({ cwd: r })
    expect(out).toContain('no guard run to compare against yet')

    out = ''
    await writeRunWithFingerprint(r, 'sha256:something-else')
    await run({ cwd: r })
    expect(out).toContain('changed since the last guard run')
  })

  it('refuses --init over an existing recipe and points at --refresh', async () => {
    const r = repo()
    writeRecipeJson(r, { build: 'true', entry: ['node', 'cli.js'] })

    await run({ cwd: r, init: true })

    expect(out).toContain('already exists')
    expect(out).toContain('--refresh')
    expect(exited).toBe(1)
  })

  it('refuses --init together with --refresh', async () => {
    await run({ cwd: repo(), init: true, refresh: true })

    expect(out).toContain('opposites')
    expect(exited).toBe(1)
  })

  it(
    '--init derives, verifies and writes the recipe, naming the deterministic source',
    async () => {
      const r = fixtureRepo()

      await run({ cwd: r, init: true, recipeRunner: neverCalled })

      expect(out).toContain('no LLM call')
      expect(out).toContain('Review and commit')
      // No `healthPath`: this path maps journeys itself, and a bare `node:http`
      // server declares no surface the mapper can read — so the ranking proposes
      // nothing and the runner polls `/` (which the fixture answers).
      expect(JSON.parse(fs.readFileSync(recipePath(r), 'utf-8'))).toEqual({
        build: 'npm run build',
        api: { serve: ['node', 'dist/index.js'] },
      })
    },
    180_000,
  )

  it(
    '--init names BOTH artifacts when it generated the datastore (item 68)',
    async () => {
      const r = fixtureRepo()
      // The app's own configuration, in the shape item 63's harvest reads: the
      // connection URL as a defaults-map value, overridable by DATABASE_URL.
      fs.writeFileSync(
        path.join(r, 'src', 'config.js'),
        [
          'const DEFAULTS = { DATABASE_URL:\'postgres://localhost:5432/weather\' }',
          'export const databaseUrl = process.env.DATABASE_URL ?? DEFAULTS.DATABASE_URL',
        ].join('\n'),
      )
      // A stub `docker` first on PATH: the daemon is not this test's subject, the
      // artifacts and the message are.
      const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cli-bin-'))
      repos.push(bin)
      fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      const realPath = process.env.PATH
      process.env.PATH = `${bin}${path.delimiter}${realPath}`

      try {
        await run({ cwd: r, init: true, recipeRunner: neverCalled })
      } finally {
        process.env.PATH = realPath
      }

      expect(out).toContain('docker-compose.guard.yml')
      expect(out).toContain('Review and commit BOTH')
      const recipe = JSON.parse(fs.readFileSync(recipePath(r), 'utf-8'))
      expect(recipe.api.services.up).toBe('docker compose -f docker-compose.guard.yml up -d --wait')
      expect(recipe.api.env).toEqual({ DATABASE_URL: 'postgres://guard@localhost:5432/weather' })
      expect(fs.readFileSync(path.join(r, 'docker-compose.guard.yml'), 'utf-8')).toContain('postgres:16-alpine')
    },
    180_000,
  )

  it(
    '--refresh replaces a stale recipe and prints the diff instead of a backup',
    async () => {
      const r = fixtureRepo()
      writeRecipeJson(r, { build: 'npm run build', api: { serve: ['node', 'dist/old.js'] } })

      await run({ cwd: r, refresh: true, recipeRunner: neverCalled })

      expect(out).toContain('-      "dist/old.js"')
      expect(out).toContain('+      "dist/index.js"')
      expect(JSON.parse(fs.readFileSync(recipePath(r), 'utf-8')).api.serve).toEqual([
        'node',
        'dist/index.js',
      ])
    },
    180_000,
  )

  it(
    '--refresh leaves the existing recipe untouched when discovery cannot verify one',
    async () => {
      // A repo the deterministic proposer refuses (no manifest at all) and whose
      // model fallback is unreachable: nothing verifies, so nothing is written.
      const r = repo()
      fs.rmSync(path.join(r, 'package.json'))
      const original = { build: 'true', entry: ['node', 'cli.js'] }
      writeRecipeJson(r, original)

      await run({ cwd: r, refresh: true, recipeRunner: neverCalled })

      expect(out).toContain('Recipe discovery failed')
      expect(out).toContain('left untouched')
      expect(exited).toBe(1)
      expect(JSON.parse(fs.readFileSync(recipePath(r), 'utf-8'))).toEqual(original)
    },
    180_000,
  )
})

describe('unifiedDiff', () => {
  it('marks removals and additions, with context around each change', () => {
    const before = 'a\nb\nc\nd\n'
    const after = 'a\nB\nc\nd\n'

    expect(unifiedDiff(before, after)).toEqual([' a', '-b', '+B', ' c', ' d'])
  })

  it('is empty for identical text', () => {
    expect(unifiedDiff('a\nb\n', 'a\nb\n')).toEqual([])
  })

  it('elides runs of unchanged lines far from any change', () => {
    const before = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n')
    const after = before.replace('line 0', 'LINE 0')

    const diff = unifiedDiff(before, after)
    expect(diff[0]).toBe('-line 0')
    expect(diff).toContain('…')
    expect(diff.at(-1)).not.toBe('line 11')
  })
})
