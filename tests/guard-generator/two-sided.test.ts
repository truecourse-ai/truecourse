/**
 * Item 1 — a two-sided claim (asserts both what DOES and what does NOT happen) is
 * authored as a two-sided test. The authoring RULE lives in the prompt (see
 * prompts.test.ts); here we exercise the pipeline end-to-end against the fixture CLI:
 * a two-sided scenario births clean and commits, and its committed steps cover BOTH
 * halves — the inclusion (declared env vars print their value) AND the exclusion
 * (undeclared vars are marked `(unset)`, feeding included + excluded in one run). A
 * capturing author runner confirms the two-sided claim reached authoring intact.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { generateGuards } from '@truecourse/guard-generator'
import type { RawGeneratedScenario, GenerateRunner, AuthorUserContext } from '@truecourse/guard-generator'
import { makeTempRepo, rmrf, writeRecipe, writeDoc, writeCorpus, raw, extractBy, faithfulReviewer, stubAuxRunners, authored } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

const DOC = 'docs/env.md'
// A genuinely two-sided claim: some inputs are included (declared vars), some excluded.
const CLAIM = '`relkit env` prints declared variables with their value but marks undeclared variables `(unset)`'
const DOC_CONTENT = ['## env', `${CLAIM}.`].join('\n')

/** A two-sided scenario: ONE invocation feeds a declared AND an undeclared var, and
 *  the `matches` assertion proves BOTH the inclusion and the exclusion at once. */
const TWO_SIDED: RawGeneratedScenario = raw(
  'env reports declared vars and marks undeclared unset',
  [
    {
      run: ['env', 'DECLARED', 'MISSING'],
      expect: { exit: 0, stdout: { matches: 'DECLARED=set-value\\nMISSING=\\(unset\\)' } },
    },
  ],
  { setup: { env: { DECLARED: 'set-value' } } },
)

/** An author runner that records the context it is handed, then authors the fixed
 *  two-sided scenario for every claim in the batch. */
function capturingAuthor(scenario: RawGeneratedScenario): { runner: GenerateRunner; calls: AuthorUserContext[] } {
  const calls: AuthorUserContext[] = []
  const runner: GenerateRunner = async (ctx) => {
    calls.push(ctx)
    return authored(ctx.claims.map((c) => ({ ref: c.ref, scenarios: [scenario] })))
  }
  return { runner, calls }
}

describe('generateGuards — two-sided claims commit a two-sided scenario (item 1)', () => {
  it('a two-sided scenario births clean, commits, and its steps cover both halves', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const { runner, calls } = capturingAuthor(TWO_SIDED)
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({ env: [{ claim: CLAIM }] }),
      generateRunner: runner,
      fidelityRunner: faithfulReviewer(),
    })

    // The two-sided scenario passed birth + fidelity and committed — no finding.
    expect(res.birthFindings).toEqual([])
    expect(res.written).toHaveLength(1)

    // The two-sided claim reached authoring intact (the exclusion half is in the text).
    expect(calls).toHaveLength(1)
    const presented = calls[0].claims[0].claim
    expect(presented).toContain('declared')
    expect(presented).toContain('but marks undeclared')

    // The committed scenario asserts BOTH halves in one run: the included var prints
    // its value AND the excluded var is observably marked `(unset)`.
    const yaml = fs.readFileSync(path.join(r, res.written[0].file), 'utf-8')
    expect(yaml).toContain('DECLARED=set-value') // inclusion half
    expect(yaml).toContain('MISSING=\\(unset\\)') // exclusion half, observably asserted
  })
})
