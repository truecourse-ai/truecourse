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
