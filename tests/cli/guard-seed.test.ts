/**
 * `truecourse guard seed` — the seed VIEW, read-only.
 *
 * Drafting moved to `truecourse guard setup`, and the REAL end-to-end coverage moved
 * with it (`tests/cli/guard-setup.test.ts`, over this same `seed-draft` fixture).
 * What remains here is the rendering, plus the proof that `--init` fails LOUDLY and
 * names where drafting went rather than silently printing the view.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { recipePath, writeGuardResult } from '@truecourse/guard-runner'
import type { GuardGenerateReport } from '@truecourse/shared'
import { runGuardSeed } from '../../tools/cli/src/commands/guard-seed'
import { rmrf } from '../guard-runner/helpers.js'

const FIXTURE = fileURLToPath(new URL('../fixtures/seed-draft', import.meta.url))

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

/** A copy of the fixture app, so a build/boot never touches the checkout. */
function fixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cli-seed-'))
  repos.push(dir)
  fs.cpSync(FIXTURE, dir, { recursive: true })
  writeRecipe(dir)
  return dir
}

function writeRecipe(r: string, seed?: unknown): void {
  const recipe = {
    build: 'true',
    api: {
      serve: ['node', path.join(r, 'server.mjs')],
      healthPath: '/health',
      env: { SEED_STORE: path.join(r, 'store.json') },
      ...(seed ? { seed } : {}),
    },
  }
  const target = recipePath(r)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify(recipe, null, 2) + '\n')
}

/** A generate report whose one gap is blocked on missing data. */
function writeBlockedReport(r: string, reason = 'blocked on missing-data, an already-cancelled booking: cancel a booking'): void {
  const report: GuardGenerateReport = {
    generatedAt: '2026-07-29T00:00:00.000Z',
    status: 'ok',
    sectionsTotal: 1,
    sectionsChanged: 1,
    skippedUnchanged: 0,
    noChanges: false,
    written: [],
    coverageGaps: [{ doc: 'docs/orgs.md', anchor: 'cancel', kind: 'blocked-on', flowId: 'cancel', reason }],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
  }
  writeGuardResult(r, report)
}

const SCRIPT = [
  '// Idempotent: the store is rewritten wholesale, so a re-run leaves the same rows.',
  "import fs from 'node:fs'",
  'const org = { id: 42, slug: "acme" }',
  'fs.writeFileSync(process.env.SEED_STORE, JSON.stringify({ orgs: [org] }))',
  'fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({ fixtures: { org } }))',
  '',
].join('\n')

let out: string
beforeEach(() => {
  out = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out += String(chunk)
    return true
  })
  // Indented detail lines go through console.log, which vitest intercepts before
  // it reaches the stream — capture both (the house pattern).
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    out += args.join(' ') + '\n'
  })
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`)
  }) as never)
})
afterEach(() => vi.restoreAllMocks())

/** Run the command, swallowing the mocked process.exit so the assertion runs. */
async function run(opts: Parameters<typeof runGuardSeed>[0]): Promise<void> {
  try {
    await runGuardSeed(opts)
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith('process.exit(')) throw e
  }
}

describe('runGuardSeed — showing the seed', () => {
  it('says there is no seed yet, and names the flows waiting on one', async () => {
    const r = fixtureRepo()
    writeBlockedReport(r)

    await run({ cwd: r })

    expect(out).toMatch(/No seed yet/)
    expect(out).toMatch(/1 flow is blocked on missing data/)
    expect(out).toMatch(/cancel a booking/)
    expect(out).toMatch(/truecourse guard setup/)
  })

  it('prints a declared seed — command, script, and what it provides', async () => {
    const r = fixtureRepo()
    writeRecipe(r, {
      command: 'node scripts/guard-seed.mjs',
      script: 'scripts/guard-seed.mjs',
      provides: {
        fixtures: { org: ['id', 'slug'] },
        credentials: { owner: { header: 'Authorization', description: 'org owner' } },
      },
    })
    fs.mkdirSync(path.join(r, 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(r, 'scripts/guard-seed.mjs'), SCRIPT)

    await run({ cwd: r })

    expect(out).toMatch(/command\s+node scripts\/guard-seed\.mjs/)
    expect(out).toMatch(/fixture\s+org \(id, slug\)/)
    expect(out).toMatch(/credential\s+owner → Authorization/)
    expect(out).not.toMatch(/MISSING on disk/)
  })

  it('flags a declared script that is not on disk', async () => {
    const r = fixtureRepo()
    writeRecipe(r, {
      command: 'node scripts/gone.mjs',
      script: 'scripts/gone.mjs',
      provides: { fixtures: { org: ['id'] } },
    })

    await run({ cwd: r })

    expect(out).toMatch(/MISSING on disk/)
    expect(out).toMatch(/every guard run will fail its seed stage/)
  })
})

describe('runGuardSeed --init — removed, drafting now lives in `guard setup`', () => {
  it('refuses, names `guard setup`, and writes nothing', async () => {
    const r = fixtureRepo()
    writeBlockedReport(r)
    const before = fs.readFileSync(recipePath(r), 'utf-8')

    await run({ cwd: r, init: true })

    expect(out).toMatch(/`guard seed --init` is gone/)
    expect(out).toMatch(/truecourse guard setup/)
    // A refusal writes nothing: no script, and the recipe is byte-identical.
    expect(fs.existsSync(path.join(r, 'scripts/guard-seed.mjs'))).toBe(false)
    expect(fs.readFileSync(recipePath(r), 'utf-8')).toBe(before)
  })
})
