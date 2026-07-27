/**
 * Recipe discovery's ONE evidence retry: any verification failure — a dead
 * install, a broken build, a missing entry file, an entry that won't start — goes
 * back to the model as the engine's own report, verbatim, and the replacement
 * proposal is verified in full. One mechanism, asserted identically for all four
 * failure kinds; the engine never inspects WHICH kind it was.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { discoverRecipe, type RecipeProposal, type RecipeRunner } from '@truecourse/guard-generator'
import { makeTempRepo, rmrf, FIXTURE_BIN } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

function recipeFile(r: string): string {
  return path.join(r, '.truecourse', 'scenarios', 'recipe.json')
}

/** A proposal that verifies against the fixture CLI. */
const GOOD: RecipeProposal = { build: 'true', entry: ['node', FIXTURE_BIN] }

type RecipeCall = Parameters<RecipeRunner>[0]

/**
 * A runner answering with each scripted value in turn (an `Error` value throws),
 * recording every call it saw. A call past the script is itself a failure — the
 * retry budget is exactly one.
 */
function scripted(...answers: unknown[]): { runner: RecipeRunner; calls: RecipeCall[] } {
  const calls: RecipeCall[] = []
  const runner: RecipeRunner = async (input) => {
    calls.push(input)
    if (calls.length > answers.length) throw new Error(`unexpected recipe call #${calls.length}`)
    const answer = answers[calls.length - 1]
    if (answer instanceof Error) throw answer
    return answer
  }
  return { runner, calls }
}

/** A runner that must never be called (a cache hit, or a proposal already verified). */
const neverCalled: RecipeRunner = async () => {
  throw new Error('the recipe runner must not be called')
}

/** The four ways engine verification rejects a proposal — one row per kind. */
const KINDS: { name: string; bad: RecipeProposal; reason: RegExp }[] = [
  {
    name: 'install failed',
    bad: { install: 'false', build: 'true', entry: ['node', FIXTURE_BIN] },
    reason: /^install `false` failed/,
  },
  {
    name: 'build failed',
    bad: { build: 'false', entry: ['node', FIXTURE_BIN] },
    reason: /^build `false` failed/,
  },
  {
    name: 'entry file missing',
    bad: { build: 'true', entry: ['node', 'dist/cli.js'] },
    reason: /entry file not found: dist\/cli\.js/,
  },
  {
    name: 'entry preflight dead',
    bad: { build: 'true', entry: ['tc-guard-no-such-binary-xyz'] },
    reason: /did not answer to `--help`/,
  },
]

describe('discoverRecipe — the one evidence retry', () => {
  for (const kind of KINDS) {
    it(`re-asks ONCE with the verification report verbatim — ${kind.name}`, async () => {
      const r = repo()
      const { runner, calls } = scripted(kind.bad, kind.bad)

      const res = await discoverRecipe(r, runner)

      // A still-bad second proposal fails exactly as discovery failed before the
      // retry existed: verify-failed, the engine's diagnostic, no recipe written.
      expect(res.status).toBe('verify-failed')
      if (res.status !== 'verify-failed') return
      expect(res.reason).toMatch(kind.reason)
      expect(res.proposal).toEqual(kind.bad)
      expect(fs.existsSync(recipeFile(r))).toBe(false)

      // Exactly one retry, carrying the engine's OWN text — the same string the
      // caller surfaces, not a summary or a classification of it.
      expect(calls).toHaveLength(2)
      expect(calls[0].retry).toBeUndefined()
      expect(calls[1].retry?.failure).toBe(res.reason)
      expect(calls[1].retry?.proposal).toBe(JSON.stringify(kind.bad, null, 2))
    })
  }

  for (const kind of KINDS) {
    it(`a corrected proposal verifies and is written — after ${kind.name}`, async () => {
      const r = repo()
      const { runner, calls } = scripted(kind.bad, GOOD)

      const res = await discoverRecipe(r, runner)

      expect(res.status).toBe('discovered')
      expect(calls).toHaveLength(2)
      expect(JSON.parse(fs.readFileSync(recipeFile(r), 'utf-8'))).toEqual(GOOD)
    })
  }

  it('re-verifies the retried proposal in FULL — its install and build both run again', async () => {
    const r = repo()
    const { runner } = scripted(
      // Rejected on the entry-file check: the build produced nothing.
      { build: 'true', entry: ['node', 'dist/cli.js'] },
      {
        install: 'touch install-marker',
        // Only succeeds when the retried proposal's install ran first.
        build: `test -f install-marker && mkdir -p dist && cp ${JSON.stringify(FIXTURE_BIN)} dist/cli.mjs`,
        entry: ['node', 'dist/cli.mjs'],
      },
    )

    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('discovered')
    expect(fs.existsSync(path.join(r, 'install-marker'))).toBe(true)
    expect(fs.existsSync(path.join(r, 'dist', 'cli.mjs'))).toBe(true)
  })

  it('the dogfood case: the proposal names dist/cli.js, the build produced dist/cli.mjs', async () => {
    const r = repo()
    const build = `mkdir -p dist && cp ${JSON.stringify(FIXTURE_BIN)} dist/cli.mjs`
    const { runner, calls } = scripted(
      { build, entry: ['node', 'dist/cli.js'] },
      { build, entry: ['node', 'dist/cli.mjs'] },
    )

    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('discovered')
    // The retry sees the diagnostic the engine already produced — including the
    // listing of what the build DID write next to the missing path.
    const evidence = calls[1].retry!.failure
    expect(evidence).toContain('entry file not found: dist/cli.js')
    expect(evidence).toContain('dist/ contains: cli.mjs')
    expect(JSON.parse(fs.readFileSync(recipeFile(r), 'utf-8')).entry).toEqual(['node', 'dist/cli.mjs'])
  })

  it('a proposal that verifies is never re-asked', async () => {
    const r = repo()
    const { runner, calls } = scripted(GOOD)

    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('discovered')
    expect(calls).toHaveLength(1)
  })

  it('a retry the transport cannot serve leaves the original diagnostic exactly as it was', async () => {
    const r = repo()
    const bad: RecipeProposal = { install: 'false', build: 'true', entry: ['node', FIXTURE_BIN] }
    const { runner, calls } = scripted(bad, new Error('no LLM transport configured'))

    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('verify-failed')
    if (res.status !== 'verify-failed') return
    expect(res.reason).toMatch(/^install `false` failed/)
    expect(res.proposal).toEqual(bad)
    expect(calls).toHaveLength(2)
    expect(fs.existsSync(recipeFile(r))).toBe(false)
  })

  it('a retry whose output never validates leaves the original diagnostic, evidence riding its re-ask', async () => {
    const r = repo()
    const bad: RecipeProposal = { build: 'false', entry: ['node', FIXTURE_BIN] }
    const { runner, calls } = scripted(bad, { nope: true }, { still: 'not a recipe' })

    const res = await discoverRecipe(r, runner)

    expect(res.status).toBe('verify-failed')
    if (res.status !== 'verify-failed') return
    expect(res.reason).toMatch(/^build `false` failed/)
    expect(res.proposal).toEqual(bad)
    // The retry keeps its own corrective re-ask (the house pattern), and the
    // verification evidence rides that re-ask too.
    expect(calls).toHaveLength(3)
    expect(calls[2].retry?.failure).toBe(res.reason)
    expect(calls[2].correction).toBeDefined()
  })

  it('a verified retry proposal replaces the cached one — the retry gets no key of its own', async () => {
    const r = repo()
    const { runner } = scripted({ build: 'true', entry: ['node', 'dist/cli.js'] }, GOOD)
    expect((await discoverRecipe(r, runner)).status).toBe('discovered')

    // Same inputs, no recipe.json: the cache must answer with what VERIFIED, so no
    // call is made and no second discovery re-pays the retry.
    fs.rmSync(recipeFile(r))
    const again = await discoverRecipe(r, neverCalled)

    expect(again.status).toBe('discovered')
    if (again.status !== 'discovered') return
    expect(again.recipe.entry).toEqual(GOOD.entry)
  })

  it('a cached proposal that verifies is untouched — no call, no retry', async () => {
    const r = repo()
    const { runner, calls } = scripted(GOOD)
    expect((await discoverRecipe(r, runner)).status).toBe('discovered')
    expect(calls).toHaveLength(1)

    fs.rmSync(recipeFile(r))
    expect((await discoverRecipe(r, neverCalled)).status).toBe('discovered')
  })
})
