/**
 * Authoring failures surface LIVE via the `onAuthorFailure` hook, fired the moment
 * each attempt fails. A failing authoring unit never ticks the settle counter, so
 * without this a flow that is timing out is indistinguishable from a slow one. Both
 * surfaces report through it the same way: a WORKER SESSION fires once, when the
 * session ends without settling. The hook is optional: a caller that surfaces
 * nothing (the dashboard popup) wires nothing and behaves exactly as before.
 */
import { describe, it, expect, afterEach } from 'vitest'
import type { AuthorFailure } from '@truecourse/guard-generator'
import type { LlmTurnFn } from '@truecourse/shared/llm'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeApiRecipe,
  writeDoc,
  writeCorpus,
  extractBy,
  runGenerate,
  workerTurnBy,
  apiWorkerTurnBy,
  journeysOf,
  apiJourney,
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

const API_DOC = 'docs/api.md'
const API_CONTENT = ['## list', 'GET /todos returns 200 with the todo list.'].join('\n')

/** A cli-only repo: the one flow authors through a worker session. */
function seed(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, CONTENT)
  return r
}

/** An api-only repo: the one flow authors through its own worker session. */
function seedApi(): string {
  const r = repo()
  writeApiRecipe(r, { entry: null })
  writeCorpus(r, [{ ref: API_DOC }])
  writeDoc(r, API_DOC, API_CONTENT)
  return r
}

/** Run generate over the api surface with the failing worker turn fn under test. */
async function runApi(r: string, turnFn: LlmTurnFn, onAuthorFailure?: (f: AuthorFailure) => void) {
  return runGenerate({
    repoRoot: r,
    journeys: journeysOf(r, apiJourney('GET', '/todos')),
    extractRunner: extractBy({
      list: [{ driver: 'api', claim: 'GET /todos returns 200 with the list', reason: 'HTTP status' }],
    }),
    turnFn,
    ...(onAuthorFailure ? { onAuthorFailure } : {}),
  })
}

/** Run generate over the cli surface with the failing worker turn fn under test. */
async function runCli(r: string, turnFn: LlmTurnFn, onAuthorFailure?: (f: AuthorFailure) => void) {
  return runGenerate({
    repoRoot: r,
    extractRunner: extractBy({}),
    turnFn,
    ...(onAuthorFailure ? { onAuthorFailure } : {}),
  })
}

describe('onAuthorFailure', () => {
  it('fires ONCE for an api worker session whose turns time out — the session IS the attempt', async () => {
    const failures: AuthorFailure[] = []
    await runApi(
      seedApi(),
      apiWorkerTurnBy({ list: { throws: 'claude timed out after 600000ms' } }),
      (f) => failures.push(f),
    )

    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ flowId: 'list', surface: 'api', attempt: 1, willRetry: false, doc: API_DOC })
    expect(failures[0].reason).toMatch(/^worker session ended: /)
    expect(failures[0].reason).toContain('timed out after 10m')
    expect(failures[0].flowTitle).toBeTruthy()
  })

  it('fires ONCE for an api session whose replies never carry an action — malformed, in-loop re-ask spent', async () => {
    const failures: AuthorFailure[] = []
    await runApi(seedApi(), apiWorkerTurnBy({ list: { malformed: true } }), (f) => failures.push(f))

    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ flowId: 'list', surface: 'api', attempt: 1, willRetry: false })
    expect(failures[0].reason).toContain('malformed')
  })

  it('fires ONCE for a cli worker session that ended without settling — the session IS the attempt', async () => {
    const failures: AuthorFailure[] = []
    // Every turn throws: the loop retries once, then the session ends `turn-error`.
    await runCli(seed(), workerTurnBy({ version: { throws: 'transport is down' } }), (f) => failures.push(f))

    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ flowId: 'version', surface: 'cli', attempt: 1, willRetry: false, doc: DOC })
    expect(failures[0].reason).toMatch(/^worker session ended: /)
    expect(failures[0].reason).toContain('transport is down')
    expect(failures[0].flowTitle).toBeTruthy()
  })

  it('is optional — a generate with no hook still records the error', async () => {
    const res = await runCli(seed(), workerTurnBy({ version: { throws: 'transport is down' } }))

    // The repo's only authoring unit was lost, so the run aborts (`llm-failed`)
    // rather than reporting an empty settle — and the error is recorded either way,
    // which is what the hook being optional is about.
    expect(res.status).toBe('llm-failed')
    expect(res.errors.some((e) => e.flowId === 'version' && e.kind === 'authoring')).toBe(true)
  })
})
