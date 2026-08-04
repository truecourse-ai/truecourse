import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { loadScenarios } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeScenario, writeScenarioFile, writeRecipe, scenario, apiScenario } from './helpers.js'

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

describe('loadScenarios', () => {
  it('loads an adjacent seed sidecar as a companion of a seeded API scenario', () => {
    const r = repo()
    const seeded = apiScenario({
      id: 'seeded-api',
      setup: { seed: { provides: { fixtures: { booking: ['id'] } } } },
      steps: [{ request: { method: 'GET', path: '/bookings/{{fixture:booking.id}}' }, expect: { status: 200 } }],
    })
    writeScenario(r, 'bookings/seeded-api.yaml', seeded)
    writeScenarioFile(r, 'bookings/seeded-api.seed.mjs', 'await Promise.resolve()\n')

    const loaded = loadScenarios(r)

    expect(loaded.errors).toEqual([])
    expect(loaded.artifacts).toHaveLength(1)
    expect(loaded.artifacts[0].companions).toEqual({
      '.truecourse/scenarios/bookings/seeded-api.seed.mjs': 'await Promise.resolve()\n',
    })
  })

  it('reports a seeded scenario whose derived adjacent sidecar is missing', () => {
    const r = repo()
    writeScenario(
      r,
      'bookings/missing.yaml',
      apiScenario({
        id: 'missing-seed',
        setup: { seed: { provides: { fixtures: { booking: ['id'] } } } },
        steps: [{ request: { method: 'GET', path: '/bookings' }, expect: { status: 200 } }],
      }),
    )

    const loaded = loadScenarios(r)

    expect(loaded.scenarios).toEqual([])
    expect(loaded.errors).toEqual([
      {
        file: '.truecourse/scenarios/bookings/missing.yaml',
        message: 'scenario declares setup.seed but adjacent sidecar "bookings/missing.seed.mjs" is missing',
      },
    ])
  })

  it('records a sidecar filesystem race without crashing or hiding other scenarios', () => {
    const r = repo()
    writeScenario(
      r,
      'bookings/racy.yaml',
      apiScenario({
        id: 'racy-seed',
        setup: { seed: { provides: { fixtures: { booking: ['id'] } } } },
        steps: [{ request: { method: 'GET', path: '/bookings' }, expect: { status: 200 } }],
      }),
    )
    const sidecar = path.join(r, '.truecourse', 'scenarios', 'bookings', 'racy.seed.mjs')
    writeScenarioFile(r, 'bookings/racy.seed.mjs', 'await Promise.resolve()\n')
    writeScenario(r, 'cli/good.yaml', scenario({ id: 'good', steps: [{ run: [], expect: { exit: 0 } }] }))
    const realStat = fs.statSync
    vi.spyOn(fs, 'statSync').mockImplementation(((file: fs.PathLike, ...args: unknown[]) => {
      if (String(file) === sidecar) {
        fs.rmSync(sidecar)
        throw Object.assign(new Error('sidecar disappeared'), { code: 'ENOENT' })
      }
      return realStat(file, ...(args as []))
    }) as typeof fs.statSync)

    const loaded = loadScenarios(r)

    expect(loaded.scenarios.map((item) => item.id)).toEqual(['good'])
    expect(loaded.errors).toEqual([
      expect.objectContaining({
        file: '.truecourse/scenarios/bookings/racy.yaml',
        message: expect.stringContaining('sidecar disappeared'),
      }),
    ])
  })

  it('reports an orphan seed sidecar with no declaring YAML scenario', () => {
    const r = repo()
    writeScenarioFile(r, 'bookings/orphan.seed.mjs', 'await Promise.resolve()\n')

    const loaded = loadScenarios(r)

    expect(loaded.scenarios).toEqual([])
    expect(loaded.errors).toEqual([
      {
        file: '.truecourse/scenarios/bookings/orphan.seed.mjs',
        message: 'orphan scenario seed sidecar has no adjacent YAML declaring setup.seed',
      },
    ])
  })

  it('returns each parsed scenario with its YAML source identity and source bytes', () => {
    const r = repo()
    const source = JSON.stringify(
      scenario({ id: 'source-backed', steps: [{ run: ['--version'], expect: { exit: 0 } }] }),
    )
    writeScenarioFile(r, 'cli/source-backed.yaml', source)

    const loaded = loadScenarios(r)

    expect(loaded.errors).toEqual([])
    expect(loaded.artifacts).toHaveLength(1)
    expect(loaded.artifacts[0]).toMatchObject({
      scenario: { id: 'source-backed' },
      source: {
        path: '.truecourse/scenarios/cli/source-backed.yaml',
        content: source,
      },
      companions: {},
    })
  })

  it('loads valid scenarios and skips recipe.json', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 'cli/a.yaml', scenario({ id: 'a', steps: [{ run: ['--version'], expect: { exit: 0 } }] }))
    writeScenario(r, 'cli/b.yaml', scenario({ id: 'b', steps: [{ run: ['whoami'], expect: { exit: 0 } }] }))

    const { scenarios, errors } = loadScenarios(r)
    expect(errors).toEqual([])
    expect(scenarios.map((s) => s.id).sort()).toEqual(['a', 'b'])
  })

  it('records a malformed YAML file as a load error, leaving valid ones intact', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 'ok.yaml', scenario({ id: 'ok', steps: [{ run: [], expect: { exit: 0 } }] }))
    writeScenarioFile(r, 'bad.yaml', 'guard: 1\n  : : broken indentation\n:::')

    const { scenarios, errors } = loadScenarios(r)
    expect(scenarios.map((s) => s.id)).toEqual(['ok'])
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toContain('bad.yaml')
  })

  it('records a schema-invalid file as a load error (never a crash)', () => {
    const r = repo()
    writeRecipe(r)
    writeScenarioFile(r, 'wrong.yaml', JSON.stringify({ guard: 2, id: 'x', driver: 'cli' }))

    const { scenarios, errors } = loadScenarios(r)
    expect(scenarios).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toContain('wrong.yaml')
  })

  it('rejects an out-of-date scenario format with one actionable line, not a schema dump', () => {
    const r = repo()
    writeRecipe(r)
    // A v1 file: single-object `binds`, no flow/journey refs.
    writeScenarioFile(
      r,
      'old.yaml',
      JSON.stringify({
        guard: 1,
        id: 'old',
        title: 'an older corpus',
        binds: { doc: 'docs/spec.md', section: 'a/b', fingerprint: 'sha256:x' },
        driver: 'cli',
        steps: [{ run: ['--version'], expect: { exit: 0 } }],
      }),
    )

    const { scenarios, errors } = loadScenarios(r)
    expect(scenarios).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toContain('old.yaml')
    expect(errors[0].message).toBe(
      'scenario format v1 is no longer supported (this build reads guard: 2) — re-run `truecourse guard generate` to re-author the corpus in the current format',
    )
    // One line, and never the per-field zod noise the version change would produce.
    expect(errors[0].message.split('\n')).toHaveLength(1)
    expect(errors[0].message).not.toContain('binds:')
  })

  it('flags duplicate ids and keeps the first', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 'one.yaml', scenario({ id: 'dup', steps: [{ run: [], expect: { exit: 0 } }] }))
    writeScenario(r, 'two.yaml', scenario({ id: 'dup', steps: [{ run: [], expect: { exit: 0 } }] }))

    const { scenarios, errors } = loadScenarios(r)
    expect(scenarios).toHaveLength(1)
    expect(errors.some((e) => e.message.includes('duplicate scenario id'))).toBe(true)
  })

  it('returns nothing for a repo with no scenarios dir', () => {
    const r = repo()
    const { scenarios, errors } = loadScenarios(r)
    expect(scenarios).toEqual([])
    expect(errors).toEqual([])
  })

  // A `matches` source the schema accepts but `new RegExp` rejects would throw (a
  // log matcher) or never match (stream/body/json) mid-run, after the sandbox has
  // already been paid for.
  it('rejects a hand-written cli scenario whose expect regex does not compile', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 'ok.yaml', scenario({ id: 'ok', steps: [{ run: [], expect: { exit: 0 } }] }))
    writeScenario(
      r,
      'bad.yaml',
      scenario({ id: 'bad', steps: [{ run: ['ls'], expect: { stdout: { matches: 'added t[0-9' } } }] }),
    )

    const { scenarios, errors } = loadScenarios(r)
    expect(scenarios.map((s) => s.id)).toEqual(['ok'])
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toContain('bad.yaml')
    expect(errors[0].message).toContain('step 1 expect.stdout')
    expect(errors[0].message).toContain('not a valid regular expression')
  })

  it('rejects an api scenario whose json/log regex does not compile, naming where it sits', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'json.yaml',
      apiScenario({
        id: 'json',
        steps: [{ request: { method: 'GET', path: '/todos' }, expect: { json: { 'data.id': { matches: '(' } } } }],
      }),
    )
    writeScenario(
      r,
      'logs.yaml',
      apiScenario({ id: 'logs', steps: [{ logs: { stream: 'stdout', match: { pattern: 'a{2,1}' } } }] }),
    )

    const { scenarios, errors } = loadScenarios(r)
    expect(scenarios).toEqual([])
    expect(errors.map((e) => e.file.split('/').pop()).sort()).toEqual(['json.yaml', 'logs.yaml'])
    expect(errors.find((e) => e.file.endsWith('json.yaml'))!.message).toContain('expect.json.data.id')
    expect(errors.find((e) => e.file.endsWith('logs.yaml'))!.message).toContain('logs.match')
  })
})
