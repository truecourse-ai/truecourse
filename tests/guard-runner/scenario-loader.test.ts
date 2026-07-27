import { describe, it, expect, afterEach } from 'vitest'
import { loadScenarios } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeScenario, writeScenarioFile, writeRecipe, scenario } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

describe('loadScenarios', () => {
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
})
