/**
 * THE ADJUDICATION SESSION'S TOOLS (plan 05 step 21, items 3–4) — the two that
 * hold a boundary a prompt cannot: `rerun_scoped`'s hard cap on re-executions,
 * and `read_evidence`'s containment to THIS failure's bundle.
 *
 * Both are refusals, and a refusal that leaks is the whole defect: a rerun cap
 * that miscounts turns a session into a build farm, and an evidence reader that
 * follows `../` hands a session the neighbouring scenario's transcript (or the
 * board) as if it were evidence of the failure under adjudication.
 */

import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { ToolContext } from '../../packages/agent-loop/src/index'
import { evidenceRelPath, type GuardExecInput, type GuardExecReport } from '@truecourse/guard-runner'
import type { GuardScenarioResult } from '@truecourse/shared'
import {
  buildAdjudicationTools,
  newSessionState,
  RERUN_MAX,
} from '../../packages/core/src/services/guard-adjudicate/tools'
import type { AdjudicationExecution } from '../../packages/core/src/services/guard-adjudicate/execute'
import { board, failRow, item, makeRepo, rmrf, RUN_ID, scenarioDoc } from './guard-adjudicate-helpers'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeRepo()
  repos.push(r)
  return r
}

/** The shell owns the real `ToolContext`; these tools use none of it. */
const CTX: ToolContext = {
  workItem: 'scn.a',
  signal: new AbortController().signal,
  dispatchChild: () => {
    throw new Error('no child is dispatched by these tools')
  },
}

const RECIPE = { build: 'true', entry: ['node', 'nothing.mjs'] } as unknown as AdjudicationExecution['recipe']

/** An `AdjudicationExecution` whose executor answers from a script. */
function exec(
  executor: (input: GuardExecInput) => Promise<GuardExecReport>,
  over: Partial<AdjudicationExecution> = {},
): AdjudicationExecution {
  return {
    executor,
    recipe: RECIPE,
    repoRoot: '/nowhere',
    branch: null,
    commit: null,
    built: false,
    ...over,
  }
}

/** A run report that executed `id` and settled it green. */
function okReport(id: string, result?: Partial<GuardScenarioResult>): GuardExecReport {
  const row: GuardScenarioResult = {
    id,
    title: `${id} title`,
    binds: { doc: 'docs/spec.md', section: 'a/b', fingerprint: 'sha256:x' },
    outcome: 'pass',
    durationMs: 3,
    ...result,
  }
  return {
    status: 'ok',
    latest: board([row]),
    latestPath: '/nowhere/LATEST.json',
    loadErrors: [],
    manifest: null,
  } as GuardExecReport
}

function toolsFor(input: {
  repoRoot: string
  exec: AdjudicationExecution
  itemOver?: Parameters<typeof item>[0]
}) {
  const state = newSessionState()
  const tools = buildAdjudicationTools({
    repoRoot: input.repoRoot,
    item: item({ scenario: scenarioDoc('scn.a'), ...input.itemOver }),
    exec: input.exec,
    state,
  })
  const call = (name: string, args: unknown) => tools.find((t) => t.name === name)!.execute(args, CTX)
  return { tools, state, call }
}

// ---------------------------------------------------------------------------
// rerun_scoped — the flake discriminator, capped
// ---------------------------------------------------------------------------

describe('rerun_scoped', () => {
  it(`re-executes at most ${RERUN_MAX} times, then refuses without spending a run`, async () => {
    let runs = 0
    const { call } = toolsFor({
      repoRoot: repo(),
      exec: exec(async () => {
        runs++
        return okReport('scn.a')
      }),
    })

    expect((await call('rerun_scoped', {})).isError).toBe(false)
    expect((await call('rerun_scoped', {})).isError).toBe(false)
    const third = await call('rerun_scoped', {})

    expect(third.isError).toBe(true)
    expect(third.content).toContain('cap')
    expect(runs).toBe(RERUN_MAX)
  })

  it('hands back the condensed result, not the whole report', async () => {
    const { call } = toolsFor({
      repoRoot: repo(),
      exec: exec(async () =>
        okReport('scn.a', {
          outcome: 'fail',
          failure: { step: 3, expected: 'exit 0', actual: 'exit 2 — unknown flag' },
          failedMilestone: 2,
        }),
      ),
    })

    const result = await call('rerun_scoped', {})

    expect(result.isError).toBe(false)
    expect(result.content).toContain('outcome: fail')
    expect(result.content).toContain('failing step: 3')
    expect(result.content).toContain('actual:   exit 2 — unknown flag')
    expect(result.content).toContain('failed milestone: 2')
  })

  /** A run-level refusal is a WORLD defect: no re-execution can answer past it. */
  it('names the world defect when the runner refuses the run outright', async () => {
    const { call } = toolsFor({
      repoRoot: repo(),
      exec: exec(async () => ({ status: 'seed-failed', message: 'the seed exited 1' }) as GuardExecReport),
    })

    const result = await call('rerun_scoped', {})

    expect(result.isError).toBe(true)
    expect(result.content).toContain('REFUSED')
    expect(result.content).toContain('the seed exited 1')
    expect(result.content).toContain('configuration/world defect')
  })

  it('says re-executions are unavailable when the repo has no usable recipe', async () => {
    const { call } = toolsFor({
      repoRoot: repo(),
      exec: exec(async () => {
        throw new Error('the executor must not be reached without a recipe')
      }, { recipe: null }),
    })

    const result = await call('rerun_scoped', {})

    expect(result.isError).toBe(true)
    expect(result.content).toContain('recipe.json')
    expect(result.content).toContain('unavailable')
  })

  it('refuses when the committed scenario has left the corpus', async () => {
    const { call } = toolsFor({
      repoRoot: repo(),
      exec: exec(async () => {
        throw new Error('nothing to re-execute')
      }),
      itemOver: { scenario: undefined },
    })

    const result = await call('rerun_scoped', {})

    expect(result.isError).toBe(true)
    expect(result.content).toContain('not in the corpus')
  })
})

// ---------------------------------------------------------------------------
// read_evidence — one contained file of THIS failure's bundle
// ---------------------------------------------------------------------------

describe('read_evidence', () => {
  /** A repo whose evidence root holds two scenarios' bundles. */
  function withBundles(): { r: string; evidenceDir: string } {
    const r = repo()
    const mine = path.join(r, '.truecourse', 'guard', 'evidence', RUN_ID, 'scn.a')
    const theirs = path.join(r, '.truecourse', 'guard', 'evidence', RUN_ID, 'other-scenario')
    fs.mkdirSync(mine, { recursive: true })
    fs.mkdirSync(theirs, { recursive: true })
    fs.writeFileSync(path.join(mine, 'diff.txt'), 'diff of MY failure\n')
    fs.writeFileSync(path.join(theirs, 'diff.txt'), 'diff of SOMEBODY ELSE\n')
    fs.writeFileSync(path.join(r, '.truecourse', 'guard', 'LATEST.json'), '{"board":"secret"}')
    return { r, evidenceDir: evidenceRelPath(RUN_ID, 'scn.a') }
  }

  const noExec = exec(async () => {
    throw new Error('read_evidence executes nothing')
  })

  it('reads a file of its own bundle', async () => {
    const { r, evidenceDir } = withBundles()
    const { call } = toolsFor({ repoRoot: r, exec: noExec, itemOver: { evidenceDir } })

    const result = await call('read_evidence', { file: 'diff.txt' })

    expect(result.isError).toBeUndefined()
    expect(result.content).toBe('diff of MY failure\n')
  })

  it('refuses a `../`-laced name that reaches a sibling failure’s bundle', async () => {
    const { r, evidenceDir } = withBundles()
    const { call } = toolsFor({ repoRoot: r, exec: noExec, itemOver: { evidenceDir } })

    const result = await call('read_evidence', { file: '../other-scenario/diff.txt' })

    expect(result.isError).toBe(true)
    expect(result.content).toContain("not a file of this failure's evidence bundle")
  })

  it('refuses a climb out of the evidence root entirely', async () => {
    const { r, evidenceDir } = withBundles()
    const { call } = toolsFor({ repoRoot: r, exec: noExec, itemOver: { evidenceDir } })

    const result = await call('read_evidence', { file: '../../LATEST.json' })

    expect(result.isError).toBe(true)
    expect(result.content).toContain("not a file of this failure's evidence bundle")
  })

  it('points a screenshot request at `visual_judge` instead of handing back bytes', async () => {
    const { r, evidenceDir } = withBundles()
    const { call } = toolsFor({ repoRoot: r, exec: noExec, itemOver: { evidenceDir } })

    const result = await call('read_evidence', { file: 'step-1.png' })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('visual_judge')
  })

  it('says so when the row carries no bundle at all', async () => {
    const { call } = toolsFor({ repoRoot: repo(), exec: noExec, itemOver: { evidenceDir: undefined } })

    const result = await call('read_evidence', { file: 'diff.txt' })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('no evidence bundle')
  })
})

// ---------------------------------------------------------------------------
// The tool surface the session is given
// ---------------------------------------------------------------------------

describe('buildAdjudicationTools', () => {
  it('hands the session exactly the six tools the plan names', () => {
    const { tools } = toolsFor({
      repoRoot: repo(),
      exec: exec(async () => okReport('scn.a')),
      itemOver: { row: failRow('scn.a') },
    })

    expect(tools.map((t) => t.name).sort()).toEqual([
      'read_evidence',
      'read_file',
      'rerun_scoped',
      'search_repo',
      'verify_bug',
      'visual_judge',
    ])
    // Every one is read-only against repo/store state — the fold does the writing.
    expect(tools.every((t) => t.readOnly && !t.destructive)).toBe(true)
  })
})
