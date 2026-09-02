/**
 * THE FLOW-WORKER ENGINE HALF (plan 04 step 17) — everything deterministic
 * about one (flow, surface) work unit, driven through the closures a session
 * would call: the det pre-flight, the fresh-sandbox execution, the
 * red-prediction done-gate, the accepted-yaml STASH, and the routing fold that
 * turns an outcome into a committed scenario / a gap / a ledger row.
 *
 * The session shape (prompts, budget, cache, driver) is NOT under test here —
 * `tests/core/guard-generate-worker-seam.test.ts` owns that. Here the seam is a
 * stub that behaves like a well-behaved worker, so every assertion is about the
 * engine.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { autoResolutionKey, type GuardExpectedRed } from '@truecourse/shared'
import {
  defaultGuardExecutor,
  loadScenarios,
  readGuardAutoResolutions,
  readManifest,
  writeGuardAutoResolutions,
  type GuardExecutor,
} from '@truecourse/guard-runner'
import type {
  FlowWorkerSessionResult,
  FlowWorkerTask,
  GenerateGuardsOptions,
  WorkerFidelityJudge,
} from '@truecourse/guard-generator'
import {
  DEFAULT_INTERFACES,
  FAILING_STEPS,
  PASSING_STEPS,
  acceptedSha,
  extractSessionBy,
  faithfulJudge,
  flowOfAllSession,
  flowWorkerSessionOf,
  makeTempRepo,
  raw,
  rmrf,
  runGenerate,
  scenarioYaml,
  stampMilestones,
  submitWorkerSessions,
  withExternalServices,
  writeCorpus,
  writeDoc,
  writeRecipe,
  yamlSha,
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
const DOC_CONTENT = ['## version', '`relkit --version` prints the version and exits 0.'].join('\n')

/** The one-flow fixture repo every case below starts from (flow id `version`). */
function seed(content = DOC_CONTENT): string {
  const r = repo()
  writeRecipe(r)
  writeCorpus(r, [{ ref: DOC }])
  writeDoc(r, DOC, content)
  return r
}

const KEY = autoResolutionKey('version', 'cli')

/** A `GuardExecutor` that counts invocations and records each batch's size. */
function countingExecutor(
  inner: GuardExecutor = defaultGuardExecutor,
): { calls: number; batchSizes: number[]; executor: GuardExecutor } {
  const state = { calls: 0, batchSizes: [] as number[], executor: undefined as unknown as GuardExecutor }
  state.executor = async (input) => {
    state.calls++
    state.batchSizes.push(input.scenarios.length)
    return inner(input)
  }
  return state
}

/** The yaml a worker submits: a raw scenario with `milestone` stamped on. */
function draft(title: string, steps: unknown, milestones = 1): string {
  return scenarioYaml(stampMilestones(raw(title, steps as never), milestones))
}

// ---------------------------------------------------------------------------
// 1. The det pre-flight — a defect costs a turn, never a sandbox
// ---------------------------------------------------------------------------

describe('run_scenario — the deterministic pre-flight', () => {
  it('an uncovered milestone is refused WITHOUT executing anything', async () => {
    const r = seed()
    const exec = countingExecutor()
    let report!: { content: string; isError?: boolean }
    await runGenerate({
      repoRoot: r,
      executor: exec.executor,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        // No `milestone` on any step ⇒ milestone 1 is realized by nothing.
        report = await task.runScenario(scenarioYaml(raw('nothing realizes milestone 1', PASSING_STEPS)))
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: 'pre-flight' } }
      }),
    })

    expect(report.isError).toBe(true)
    expect(report.content).toContain('pre-flight defect (not executed)')
    expect(report.content).toContain('milestone(s) 1 are realized by no step')
    expect(exec.calls).toBe(0)
  })

  it('an unknown milestone number is refused WITHOUT executing anything', async () => {
    const r = seed()
    const exec = countingExecutor()
    let report!: { content: string; isError?: boolean }
    await runGenerate({
      repoRoot: r,
      executor: exec.executor,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        report = await task.runScenario(
          scenarioYaml(raw('step 1 claims milestone 4', [{ run: ['--version'], expect: { exit: 0 }, milestone: 4 }] as never)),
        )
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: 'pre-flight' } }
      }),
    })

    expect(report.isError).toBe(true)
    expect(report.content).toContain('match no milestone of this flow')
    expect(exec.calls).toBe(0)
  })

  it('a step repeating the entrypoint is a composition defect, unexecuted', async () => {
    const r = seed()
    const exec = countingExecutor()
    let report!: { content: string; isError?: boolean }
    await runGenerate({
      repoRoot: r,
      executor: exec.executor,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        // The recipe entry is ["node", <bin>] — `run[0] === 'node'` repeats it.
        report = await task.runScenario(draft('repeats the entrypoint', [{ run: ['node', '--version'], expect: { exit: 0 } }]))
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: 'pre-flight' } }
      }),
    })

    expect(report.isError).toBe(true)
    expect(report.content).toContain('repeats the entrypoint')
    expect(exec.calls).toBe(0)
  })

  it('an invalid `matches` regex is refused, unexecuted, naming the step', async () => {
    const r = seed()
    const exec = countingExecutor()
    let report!: { content: string; isError?: boolean }
    await runGenerate({
      repoRoot: r,
      executor: exec.executor,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        report = await task.runScenario(
          draft('bad pattern', [{ run: ['--version'], expect: { exit: 0, stdout: { matches: '([unclosed' } } }]),
        )
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: 'pre-flight' } }
      }),
    })

    expect(report.isError).toBe(true)
    expect(report.content).toContain('is not a valid regular expression')
    expect(report.content).toContain('step 1')
    expect(exec.calls).toBe(0)
  })

  it('a reformatted doc example is refused, unexecuted, naming the carrier', async () => {
    const BLOCK = 'line one\n    indented line'
    const r = seed(
      ['## version', 'With this exact file as input, `relkit --version` prints the version:', '', '```txt', BLOCK, '```'].join(
        '\n',
      ),
    )
    const exec = countingExecutor()
    const reports: { content: string; isError?: boolean }[] = []
    await runGenerate({
      repoRoot: r,
      executor: exec.executor,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        reports.push(
          await task.runScenario(
            scenarioYaml(
              stampMilestones(
                raw('the version prints', PASSING_STEPS, { setup: { files: { 'input.txt': 'line one\nindented line' } } }),
                1,
              ),
            ),
          ),
        )
        // The byte-exact embedding then passes pre-flight and really runs.
        reports.push(
          await task.runScenario(
            scenarioYaml(stampMilestones(raw('the version prints', PASSING_STEPS, { setup: { files: { 'input.txt': BLOCK } } }), 1)),
          ),
        )
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 2, lastEvidence: 'probe only' } }
      }),
    })

    expect(reports[0].isError).toBe(true)
    expect(reports[0].content).toContain('pre-flight defect (not executed)')
    expect(reports[0].content).toContain('setup.files["input.txt"]')
    expect(exec.calls).toBe(1) // only the byte-exact draft reached a sandbox
    expect(reports[1].isError).toBeUndefined()
    expect(reports[1].content).toContain('PASS')
  }, 60_000)

  it('unparseable yaml is refused as an error, unexecuted', async () => {
    const r = seed()
    const exec = countingExecutor()
    let report!: { content: string; isError?: boolean }
    await runGenerate({
      repoRoot: r,
      executor: exec.executor,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        report = await task.runScenario('title: [unterminated\n')
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: 'pre-flight' } }
      }),
    })
    expect(report.isError).toBe(true)
    expect(exec.calls).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 2. Run refusals — recorded once, and they end the flow rather than thrash
// ---------------------------------------------------------------------------

describe('run refusals end the flow, never a thrash', () => {
  it('a refusing executor is recorded ONCE and never re-invoked by a second run', async () => {
    const r = seed()
    let execCalls = 0
    const refusing: GuardExecutor = async () => {
      execCalls++
      return {
        status: 'missing-credential-env',
        message: 'GUARD_TOKEN is not set',
      } as never
    }
    const reports: { content: string; isError?: boolean }[] = []
    const res = await runGenerate({
      repoRoot: r,
      executor: refusing,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        reports.push(await task.runScenario(draft('probe', PASSING_STEPS)))
        reports.push(await task.runScenario(draft('probe again', PASSING_STEPS)))
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 2, lastEvidence: 'the runner refused' } }
      }),
    })

    expect(reports[0].isError).toBe(true)
    expect(reports[0].content).toContain('the runner REFUSED the run')
    expect(reports[0].content).toContain('GUARD_TOKEN is not set')
    // The latch: the second call short-circuits without touching the executor.
    expect(reports[1].isError).toBe(true)
    expect(execCalls).toBe(1)

    // Exactly ONE run-level refusal error, and the refusal rides the result.
    expect(res.refusal).toMatchObject({ status: 'missing-credential-env' })
    expect(res.errors.filter((e) => e.message.includes('GUARD_TOKEN'))).toHaveLength(1)
    expect(res.written).toEqual([])
    // Refused ⇒ the flow is unsettled, and no gap was invented for it.
    expect(res.coverageGaps.filter((g) => g.flowId === 'version')).toEqual([])
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'version')!.generationInputsHash).toBeNull()
  })

  it('one refusal covers every task — N flows record ONE refusal error', async () => {
    const r = seed(
      ['## version', '`relkit --version` prints the version and exits 0.', '', '## boom', '`relkit boom` exits 7.'].join('\n'),
    )
    const refusing: GuardExecutor = async () => ({ status: 'missing-credential-env', message: 'no creds' }) as never
    const res = await runGenerate({
      repoRoot: r,
      executor: refusing,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        await task.runScenario(draft('probe', PASSING_STEPS))
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: 'refused' } }
      }),
    })

    expect(res.errors.filter((e) => e.message.includes('no creds'))).toHaveLength(1)
    expect(res.written).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 3. The red-prediction gate
// ---------------------------------------------------------------------------

describe('submit_scenario — the red-prediction gate', () => {
  /** Submit `yaml` with `expectedReds` and return the engine's report. */
  async function submitOnce(
    r: string,
    submissions: (task: FlowWorkerTask) => Promise<void>,
  ): Promise<void> {
    await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        await submissions(task)
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: 'probe only' } }
      }),
    })
  }

  it('a red with no prediction is refused; a wrong step is refused; the honest prediction is accepted', async () => {
    const r = seed()
    const redYaml = draft('boom exits 0 (it does not)', FAILING_STEPS)
    const reports: Record<string, { content: string; isError?: boolean }> = {}
    await submitOnce(r, async (task) => {
      reports.none = await task.submitScenario(redYaml, [], faithfulJudge)
      reports.wrongStep = await task.submitScenario(
        redYaml,
        [{ step: 3, predictedActual: 'exit 7', verdict: 'code-drift', brief: 'b' }],
        faithfulJudge,
      )
      // The honest prediction: copy the actual out of the engine's own report.
      const actual = /actual:\s+(.*)/.exec(reports.none.content)?.[1] ?? ''
      reports.honest = await task.submitScenario(
        redYaml,
        [{ step: 1, predictedActual: actual, verdict: 'code-drift', brief: 'the doc says 0, the code exits 7' }],
        faithfulJudge,
      )
      reports.mispredicted = await task.submitScenario(
        redYaml,
        [{ step: 1, predictedActual: 'exit code 99', verdict: 'code-drift', brief: 'b' }],
        faithfulJudge,
      )
    })

    expect(reports.none.isError).toBe(true)
    expect(reports.none.content).toContain('declared no expectedReds')

    expect(reports.wrongStep.isError).toBe(true)
    expect(reports.wrongStep.content).toContain('execution stops at the FIRST red step')

    expect(reports.honest.isError).toBeUndefined()
    expect(reports.honest.content.startsWith('accepted')).toBe(true)
    expect(acceptedSha(reports.honest)).toMatch(/^[0-9a-f]{64}$/)

    expect(reports.mispredicted.isError).toBe(true)
    expect(reports.mispredicted.content).toContain('does not match your predictedActual')
  }, 60_000)

  it('a GREEN submitted with expectedReds is refused', async () => {
    const r = seed()
    let report!: { content: string; isError?: boolean }
    await submitOnce(r, async (task) => {
      report = await task.submitScenario(
        draft('the version prints', PASSING_STEPS),
        [{ step: 1, predictedActual: 'nope', verdict: 'doc-drift', brief: 'b' }],
        faithfulJudge,
      )
    })
    expect(report.isError).toBe(true)
    expect(report.content).toContain('the confirmation run is GREEN')
  }, 60_000)
})

// ---------------------------------------------------------------------------
// 4. Engine-stash integrity
// ---------------------------------------------------------------------------

describe('the engine stash is what the fold persists', () => {
  it('the committed file is the stashed yaml, and a committed red carries expectedRed and no triage', async () => {
    const r = seed()
    let stashed: string | undefined
    let declared: GuardExpectedRed | undefined
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        const redYaml = draft('boom exits 0 (it does not)', FAILING_STEPS)
        const probe = await task.submitScenario(redYaml, [], faithfulJudge)
        const actual = /actual:\s+(.*)/.exec(probe.content)?.[1] ?? ''
        declared = { step: 1, predictedActual: actual, verdict: 'code-drift', brief: 'the doc says 0, the code exits 7' }
        const accepted = await task.submitScenario(redYaml, [declared], faithfulJudge)
        const sha = acceptedSha(accepted)!
        expect(task.hasStash(sha)).toBe(true)
        stashed = task.stashedYaml(sha)
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [declared] } }
      }),
    })

    expect(res.written).toHaveLength(1)
    const committedBytes = fs.readFileSync(path.join(r, res.written[0].file), 'utf-8')
    expect(committedBytes).toBe(stashed)

    const entry = readManifest(r)!.flows.find((f) => f.flowId === 'version')!
    expect(entry.scenarios[0]).toMatchObject({ status: 'failing' })
    expect(entry.scenarios[0].diagnosis).toBeTruthy()
    expect(entry.scenarios[0].diagnosis!.expectedRed).toEqual(declared)
    expect(entry.scenarios[0].diagnosis!.triage).toBeUndefined()
    // A committed red SETTLES its flow — it is a decision surface, not a hole.
    expect(entry.generationInputsHash).not.toBeNull()

    const finding = res.birthFindings.find((f) => f.flowId === 'version')!
    expect(finding.committed).toBe(true)
    expect(finding.expectedRed).toEqual(declared)
  }, 60_000)

  it('a settled outcome naming a sha the engine never accepted leaves the flow unsettled', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        expect(task.hasStash('f'.repeat(64))).toBe(false)
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: 'f'.repeat(64), expectedReds: [] } }
      }),
    })

    expect(res.written).toEqual([])
    expect(res.errors.some((e) => e.message.includes('settled with a sha the engine never accepted'))).toBe(true)
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'version')!.generationInputsHash).toBeNull()
  })

  it('the stash is per-TASK: one task cannot claim another task’s accepted sha', async () => {
    const r = seed(
      ['## version', '`relkit --version` prints the version and exits 0.', '', '## boom', '`relkit boom` exits 7.'].join('\n'),
    )
    const shas: Record<string, string> = {}
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        const accepted = await task.submitScenario(draft(`${task.flowId} prints`, PASSING_STEPS), [], faithfulJudge)
        shas[task.flowId] = acceptedSha(accepted)!
        // The FIRST task's sha must be invisible to the second.
        const foreign = Object.entries(shas).find(([id]) => id !== task.flowId)?.[1]
        if (foreign) expect(task.hasStash(foreign)).toBe(false)
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: shas[task.flowId], expectedReds: [] } }
      }),
    })
    expect(res.written).toHaveLength(2)
  }, 90_000)
})

// ---------------------------------------------------------------------------
// 5. The routing fold — blocked / journey-defect / retired
// ---------------------------------------------------------------------------

describe('the routing fold', () => {
  it('blocked ⇒ a blocked-on gap whose noun went through enrichBlockedOn, flow SETTLED', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      interfaces: withExternalServices(DEFAULT_INTERFACES(r), { service: 'stripe', category: 'payment' }),
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions(() => ({
        blocked: [{ order: 1, capability: 'external-service' }],
      })),
    })

    const gap = res.coverageGaps.find((g) => g.kind === 'blocked-on')!
    expect(gap.flowId).toBe('version')
    expect(gap.reason).toContain('stripe')
    expect(gap.reason).not.toContain('external-service')
    // A gap accounts for the surface, so the flow settles.
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'version')!.generationInputsHash).not.toBeNull()
    expect(res.birthFindings).toEqual([])
  })

  it('journey-defect ⇒ an error naming the interface, flow unsettled, nothing written', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions(() => ({
        journeyDefect: { interfaceId: 'cli/relkit', detail: 'the derived command does not exist' },
      })),
    })

    const err = res.errors.find((e) => e.flowId === 'version')!
    expect(err.kind).toBe('authoring')
    expect(err.message).toContain('cli/relkit')
    expect(err.message).toContain('the derived command does not exist')
    expect(res.written).toEqual([])
    expect(res.coverageGaps.filter((g) => g.flowId === 'version')).toEqual([])
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'version')!.generationInputsHash).toBeNull()
  })

  it('retired under budget ⇒ a ledger bump sourced `worker` + a taint, no finding, unsettled', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions(() => ({
        retired: { attempts: 3, lastEvidence: 'no faithful scenario passes' },
      })),
    })

    expect(res.written).toEqual([])
    expect(res.birthFindings).toEqual([])
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.entries[KEY]).toMatchObject({ count: 1, source: 'worker' })
    expect(ledger.tainted[KEY]).toMatchObject({
      flowId: 'version',
      surface: 'cli',
      mismatch: 'no faithful scenario passes',
    })
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'version')!.generationInputsHash).toBeNull()
  })

  it('retired past the threshold ⇒ a withheld finding with the escalation, and NO further bump', async () => {
    const r = seed()
    writeGuardAutoResolutions(r, {
      version: 1,
      entries: { [KEY]: { count: 2, source: 'worker', updatedAt: '2026-07-01T00:00:00Z' } },
      tainted: {},
    })
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions(() => ({
        retired: { attempts: 4, lastEvidence: 'still no faithful scenario' },
      })),
    })

    expect(res.birthFindings).toHaveLength(1)
    expect(res.birthFindings[0].autoResolveEscalation).toEqual({ count: 2, source: 'worker' })
    expect(res.birthFindings[0].committed).toBeUndefined()
    expect(readGuardAutoResolutions(r).entries[KEY]).toMatchObject({ count: 2 })
  })

  it('a task the seam returned NO result for is an error, never a silent settle', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async () => undefined),
    })

    expect(res.errors.some((e) => e.message === 'flow worker (cli) never ran')).toBe(true)
    expect(res.written).toEqual([])
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'version')!.generationInputsHash).toBeNull()
  })

  it('a FAILED worker session is an error carrying the seam’s reason', async () => {
    const r = seed()
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async () => ({ kind: 'failed', reason: 'budget exhausted' })),
    })

    expect(res.errors.some((e) => e.message === 'flow worker (cli) budget exhausted')).toBe(true)
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'version')!.generationInputsHash).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 6. Taint: bypass and clear
// ---------------------------------------------------------------------------

describe('taint', () => {
  it('a tainted flow reaches its worker with `taint` set, and a settled outcome clears it', async () => {
    const r = seed()
    writeGuardAutoResolutions(r, {
      version: 1,
      entries: {},
      tainted: {
        [KEY]: {
          flowId: 'version',
          surface: 'cli',
          title: 'the prior scenario',
          mismatch: 'asserted nothing the section states',
          updatedAt: '2026-07-01T00:00:00Z',
        },
      },
    })
    let seen: FlowWorkerTask['taint']
    await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions(() => raw('the version prints', PASSING_STEPS), {
        onSubmit: () => undefined,
      }),
      onWorkerProgress: () => undefined,
    })
    // Re-run with a recording stub against the same (still tainted) ledger.
    writeGuardAutoResolutions(r, {
      version: 1,
      entries: {},
      tainted: {
        [KEY]: {
          flowId: 'version',
          surface: 'cli',
          title: 'the prior scenario',
          mismatch: 'asserted nothing the section states',
          updatedAt: '2026-07-01T00:00:00Z',
        },
      },
    })
    fs.rmSync(path.join(r, '.truecourse', 'scenarios', 'manifest.json'), { force: true })
    await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions((task) => {
        seen = task.taint
        return raw('the version prints', PASSING_STEPS)
      }),
    })

    expect(seen).toEqual({ title: 'the prior scenario', mismatch: 'asserted nothing the section states' })
    expect(readGuardAutoResolutions(r).tainted[KEY]).toBeUndefined()
  }, 90_000)

  it('a retired outcome re-records the taint with the new evidence', async () => {
    const r = seed()
    writeGuardAutoResolutions(r, {
      version: 1,
      entries: {},
      tainted: {
        [KEY]: { flowId: 'version', surface: 'cli', title: 'old', mismatch: 'old evidence', updatedAt: '2026-07-01T00:00:00Z' },
      },
    })
    await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions(() => ({ retired: { attempts: 2, lastEvidence: 'new evidence' } })),
    })
    expect(readGuardAutoResolutions(r).tainted[KEY]).toMatchObject({ mismatch: 'new evidence' })
  })
})

// ---------------------------------------------------------------------------
// 7. Wave ordering — the epic sees its members' settled scenarios
// ---------------------------------------------------------------------------

describe('wave ordering', () => {
  const DOC_A = 'docs/a.md'
  const DOC_B = 'docs/b.md'

  /** Two AREAS (the epic pass only runs when more than one area produced flows). */
  function seedEpicRepo(): string {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [
      { ref: DOC_A, areaTags: ['alpha'] },
      { ref: DOC_B, areaTags: ['beta'] },
    ])
    writeDoc(r, DOC_A, ['## version', '`relkit --version` prints the version and exits 0.'].join('\n'))
    writeDoc(r, DOC_B, ['## boom', '`relkit boom` exits 7.'].join('\n'))
    return r
  }

  const flowsSummary = {
    kind: 'guard-generate.flows',
    ran: 1,
    fromCache: 0,
    failed: 0,
    allTransport: true,
    spent: { turns: 0, tokens: 0, costUsd: 0 },
  } as const

  /** An epic pass chaining every area flow into ONE epic over both milestones. */
  const chainEverything: GenerateGuardsOptions['flowsEpicSession'] = async ({ digests }) => ({
    result: {
      ok: true,
      inputsKey: 'key:epic',
      value: {
        epics: [
          {
            title: 'version then boom',
            goal: 'chain both commands',
            composedOf: digests.map((d) => d.ref),
            milestones: digests.map((d, i) => ({ order: i + 1, ...d.milestones[0] })),
          },
        ],
      },
    },
    summary: { ...flowsSummary },
  })

  const workerSummary = (n: number) =>
    ({
      kind: 'guard-generate.flow-worker',
      ran: n,
      fromCache: 0,
      failed: 0,
      allTransport: true,
      spent: { turns: 0, tokens: 0, costUsd: 0 },
    }) as const

  it('members are wave 1 and the epic is wave 2; its briefing carries their stashed yamls', async () => {
    const r = seedEpicRepo()
    const waves: { tasks: string[]; epics: string[] } = { tasks: [], epics: [] }
    let epicBriefing = ''
    let memberYaml = ''
    let memberCounts: number[] = []
    let epicCount = 0
    await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowsEpicSession: chainEverything,
      flowWorkerSession: async ({ tasks, epicTasks }) => {
        waves.tasks = tasks.map((t) => t.flowId)
        waves.epics = epicTasks.map((t) => t.flowId)
        memberCounts = tasks.map((t) => t.milestoneCount)
        epicCount = epicTasks[0]?.milestoneCount ?? 0
        const out = new Map<string, FlowWorkerSessionResult>()
        // WAVE 1 — the members submit and accept.
        for (const task of tasks) {
          const accepted = await task.submitScenario(draft(`${task.flowId} works`, PASSING_STEPS), [], faithfulJudge)
          const sha = acceptedSha(accepted)!
          memberYaml ||= task.stashedYaml(sha)!
          out.set(task.workItem, { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } })
        }
        // WAVE 2 — the epic's briefing is built AFTER wave 1's acceptances.
        for (const task of epicTasks) {
          epicBriefing = await task.prepare()
          out.set(task.workItem, { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: 'briefing only' } })
        }
        return { byTask: out, summary: workerSummary(tasks.length + epicTasks.length) }
      },
    })

    expect(waves.tasks.sort()).toEqual(['boom', 'version'])
    expect(waves.epics).toEqual(['version-then-boom'])
    // The task states how many milestones its plan realizes, so a session can
    // build a draft that clears the pre-flight without re-deriving the plan.
    expect(memberCounts).toEqual([1, 1])
    expect(epicCount).toBe(2)
    expect(epicBriefing).toContain("MEMBER FLOWS' SETTLED SCENARIOS")
    expect(memberYaml).not.toBe('')
    // The member's yaml rides the briefing verbatim.
    expect(epicBriefing).toContain(memberYaml.trimEnd())
  }, 90_000)

  it('with no member acceptance the epic briefing carries no member block', async () => {
    const r = seedEpicRepo()
    let epicBriefing = ''
    await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowsEpicSession: chainEverything,
      flowWorkerSession: async ({ tasks, epicTasks }) => {
        const out = new Map<string, FlowWorkerSessionResult>()
        for (const task of [...tasks, ...epicTasks]) {
          if (task.epic) epicBriefing = await task.prepare()
          out.set(task.workItem, { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: 'nope' } })
        }
        return { byTask: out, summary: workerSummary(tasks.length + epicTasks.length) }
      },
    })

    expect(epicBriefing).not.toBe('')
    expect(epicBriefing).not.toContain("MEMBER FLOWS' SETTLED SCENARIOS")
  }, 60_000)
})

// ---------------------------------------------------------------------------
// 8. C4 — the no-op anomaly aborts before persist
// ---------------------------------------------------------------------------

describe('the C4 no-op anomaly abort', () => {
  it('trips inside run_scenario, aborts recipe-failed, and leaves the corpus untouched', async () => {
    const r = repo()
    writeRecipe(r, { build: 'true', entry: ['node', 'silent.mjs'] })
    fs.writeFileSync(
      path.join(r, 'silent.mjs'),
      [
        'const a = process.argv[2]',
        "if (a === undefined || a === '--help' || a === '--version') process.stdout.write('usage: silent\\n')",
        'process.exit(0)',
        '',
      ].join('\n'),
    )
    writeCorpus(r, [{ ref: DOC }])
    writeDoc(r, DOC, DOC_CONTENT)

    let aborted!: { content: string; isError?: boolean }
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      // The anomaly gate needs 20 executed steps: one scenario carries them all.
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        aborted = await task.runScenario(
          draft(
            'twenty no-ops',
            Array.from({ length: 20 }, () => ({ run: ['do'], expect: { exit: 0 } })),
          ),
        )
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: 'aborted' } }
      }),
      noOpThresholdMs: 100_000,
    })

    expect(aborted.isError).toBe(true)
    expect(aborted.content).toContain('run aborted')
    expect(res.status).toBe('recipe-failed')
    expect(res.reason).toContain('silent.mjs')
    expect(res.reason).toMatch(/20 of 20/)
    // Nothing persisted — the abort is before the persist stage.
    expect(res.written).toEqual([])
    expect(loadScenarios(r).scenarios).toEqual([])
    expect(readManifest(r)).toBeNull()
  }, 90_000)
})

// ---------------------------------------------------------------------------
// 9. Isolation (step 19) — every worker execution is a batch of ONE
// ---------------------------------------------------------------------------

describe('isolation', () => {
  it('every execution on the worker path runs exactly one scenario', async () => {
    const r = seed(
      ['## version', '`relkit --version` prints the version and exits 0.', '', '## boom', '`relkit boom` exits 7.'].join('\n'),
    )
    const exec = countingExecutor()
    const res = await runGenerate({
      repoRoot: r,
      executor: exec.executor,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        // Probe run + confirmation run: two executions, each of one scenario.
        await task.runScenario(draft(`${task.flowId} works`, PASSING_STEPS))
        const accepted = await task.submitScenario(draft(`${task.flowId} works`, PASSING_STEPS), [], faithfulJudge)
        return {
          kind: 'outcome',
          outcome: { kind: 'settled', scenarioYamlSha: acceptedSha(accepted)!, expectedReds: [] },
        }
      }),
    })

    expect(res.written).toHaveLength(2)
    expect(exec.calls).toBe(4)
    expect(exec.batchSizes).toEqual([1, 1, 1, 1])
  }, 90_000)
})

// ---------------------------------------------------------------------------
// 10. The fidelity judge, engine side (step 18)
// ---------------------------------------------------------------------------

describe('the fidelity judge’s engine half', () => {
  it('a HIGH flag self-heals in-loop; a second flag of ANY confidence REJECTS', async () => {
    const r = seed()
    const verdicts: Parameters<WorkerFidelityJudge>[0][] = []
    const reports: { content: string; isError?: boolean }[] = []
    let call = 0
    const judge: WorkerFidelityJudge = async (input) => {
      verdicts.push(input)
      call++
      return call === 1
        ? { kind: 'flagged', mismatch: 'm1', confidence: 'high' }
        : { kind: 'flagged', mismatch: 'm2', confidence: 'low' }
    }
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        reports.push(await task.submitScenario(draft('first try', PASSING_STEPS), [], judge))
        reports.push(await task.submitScenario(draft('revised', PASSING_STEPS), [], judge))
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 2, lastEvidence: 'the judge rejected it' } }
      }),
    })

    // The judge saw the flow's material and the confirmation capture.
    expect(verdicts[0].flowFingerprint).toBeTruthy()
    expect(verdicts[0].briefing).toContain('CONFIRMATION CAPTURE')
    expect(verdicts[0].scenarioBehavior).not.toBe(verdicts[1].scenarioBehavior)

    expect(reports[0].isError).toBe(true)
    expect(reports[0].content).toContain('flagged the scenario (high confidence)')
    expect(reports[0].content).toContain('Revise')

    expect(reports[1].isError).toBe(true)
    expect(reports[1].content).toContain('REJECTED')
    expect(reports[1].content).toContain('(low)')

    // The rejection is the record: a fidelity finding, a taint, and exactly ONE
    // ledger bump for the run — sourced `fidelity`, not a second `worker` one.
    expect(res.written).toEqual([])
    const finding = res.birthFindings.find((f) => f.flowId === 'version')!
    expect(finding.actual).toContain('m2')
    const ledger = readGuardAutoResolutions(r)
    expect(ledger.entries[KEY]).toMatchObject({ count: 1, source: 'fidelity' })
    // The taint is (re)recorded; the LAST writer wins its `mismatch`, and the
    // retirement runs after the rejection — so it carries the retirement evidence.
    expect(ledger.tainted[KEY]).toMatchObject({ flowId: 'version', surface: 'cli' })
  }, 90_000)

  it('past the threshold a HIGH flag never self-heals — it rejects with the escalation', async () => {
    const r = seed()
    writeGuardAutoResolutions(r, {
      version: 1,
      entries: { [KEY]: { count: 2, source: 'fidelity', updatedAt: '2026-07-01T00:00:00Z' } },
      tainted: {},
    })
    let report!: { content: string; isError?: boolean }
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        report = await task.submitScenario(draft('first try', PASSING_STEPS), [], async () => ({
          kind: 'flagged',
          mismatch: 'still wrong',
          confidence: 'high',
        }))
        return { kind: 'outcome', outcome: { kind: 'retired', attempts: 1, lastEvidence: 'rejected' } }
      }),
    })

    expect(report.isError).toBe(true)
    expect(report.content).toContain('REJECTED')
    expect(res.birthFindings).toHaveLength(1)
    expect(res.birthFindings[0].autoResolveEscalation).toEqual({ count: 2, source: 'fidelity' })
    expect(readGuardAutoResolutions(r).entries[KEY]).toMatchObject({ count: 2 })
  }, 60_000)

  it('an UNAVAILABLE judge accepts the green unreviewed — persisted, unsettled, unadjudicated', async () => {
    const r = seed()
    let accepted!: { content: string; isError?: boolean }
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions(() => raw('the version prints', PASSING_STEPS), {
        judge: async () => ({ kind: 'unavailable', reason: 'the child session died' }),
        onSubmit: (_t, report) => (accepted = report),
        fidelitySummary: {
          kind: 'guard-generate.fidelity',
          ran: 1,
          fromCache: 0,
          failed: 1,
          allTransport: true,
          firstError: 'the child session died',
          spent: { turns: 0, tokens: 0, costUsd: 0 },
        },
      }),
    })

    expect(accepted.isError).toBeUndefined()
    expect(accepted.content).toContain('UNREVIEWED')
    // The green is committed, but its flow does not settle and the run says so.
    expect(res.written).toHaveLength(1)
    expect(res.written[0].status).toBe('passing')
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'version')!.generationInputsHash).toBeNull()
    expect(res.unadjudicated).toEqual([{ stage: 'guard.fidelity', affected: 1 }])
  }, 60_000)

  it('an unreviewed green is never stashed for the cache — `stashedYaml` withholds it', async () => {
    const r = seed()
    let yamlBack: string | undefined
    let hasStash = false
    await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        const accepted = await task.submitScenario(draft('the version prints', PASSING_STEPS), [], async () => ({
          kind: 'unavailable',
          reason: 'no child',
        }))
        const sha = acceptedSha(accepted)!
        hasStash = task.hasStash(sha)
        yamlBack = task.stashedYaml(sha)
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
      }),
    })

    expect(hasStash).toBe(true) // the fold still persists it
    expect(yamlBack).toBeUndefined() // …but core writes NO cache entry
  }, 60_000)

  it('a faithful verdict accepts without any note', async () => {
    const r = seed()
    let accepted!: { content: string; isError?: boolean }
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: submitWorkerSessions(() => raw('the version prints', PASSING_STEPS), {
        onSubmit: (_t, report) => (accepted = report),
      }),
    })
    expect(accepted.content).not.toContain('UNREVIEWED')
    expect(res.written).toHaveLength(1)
    expect(res.unadjudicated).toEqual([])
    expect(readManifest(r)!.flows.find((f) => f.flowId === 'version')!.generationInputsHash).not.toBeNull()
  }, 60_000)
})

// ---------------------------------------------------------------------------
// 11. confirmCached — the cached-settled verification (engine half)
// ---------------------------------------------------------------------------

describe('confirmCached', () => {
  it('re-runs the cached yaml and stands only when the verdict still reproduces', async () => {
    const r = seed()
    let firstAccepted = ''
    // Round 1: settle the flow and keep the committed yaml.
    await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        const accepted = await task.submitScenario(draft('the version prints', PASSING_STEPS), [], faithfulJudge)
        const sha = acceptedSha(accepted)!
        firstAccepted = task.stashedYaml(sha)!
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
      }),
    })
    expect(firstAccepted).not.toBe('')

    // Round 2, forced to re-author: `confirmCached` on the SAME yaml stands
    // (green, no predictions) and re-stashes it for the fold.
    fs.rmSync(path.join(r, '.truecourse', 'scenarios', 'manifest.json'), { force: true })
    let confirmed: boolean | undefined
    let mispredicted: boolean | undefined
    const res = await runGenerate({
      repoRoot: r,
      extractSession: extractSessionBy({}),
      flowWorkerSession: flowWorkerSessionOf(async (task) => {
        mispredicted = await task.confirmCached([
          {
            yaml: firstAccepted,
            expectedReds: [{ step: 1, predictedActual: 'never happens', verdict: 'code-drift', brief: 'b' }],
          },
        ])
        confirmed = await task.confirmCached([{ yaml: firstAccepted, expectedReds: [] }])
        const sha = yamlSha(firstAccepted)
        expect(task.hasStash(sha)).toBe(true)
        return { kind: 'outcome', outcome: { kind: 'settled', scenarioYamlSha: sha, expectedReds: [] } }
      }),
    })

    // A green run with a declared red does NOT reproduce: the entry is a miss.
    expect(mispredicted).toBe(false)
    expect(confirmed).toBe(true)
    expect(res.written).toHaveLength(1)
    expect(fs.readFileSync(path.join(r, res.written[0].file), 'utf-8')).toBe(firstAccepted)
  }, 90_000)
})

