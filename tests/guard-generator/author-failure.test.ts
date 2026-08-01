/**
 * Authoring failures surface LIVE via the `onAuthorFailure` hook, fired the moment
 * each attempt fails. Authoring is one call per (flow, surface) and a failing call
 * never ticks the settle counter, so without this a flow that is timing out is
 * indistinguishable from a slow one. The hook is optional: a caller that surfaces
 * nothing (the dashboard popup) wires nothing and behaves exactly as before.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { type GenerateRunner, type AuthorFailure } from '@truecourse/guard-generator'
import { makeTempRepo, rmrf, writeRecipe, writeDoc, writeCorpus, extractBy, runGenerate } from './helpers.js'

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

/** Run generate with the deterministic seams the failure hook is measured through. */
async function run(r: string, generateRunner: GenerateRunner, onAuthorFailure?: (f: AuthorFailure) => void) {
  return runGenerate({
    repoRoot: r,
    extractRunner: extractBy({}),
    generateRunner,
    ...(onAuthorFailure ? { onAuthorFailure } : {}),
  })
}

describe('onAuthorFailure', () => {
  it('fires once for a timed-out authoring call — final, no retry', async () => {
    const failures: AuthorFailure[] = []
    await run(
      seed(),
      async () => {
        throw new Error('claude timed out after 600000ms')
      },
      (f) => failures.push(f),
    )

    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ flowId: 'version', surface: 'cli', attempt: 1, willRetry: false, doc: DOC })
    expect(failures[0].reason).toBe('timed out after 10m')
    expect(failures[0].flowTitle).toBeTruthy()
  })

  it('fires twice for invalid output — the re-ask, then the final give-up', async () => {
    const failures: AuthorFailure[] = []
    await run(seed(), async () => ({ garbage: true }), (f) => failures.push(f))

    expect(failures.map((f) => ({ attempt: f.attempt, willRetry: f.willRetry, reason: f.reason }))).toEqual([
      { attempt: 1, willRetry: true, reason: 'invalid output' },
      { attempt: 2, willRetry: false, reason: 'invalid output twice' },
    ])
    for (const f of failures) expect(f).toMatchObject({ flowId: 'version', surface: 'cli' })
  })

  it('is optional — a generate with no hook still completes and records the error', async () => {
    const res = await run(seed(), async () => {
      throw new Error('claude timed out after 600000ms')
    })

    expect(res.status).toBe('ok')
    expect(res.errors.some((e) => e.flowId === 'version' && e.kind === 'authoring')).toBe(true)
  })
})
