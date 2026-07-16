/**
 * Item 2 — authoring failures surface live via the `onAuthorFailure` hook, fired
 * the moment each attempt fails (a timeout, or invalid output twice), per affected
 * section. The CLI renders these immediately; the hook is optional so the dashboard
 * popup (which wires nothing) is unchanged.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { generateGuards, type GenerateRunner, type AuthorFailure } from '@truecourse/guard-generator'
import { makeTempRepo, rmrf, writeRecipe, writeDoc, writeCorpus, extractBy } from './helpers.js'
import { stubAuxRunners } from './helpers.js'

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
const DOC_CONTENT = '## version\n`relkit --version` prints the version and exits 0.'

function setup(r: string): void {
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
}

// Default extract: the single `version` section yields one cli claim to author.
const extract = extractBy({})

describe('onAuthorFailure (item 2)', () => {
  it('fires once for a timed-out authoring call — final, no retry', async () => {
    const r = repo()
    setup(r)
    const timeoutRunner: GenerateRunner = async () => {
      throw new Error('claude timed out after 600000ms')
    }
    const failures: AuthorFailure[] = []
    await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extract,
      generateRunner: timeoutRunner,
      onAuthorFailure: (f) => failures.push(f),
    })

    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ doc: DOC, anchor: 'version', attempt: 1, willRetry: false })
    expect(failures[0].reason).toBe('timed out after 10m')
  })

  it('fires twice for invalid output — the re-ask, then the final give-up', async () => {
    const r = repo()
    setup(r)
    // Never a valid batch array → invalid on the first call and the corrective re-ask.
    const invalidRunner: GenerateRunner = async () => ({ garbage: true })
    const failures: AuthorFailure[] = []
    await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extract,
      generateRunner: invalidRunner,
      onAuthorFailure: (f) => failures.push(f),
    })

    expect(failures.map((f) => ({ attempt: f.attempt, willRetry: f.willRetry, reason: f.reason }))).toEqual([
      { attempt: 1, willRetry: true, reason: 'invalid output' },
      { attempt: 2, willRetry: false, reason: 'invalid output twice' },
    ])
    for (const f of failures) expect(f).toMatchObject({ doc: DOC, anchor: 'version' })
  })

  it('is optional — a generate with no hook still completes (dashboard popup path)', async () => {
    const r = repo()
    setup(r)
    const timeoutRunner: GenerateRunner = async () => {
      throw new Error('claude timed out after 600000ms')
    }
    const result = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: extract, generateRunner: timeoutRunner })
    // The section stayed unsettled (authoring error), recorded — but nothing threw.
    expect(result.status).toBe('ok')
    expect(result.errors.some((e) => e.anchor === 'version')).toBe(true)
  })
})
