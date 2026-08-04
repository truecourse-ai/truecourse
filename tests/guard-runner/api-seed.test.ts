import { describe, it, expect, afterEach, beforeEach, vi, type MockInstance } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runGuard, runScenarioSeed, runSeed, SeedError, isSetupDefectResult } from '@truecourse/guard-runner'
import type { RecipeApiSeed } from '@truecourse/guard-runner'
import {
  makeTempRepo,
  rmrf,
  writeApiRecipe,
  writeScenario,
  writeScenarioFile,
  apiScenario,
  specBinds,
  FIXTURE_API_SERVER,
  FIXTURE_API_SERVER_V2,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

/** Write a `seed.mjs` into the repo that emits `manifest` (a literal or an expression). */
function writeSeedScript(r: string, body: string): void {
  fs.writeFileSync(path.join(r, 'seed.mjs'), body)
}

/** A seed script that writes the given JSON object verbatim to GUARD_SEED_OUT. */
function emit(manifest: unknown): string {
  return `import fs from 'node:fs'\nfs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify(${JSON.stringify(manifest)}))\n`
}

const SEED: RecipeApiSeed = {
  command: 'node seed.mjs',
  provides: {
    credentials: { 'api-key': { header: 'Authorization', description: 'pro user' } },
    fixtures: { user: ['id', 'username'], eventType: ['id'] },
  },
}

describe('runSeed', () => {
  it('runs the command, resolves declared credentials (header from provides, value from manifest) and keeps fixtures native', async () => {
    const r = repo()
    writeSeedScript(
      r,
      emit({
        credentials: { 'api-key': { value: 'Bearer cal_abc' } },
        fixtures: { user: { id: 4, username: 'pro' }, eventType: { id: 3 } },
      }),
    )
    const out = await runSeed({ repoRoot: r, seed: SEED })
    expect(out.credentials.get('api-key')).toEqual({ header: 'Authorization', value: 'Bearer cal_abc' })
    // Values keep their native JSON type (numbers stay numbers); the map carries only DECLARED fields.
    expect(out.fixtures.get('user')).toEqual({ id: 4, username: 'pro' })
    expect(out.fixtures.get('eventType')).toEqual({ id: 3 })
  })

  it('ignores emitted keys the recipe did not declare (extra creds/fixtures/fields)', async () => {
    const r = repo()
    writeSeedScript(
      r,
      emit({
        credentials: { 'api-key': { value: 'Bearer x' }, 'admin-key': { value: 'Bearer y' } },
        fixtures: { user: { id: 4, username: 'pro', email: 'p@x.io' }, eventType: { id: 3 }, booking: { id: 9 } },
      }),
    )
    const out = await runSeed({ repoRoot: r, seed: SEED })
    expect(out.credentials.has('admin-key')).toBe(false)
    expect(out.fixtures.has('booking')).toBe(false)
    expect(out.fixtures.get('user')).toEqual({ id: 4, username: 'pro' }) // email dropped
  })

  it('hard-stops when the seed command exits non-zero, naming the exit code and stderr tail', async () => {
    const r = repo()
    writeSeedScript(r, `console.error('boom: db unreachable')\nprocess.exit(3)\n`)
    await expect(runSeed({ repoRoot: r, seed: SEED })).rejects.toBeInstanceOf(SeedError)
    try {
      await runSeed({ repoRoot: r, seed: SEED })
    } catch (e) {
      expect((e as Error).message).toContain('3')
      expect((e as Error).message).toContain('boom: db unreachable')
    }
  })

  it('hard-stops when the seed writes no manifest file', async () => {
    const r = repo()
    writeSeedScript(r, `// exits 0 but writes nothing\n`)
    await expect(runSeed({ repoRoot: r, seed: SEED })).rejects.toThrow(SeedError)
  })

  it('hard-stops when the manifest is not valid JSON', async () => {
    const r = repo()
    writeSeedScript(r, `import fs from 'node:fs'\nfs.writeFileSync(process.env.GUARD_SEED_OUT, 'not json')\n`)
    await expect(runSeed({ repoRoot: r, seed: SEED })).rejects.toThrow(SeedError)
  })

  it('hard-stops when a declared credential is missing from the manifest, naming it', async () => {
    const r = repo()
    writeSeedScript(r, emit({ fixtures: { user: { id: 1, username: 'p' }, eventType: { id: 2 } } }))
    try {
      await runSeed({ repoRoot: r, seed: SEED })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SeedError)
      expect((e as Error).message).toContain('api-key')
    }
  })

  it('hard-stops when a declared credential value is blank (would run un-authenticated)', async () => {
    const r = repo()
    writeSeedScript(
      r,
      emit({
        credentials: { 'api-key': { value: '   ' } },
        fixtures: { user: { id: 1, username: 'p' }, eventType: { id: 2 } },
      }),
    )
    await expect(runSeed({ repoRoot: r, seed: SEED })).rejects.toThrow(SeedError)
  })

  it('hard-stops when a declared fixture field is missing, naming the fixture and field', async () => {
    const r = repo()
    writeSeedScript(
      r,
      emit({
        credentials: { 'api-key': { value: 'Bearer x' } },
        fixtures: { user: { id: 1 }, eventType: { id: 2 } }, // user.username missing
      }),
    )
    try {
      await runSeed({ repoRoot: r, seed: SEED })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SeedError)
      expect((e as Error).message).toContain('user')
      expect((e as Error).message).toContain('username')
    }
  })

  it('supports a fixtures-only seed (no credentials declared)', async () => {
    const r = repo()
    const fixturesOnly: RecipeApiSeed = { command: 'node seed.mjs', provides: { fixtures: { user: ['id'] } } }
    writeSeedScript(r, emit({ fixtures: { user: { id: 7 } } }))
    const out = await runSeed({ repoRoot: r, seed: fixturesOnly })
    expect(out.credentials.size).toBe(0)
    expect(out.fixtures.get('user')).toEqual({ id: 7 })
  })

  it('drains stdout: a seed that writes >64KB to stdout still completes (no pipe-buffer hang)', async () => {
    const r = repo()
    // 256KB to stdout would fill the OS pipe buffer (~64KB) and block the seed's
    // write() forever if stdout is never drained — the run would die at the timeout.
    writeSeedScript(
      r,
      `import fs from 'node:fs'\nprocess.stdout.write('x'.repeat(256 * 1024))\n` +
        `fs.writeFileSync(process.env.GUARD_SEED_OUT, ${JSON.stringify(
          JSON.stringify({
            credentials: { 'api-key': { value: 'Bearer z' } },
            fixtures: { user: { id: 1, username: 'p' }, eventType: { id: 2 } },
          }),
        )})\n`,
    )
    // A short budget: if stdout were undrained this times out; drained it finishes in ms.
    const out = await runSeed({ repoRoot: r, seed: SEED, timeoutMs: 8_000 })
    expect(out.credentials.get('api-key')?.value).toBe('Bearer z')
  })

  it('carries stdout in the failure tail (a seed that logs its error to stdout then exits 1)', async () => {
    const r = repo()
    writeSeedScript(r, `console.log('fatal: migration 0007 not applied')\nprocess.exit(1)\n`)
    try {
      await runSeed({ repoRoot: r, seed: SEED })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SeedError)
      expect((e as Error).message).toContain('fatal: migration 0007 not applied')
    }
  })

  it('masks a recipe-known credential value the seed echoed before failing', async () => {
    const r = repo()
    const SECRET = 'sk-recipe-known-secret'
    writeSeedScript(r, `console.error('used token ${SECRET}')\nprocess.exit(2)\n`)
    try {
      await runSeed({ repoRoot: r, seed: SEED, knownCredentials: new Map([['session', SECRET]]) })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as Error).message).toContain('«cred:session»')
      expect((e as Error).message).not.toContain(SECRET)
    }
  })

  it('masks a manifest-minted credential value the seed echoed before exiting non-zero', async () => {
    const r = repo()
    const MINTED = 'Bearer minted-then-leaked'
    // The seed writes a manifest carrying the minted value, echoes it to stderr, then
    // fails — the tail must be masked using values harvested from the (partial) manifest.
    writeSeedScript(
      r,
      `import fs from 'node:fs'\n` +
        `fs.writeFileSync(process.env.GUARD_SEED_OUT, ${JSON.stringify(
          JSON.stringify({ credentials: { 'api-key': { value: MINTED } } }),
        )})\n` +
        `console.error('minted ${MINTED}')\nprocess.exit(1)\n`,
    )
    try {
      await runSeed({ repoRoot: r, seed: SEED })
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as Error).message).toContain('«cred:api-key»')
      expect((e as Error).message).not.toContain(MINTED)
    }
  })

  it('uses hasOwnProperty for fixture fields: a declared field named toString is genuinely required', async () => {
    const r = repo()
    const seed: RecipeApiSeed = { command: 'node seed.mjs', provides: { fixtures: { user: ['toString'] } } }
    // The manifest emits `id`, NOT `toString` — a prototype-chain `in` check would
    // spuriously find `toString` and stringify the FUNCTION into requests.
    writeSeedScript(r, emit({ fixtures: { user: { id: 1 } } }))
    try {
      await runSeed({ repoRoot: r, seed })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SeedError)
      expect((e as Error).message).toContain('toString')
    }
  })
})

describe('runScenarioSeed', () => {
  it('removes its external source mirror when mirror construction fails', async () => {
    const r = repo()
    fs.writeFileSync(path.join(r, 'sibling.mjs'), 'export {}\n')
    const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('tc-guard-scenario-source-')))
    vi.spyOn(fs, 'symlinkSync').mockImplementation(() => {
      throw new Error('mirror link failed')
    })

    await expect(
      runScenarioSeed({
        repoRoot: r,
        seed: { provides: { fixtures: { account: ['id'] } } },
        sidecar: {
          path: '.truecourse/scenarios/api/account.seed.mjs',
          content: "process.env.GUARD_SEED_NAMESPACE; process.env.GUARD_SEED_OUT\n",
        },
        namespace: 'repo:account',
      }),
    ).rejects.toThrow('mirror link failed')

    const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('tc-guard-scenario-source-'))
    expect(after.filter((name) => !before.has(name))).toEqual([])
  })

  it('resolves repository-relative imports from the sidecar intended directory without writing the corpus path', async () => {
    const r = repo()
    const scenarioDir = path.join(r, '.truecourse', 'scenarios', 'api')
    fs.mkdirSync(scenarioDir, { recursive: true })
    fs.writeFileSync(
      path.join(scenarioDir, 'seed-factory.mjs'),
      "export const account = { id: 'account-from-repository-module' }\n",
    )
    const sidecarPath = '.truecourse/scenarios/api/account.seed.mjs'
    const source = [
      "import fs from 'node:fs'",
      "import { account } from './seed-factory.mjs'",
      "fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({ fixtures: { account } }))",
      '',
    ].join('\n')

    const result = await runScenarioSeed({
      repoRoot: r,
      seed: { provides: { fixtures: { account: ['id'] } } },
      sidecar: { path: sidecarPath, content: source },
      namespace: 'repo:account',
    })

    expect(result.fixtures.get('account')).toEqual({ id: 'account-from-repository-module' })
    expect(fs.existsSync(path.join(r, sidecarPath))).toBe(false)
  })
})

describe('scenario-local pre-boot seed sidecars', () => {
  it('classifies a redacted sidecar failure as a setup defect and persists its evidence', async () => {
    const r = repo()
    writeApiRecipe(r)
    const secret = 'Bearer never-persist-this-secret'
    const seeded = apiScenario({
      id: 'scenario-seed-failure',
      setup: {
        seed: { provides: { credentials: { owner: { header: 'Authorization' } } } },
      },
      steps: [{ request: { method: 'GET', path: '/todos' }, expect: { status: 200 } }],
    })
    writeScenario(r, 'bookings/scenario-seed-failure.yaml', seeded)
    writeScenarioFile(
      r,
      'bookings/scenario-seed-failure.seed.mjs',
      `import fs from 'node:fs'\n` +
        `fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify({ credentials: { owner: { value: ${JSON.stringify(secret)} } } }))\n` +
        `console.error(${JSON.stringify(secret)})\n` +
        `process.exit(7)\n`,
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })

    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = res.latest.scenarios[0]
    expect(result).toMatchObject({
      outcome: 'error',
      failure: { expected: 'scenario seed to materialize' },
    })
    expect(isSetupDefectResult(result)).toBe(true)
    expect(result.failure?.actual).not.toContain(secret)
    expect(result.failure?.actual).toContain('«cred:owner»')
    expect(result.evidencePath).toBeDefined()
    const transcript = fs.readFileSync(path.join(r, result.evidencePath!, 'transcript.txt'), 'utf-8')
    expect(transcript).toContain('scenario seed to materialize')
    expect(transcript).toContain('«cred:owner»')
    expect(transcript).not.toContain(secret)
  })

  it('executes a transient sidecar and preserves native fixture values through interpolation', async () => {
    const r = repo()
    writeApiRecipe(r)
    const seeded = apiScenario({
      id: 'scenario-seeded',
      setup: { seed: { provides: { fixtures: { booking: ['id'] } } } },
      steps: [
        {
          request: { method: 'GET', path: '/echo/{{fixture:booking.id}}' },
          expect: { status: 200, json: { path: { equals: '/echo/42' } } },
        },
      ],
    })
    const yamlPath = '.truecourse/scenarios/bookings/scenario-seeded.yaml'
    const sidecarPath = '.truecourse/scenarios/bookings/scenario-seeded.seed.mjs'
    const sidecar = emit({ fixtures: { booking: { id: 42 } } })

    const res = await runGuard({
      repoRoot: r,
      artifacts: [
        {
          scenario: seeded,
          source: { path: yamlPath, content: JSON.stringify(seeded) },
          companions: { [sidecarPath]: sidecar },
        },
      ],
      skipBuild: true,
      persist: false,
    })

    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    expect(res.latest.scenarios[0].outcome).toBe('pass')
    expect(fs.existsSync(path.join(r, sidecarPath))).toBe(false)
  })

  it('adds redacted setup evidence with duration and declared non-secret fixture names', async () => {
    const r = repo()
    writeApiRecipe(r)
    const secret = 'Bearer scenario-local-secret'
    const seeded = apiScenario({
      id: 'scenario-evidence',
      setup: {
        seed: {
          provides: {
            fixtures: { booking: ['id'] },
            credentials: { owner: { header: 'Authorization' } },
          },
        },
      },
      steps: [
        {
          request: {
            method: 'GET',
            path: '/echo/{{fixture:booking.id}}',
            headers: { Authorization: '{{cred:owner}}' },
          },
          expect: {
            status: 200,
            json: {
              path: { equals: '/echo/42' },
              authorization: { equals: secret },
            },
          },
        },
      ],
    })
    writeScenario(r, 'bookings/scenario-evidence.yaml', seeded)
    writeScenarioFile(
      r,
      'bookings/scenario-evidence.seed.mjs',
      `import fs from 'node:fs'\n` +
        `console.log(${JSON.stringify(`arranged booking with ${secret}`)})\n` +
        `fs.writeFileSync(process.env.GUARD_SEED_OUT, JSON.stringify(${JSON.stringify({
          fixtures: { booking: { id: 42 } },
          credentials: { owner: { value: secret } },
        })}))\n`,
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })

    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = res.latest.scenarios[0]
    expect(result.outcome).toBe('pass')
    const transcript = fs.readFileSync(path.join(r, result.evidencePath!, 'transcript.txt'), 'utf-8')
    expect(transcript).toContain('setup:')
    expect(transcript).toContain('fixtures: booking')
    expect(transcript).toContain('«cred:owner»')
    expect(transcript).not.toContain(secret)
  })
})

describe('runSeed — the shape check on a minted Authorization credential', () => {
  let warnings: string[]
  let spy: MockInstance
  beforeEach(() => {
    warnings = []
    spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.join(' '))
    })
  })
  afterEach(() => spy.mockRestore())

  it('warns when the seed mints a bare Authorization value, naming the credential without the secret', async () => {
    const r = repo()
    writeSeedScript(
      r,
      emit({
        credentials: { 'api-key': { value: 'cal_live_rawtoken' } },
        fixtures: { user: { id: 1, username: 'p' }, eventType: { id: 2 } },
      }),
    )
    await runSeed({ repoRoot: r, seed: SEED })
    const shape = warnings.filter((w) => w.includes('[guard credentials]'))
    expect(shape).toHaveLength(1)
    expect(shape[0]).toContain('api-key')
    expect(shape[0]).not.toContain('cal_live_rawtoken')
  })

  it('stays silent when the minted value carries the `Bearer ` prefix', async () => {
    const r = repo()
    writeSeedScript(
      r,
      emit({
        credentials: { 'api-key': { value: 'Bearer cal_live_ok' } },
        fixtures: { user: { id: 1, username: 'p' }, eventType: { id: 2 } },
      }),
    )
    await runSeed({ repoRoot: r, seed: SEED })
    expect(warnings.filter((w) => w.includes('[guard credentials]'))).toEqual([])
  })
})

describe('seeded credentials across servers', () => {
  it('injects a seeded credential only on the servers its allowlist names', async () => {
    const r = repo()
    const SECRET = 'Bearer v2_seeded_secret'
    writeApiRecipe(r, {
      env: { SEED_MANIFEST: JSON.stringify({ credentials: { 'v2-key': { value: SECRET } } }) },
      servers: {
        web: { serve: ['node', FIXTURE_API_SERVER], healthPath: '/health' },
        'api-v2': { serve: ['node', FIXTURE_API_SERVER_V2], healthPath: '/v2/health' },
      },
      defaultServer: 'web',
      seed: { provides: { credentials: { 'v2-key': { header: 'Authorization', servers: ['api-v2'] } } } },
    })
    writeScenario(
      r,
      'api/v2.yaml',
      apiScenario({
        id: 'v2-authenticated',
        server: 'api-v2',
        steps: [
          {
            request: { method: 'GET', path: '/v2/echo', headers: { Authorization: '{{cred:v2-key}}' } },
            expect: { status: 200, json: { authorization: { equals: SECRET } } },
          },
        ],
      }),
    )
    writeScenario(
      r,
      'api/web.yaml',
      apiScenario({
        id: 'web-borrows-it',
        binds: specBinds('cli/version'),
        steps: [
          {
            request: { method: 'GET', path: '/echo-auth', headers: { Authorization: '{{cred:v2-key}}' } },
            expect: { status: 200 },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const byId = new Map(res.latest.scenarios.map((s) => [s.id, s]))
    expect(byId.get('v2-authenticated')!.outcome).toBe('pass')
    const web = byId.get('web-borrows-it')!
    expect(web.outcome).toBe('error')
    expect(web.failure!.actual).toContain('"api-v2"')
  })
})
