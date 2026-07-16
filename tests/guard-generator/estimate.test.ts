import { describe, it, expect, afterEach } from 'vitest'
import { estimateGuardTokens } from '../../packages/core/src/services/llm/spec-estimate.js'
import { generateGuards } from '@truecourse/guard-generator'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  authorBy,
  PASSING_STEPS,
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
const DOC_CONTENT = [
  '## version',
  '`relkit --version` prints the version and exits 0.',
  '',
  '## background',
  'Design history; nothing externally observable here.',
].join('\n')

const extract = extractBy({ background: { untestable: 'bg' } })
const author = authorBy({ version: [raw('v', PASSING_STEPS)] })

describe('estimateGuardTokens', () => {
  it('cold: one extract call for the single work doc, recipe present ⇒ no discovery call', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const est = await estimateGuardTokens(r)
    expect(est.subjectLabel).toBe('2 sections')
    const extractStage = est.stages!.find((s) => s.stage === 'guardExtract')!
    expect(extractStage.calls).toBe(1) // one doc, one view (under budget)
    expect(est.stages!.find((s) => s.stage === 'guardRecipe')).toBeUndefined() // 0 calls dropped
    expect(est.stages!.find((s) => s.stage === 'guardAuthor')).toBeTruthy()
    expect(est.totalEstimatedTokens).toBeGreaterThan(0)
  })

  it('adds a recipe-discovery call when no recipe.json exists', async () => {
    const r = repo()
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    const est = await estimateGuardTokens(r)
    expect(est.stages!.find((s) => s.stage === 'guardRecipe')!.calls).toBe(1)
  })

  it('cache-aware: after a full generate every section is settled ⇒ empty estimate', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    await generateGuards({ repoRoot: r, extractRunner: extract, generateRunner: author })

    const est = await estimateGuardTokens(r)
    expect(est.subjectLabel).toBe('all 2 sections cached')
    expect(est.stages).toEqual([])
    expect(est.totalEstimatedTokens).toBe(0)
  })
})

// A doc with several cli-claim sections so batched (economical) vs per-claim (fast)
// authoring diverges.
const MANY_SECTIONS = [
  '## a',
  '`relkit a` does A and exits 0.',
  '',
  '## b',
  '`relkit b` does B and exits 0.',
  '',
  '## c',
  '`relkit c` does C and exits 0.',
  '',
  '## d',
  '`relkit d` does D and exits 0.',
].join('\n')

describe('estimateGuardTokens — fast vs economical (item 5)', () => {
  const authorStage = (est: Awaited<ReturnType<typeof estimateGuardTokens>>) =>
    est.stages!.find((s) => s.stage === 'guardAuthor')!

  it('fast prices per-claim authoring calls; economical batches them (fewer calls, cheaper)', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, MANY_SECTIONS)

    const eco = await estimateGuardTokens(r, undefined, 'economical')
    const fast = await estimateGuardTokens(r, undefined, 'fast')

    // Same 4 changed sections, same subject — only the authoring dial differs.
    expect(eco.subjectLabel).toBe('4 sections')
    expect(fast.subjectLabel).toBe('4 sections')

    // Fast authors one claim per call → strictly more calls than the batched dial.
    expect(fast.stages!.length).toBe(eco.stages!.length)
    expect(authorStage(fast).calls).toBeGreaterThan(authorStage(eco).calls)
    expect(authorStage(fast).callsRange!.high).toBeGreaterThan(authorStage(eco).callsRange!.high)
    // More calls, each re-paying the shared document context → more total tokens.
    expect(fast.totalEstimatedTokens).toBeGreaterThan(eco.totalEstimatedTokens)
  })

  it('defaults to economical when no mode is passed', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, MANY_SECTIONS)

    const dflt = await estimateGuardTokens(r)
    const eco = await estimateGuardTokens(r, undefined, 'economical')
    expect(authorStage(dflt).calls).toBe(authorStage(eco).calls)
  })
})
