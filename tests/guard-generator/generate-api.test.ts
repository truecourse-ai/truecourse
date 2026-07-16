import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { generateGuards, spawnGenerateRunner } from '@truecourse/guard-generator'
import { readManifest } from '@truecourse/guard-runner'
import {
  makeTempRepo,
  rmrf,
  writeApiRecipe,
  writeDoc,
  writeCorpus,
  extractBy,
  authorBy,
  raw,
  rawApi,
  PASSING_STEPS,
  PASSING_API_STEPS,
  FAILING_API_STEPS,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

const DOC = 'docs/api.md'
const DOC_CONTENT = [
  '## list',
  'GET /todos returns 200 with the todo list.',
  '',
  '## version',
  '`relkit --version` prints the version and exits 0.',
].join('\n')

describe('generateGuards — api driver authoring + birth', () => {
  it('authors, births, and persists an api scenario end to end', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      repoRoot: r,
      extractRunner: extractBy({
        list: [{ driver: 'api', claim: 'GET /todos returns 200 with the list', reason: 'HTTP status + body' }],
        version: { untestable: 'covered elsewhere' },
      }),
      generateRunner: authorBy({
        list: [rawApi('GET /todos answers 200 with the empty list', PASSING_API_STEPS)],
      }),
    })

    expect(res.status).toBe('ok')
    expect(res.errors).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.written).toHaveLength(1)
    expect(res.written[0].anchor).toBe('list')

    // The committed YAML is a valid api-driver scenario.
    const file = path.join(r, res.written[0].file)
    const committed = yaml.load(fs.readFileSync(file, 'utf-8')) as { driver: string; steps: unknown[] }
    expect(committed.driver).toBe('api')
    expect(committed.steps).toHaveLength(1)

    // The manifest classifies the section under the api driver.
    const section = readManifest(r)!.sections.find((s) => s.anchor === 'list')!
    expect(section.classification).toMatchObject({ driver: 'api' })
    expect(section.scenarioIds).toEqual(['list.1'])
  }, 60_000)

  it('an api scenario asserting the claim against drifted code becomes a birth finding', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      repoRoot: r,
      extractRunner: extractBy({
        list: [{ driver: 'api', claim: 'GET /boom answers 200', reason: 'HTTP status' }],
        version: { untestable: 'covered elsewhere' },
      }),
      // Round 1 AND the retry both author the claim's (correct) assertion; the
      // fixture answers 500 → the disagreement settles as a birth finding.
      generateRunner: authorBy({
        list: [rawApi('GET /boom answers 200', FAILING_API_STEPS)],
      }),
    })

    expect(res.status).toBe('ok')
    expect(res.written).toEqual([])
    expect(res.birthFindings).toHaveLength(1)
    expect(res.birthFindings[0]).toMatchObject({
      anchor: 'list',
      expected: 'status 200',
      actual: 'status 500',
    })
    // The failing response body rides the finding (the api analog of program output).
    expect(res.birthFindings[0].stdout).toContain('kaboom')
  }, 60_000)

  it('authors cli and api claims from one doc in separate single-driver batches', async () => {
    const r = repo()
    writeApiRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const batches: { driver: string; refs: number }[] = []
    const res = await generateGuards({
      repoRoot: r,
      extractRunner: extractBy({
        list: [{ driver: 'api', claim: 'GET /todos returns 200', reason: 'HTTP status' }],
        version: [{ driver: 'cli', claim: '`relkit --version` exits 0', reason: 'exit code' }],
      }),
      generateRunner: async (ctx) => {
        batches.push({ driver: ctx.driver, refs: ctx.claims.length })
        return ctx.claims.map((c) => ({
          ref: c.ref,
          scenarios:
            ctx.driver === 'api'
              ? [rawApi('GET /todos answers 200', PASSING_API_STEPS)]
              : [raw('relkit --version exits 0', PASSING_STEPS)],
        }))
      },
    })

    expect(res.status).toBe('ok')
    expect(res.errors).toEqual([])
    expect(res.written.map((w) => w.anchor).sort()).toEqual(['list', 'version'])
    // Two batches, one per driver — never mixed.
    expect(batches).toHaveLength(2)
    expect(batches.map((b) => b.driver).sort()).toEqual(['api', 'cli'])
  }, 60_000)
})

describe('spawnGenerateRunner — per-driver system prompt', () => {
  it('sends the api authoring prompt for api batches and the cli one otherwise', async () => {
    const systems: string[] = []
    const transport = async (input: { system: string }): Promise<string> => {
      systems.push(input.system)
      return '[]'
    }
    const runner = spawnGenerateRunner({ transport: transport as never })
    const base = {
      doc: 'docs/x.md',
      docContext: 'ctx',
      areaTags: [],
      recipeBuild: 'true',
      claims: [],
    }
    await runner({ ...base, driver: 'api', recipeServe: ['node', 'server.js'], recipeHealthPath: '/health' })
    await runner({ ...base, driver: 'cli', recipeEntry: ['node', 'cli.js'] })
    expect(systems[0]).toContain('HTTP service')
    expect(systems[0]).toContain('"api"')
    expect(systems[1]).toContain('command-line program')
  })
})
