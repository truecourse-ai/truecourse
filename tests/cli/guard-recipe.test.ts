/**
 * `truecourse guard recipe` — the recipe VIEW, read-only.
 * Pure rendering: no LLM, no build, no write path. The derivation these tests used
 * to drive moved to `truecourse guard setup`, and its coverage moved with it
 * (`tests/cli/guard-setup.test.ts`); what remains here is the rendering plus the
 * proof that the removed flags fail LOUDLY and name where derivation went.
 *
 * Non-interactive by contract: nothing here ever prompts, and every refusal is a
 * printed message + a non-zero exit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { recipePath, writeGuardLatest } from '@truecourse/guard-runner'
import { type GuardLatest } from '@truecourse/shared'
import { runGuardRecipe } from '../../tools/cli/src/commands/guard-recipe'
import { unifiedDiff } from '../../tools/cli/src/lib/unified-diff'
import { makeTempRepo, rmrf } from '../guard-runner/helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
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
    },
    summary: { total: 0, pass: 0, fail: 0, error: 0, stale: 0, orphaned: 0 },
    scenarios: [],
    sections: [],
  }
  await writeGuardLatest(r, latest)
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

  it('points at `guard setup` when the repo has no recipe', async () => {
    await run({ cwd: repo() })

    expect(out).toContain('No recipe yet')
    expect(out).toContain('guard setup')
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
    expect(out).toContain('guard setup --refresh')
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

  // Derivation exists in exactly ONE place. A script or an agent still
  // passing the removed flags must be TOLD where it went, not silently handed the
  // read-only view it did not ask for.
  it('refuses --init and names `guard setup`', async () => {
    await run({ cwd: repo(), init: true })

    expect(out).toContain('no longer derives a recipe')
    expect(out).toContain('truecourse guard setup')
    expect(exited).toBe(1)
  })

  it('refuses --refresh and names `guard setup`', async () => {
    const r = repo()
    writeRecipeJson(r, { build: 'true', entry: ['node', 'cli.js'] })

    await run({ cwd: r, refresh: true })

    expect(out).toContain('truecourse guard setup')
    expect(exited).toBe(1)
    // The refusal is a refusal: the existing recipe is byte-identical afterwards.
    expect(JSON.parse(fs.readFileSync(recipePath(r), 'utf-8'))).toEqual({
      build: 'true',
      entry: ['node', 'cli.js'],
    })
  })
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
