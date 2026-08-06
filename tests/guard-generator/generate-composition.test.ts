/**
 * COMPOSITION validation — the rules the scenario schema accepts but the engine
 * cannot execute, checked before a draft is ever executed: on the cli surface the
 * worker's `run_scenario` tool answers a defective draft `invalid` (no sandbox
 * spend) and the session corrects itself; on the api surface the same defect
 * routes through the one-shot corrective re-ask. They are per driver, because the
 * two surfaces compose differently:
 *
 *  - cli — `run` is argv APPENDED to the recipe entrypoint, so `run[0]` must be an
 *    argument, never the program's own name and never a foreign binary;
 *  - api — a journey is a chain: a `${var}` must come from an EARLIER step's
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
import type { GuardApiStep, GuardStep } from '@truecourse/shared'
import type { LlmTurnFn } from '@truecourse/shared/llm'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  extractBy,
  runGenerate,
  turnReply,
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
    expect(scenarioCompositionDefect({ driver: 'cli', steps: [step(['npm'])] }, undefined)).toBeNull()
    expect(scenarioCompositionDefect({ driver: 'cli', steps: [step(['npm'])] }, [])).toBeNull()
  })
})

describe('apiCompositionDefect — a journey has to chain with itself', () => {
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

/** A scripted cli session drafting `stepsFor(draft)` each time it is asked, and
 *  settling once a run passes. Records every tool result the session saw. */
function draftingSession(stepsFor: (draft: number) => unknown[]): {
  turnFn: LlmTurnFn
  toolResults: string[]
  draftCount: () => number
} {
  const toolResults: string[] = []
  let drafts = 0
  const turnFn: LlmTurnFn = async (req) => {
    const last = req.messages[req.messages.length - 1]
    if (last?.role === 'user' && last.text.startsWith('run_scenario result:')) {
      toolResults.push(last.text)
      if (last.text.includes('"verdict": "pass"')) return turnReply({ outcome: { result: 'settled' } })
    }
    return turnReply({
      tool: 'run_scenario',
      args: { scenario: { title: 'version prints', driver: 'cli', steps: stepsFor(drafts++) } },
    })
  }
  return { turnFn, toolResults, draftCount: () => drafts }
}

describe('generateGuards — the composition defect is caught before any sandbox run', () => {
  it('answers the defective draft `invalid` in-session, and persists the corrected scenario', async () => {
    const r = seed()
    // Draft 1 composes a whole command line (the recipe entry is
    // `["node", "…/bin.mjs"]`); draft 2 returns argv only.
    const session = draftingSession((draft) =>
      draft === 0
        ? [{ run: ['node', 'bin.mjs', '--version'], expect: { exit: 0 }, milestone: 1 }]
        : [{ run: ['--version'], expect: { exit: 0 }, milestone: 1 }],
    )

    const res = await runGenerate({ repoRoot: r, extractRunner: extractBy({}), turnFn: session.turnFn })

    expect(session.draftCount()).toBe(2)
    // The first tool result carried the rule, not a sandbox verdict — the
    // defective draft cost no run.
    expect(session.toolResults[0]).toContain('"verdict": "invalid"')
    expect(session.toolResults[0]).toContain('repeats the entrypoint')
    expect(res.errors).toEqual([])
    expect(res.written.map((w) => w.flowId)).toEqual(['version'])
  })

  it('records ONE authoring error when the session never composes', async () => {
    const r = seed()
    const session = draftingSession(() => [
      { run: ['npm', 'run', 'version'], expect: { exit: 0 }, milestone: 1 },
    ])

    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: session.turnFn,
      workerBudget: { maxTurns: 3 },
    })

    // Every draft came back invalid, so the session ran out of turns without
    // settling: nothing is written, and the loss is ONE honest authoring error.
    expect(res.written).toEqual([])
    expect(session.toolResults.every((t) => t.includes('foreign binary'))).toBe(true)
    expect(res.errors.map((e) => e.anchor)).toEqual(['version'])
    expect(res.errors[0].kind).toBe('authoring')
    expect(res.errors[0].message).toContain('worker session ended: turn-budget')
  })
})
