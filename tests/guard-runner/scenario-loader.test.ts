import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { describeGuardScenarioSteps, guardScenarioDrivers, type GuardSandboxStep } from '@truecourse/shared'
import { loadScenarios, walkScenarioRelFiles, scenariosDir } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeScenario, writeScenarioFile, writeRecipe, scenario, apiScenario } from './helpers.js'

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
    writeScenarioFile(r, 'wrong.yaml', JSON.stringify({ id: 'x' }))

    const { scenarios, errors } = loadScenarios(r)
    expect(scenarios).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toContain('wrong.yaml')
  })

  it('accepts and drops the retired guard: version key, so pre-cut corpora keep loading', () => {
    const r = repo()
    writeRecipe(r)
    writeScenarioFile(
      r,
      'old.yaml',
      JSON.stringify({
        guard: 1,
        id: 'old',
        title: 'an older corpus',
        binds: [{ doc: 'docs/spec.md', section: 'a/b', fingerprint: 'sha256:x' }],
        normalize: [],
        steps: [{ run: ['--version'], expect: { exit: 0 } }],
      }),
    )

    const { scenarios, errors } = loadScenarios(r)
    expect(errors).toEqual([])
    expect(scenarios).toHaveLength(1)
    expect(scenarios[0].id).toBe('old')
    expect(scenarios[0]).not.toHaveProperty('guard')
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

describe('an upload step, through the loader', () => {
  it('round-trips through YAML with its locator, its bytes and its name', () => {
    const r = repo()
    writeRecipe(r)
    const step = {
      driver: 'web',
      upload: { role: 'button', name: 'Upload Document' },
      file: { base64: '{{fixture:doc.base64}}', as: 'contract-${unique}.pdf' },
      expect: { url: { contains: '/edit' }, text: { contains: 'contract-${unique}.pdf' } },
      milestone: 2,
    }
    writeScenario(
      r,
      'web/upload.yaml',
      scenario({ id: 'up', steps: [{ driver: 'web', navigate: '/documents' }, step] as GuardSandboxStep[] }),
    )

    const { scenarios, errors } = loadScenarios(r)
    expect(errors).toEqual([])
    // Byte-identical to what was written: nothing about the file is normalized away.
    expect(scenarios[0].steps[1]).toEqual(step)
  })

  it('a file with two byte sources is ONE load error, and the rest still loads', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 'ok.yaml', scenario({ id: 'ok', steps: [{ run: [], expect: { exit: 0 } }] }))
    writeScenario(
      r,
      'web/bad.yaml',
      scenario({
        id: 'bad',
        steps: [
          {
            driver: 'web',
            upload: { role: 'button', name: 'Attach' },
            file: { base64: 'aGk=', text: 'hi', as: 'a.txt' },
          },
        ] as GuardSandboxStep[],
      }),
    )

    const { scenarios, errors } = loadScenarios(r)
    expect(scenarios.map((s) => s.id)).toEqual(['ok'])
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toContain('bad.yaml')
  })

  it('wears the web kind and the web driver, like every other web verb', () => {
    const s = scenario({
      id: 'up',
      steps: [
        { run: ['version'], expect: { exit: 0 } },
        {
          driver: 'web',
          upload: { role: 'button', name: 'Upload Document' },
          file: { text: 'x', as: 'a.txt' },
          expect: { text: { contains: 'a.txt' } },
        },
      ] as GuardSandboxStep[],
    })
    expect(guardScenarioDrivers(s)).toEqual(['cli', 'web'])
    const views = describeGuardScenarioSteps(s)
    expect(views[1].kind).toBe('web')
    expect(views[1].command).toBe('upload “a.txt” to button “Upload Document”')
  })
})

describe('walkScenarioRelFiles — the corpus-membership rule', () => {
  it('includes the flow corpus, so a snapshotting store cannot lose it', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 'cli/a.yaml', scenario({ id: 'a', steps: [{ run: [], expect: { exit: 0 } }] }))
    const dir = scenariosDir(r)
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: 3, flows: [] }))
    fs.writeFileSync(
      path.join(dir, 'flows.json'),
      JSON.stringify({ version: 1, generatedAt: '2026-08-06T00:00:00.000Z', flows: [], noFlowClaims: [] }),
    )
    // Not a scenario body: it routes to the decisions store, and stays excluded.
    fs.writeFileSync(path.join(dir, 'decisions.json'), JSON.stringify({ version: 1, dismissedClaims: [] }))

    expect(walkScenarioRelFiles(dir)).toEqual(['cli/a.yaml', 'flows.json', 'manifest.json', 'recipe.json'])
  })

  it('takes flows.json only at the TOP level, like its siblings', () => {
    const r = repo()
    writeRecipe(r)
    const dir = scenariosDir(r)
    fs.mkdirSync(path.join(dir, 'cli'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'cli', 'flows.json'), '{}')

    expect(walkScenarioRelFiles(dir)).toEqual(['recipe.json'])
  })
})
