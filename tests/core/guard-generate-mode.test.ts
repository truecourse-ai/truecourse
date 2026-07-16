/**
 * Item 5 — the fast-vs-economical authoring dial in `guardGenerateInProcess`: the
 * mode is asked (CLI `onModeChoice`) BEFORE the estimate, the estimate is scoped to
 * the choice, `TRUECOURSE_GENERATE_BATCH` skips the ask, and the resolved choice is
 * remembered per repo (config.json) so the next run pre-selects it.
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  guardGenerateInProcess,
  EstimateDeclined,
  type GenerateMode,
} from '../../packages/core/src/commands/guard-in-process.js'
import { readGuardGenerateMode, writeGuardGenerateMode } from '../../packages/core/src/config/project-config.js'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  extractBy,
  authorBy,
  raw,
  faithfulReviewer,
  PASSING_STEPS,
} from '../guard-generator/helpers.js'

const repos: string[] = []
afterEach(() => {
  delete process.env.TRUECOURSE_GENERATE_BATCH
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

const DOC = 'docs/cli.md'
// Four cli-claim sections so batched (economical) vs per-claim (fast) diverges.
const DOC_CONTENT = [
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

function seed(r: string): void {
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
}

const authorStageCalls = (est: { stages?: { stage: string; calls: number }[] }): number =>
  est.stages!.find((s) => s.stage === 'guardAuthor')!.calls

describe('guard generate — fast-vs-economical (item 5)', () => {
  it('asks the mode before the estimate and scopes the estimate to the choice', async () => {
    const r = repo()
    seed(r)
    let asked = false
    let defaultSeen: GenerateMode | undefined
    let ecoCalls = 0
    let fastCalls = 0

    // Economical reference (decline immediately).
    await guardGenerateInProcess(r, {
      onLlmEstimate: async (est) => {
        ecoCalls = authorStageCalls(est)
        return false
      },
    }).catch(() => {})

    await guardGenerateInProcess(r, {
      onModeChoice: (dflt) => {
        asked = true
        defaultSeen = dflt
        return Promise.resolve('fast')
      },
      onLlmEstimate: async (est) => {
        fastCalls = authorStageCalls(est)
        return false
      },
    }).catch((e) => {
      if (!(e instanceof EstimateDeclined)) throw e
    })

    expect(asked).toBe(true)
    expect(defaultSeen).toBe('economical') // default when nothing is remembered
    expect(fastCalls).toBeGreaterThan(ecoCalls) // fast → one call per claim
  })

  it('skips the ask under TRUECOURSE_GENERATE_BATCH (the raw override wins)', async () => {
    const r = repo()
    seed(r)
    process.env.TRUECOURSE_GENERATE_BATCH = '3'
    let asked = false

    await guardGenerateInProcess(r, {
      onModeChoice: () => {
        asked = true
        return Promise.resolve('fast')
      },
      onLlmEstimate: async () => false,
    }).catch(() => {})

    expect(asked).toBe(false)
  })

  it('remembers the resolved choice per repo after a completed generate', async () => {
    const r = repo()
    seed(r)
    expect(await readGuardGenerateMode(r)).toBeUndefined()

    await guardGenerateInProcess(r, {
      onModeChoice: () => Promise.resolve('fast'),
      onLlmEstimate: async () => true,
      extractRunner: extractBy({}),
      generateRunner: authorBy({
        a: [raw('a', PASSING_STEPS)],
        b: [raw('b', PASSING_STEPS)],
        c: [raw('c', PASSING_STEPS)],
        d: [raw('d', PASSING_STEPS)],
      }),
      fidelityRunner: faithfulReviewer(),
    })

    expect(await readGuardGenerateMode(r)).toBe('fast')
  })

  it('pre-selects the remembered choice as the mode-prompt default', async () => {
    const r = repo()
    seed(r)
    await writeGuardGenerateMode(r, 'fast')
    let defaultSeen: GenerateMode | undefined

    await guardGenerateInProcess(r, {
      onModeChoice: (dflt) => {
        defaultSeen = dflt
        return Promise.resolve(dflt)
      },
      onLlmEstimate: async () => false,
    }).catch(() => {})

    expect(defaultSeen).toBe('fast')
  })
})
