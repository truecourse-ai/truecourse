/**
 * `truecourse guard seed` — the seed view and its standalone drafting run.
 *
 * `--init` runs the REAL stage over a copy of the `seed-draft` fixture: the
 * ANALYZER parses its `schema.prisma` (so the draft's grounding is the repo's own
 * schema, not a hand-built literal), the drafted script is spawned for real, its
 * manifest is validated, and the fixture server is booted against what it left. Only
 * the model is stubbed. Docker is never involved — the recipe declares no
 * `api.services`, which is the tested path.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { recipePath, writeGuardResult } from '@truecourse/guard-runner'
import type { GuardGenerateReport } from '@truecourse/shared'
import type { SeedProposal, SeedRunner } from '@truecourse/guard-generator'
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

const PROPOSAL: SeedProposal = {
  scriptPath: 'scripts/guard-seed.mjs',
  scriptContent: SCRIPT,
  seed: { command: 'node scripts/guard-seed.mjs', provides: { fixtures: { org: ['id', 'slug'] } } },
}

/** The model, stubbed — and the drafting input it was handed, for assertions. */
function stubbed(...answers: unknown[]): { runner: SeedRunner; inputs: Parameters<SeedRunner>[0][] } {
  const inputs: Parameters<SeedRunner>[0][] = []
  return {
    inputs,
    runner: async (input) => {
      inputs.push(input)
      const answer = answers[inputs.length - 1]
      if (answer === undefined) throw new Error(`unexpected seed call #${inputs.length}`)
      return answer
    },
  }
}

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
    expect(out).toMatch(/truecourse guard seed --init/)
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

describe('runGuardSeed --init', () => {
  it('exits cleanly when no flow is blocked on missing data', async () => {
    const r = fixtureRepo()
    const stub = stubbed()

    await run({ cwd: r, init: true, seedRunner: stub.runner })

    expect(out).toMatch(/no `truecourse guard generate` has run yet/)
    expect(stub.inputs).toHaveLength(0)
    expect(fs.existsSync(path.join(r, 'scripts/guard-seed.mjs'))).toBe(false)
  })

  it('says so when the last generate left no missing-data gap', async () => {
    const r = fixtureRepo()
    writeBlockedReport(r, 'blocked on stripe: charge a card')
    const stub = stubbed()

    await run({ cwd: r, init: true, seedRunner: stub.runner })

    expect(out).toMatch(/left no flow blocked on missing data/)
    expect(stub.inputs).toHaveLength(0)
  })

  it('refuses to overwrite an existing seed, without analyzing anything', async () => {
    const r = fixtureRepo()
    writeBlockedReport(r)
    writeRecipe(r, { command: 'node mine.mjs', provides: { fixtures: { org: ['id'] } } })
    const before = fs.readFileSync(recipePath(r), 'utf-8')
    const stub = stubbed()

    await run({ cwd: r, init: true, seedRunner: stub.runner })

    expect(out).toMatch(/already declares `api\.seed`/)
    expect(stub.inputs).toHaveLength(0)
    expect(fs.readFileSync(recipePath(r), 'utf-8')).toBe(before)
  })

  it('drafts against the repo’s OWN parsed schema, verifies it, and writes both artifacts', async () => {
    const r = fixtureRepo()
    writeBlockedReport(r)
    const stub = stubbed(PROPOSAL)

    await run({ cwd: r, init: true, seedRunner: stub.runner })

    // The grounding came from the analyzer, not from the test: the fixture's
    // `schema.prisma` and the `@prisma/client` import in `src/db.js`.
    expect(stub.inputs).toHaveLength(1)
    expect(stub.inputs[0].driver).toBe('prisma')
    expect(stub.inputs[0].tables.map((t) => t.name).sort()).toEqual(['Booking', 'Org'])
    expect(stub.inputs[0].relations).toContainEqual({
      sourceTable: 'Booking',
      targetTable: 'Org',
      foreignKeyColumn: 'orgId',
    })
    expect(stub.inputs[0].appImports.join('\n')).toMatch(/@prisma\/client/)
    expect(stub.inputs[0].blocked[0].needs).toContain('missing-data')

    // Both artifacts, and the review-and-commit message naming BOTH.
    expect(fs.readFileSync(path.join(r, 'scripts/guard-seed.mjs'), 'utf-8')).toBe(SCRIPT)
    expect(JSON.parse(fs.readFileSync(recipePath(r), 'utf-8')).api.seed).toEqual({
      command: 'node scripts/guard-seed.mjs',
      script: 'scripts/guard-seed.mjs',
      provides: { fixtures: { org: ['id', 'slug'] } },
    })
    expect(out).toMatch(/wrote scripts\/guard-seed\.mjs/)
    expect(out).toMatch(/Review and commit BOTH/)
    expect(out).toMatch(/re-run `truecourse guard generate`/)
  }, 60_000)
})
