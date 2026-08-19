import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { readManifest } from '@truecourse/guard-runner'
import { GuardScenarioSchema, guardManifestSections, guardScenarioDrivers } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeApiRecipe,
  writeDoc,
  writeCorpus,
  extractSessionBy,
  submitWorkerSessions,
  runGenerate,
  interfacesOf,
  cliInterface,
  apiInterface,
  raw,
  rawApi,
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
const listExtract = extractSessionBy({
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
      interfaces: interfacesOf(r, apiInterface('GET', '/todos')),
      extractSession: listExtract,
      flowWorkerSession: submitWorkerSessions(() => rawApi('GET /todos answers 200 with the empty list', PASSING_API_STEPS)),
    })

    expect(res.status).toBe('ok')
    expect(res.errors).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.written).toHaveLength(1)
    expect(res.written[0]).toMatchObject({ anchor: 'list', flowId: 'list', surface: 'api', id: 'list' })

    // The committed YAML is a valid api scenario, bound to the flow's section — and
    // it declares NO scenario-level driver: the surface is read off its steps.
    const file = path.join(r, res.written[0].file)
    const committed = yaml.load(fs.readFileSync(file, 'utf-8')) as {
      steps: unknown[]
      flow: { id: string }
      binds: { doc: string; section: string }[]
    }
    expect('driver' in committed).toBe(false)
    expect(guardScenarioDrivers(GuardScenarioSchema.parse(committed))).toEqual(['api'])
    expect(committed.steps).toHaveLength(1)
    expect(committed.flow.id).toBe('list')
    expect(committed.binds).toEqual([expect.objectContaining({ doc: DOC, section: 'list' })])

    const section = guardManifestSections(readManifest(r)).find((s) => s.anchor === 'list')!
    expect(section.scenarioIds).toEqual(['list'])
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'list')!.scenarios).toEqual([
      { id: 'list', drivers: ['api'], status: 'passing' },
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
      interfaces: interfacesOf(r, apiInterface('GET', '/todos')),
      extractSession: listExtract,
      flowWorkerSession: submitWorkerSessions(() =>
        rawApi('the todos server comes up', PASSING_API_STEPS, {
          setup: { env: { TC_FAIL_BOOT: '1', TC_LEAK: SECRET } },
        }),
      ),
    })

    expect(res.status).toBe('ok')
    // On the worker path the boot failure comes back through `submit_scenario`'s
    // rendered report; the run records ONE error for the (flow, surface), built
    // from the BIRTH CAPTURE — so the output excerpts ride the STRUCTURED fields
    // and not only the free text.
    const err = res.errors.find((e) => e.flowId === 'list' && e.surface === 'api')
    expect(err).toBeDefined()
    expect(err!.kind).toBe('birth')
    // The distinctive boot line survived: result.json still shows WHY it didn't boot.
    expect(err!.stderr).toContain('boot-fail: fixture refused to boot')
    expect(err!.message).toContain('boot-fail: fixture refused to boot')
    // The credential the fixture echoed into boot output is masked, never raw.
    expect(err!.stdout ?? '').not.toContain(SECRET)
    expect(err!.stdout).toContain('«cred:leak»')
    expect(err!.message).not.toContain(SECRET)
  }, 60_000)

  it('an api scenario asserting the claim against drifted code becomes a birth finding', async () => {
    const r = repo()
    writeApiRecipe(r, { entry: null })
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, apiInterface('GET', '/boom')),
      extractSession: extractSessionBy({
        list: [{ driver: 'api', claim: 'GET /boom answers 200', reason: 'HTTP status' }],
        version: { untestable: 'covered elsewhere' },
      }),
      // The worker authors the claim's (correct) assertion; the fixture answers
      // 500, so it DECLARES the red and the disagreement commits as a failing test.
      flowWorkerSession: submitWorkerSessions(() => ({ red: rawApi('GET /boom answers 200', FAILING_API_STEPS) })),
    })

    expect(res.status).toBe('ok')
    expect(res.written).toMatchObject([{ id: 'list', surface: 'api', status: 'failing' }])
    expect(res.birthFindings).toHaveLength(1)
    expect(res.birthFindings[0]).toMatchObject({
      anchor: 'list',
      flowId: 'list',
      surface: 'api',
      scenarioId: 'list',
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
      { id: 'list', drivers: ['api'], status: 'failing', diagnosis: { actual: 'status 500' } },
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

    const calls: { flowId: string; surface: string; briefing: string }[] = []

    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, cliInterface(['relkit']), apiInterface('GET', '/todos')),
      extractSession: listExtract,
      flowWorkerSession: submitWorkerSessions(
        (task) =>
          task.surface === 'api'
            ? rawApi('GET /todos answers 200', PASSING_API_STEPS)
            : raw('relkit --version exits 0', PASSING_STEPS),
        { onBriefing: (task, briefing) => calls.push({ flowId: task.flowId, surface: task.surface, briefing }) },
      ),
    })

    expect(res.status).toBe('ok')
    expect(res.errors).toEqual([])
    // Two WORKERS for the ONE flow — one per surface, never mixed.
    expect(calls).toHaveLength(2)
    expect(calls.every((c) => c.flowId === 'list')).toBe(true)
    expect(calls.map((c) => c.surface).sort()).toEqual(['api', 'cli'])
    // Each worker is briefed only on its own surface's preparation.
    const api = calls.find((c) => c.surface === 'api')!
    const cli = calls.find((c) => c.surface === 'cli')!
    expect(api.briefing).toContain('Service serve command:')
    expect(api.briefing).not.toContain('Program entrypoint:')
    expect(cli.briefing).toContain('Program entrypoint:')
    expect(cli.briefing).not.toContain('Service serve command:')

    // Both surfaces persist as their own scenario under the one flow.
    expect(res.written.map((w) => w.surface).sort()).toEqual(['api', 'cli'])
    expect(res.written.map((w) => w.id).sort()).toEqual(['list', 'list.2'])
    const persisted = readManifest(r)!
      .flows.find((f) => f.flowId === 'list')!
      .scenarios.map((s) => ({ id: s.id, drivers: s.drivers }))
    expect(persisted.map((s) => s.id).sort()).toEqual(['list', 'list.2'])
    expect(persisted.map((s) => s.drivers).sort()).toEqual([['api'], ['cli']])
  }, 60_000)

  it('a runnable surface with an EMPTY interface catalog settles as a no-interface gap', async () => {
    // The recipe prepares api, but nothing api-shaped was mapped from the code: the
    // flow is accounted for with a stated gap and nothing is authored for it.
    const r = repo()
    writeApiRecipe(r) // both surfaces prepared
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await runGenerate({
      repoRoot: r,
      interfaces: interfacesOf(r, cliInterface(['relkit'])), // cli only
      extractSession: listExtract,
      flowWorkerSession: submitWorkerSessions(() => raw('relkit --version exits 0', PASSING_STEPS)),
    })

    expect(res.written.map((w) => w.surface)).toEqual(['cli'])
    const gap = res.coverageGaps.find((g) => g.flowId === 'list' && g.surface === 'api')!
    expect(gap.kind).toBe('no-interface')
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'list')!.gaps).toEqual([
      expect.objectContaining({ surface: 'api', kind: 'no-interface' }),
    ])
  }, 60_000)
})

// `spawnGenerateRunner` is RETIRED (plan 04 step 20): the per-driver system
// prompt is now the flow-worker session's, pinned in
// `tests/core/guard-generate-worker-seam.test.ts` ("authors each surface under
// its own prompt").
