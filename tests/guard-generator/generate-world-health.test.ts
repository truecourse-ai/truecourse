/**
 * THE WORLD-HEALTH LATCH: a server that cannot boot AFTER the world has proven
 * itself is news about the run, not about the scenario that observed it. The
 * first observer hands the shared world back for one re-boot and re-executes;
 * a boot that fails again latches a run-level `world-lost` refusal every later
 * execution short-circuits on — instead of a session per flow each retiring
 * its flow against a dead world (documenso 2026-09-03: ~110 sessions after
 * one loss). The executor here is scripted, so the cases are about the
 * generator's control flow; the runner half (invalidate → re-boot) is pinned
 * in tests/guard-runner/shared-world.test.ts.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { API_SERVER_BOOT_EXPECTED, readManifest, type GuardExecReport, type GuardExecutor } from '@truecourse/guard-runner'
import {
  PASSING_STEPS,
  extractSessionBy,
  flowWorkerSessionOf,
  makeTempRepo,
  raw,
  rmrf,
  runGenerate,
  scenarioYaml,
  stampMilestones,
  writeCorpus,
  writeDoc,
  writeRecipe,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

const DOC = 'docs/cli.md'
const ONE_FLOW = ['## version', '`relkit --version` prints the version and exits 0.'].join('\n')
const TWO_FLOWS = [ONE_FLOW, '', '## boom', '`relkit boom` exits 7.'].join('\n')

function seed(content: string): string {
  const r = makeTempRepo()
  repos.push(r)
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, content)
  return r
}

type Verdict = 'pass' | 'boot'

/** An executor whose verdict per call is scripted: the server booted and the
 *  scenario passed, or the server could not boot against the world. */
function scriptedExecutor(script: Verdict[]): { exec: GuardExecutor; calls: Verdict[] } {
  const calls: Verdict[] = []
  const exec: GuardExecutor = async (input) => {
    const verdict = script[calls.length] ?? 'pass'
    calls.push(verdict)
    const scenarios = input.scenarios.map((s) => ({
      id: s.id,
      title: s.title,
      binds: s.binds[0],
      ...(s.flow ? { flowId: s.flow.id } : {}),
      ...(verdict === 'pass'
        ? { outcome: 'pass', durationMs: 1 }
        : {
            outcome: 'error',
            durationMs: 1,
            failure: {
              step: 1,
              expected: API_SERVER_BOOT_EXPECTED,
              actual: 'api server exited before becoming healthy',
            },
          }),
    }))
    return { status: 'ok', latest: { scenarios } } as unknown as GuardExecReport
  }
  return { exec, calls }
}

const draft = (task: { milestoneCount: number }, extra = {}) =>
  scenarioYaml(stampMilestones(raw('Version works', PASSING_STEPS, extra), task.milestoneCount))

describe('generateGuards — the world-health latch', () => {
  it('one boot failure after a proven world re-boots the world and re-executes — the worker sees the repaired run', async () => {
    const r = seed(ONE_FLOW)
    const { exec, calls } = scriptedExecutor(['pass', 'boot', 'pass'])
    const reports: { content: string; isError?: boolean }[] = []
    const res = await runGenerate({
      repoRoot: r,
      executor: exec,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        reports.push(await task.runScenario(draft(task)))
        reports.push(await task.runScenario(draft(task)))
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 2, lastEvidence: 'probing' } }
      }),
    })
    // Call 2 lost the world; the engine re-booted and re-executed (call 3)
    // before the worker heard anything — so the second report is the PASS.
    expect(calls).toEqual(['pass', 'boot', 'pass'])
    expect(reports.map((x) => x.isError ?? false)).toEqual([false, false])
    expect(reports[1].content).toContain('PASS')
    expect(res.refusal).toBeUndefined()
    expect(res.errors).toEqual([])
  }, 60_000)

  it('a world that stays down after the re-boot latches ONE run-level refusal every later execution short-circuits on', async () => {
    const r = seed(TWO_FLOWS)
    const { exec, calls } = scriptedExecutor(['pass', 'boot', 'boot'])
    const byFlow = new Map<string, { content: string; isError?: boolean }[]>()
    const res = await runGenerate({
      repoRoot: r,
      executor: exec,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        const reports: { content: string; isError?: boolean }[] = []
        byFlow.set(task.flowId, reports)
        // The first worker: a good run, then the loss (repair fails), then a
        // short-circuit. The second worker: straight to the short-circuit.
        reports.push(await task.runScenario(draft(task)))
        reports.push(await task.runScenario(draft(task)))
        reports.push(await task.runScenario(draft(task)))
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 3, lastEvidence: 'the world was lost' } }
      }),
    })
    // Three executions in the whole run: proven, lost, re-boot failed. Nothing after.
    expect(calls).toEqual(['pass', 'boot', 'boot'])
    const [first, second] = [...byFlow.values()]
    expect(first[0].isError ?? false).toBe(false)
    expect(first[1].isError).toBe(true)
    expect(first[1].content).toContain('the prepared world was LOST mid-run')
    expect(first[2].isError).toBe(true)
    expect(second.every((x) => x.isError)).toBe(true)
    expect(second[0].content).toContain('LOST mid-run')

    // ONE refusal, run-level, naming what was observed and what was tried.
    expect(res.refusal).toMatchObject({ status: 'world-lost' })
    expect(res.refusal!.message).toContain('after 1 execution(s) had booted')
    expect(res.refusal!.message).toContain('api server exited before becoming healthy')
    expect(res.errors.filter((e) => e.kind === 'refusal')).toHaveLength(1)
    expect(res.written).toEqual([])
    // Both flows stay unsettled: the next generate re-attempts them.
    const manifest = readManifest(r)!
    for (const flow of manifest.flows) expect(flow.generationInputsHash).toBeNull()
  }, 60_000)

  it('a scenario carrying its own boot overrides never triggers a repair — its crash is its own finding', async () => {
    const r = seed(ONE_FLOW)
    const { exec, calls } = scriptedExecutor(['pass', 'boot', 'pass'])
    const reports: { content: string; isError?: boolean }[] = []
    await runGenerate({
      repoRoot: r,
      executor: exec,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        reports.push(await task.runScenario(draft(task)))
        reports.push(await task.runScenario(draft(task, { setup: { env: { RELKIT_MODE: 'broken' } } })))
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 2, lastEvidence: 'probing' } }
      }),
    })
    // No third call: the boot failure under the scenario's env went straight back.
    expect(calls).toEqual(['pass', 'boot'])
    expect(reports[1].isError).toBe(true)
    expect(reports[1].content).toContain('api server exited before becoming healthy')
  }, 60_000)

  it('a boot failure before the world ever proved itself is the existing story — no repair, no latch', async () => {
    const r = seed(ONE_FLOW)
    const { exec, calls } = scriptedExecutor(['boot', 'pass'])
    const reports: { content: string; isError?: boolean }[] = []
    const res = await runGenerate({
      repoRoot: r,
      executor: exec,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        reports.push(await task.runScenario(draft(task)))
        reports.push(await task.runScenario(draft(task)))
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 2, lastEvidence: 'probing' } }
      }),
    })
    expect(calls).toEqual(['boot', 'pass'])
    expect(reports[0].isError).toBe(true)
    expect(reports[1].isError ?? false).toBe(false)
    expect(res.refusal).toBeUndefined()
  }, 60_000)
})
