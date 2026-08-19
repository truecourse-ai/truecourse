/**
 * `truecourse guard adjudicate` — the terminal surface (plan 05 step 21, item 7).
 *
 * The engine is covered under `tests/core/guard-adjudicate-*`; what this file
 * pins is the command's own contract: the three refusals a user can hit before
 * anything is spent (no board, a transport with no session driver, a board with
 * nothing red), and the fact that a board which settles DETERMINISTICALLY never
 * reaches the LLM preflight at all — the pre-pass exists precisely so a routine
 * re-run costs nothing, and a preflight that fires anyway would demand a
 * provider for a run that needs none.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const { out } = vi.hoisted(() => ({ out: [] as string[] }))

vi.mock('../../tools/cli/node_modules/@clack/prompts', () => {
  const say = (msg?: unknown) => {
    out.push(String(msg ?? ''))
  }
  return {
    intro: say,
    outro: say,
    cancel: say,
    note: (body: string, title: string) => out.push(`${title}\n${body}`),
    log: { info: say, step: say, message: say, warn: say, error: say, success: say },
    spinner: () => ({ start: say, stop: say, message: say }),
    confirm: async () => {
      throw new Error('this command must not reach a confirm in these cases')
    },
    isCancel: (v: unknown) => typeof v === 'symbol',
  }
})

/** The LLM preflight is a hard exit in a bare environment; count its calls. */
const { preflights } = vi.hoisted(() => ({ preflights: [] as unknown[] }))
vi.mock('../../tools/cli/src/lib/claude-preflight.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tools/cli/src/lib/claude-preflight.js')>()
  return {
    ...actual,
    preflightLlmOrExit: vi.fn(async (flag: unknown) => {
      preflights.push(flag)
    }),
  }
})

import { writeGuardLatest, writeManifest } from '@truecourse/guard-runner'
import { runGuardAdjudicate } from '../../tools/cli/src/commands/guard-adjudicate'
import {
  board,
  failRow,
  makeRepo,
  manifestWith,
  rmrf,
} from '../core/guard-adjudicate-helpers'

const repos: string[] = []
function repo(): string {
  const r = makeRepo()
  repos.push(r)
  return r
}
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
  vi.restoreAllMocks()
})
beforeEach(() => {
  out.length = 0
  preflights.length = 0
})

const text = (): string => out.join('\n')

/** Run the command, swallowing the mocked `process.exit` so assertions run. */
async function run(opts: Parameters<typeof runGuardAdjudicate>[0]): Promise<number | undefined> {
  let exited: number | undefined
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exited = code
    throw new Error(`process.exit(${code})`)
  }) as never)
  try {
    await runGuardAdjudicate(opts)
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith('process.exit(')) throw e
  }
  return exited
}

const PASS_ROW = { ...failRow('scn.green'), outcome: 'pass' as const, failure: undefined }

describe('runGuardAdjudicate — the refusals', () => {
  it('exits 1 on a repo with no guard board, pointing at `guard run`', async () => {
    const exited = await run({ cwd: repo() })

    expect(exited).toBe(1)
    expect(text()).toContain('No guard board')
    expect(text()).toContain('guard run')
  })

  it('refuses `--llm-transport agent`: an adjudication session needs a live backend', async () => {
    const exited = await run({ cwd: repo(), llmTransport: 'agent' })

    expect(exited).toBe(1)
    expect(text()).toContain('--llm-transport agent has no session driver')
    // The refusal lands before anything reads the stores or the provider.
    expect(preflights).toHaveLength(0)
  })

  it('says there is nothing to adjudicate on an all-green board, and exits 0', async () => {
    const r = repo()
    writeGuardLatest(r, board([PASS_ROW]))

    const exited = await run({ cwd: r })

    expect(exited).toBeUndefined()
    expect(process.exitCode).not.toBe(1)
    expect(text()).toContain('nothing to adjudicate')
    expect(preflights).toHaveLength(0)
  })

  it('names an unknown `--scenario` and exits 1 rather than adjudicating the board', async () => {
    const r = repo()
    writeGuardLatest(r, board([failRow('scn.a')]))

    const exited = await run({ cwd: r, scenario: ['scn.ghost'] })

    expect(exited).toBe(1)
    expect(text()).toContain('scn.ghost')
    expect(preflights).toHaveLength(0)
  })
})

describe('runGuardAdjudicate — a deterministically settled board', () => {
  it('settles the declared red without a session, and never asks for a provider', async () => {
    const r = repo()
    writeGuardLatest(r, board([failRow('scn.a')]))
    writeManifest(
      r,
      manifestWith([
        {
          scenarioId: 'scn.a',
          flowId: 'flow.a',
          expectedRed: {
            step: 3,
            predictedActual: 'exit 2',
            verdict: 'doc-drift',
            brief: 'the doc promises the flag; the CLI has never accepted it',
          },
        },
      ]),
    )

    const exited = await run({ cwd: r, yes: true })

    expect(exited).toBeUndefined()
    expect(preflights).toHaveLength(0)
    expect(text()).toContain('1 settle deterministically')
    expect(text()).toContain('no session needed')
    expect(text()).toContain('scn.a — expected-red (high, pre-pass)')
    expect(text()).toContain('verdicts  1/1')
    // The board is where the verdict landed.
    const latest = JSON.parse(
      fs.readFileSync(path.join(r, '.truecourse', 'guard', 'LATEST.json'), 'utf-8'),
    )
    expect(latest.scenarios[0].adjudication.class).toBe('expected-red')
    expect(fs.existsSync(path.join(r, '.truecourse', 'sessions'))).toBe(false)
  })

  it('reports "every failure already carries a verdict" when the scope is empty', async () => {
    const r = repo()
    writeGuardLatest(
      r,
      board([
        failRow('scn.a', {
          adjudication: {
            class: 'drift',
            mechanism: 'the doc and the code disagree',
            evidence: ['a verbatim line'],
            confidence: 'high',
            findings: [],
            adjudicatedAt: '2026-08-19T01:00:00.000Z',
          },
        }),
      ]),
    )

    const exited = await run({ cwd: r })

    expect(exited).toBeUndefined()
    expect(text()).toContain('Every failure already carries a verdict')
    expect(text()).toContain('1 already adjudicated, skipped')
    expect(preflights).toHaveLength(0)
  })
})
