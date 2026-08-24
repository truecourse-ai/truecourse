/**
 * The flow taint. A flow whose test was rejected last run must never be
 * served the byte-identical rejected scenario from the author cache again: the
 * taint bypasses the cache read, the fresh worker session opens with the prior
 * mismatch as a PRIOR FLAG evidence block, a completed session clears the taint
 * (the poisoned entry was overwritten), and an authoring error keeps it.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { autoResolutionKey, GUARD_FORMAT_VERSION } from '@truecourse/shared'
import {
  readGuardAutoResolutions,
  writeGuardAutoResolutions,
  writeManifest,
} from '@truecourse/guard-runner'
import type { LlmTurnRequest } from '@truecourse/shared/llm'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  reviewBy,
  workerTurnBy,
  runGenerate,
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

/** Record one turn request, snapshotting its transcript: the loop mutates the
 *  same `messages` array all session long, so a live reference reads the END of
 *  the session no matter which turn it came from. */
function record(turns: LlmTurnRequest[]): (req: LlmTurnRequest) => void {
  return (req) => turns.push({ ...req, messages: [...req.messages] })
}

/** The OPENING prompts of the worker sessions a run started — a resume carries
 *  the session's transcript, so only a fresh session has a lone first message. */
function openings(turns: LlmTurnRequest[], flowId: string): string[] {
  return turns.filter((t) => t.subject === flowId && t.messages.length === 1).map((t) => t.messages[0].text)
}

describe('flow taint — the author-cache bypass', () => {
  it('a tainted flow re-authors FRESH with the prior rejection as evidence; a faithful pass clears it', async () => {
    const r = seed()
    // Warm the author cache with a green run.
    const turns: LlmTurnRequest[] = []
    const turnFn = workerTurnBy({ version: raw('green test', PASSING_STEPS) }, record(turns))
    await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, turnFn })
    expect(openings(turns, 'version')).toHaveLength(1)
    expect(openings(turns, 'version')[0]).not.toContain('PRIOR FLAG')

    // Taint the flow (as a prior run's rejection would) and make it work again.
    writeGuardAutoResolutions(r, taintedLedger('asserts exit 0 where the claim quotes exact output'))
    writeManifest(r, { version: GUARD_FORMAT_VERSION, flows: [] })

    await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, turnFn })
    // The warm cache was BYPASSED: a second session opened, with the evidence.
    const fresh = openings(turns, 'version')
    expect(fresh).toHaveLength(2)
    expect(fresh[1]).toContain('PRIOR FLAG')
    expect(fresh[1]).toContain('rejected scenario: the rejected scenario')
    expect(fresh[1]).toContain('asserts exit 0 where the claim quotes exact output')
    // The fresh pass cleared the taint (the poisoned cache entry is gone).
    expect(readGuardAutoResolutions(r).tainted[KEY]).toBeUndefined()

    // And an untainted re-run is a cache hit again — the fresh result was cached.
    writeManifest(r, { version: GUARD_FORMAT_VERSION, flows: [] })
    await runGenerate({ repoRoot: r, extractRunner: versionCliBgUntestable, turnFn })
    expect(openings(turns, 'version')).toHaveLength(2)
  })

  it('an authoring error KEEPS the taint — the cache is still poisoned', async () => {
    const r = seed()
    writeGuardAutoResolutions(r, taintedLedger('the prior rejection'))
    // A sibling flow that settles keeps the run from being a total authoring
    // wipeout, which would abort before the ledger is reconciled at all.
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      turnFn: workerTurnBy({ version: { throws: 'transport died' } }),
    })
    expect(res.errors.filter((e) => e.kind === 'authoring')).toHaveLength(1)
    const taint = readGuardAutoResolutions(r).tainted[KEY]!
    expect(taint.flowId).toBe('version')
    expect(taint.mismatch).toContain('authoring session ended without settling')
  })

  it('end-to-end: a rejected test taints, and the NEXT generate opens fresh with the mismatch', async () => {
    const r = seed()
    const turns: LlmTurnRequest[] = []
    const mismatch = 'asserts only the exit code where the claim quotes the printed version'
    const run = () =>
      runGenerate({
        repoRoot: r,
        extractRunner: versionCliBgUntestable,
        turnFn: workerTurnBy({ version: raw('always shallow', PASSING_STEPS) }, record(turns)),
        fidelityRunner: reviewBy({ 'always shallow': mismatch }),
      })

    const first = await run()
    // The flagged test is withheld, and its flow tainted with the reviewer's words.
    expect(first.written).toEqual([])
    expect(readGuardAutoResolutions(r).tainted[KEY]).toMatchObject({ title: 'always shallow', mismatch })

    await run()
    // The second run opened a NEW session (no cache serve) carrying the evidence.
    const fresh = openings(turns, 'version')
    expect(fresh).toHaveLength(2)
    expect(fresh[1]).toContain('rejected scenario: always shallow')
    expect(fresh[1]).toContain(mismatch)
  })
})
