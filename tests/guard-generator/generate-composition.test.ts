/**
 * COMPOSITION validation — the rules the scenario schema accepts but the engine
 * cannot execute. On the worker path (plan 04 step 17) they are part of
 * `run_scenario`/`submit_scenario`'s deterministic PRE-FLIGHT: a defect comes
 * back as the tool error WITHOUT an execution, and the session revises in-loop.
 * They are per driver, because the two surfaces compose differently:
 *
 *  - cli — `run` is argv APPENDED to the recipe entrypoint, so `run[0]` must be an
 *    argument, never the program's own name and never a foreign binary;
 *  - api — an interface is a chain: a `${var}` must come from an EARLIER step's
 *    capture, and a `${HTTP_STUB:…}` must name a stub the scenario declares.
 *
 * Left uncaught, every one of these dies as a run-level INFRASTRUCTURE error after
 * a sandbox, a build and (on api) a boot have been paid for — and reads like drift.
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  apiCompositionDefect,
  cliCompositionDefect,
  scenarioCompositionDefect,
} from '@truecourse/guard-generator'
import type { GuardApiStep, GuardStep, GuardWebStep } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  extractSessionBy,
  flowWorkerSessionOf,
  faithfulJudge,
  acceptedSha,
  scenarioYaml,
  PASSING_STEPS,
  raw,
  runGenerate,
  stampMilestones,
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

const DOC = 'docs/cli.md'
const CONTENT = ['## version', '`relkit --version` prints the version and exits 0.'].join('\n')

function seed(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, CONTENT)
  return r
}

const step = (run: string[]): GuardStep => ({ run, expect: { exit: 0 } })
const request = (path: string, over: Partial<GuardApiStep> = {}): GuardApiStep =>
  ({ request: { method: 'GET', path }, expect: { status: 200 }, ...over }) as GuardApiStep

describe('cliCompositionDefect — `run` is argv, not a command line', () => {
  const entry = ['node', 'dist/relkit.js']

  it('accepts argv that starts with a subcommand or a flag', () => {
    expect(cliCompositionDefect([step(['--version']), step(['check', '--strict'])], entry)).toBeNull()
    // An empty argv runs the bare entrypoint — legitimate, and not a head at all.
    expect(cliCompositionDefect([step([])], entry)).toBeNull()
  })

  it('rejects a step that re-states the program — by name, basename or stem', () => {
    for (const head of ['relkit', 'dist/relkit.js', 'relkit.js']) {
      const defect = cliCompositionDefect([step([head, '--version'])], entry)
      expect(defect, head).toContain('repeats the entrypoint')
      expect(defect, head).toContain('argv APPENDED')
    }
  })

  it('rejects a foreign build/package/runtime binary as the head', () => {
    expect(cliCompositionDefect([step(['npm', 'test'])], entry)).toContain('foreign binary "npm"')
    expect(cliCompositionDefect([step(['python3', '-m', 'x'])], entry)).toContain('foreign binary')
    // The offending STEP is named, so a long scenario points at one line.
    expect(cliCompositionDefect([step(['--version']), step(['cargo', 'run'])], entry)).toContain('step 2')
  })

  it('is skipped entirely when the recipe declares no cli entry', () => {
    expect(scenarioCompositionDefect({ steps: [step(['npm'])] }, undefined)).toBeNull()
    expect(scenarioCompositionDefect({ steps: [step(['npm'])] }, [])).toBeNull()
  })
})

describe('apiCompositionDefect — an interface has to chain with itself', () => {
  it('accepts a ${var} the previous step captured, from a body or a header', () => {
    expect(
      apiCompositionDefect(
        [
          request('/todos', { capture: { id: 'data.id' } } as Partial<GuardApiStep>),
          request('/todos/${id}'),
        ],
        undefined,
      ),
    ).toBeNull()
    expect(
      apiCompositionDefect(
        [
          request('/session', { captureHeaders: { token: 'x-auth-token' } } as Partial<GuardApiStep>),
          request('/me', { request: { method: 'GET', path: '/me', headers: { authorization: '${token}' } } } as Partial<GuardApiStep>),
        ],
        undefined,
      ),
    ).toBeNull()
  })

  it('rejects a ${var} no earlier step captures, and names what IS available', () => {
    const defect = apiCompositionDefect(
      [request('/todos', { capture: { id: 'data.id' } } as Partial<GuardApiStep>), request('/todos/${slug}')],
      undefined,
    )
    expect(defect).toContain('step 2')
    expect(defect).toContain('${slug}')
    expect(defect).toContain('${id}')
  })

  it('rejects a capture referenced BEFORE the step that makes it (order matters)', () => {
    const defect = apiCompositionDefect(
      [request('/todos/${id}'), request('/todos', { capture: { id: 'data.id' } } as Partial<GuardApiStep>)],
      undefined,
    )
    expect(defect).toContain('step 1')
    expect(defect).toContain('no step before this one captures anything')
  })

  it('never flags the engine’s own ${unique} token', () => {
    expect(
      apiCompositionDefect(
        [{ request: { method: 'POST', path: '/teams', json: { slug: 'team-${unique}' } }, expect: { status: 201 } } as GuardApiStep],
        undefined,
      ),
    ).toBeNull()
  })

  it('rejects an env var pointed at a stub the scenario never declares', () => {
    const defect = apiCompositionDefect([request('/todos')], {
      env: { WEATHER_URL: '${HTTP_STUB:weather}' },
      http: { billing: { routes: [{ method: 'GET', path: '/v1/x' }] } },
    })
    expect(defect).toContain('setup.env.WEATHER_URL')
    expect(defect).toContain('no stub named "weather"')
    expect(defect).toContain('billing')
  })

  it('accepts an env var pointed at a stub it does declare', () => {
    expect(
      apiCompositionDefect([request('/todos')], {
        env: { WEATHER_URL: '${HTTP_STUB:weather}' },
        http: { weather: { routes: [{ method: 'GET', path: '/v1/forecast' }] } },
      }),
    ).toBeNull()
  })
})

describe('generateGuards — the composition defect is the worker’s pre-flight', () => {
  it('bounces the draft in-session (no execution), and the corrected draft persists', async () => {
    const r = seed()
    const reports: { content: string; isError?: boolean }[] = []
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        // Round 1 composes a whole command line (the recipe entry is
        // `["node", "…/bin.mjs"]`); round 2 returns argv only.
        reports.push(
          await task.runScenario(
            scenarioYaml(stampMilestones(raw('version prints', [{ run: ['node', 'bin.mjs', '--version'], expect: { exit: 0 } }] as never), 1)),
          ),
        )
        const good = scenarioYaml(stampMilestones(raw('version prints', PASSING_STEPS), 1))
        const accepted = await task.submitScenario(good, [], faithfulJudge)
        reports.push(accepted)
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: acceptedSha(accepted)!, expectedReds: [] } }
      }),
    })

    expect(reports[0].isError).toBe(true)
    expect(reports[0].content).toContain('pre-flight defect (not executed)')
    expect(reports[0].content).toContain('repeats the entrypoint')
    expect(res.errors).toEqual([])
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
  }, 60_000)

  it('a foreign binary is refused the same way, on submit as on run', async () => {
    const r = seed()
    const foreign = scenarioYaml(
      stampMilestones(raw('version prints', [{ run: ['npm', 'run', 'version'], expect: { exit: 0 } }] as never), 1),
    )
    const reports: { content: string; isError?: boolean }[] = []
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        reports.push(await task.runScenario(foreign))
        reports.push(await task.submitScenario(foreign, [], faithfulJudge))
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 2, lastEvidence: 'cannot compose a step' } }
      }),
    })

    for (const report of reports) {
      expect(report.isError).toBe(true)
      expect(report.content).toContain('is the foreign binary "npm"')
    }
    expect(res.written).toEqual([])
  }, 60_000)
})

describe('scenarioCompositionDefect — partitioned by vocabulary (the web arm)', () => {
  const webNav: GuardWebStep = {
    driver: 'web',
    navigate: '/',
    expect: { visible: { role: 'heading', name: 'Board' } },
  }

  it('composes a mixed web + cli scenario instead of crashing on the web step', () => {
    // Pre-partition, a web step fell into the cli rule's `run[0]` read — a
    // TypeError inside the worker tool, not a verdict.
    expect(scenarioCompositionDefect({ steps: [webNav, step(['add', 'x'])] }, ['node', 'cli.js'])).toBeNull()
  })

  it('still catches a cli entrypoint repeat inside a mixed draft', () => {
    const defect = scenarioCompositionDefect({ steps: [webNav, step(['node', 'cli.js', 'add'])] }, ['node', 'cli.js'])
    expect(defect).toContain('repeats the entrypoint')
  })

  it('still catches an api ${var} with no earlier capture inside a mixed draft', () => {
    const defect = scenarioCompositionDefect(
      { steps: [webNav, request('/api/notes/${id}')] },
      ['node', 'cli.js'],
    )
    expect(defect).toContain('${id}')
  })

  it('web captures live in their own namespace — a request reading ${captured:…} is not the api rule’s business', () => {
    const captures: GuardWebStep = {
      driver: 'web',
      navigate: '/',
      capture: { noteId: { from: { role: 'link', name: 'Permalink' }, get: { attribute: 'href' } } },
    }
    expect(
      scenarioCompositionDefect({ steps: [captures, request('/api/notes/${captured:noteId}')] }, undefined),
    ).toBeNull()
  })
})
