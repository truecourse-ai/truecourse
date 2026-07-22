import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
    writeScenarioFile(r, 'wrong.yaml', JSON.stringify({ guard: 1, id: 'x', driver: 'cli' }))

    const { scenarios, errors } = loadScenarios(r)
    expect(scenarios).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toContain('wrong.yaml')
  })

  it('rejects a committed scenario whose expect regex does not compile, naming file + step + pattern', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 'cli/ok.yaml', scenario({ id: 'ok', steps: [{ run: ['--version'], expect: { exit: 0 } }] }))
    // A Python-style named group — invalid in the JS engine the runner compiles with.
    writeScenario(
      r,
      'cli/bad.yaml',
      scenario({ id: 'bad', steps: [{ run: ['lint'], expect: { exit: 1, stdout: { matches: '(?P<num>\\d+)' } } }] }),
    )

    const { scenarios, errors } = loadScenarios(r)
    // The valid scenario loads; the bad one is a loud load error, not a silent drop or crash.
    expect(scenarios.map((s) => s.id)).toEqual(['ok'])
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toContain('bad.yaml')
    expect(errors[0].message).toContain('step 1')
    expect(errors[0].message).toContain('(?P<num>')
    expect(errors[0].message).toContain('not a valid regular expression')
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

describe('corpus pack exclusion', () => {
  it('never parses corpus pack files as scenarios, even yaml-formatted exemplars', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-loader-corpus-'))
    try {
      const dir = path.join(repo, '.truecourse', 'scenarios')
      fs.mkdirSync(path.join(dir, 'corpus', 'sup-versions-abc12345'), { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'corpus', 'sup-versions-abc12345', 'exemplar-01.yaml'),
        'openapi: 3.0.0\ninfo:\n  title: not a scenario\n',
      )
      fs.mkdirSync(path.join(dir, 'core-cli'), { recursive: true })
      fs.writeFileSync(
        path.join(dir, 'core-cli', 'usage.1.yaml'),
        [
          'guard: 1',
          'id: usage.1',
          'title: prints usage',
          'binds:',
          '  doc: README.md',
          '  section: usage',
          "  fingerprint: 'sha256:x'",
          'driver: cli',
          'steps:',
          '  - run: ["--help"]',
          '    expect:',
          '      exit: 0',
        ].join('\n'),
      )

      const loaded = loadScenarios(repo)
      expect(loaded.errors).toEqual([])
      expect(loaded.scenarios.map((s) => s.id)).toEqual(['usage.1'])
    } finally {
      fs.rmSync(repo, { recursive: true, force: true })
    }
  })
})
