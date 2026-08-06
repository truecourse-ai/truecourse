/**
 * An EXHAUSTED authoring worker session — the session ran out of turns, or ended
 * without ever producing an action the loop could read — is the honest "this flow
 * defeated authoring" signal, and it feeds the same durable ledger
 * (`guard/auto-resolutions.json`) every other auto behavior does, under its own
 * source: `author`. One exhausted session is an authoring error plus a taint plus
 * a counted attempt; past the escalation threshold the flow RETIRES — a settled
 * `retired` coverage gap, zero further spend, never a human task — until one of
 * the three resets fires.
 *
 * Every run here drives TWO flows. A run whose every authoring unit was lost and
 * that settled nothing aborts as an LLM wipeout before anything (the ledger
 * included) is written, so the tracked flow's exhaustion is always accompanied by
 * a sibling session that ANSWERS: a journey defect, which is an answer and not a
 * loss, and which — like the exhausted flow — never settles, so both flows are
 * work again on the next run.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { autoResolutionKey } from '@truecourse/shared'
import { readGuardAutoResolutions, readManifest } from '@truecourse/guard-runner'
import { WORKER_CLI_PROMPT_FINGERPRINT, type GuardGenerateResult } from '@truecourse/guard-generator'
import type { LlmTurnRequest } from '@truecourse/shared/llm'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  extractBy,
  workerTurnBy,
  runGenerate,
  type WorkerSpec,
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

/** Both sections yield a claim, so the doc yields the two flows every run drives. */
const bothSectionsTestable = extractBy({})
const KEY = autoResolutionKey('version', 'cli')

/** The sibling session: it answers (a journey defect), so the run is never a
 *  total authoring wipeout, and it never settles, so it is work again next run. */
const SIBLING: WorkerSpec = {
  journeyDefect: {
    argv: ['background'],
    promised: 'the mapper promised a `background` command',
    observed: 'relkit exits 64 with a usage error',
  },
}

/** One generate whose `version` worker session ends exhausted (no action block
 *  the loop can read, twice) beside a sibling that answers. */
function exhaustedRun(
  r: string,
  onTurn?: (req: LlmTurnRequest) => void,
  escalateAutoResolveAfter?: number,
): Promise<GuardGenerateResult> {
  return runGenerate({
    repoRoot: r,
    extractRunner: bothSectionsTestable,
    turnFn: workerTurnBy({ version: { malformed: true }, background: SIBLING }, onTurn),
    ...(escalateAutoResolveAfter === undefined ? {} : { escalateAutoResolveAfter }),
  })
}

describe('an exhausted worker session bumps the author ledger', () => {
  it('records the authoring error, taints the flow, and counts the attempt under `author`', async () => {
    const r = seed()
    const res = await exhaustedRun(r)

    expect(res.status).toBe('ok')
    // ONE error row for the session, naming the flow, the surface and the ending.
    const authoring = res.errors.filter((e) => e.kind === 'authoring')
    expect(authoring).toHaveLength(1)
    expect(authoring[0]).toMatchObject({ flowId: 'version', surface: 'cli', doc: DOC, anchor: 'version' })
    expect(authoring[0].message).toContain('authoring (cli) worker session ended: malformed')

    // Nothing committed for it, and the flow re-attempts next generate.
    expect(res.written.map((w) => w.flowId)).not.toContain('version')
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'version')!.generationInputsHash).toBeNull()

    // The durable ledger counted the attempt under the NEW source, and tainted the
    // flow so the next generate bypasses the (unusable) author cache.
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.entries[KEY]).toMatchObject({ count: 1, source: 'author' })
    expect(ledger.entries[KEY]!.attempts).toMatchObject([{ source: 'author', title: 'version' }])
    expect(ledger.tainted[KEY]).toMatchObject({ flowId: 'version', surface: 'cli', title: 'version' })
    expect(ledger.tainted[KEY]!.mismatch).toContain('authoring session ended without settling')
  })

  it('a session whose transport dies is the same loss, reported as a turn error', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: bothSectionsTestable,
      turnFn: workerTurnBy({ version: { throws: 'claude exited 1' }, background: SIBLING }),
    })

    expect(res.status).toBe('ok')
    expect(res.errors.filter((e) => e.kind === 'authoring')[0].message).toBe(
      'authoring (cli) worker session ended: turn-error — claude exited 1',
    )
    expect(readGuardAutoResolutions(r).entries[KEY]).toMatchObject({ count: 1, source: 'author' })
  })
})

describe('past the threshold an exhausted flow retires', () => {
  it('the second exhausted generate retires it: a settled gap, a visible row, zero later spend', async () => {
    const r = seed()
    const first = await exhaustedRun(r, undefined, 1)
    expect(first.autoResolved).toEqual([])
    expect(readGuardAutoResolutions(r).entries[KEY]).toMatchObject({ count: 1, source: 'author' })

    const second = await exhaustedRun(r, undefined, 1)
    // No finding and no task: the gap + the visible `retire` row ARE the record.
    expect(second.birthFindings).toEqual([])
    expect(second.autoResolved).toEqual([
      {
        kind: 'retire',
        flowId: 'version',
        surface: 'cli',
        doc: DOC,
        anchor: 'version',
        title: 'version',
        source: 'author',
        detail: expect.stringContaining('malformed'),
        attempts: 2,
      },
    ])
    const reason = 'no scenario — authoring retired after 2 defective attempts'
    expect(second.coverageGaps).toContainEqual(
      expect.objectContaining({ kind: 'retired', flowId: 'version', surface: 'cli', reason }),
    )
    // The flow SETTLES: hash recorded, the gap accounts for the surface.
    const entry = readManifest(r)!.flows.find((f) => f.flowId === 'version')!
    expect(entry.generationInputsHash).not.toBeNull()
    expect(entry.gaps).toEqual([{ surface: 'cli', kind: 'retired', reason }])

    // The retirement absorbed the count and its verdict history, and stored both
    // reset anchors — the bound spec content and the WORKER's authoring prompt.
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.retired[KEY]).toMatchObject({
      flowId: 'version',
      surface: 'cli',
      attempts: 2,
      history: [{ source: 'author' }, { source: 'author' }],
    })
    expect(ledger.retired[KEY]!.sectionsKey).toMatch(/^[0-9a-f]{64}$/)
    expect(ledger.retired[KEY]!.promptFingerprint).toBe(WORKER_CLI_PROMPT_FINGERPRINT)
    expect(ledger.entries[KEY]).toBeUndefined()

    // And the next generate spends NOT ONE TURN on it.
    const turns: LlmTurnRequest[] = []
    const third = await exhaustedRun(r, (req) => turns.push(req), 1)
    expect(turns.filter((t) => t.subject === 'version')).toEqual([])
    expect(third.autoResolved).toEqual([])
    expect(third.coverageGaps).toContainEqual(
      expect.objectContaining({ kind: 'retired', flowId: 'version', surface: 'cli', reason }),
    )
    expect(readGuardAutoResolutions(r).retired[KEY]).toBeTruthy()
  })

  it('a `reenabledFlows` decision clears the retirement — the flow authors again', async () => {
    const r = seed()
    await exhaustedRun(r, undefined, 1)
    await exhaustedRun(r, undefined, 1)
    expect(readGuardAutoResolutions(r).retired[KEY]).toBeTruthy()

    fs.writeFileSync(
      path.join(r, '.truecourse', 'scenarios', 'decisions.json'),
      JSON.stringify({
        version: 1,
        reenabledFlows: [
          { flowId: 'version', reenabledAt: new Date(Date.now() + 60_000).toISOString(), note: 'try again' },
        ],
      }),
    )

    const turns: LlmTurnRequest[] = []
    const res = await exhaustedRun(r, (req) => turns.push(req), 1)
    // The session really ran, and the retirement (with its count) is gone: the
    // fresh attempt starts its budget over.
    expect(turns.filter((t) => t.subject === 'version').length).toBeGreaterThan(0)
    expect(res.autoResolved).toEqual([])
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.retired[KEY]).toBeUndefined()
    expect(ledger.entries[KEY]).toMatchObject({ count: 1, source: 'author' })
  })
})
