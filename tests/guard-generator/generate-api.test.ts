import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { spawnGenerateRunner, type AuthorUserContext, type GenerateRunner } from '@truecourse/guard-generator'
import { readManifest } from '@truecourse/guard-runner'
import { guardManifestSections } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeApiRecipe,
  writeDoc,
  writeCorpus,
  extractBy,
  authorBy,
  runGenerate,
  journeysOf,
  cliJourney,
  apiJourney,
  raw,
  rawApi,
  stampMilestones,
  PASSING_STEPS,
  PASSING_API_STEPS,
  FAILING_API_STEPS,
  FIXTURE_API_SERVER,
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

/** The api claim on `list`; `version` states nothing a driver can assert. */
const listExtract = extractBy({
  list: [{ driver: 'api', claim: 'GET /todos returns 200 with the list', reason: 'HTTP status + body' }],
  version: { untestable: 'covered elsewhere' },
})

describe('generateGuards — api surface authoring + birth', () => {
  it('authors, births, and persists an api scenario end to end', async () => {
    const r = repo()
    writeApiRecipe(r, { entry: null }) // api is the only prepared surface
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, apiJourney('GET', '/todos')),
      extractRunner: listExtract,
      generateRunner: authorBy({ list: rawApi('GET /todos answers 200 with the empty list', PASSING_API_STEPS) }),
    })

    expect(res.status).toBe('ok')
    expect(res.errors).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.written).toHaveLength(1)
    expect(res.written[0]).toMatchObject({ anchor: 'list', flowId: 'list', surface: 'api', id: 'list.api.1' })

    // The committed YAML is a valid api-driver scenario, bound to the flow's section.
    const file = path.join(r, res.written[0].file)
    const committed = yaml.load(fs.readFileSync(file, 'utf-8')) as {
      driver: string
      steps: unknown[]
      flow: { id: string }
      binds: { doc: string; section: string }[]
    }
    expect(committed.driver).toBe('api')
    expect(committed.steps).toHaveLength(1)
    expect(committed.flow.id).toBe('list')
    expect(committed.binds).toEqual([expect.objectContaining({ doc: DOC, section: 'list' })])

    const section = guardManifestSections(readManifest(r)).find((s) => s.anchor === 'list')!
    expect(section.scenarioIds).toEqual(['list.api.1'])
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'list')!.scenarios).toEqual([
      { id: 'list.api.1', surface: 'api', status: 'passing' },
    ])
  }, 60_000)

  it('a birth boot failure carries the server output (masked) into the persisted error', async () => {
    // The diagnosed cal.com failure: birth boots timed out and `errorFrom` discarded the
    // server's stdout/stderr, so result.json showed WHY nothing came up. The failed boot's
    // output must now survive on the error — with any resolved credential still redacted.
    const r = repo()
    const SECRET = 'sk-live-boot-secret-xyz'
    // Recipe declares a credential (value=SECRET) so the redactor is live; the run-level
    // preflight boot carries only recipe env, so it boots clean — the SCENARIO's setup.env
    // is what trips the fixture's fail-boot (echoing SECRET to prove masking).
    fs.mkdirSync(path.join(r, '.truecourse', 'scenarios'), { recursive: true })
    fs.writeFileSync(
      path.join(r, '.truecourse', 'scenarios', 'recipe.json'),
      JSON.stringify({
        build: 'true',
        api: {
          serve: ['node', FIXTURE_API_SERVER],
          healthPath: '/health',
          credentials: { leak: { header: 'Authorization', value: SECRET } },
        },
      }),
    )
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, apiJourney('GET', '/todos')),
      extractRunner: listExtract,
      generateRunner: authorBy({
        list: rawApi('the todos server comes up', PASSING_API_STEPS, {
          setup: { env: { TC_FAIL_BOOT: '1', TC_LEAK: SECRET } },
        }),
      }),
    })

    expect(res.status).toBe('ok')
    const err = res.errors.find((e) => e.message.includes('the todos server comes up'))
    expect(err).toBeDefined()
    // The distinctive boot line survived (fix 3): result.json now shows WHY it didn't boot.
    expect(err!.stderr).toContain('boot-fail: fixture refused to boot')
    // The credential the fixture echoed into boot output is masked, never raw.
    expect(err!.stdout ?? '').not.toContain(SECRET)
    expect(err!.stdout).toContain('«cred:leak»')
  }, 60_000)

  it('an api scenario asserting the claim against drifted code becomes a birth finding', async () => {
    const r = repo()
    writeApiRecipe(r, { entry: null })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, apiJourney('GET', '/boom')),
      extractRunner: extractBy({
        list: [{ driver: 'api', claim: 'GET /boom answers 200', reason: 'HTTP status' }],
        version: { untestable: 'covered elsewhere' },
      }),
      // Round 1 AND the retry both author the claim's (correct) assertion; the
      // fixture answers 500 → the disagreement is committed as a FAILING test.
      generateRunner: authorBy({ list: rawApi('GET /boom answers 200', FAILING_API_STEPS) }),
    })

    expect(res.status).toBe('ok')
    expect(res.written).toMatchObject([{ id: 'list.api.1', surface: 'api', status: 'failing' }])
    expect(res.birthFindings).toHaveLength(1)
    expect(res.birthFindings[0]).toMatchObject({
      anchor: 'list',
      flowId: 'list',
      surface: 'api',
      scenarioId: 'list.api.1',
      committed: true,
      expected: 'status 200',
      actual: 'status 500',
    })
    // The failing response body rides the result (the api analog of program output).
    expect(res.birthFindings[0].stdout).toContain('kaboom')
    // The flow SETTLED: the red test is committed with its status and an inputs hash,
    // so the next generate leaves it alone until an input moves.
    const entry = readManifest(r)!.flows.find((f) => f.flowId === 'list')!
    expect(entry.scenarios).toMatchObject([
      { id: 'list.api.1', surface: 'api', status: 'failing', diagnosis: { actual: 'status 500' } },
    ])
    expect(entry.generationInputsHash).not.toBeNull()
    expect(res.flows).toMatchObject({ settled: 1, unsettled: 0 })
  }, 60_000)

  it('authors a flow’s cli and api surfaces in separate single-driver calls', async () => {
    // One scenario per (flow, surface): a surface never rides another's authoring
    // call, so each call carries exactly one driver's framing and system prompt.
    const r = repo()
    writeApiRecipe(r) // prepares both cli (entry) and api (serve)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const calls: { flowId: string; driver: string; hasEntry: boolean; hasServe: boolean }[] = []
    const perSurface: GenerateRunner = async (ctx) => {
      calls.push({
        flowId: ctx.flow.id,
        driver: ctx.driver,
        hasEntry: ctx.recipeEntry !== undefined,
        hasServe: ctx.recipeServe !== undefined,
      })
      const scenario =
        ctx.driver === 'api'
          ? rawApi('GET /todos answers 200', PASSING_API_STEPS)
          : raw('relkit --version exits 0', PASSING_STEPS)
      return { scenario: stampMilestones(scenario, ctx.milestones.length) }
    }

    const res = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, cliJourney(['relkit']), apiJourney('GET', '/todos')),
      extractRunner: listExtract,
      generateRunner: perSurface,
    })

    expect(res.status).toBe('ok')
    expect(res.errors).toEqual([])
    // Two calls for the ONE flow — one per surface, never mixed.
    expect(calls).toHaveLength(2)
    expect(calls.every((c) => c.flowId === 'list')).toBe(true)
    expect(calls.map((c) => c.driver).sort()).toEqual(['api', 'cli'])
    // Each call is handed only its own surface's preparation.
    expect(calls.find((c) => c.driver === 'api')).toMatchObject({ hasEntry: false, hasServe: true })
    expect(calls.find((c) => c.driver === 'cli')).toMatchObject({ hasEntry: true, hasServe: false })

    // Both surfaces persist as their own scenario under the one flow.
    expect(res.written.map((w) => w.surface).sort()).toEqual(['api', 'cli'])
    expect(res.written.map((w) => w.id).sort()).toEqual(['list.api.1', 'list.cli.1'])
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'list')!.scenarios).toEqual([
      { id: 'list.api.1', surface: 'api', status: 'passing' },
      { id: 'list.cli.1', surface: 'cli', status: 'passing' },
    ])
  }, 60_000)

  it('a runnable surface with an EMPTY journey catalog settles as a no-journey gap', async () => {
    // The recipe prepares api, but nothing api-shaped was mapped from the code: the
    // flow is accounted for with a stated gap and nothing is authored for it.
    const r = repo()
    writeApiRecipe(r) // both surfaces prepared
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, cliJourney(['relkit'])), // cli only
      extractRunner: listExtract,
      generateRunner: authorBy({ list: raw('relkit --version exits 0', PASSING_STEPS) }),
    })

    expect(res.written.map((w) => w.surface)).toEqual(['cli'])
    const gap = res.coverageGaps.find((g) => g.flowId === 'list' && g.surface === 'api')!
    expect(gap.kind).toBe('no-journey')
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'list')!.gaps).toEqual([
      expect.objectContaining({ surface: 'api', kind: 'no-journey' }),
    ])
  }, 60_000)
})

describe('spawnGenerateRunner — per-driver system prompt', () => {
  it('sends the api authoring prompt for an api scenario and the cli one otherwise', async () => {
    const systems: string[] = []
    const transport = async (input: { system: string }): Promise<string> => {
      systems.push(input.system)
      return '{"blockedOn":["nothing"]}'
    }
    const runner = spawnGenerateRunner({ transport: transport as never })
    const base: Omit<AuthorUserContext, 'driver'> = {
      flow: { id: 'list', title: 'list the todos', goal: 'a user sees their todos' },
      milestones: [
        { order: 1, claim: 'GET /todos returns 200', doc: 'docs/api.md', sectionHeading: 'list', sectionText: '', realization: [] },
      ],
      journeyPath: ['api/get-todos'],
      areaTags: [],
      recipeBuild: 'true',
    }
    await runner({ ...base, driver: 'api', recipeServe: ['node', 'server.js'], recipeHealthPath: '/health' })
    await runner({ ...base, driver: 'cli', recipeEntry: ['node', 'cli.js'] })
    expect(systems[0]).toContain('HTTP service')
    expect(systems[0]).toContain('"api"')
    expect(systems[1]).toContain('command-line program')
  })
})
