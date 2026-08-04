/**
 * The flow taint. A flow whose test was rejected last run must never be
 * served the byte-identical rejected scenario from the author cache again: the
 * taint bypasses the round-1 cache read, the fresh call carries the prior
 * mismatch as a PRIOR FLAG evidence block, a completed fresh author clears the
 * taint (the poisoned entry was overwritten), and an authoring error keeps it.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { autoResolutionKey, GUARD_FORMAT_VERSION } from '@truecourse/shared'
import {
  readGuardAutoResolutions,
  writeGuardAutoResolutions,
  writeManifest,
} from '@truecourse/guard-runner'
import type { GenerateRunner, AuthorUserContext } from '@truecourse/guard-generator'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  authorBy,
  runGenerate,
  stampMilestones,
  FAILING_STEPS,
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
  'The history of relkit; nothing externally observable here.',
].join('\n')

function seed(): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, DOC_CONTENT)
  return r
}

const versionCliBgUntestable = extractBy({ background: { untestable: 'design history' } })
const KEY = autoResolutionKey('version', 'cli')

function taintedLedger(mismatch: string) {
  return {
    version: 1 as const,
    entries: {},
    tainted: {
      [KEY]: {
        flowId: 'version',
        surface: 'cli' as const,
        title: 'the rejected scenario',
        mismatch,
        updatedAt: '2026-07-01T00:00:00Z',
      },
    },
  }
}

describe('flow taint — the author-cache bypass', () => {
  it('a tainted flow re-authors FRESH with the prior rejection as evidence; a faithful pass clears it', async () => {
    const r = seed()
    // Warm the author cache with a green run.
    let calls = 0
    const seen: AuthorUserContext[] = []
    const runner = authorBy({ version: raw('green test', PASSING_STEPS) }, (ctx) => {
      calls++
      seen.push(ctx)
    })
    await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: runner })
    expect(calls).toBe(1)

    // Taint the flow (as a prior run's rejection would) and make it work again.
    writeGuardAutoResolutions(r, taintedLedger('asserts exit 0 where the claim quotes exact output'))
    writeManifest(r, { version: GUARD_FORMAT_VERSION, flows: [] })

    await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: runner })
    // The warm cache was BYPASSED: the model was called again, with the evidence.
    expect(calls).toBe(2)
    expect(seen[1].priorFlag).toEqual({
      title: 'the rejected scenario',
      mismatch: 'asserts exit 0 where the claim quotes exact output',
    })
    // The fresh pass cleared the taint (the poisoned cache entry is gone).
    expect(readGuardAutoResolutions(r).tainted[KEY]).toBeUndefined()

    // And an untainted re-run is a cache hit again — the fresh result was cached.
    writeManifest(r, { version: GUARD_FORMAT_VERSION, flows: [] })
    await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: runner })
    expect(calls).toBe(2)
  })

  it('an authoring error KEEPS the taint — the cache is still poisoned', async () => {
    const r = seed()
    writeGuardAutoResolutions(r, taintedLedger('the prior rejection'))
    const throwing: GenerateRunner = async () => {
      throw new Error('transport died')
    }
    await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, generateRunner: throwing })
    expect(readGuardAutoResolutions(r).tainted[KEY]).toMatchObject({ mismatch: 'the prior rejection' })
  })

  it('end-to-end: a withheld generation-defect taints, and the NEXT generate authors fresh with the brief', async () => {
    const r = seed()
    const flags: (AuthorUserContext['priorFlag'] | undefined)[] = []
    const runner: GenerateRunner = async (ctx) => {
      flags.push(ctx.priorFlag)
      return { scenario: stampMilestones(raw('always broken', FAILING_STEPS), ctx.milestones.length) }
    }
    const brief = 'The scenario asserts an exit code the section never states.'
    const run = () =>
      runGenerate({
        repoRoot: r,
        extractRunner: versionCliBgUntestable,
        generateRunner: runner,
        triageRunner: async () => ({
          verdict: 'generation-defect',
          confidence: 'medium',
          brief,
          recommendation: 'Author against the documented behavior.',
        }),
      })

    await run()
    expect(readGuardAutoResolutions(r).tainted[KEY]).toMatchObject({ mismatch: brief })

    await run()
    // The second run's ROUND-1 call happened (no cache serve) and carried the brief.
    const round1Flags = flags.filter((f) => f !== undefined)
    expect(round1Flags.length).toBeGreaterThan(0)
    expect(round1Flags[0]).toMatchObject({ title: 'always broken', mismatch: brief })
  })
})
