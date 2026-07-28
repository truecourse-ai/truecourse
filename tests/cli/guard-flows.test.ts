/**
 * The flow-led CLI surfaces: `truecourse guard flows` (list + `--show`), the flow
 * instance a failing `guard run` prints, and the estimate prompt's honest bound
 * line. Fixtures mirror the design doc's taskbird worked example — one flow whose
 * four milestones span three sections, realized on api and awaiting the web driver.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { flowsPath } from '@truecourse/guard-generator'
import { writeManifest, writeGuardLatest } from '@truecourse/guard-runner'
import {
  flowFingerprint,
  GUARD_FORMAT_VERSION,
  type GuardFlow,
  type GuardFlowMilestone,
  type GuardLatest,
  type GuardManifest,
  type GuardManifestFlow,
  type GuardScenarioResult,
} from '@truecourse/shared'
import { runGuardFlows } from '../../tools/cli/src/commands/guard-flows'
import { failureDetailLines, runGuardRun } from '../../tools/cli/src/commands/guard'
import { promptLlmEstimate } from '../../tools/cli/src/commands/llm-prompt'
import {
  flowInstanceLine,
  milestoneChain,
  milestoneLabel,
} from '../../tools/cli/src/lib/guard-flow-format'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeScenario,
  scenario,
  apiScenario,
  specBinds,
} from '../guard-runner/helpers.js'

const repos: string[] = []
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

// ---------------------------------------------------------------------------
// The taskbird fixture — spec → flow → manifest → run, exactly the design doc's
// worked example (one flow, four milestones, three sections, api + web).
// ---------------------------------------------------------------------------

const DOC = 'docs/specs/tasks.md'

function m(order: number, anchor: string, claimTitle: string): GuardFlowMilestone {
  return { order, doc: DOC, anchor, claimTitle }
}

const TASK_LIFECYCLE: GuardFlowMilestone[] = [
  m(1, 'tasks/creating-tasks', 'Creating a task returns it with an id'),
  m(2, 'tasks/listing-tasks', 'The list shows tasks newest-first'),
  m(3, 'tasks/completing-tasks', 'A task can be marked done'),
  m(4, 'tasks/completing-tasks', 'Done tasks appear under the done filter'),
]

const RATE_LIMITING: GuardFlowMilestone[] = [
  m(1, 'auth/rate-limits', 'Login rate-limits after 5 failed attempts'),
]

function flow(id: string, title: string, goal: string, milestones: GuardFlowMilestone[]): GuardFlow {
  const anchors = [...new Set(milestones.map((x) => x.anchor))]
  return {
    id,
    title,
    goal,
    fingerprint: flowFingerprint(milestones),
    milestones,
    bindings: anchors.map((anchor) => ({ doc: DOC, anchor, fingerprint: `sha256:${anchor}` })),
    composedOf: [],
    synthesisInputsHash: 'sha256:inputs',
  }
}

function writeFlows(r: string, flows: GuardFlow[], noFlowClaims: { doc: string; anchor: string; claimTitle: string; reason: string }[] = []): void {
  const target = flowsPath(r)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(
    target,
    JSON.stringify({ version: 1, generatedAt: '2026-07-24T13:40:00.000Z', flows, noFlowClaims }, null, 2),
  )
}

function manifestFlow(over: Partial<GuardManifestFlow> & Pick<GuardManifestFlow, 'flowId'>): GuardManifestFlow {
  return {
    flowFingerprint: 'sha256:flow',
    bindings: [{ doc: DOC, anchor: 'tasks/creating-tasks', fingerprint: 'sha256:tasks/creating-tasks' }],
    scenarios: [],
    generationInputsHash: null,
    gaps: [],
    ...over,
  }
}

function manifest(flows: GuardManifestFlow[]): GuardManifest {
  return { version: GUARD_FORMAT_VERSION, flows }
}

function result(over: Partial<GuardScenarioResult> & Pick<GuardScenarioResult, 'id' | 'outcome'>): GuardScenarioResult {
  return {
    title: over.id,
    binds: { doc: DOC, section: 'tasks/creating-tasks', fingerprint: 'sha256:tasks/creating-tasks' },
    durationMs: 12,
    ...over,
  }
}

function latest(scenarios: GuardScenarioResult[]): GuardLatest {
  const summary = { total: scenarios.length, pass: 0, fail: 0, stale: 0, orphaned: 0, error: 0 }
  for (const s of scenarios) summary[s.outcome]++
  return {
    run: {
      runId: '2026-07-24_9f2c',
      ranAt: '2026-07-24T14:02:00.000Z',
      branch: 'main',
      commit: 'deadbeefcafef00d',
      recipeFingerprint: 'sha256:r',
      scenarioFormat: GUARD_FORMAT_VERSION,
    },
    summary,
    scenarios,
    sections: [],
  }
}

/** The taskbird store: three flows, one realized on api with a web gap. */
async function seedTaskbird(r: string): Promise<void> {
  writeFlows(r, [
    flow('task-lifecycle', 'Task lifecycle', 'A user creates a task, sees it listed, completes it, and sees it done', TASK_LIFECYCLE),
    flow('rate-limiting', 'Login rate limiting', 'Repeated bad logins stop being accepted', RATE_LIMITING),
  ])
  await writeManifest(
    r,
    manifest([
      manifestFlow({
        flowId: 'task-lifecycle',
        bindings: [...new Set(TASK_LIFECYCLE.map((x) => x.anchor))].map((anchor) => ({
          doc: DOC,
          anchor,
          fingerprint: `sha256:${anchor}`,
        })),
        scenarios: [{ id: 'task-lifecycle.api.1', surface: 'api' }],
        gaps: [
          {
            surface: 'web',
            kind: 'awaiting-driver',
            driver: 'web',
            reason: 'the web driver is not runnable yet',
          },
        ],
      }),
      manifestFlow({
        flowId: 'rate-limiting',
        bindings: [{ doc: DOC, anchor: 'auth/rate-limits', fingerprint: 'sha256:auth/rate-limits' }],
        scenarios: [{ id: 'rate-limiting.api.1', surface: 'api' }],
      }),
    ]),
  )
  writeScenario(
    r,
    'api/task-lifecycle.yaml',
    apiScenario({
      id: 'task-lifecycle.api.1',
      title: 'Tasks are created, listed newest-first, completed, and filterable as done',
      flow: { id: 'task-lifecycle', fingerprint: 'sha256:41ac' },
      journey: {
        path: ['api/create-task', 'api/list-tasks', 'api/complete-task'],
        fingerprints: ['sha256:9b', 'sha256:c2', 'sha256:77'],
      },
      binds: specBinds('a/b'),
      steps: [{ request: { method: 'POST', path: '/tasks' }, expect: { status: 201 }, milestone: 1 }],
    }),
  )
}

// ---------------------------------------------------------------------------

describe('runGuardFlows — the inventory', () => {
  let out: string
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    out = ''
    spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk)
      return true
    })
  })
  afterEach(() => spy.mockRestore())

  it('points at `guard generate` when nothing has been synthesized', async () => {
    const r = repo()
    await runGuardFlows({ cwd: r })
    expect(out).toContain('No flows yet')
    expect(out).toContain('guard generate')
  })

  it('renders the header tally and one row per flow with per-surface chips', async () => {
    const r = repo()
    await seedTaskbird(r)

    await runGuardFlows({ cwd: r })

    expect(out).toContain('FLOWS (2) · 1 guarded · 1 gap')
    // The gap flow sorts first and carries both surfaces as chips.
    expect(out).toMatch(/✗ task-lifecycle\s+api ✓ · web awaiting driver\s+4 milestones · 3 sections/)
    expect(out).toMatch(/✓ rate-limiting\s+api ✓\s+1 milestone · 1 section/)
    expect(out).toContain('guard flows --show')
  })

  it('a flow synthesized but never generated reads "not generated", never "guarded"', async () => {
    const r = repo()
    writeFlows(r, [flow('rate-limiting', 'Login rate limiting', 'g', RATE_LIMITING)])

    await runGuardFlows({ cwd: r })

    expect(out).toContain('FLOWS (1) · 0 guarded · 0 gap · 1 not generated')
    expect(out).toContain('not generated')
  })

  it('paints the last run outcome over the coverage glyph', async () => {
    const r = repo()
    await seedTaskbird(r)
    await writeGuardLatest(r, latest([result({ id: 'task-lifecycle.api.1', outcome: 'fail' })]))

    await runGuardFlows({ cwd: r })

    expect(out).toMatch(/✗ task-lifecycle\s+api ✗/)
  })

  it('surfaces the claims synthesis left out of every flow', async () => {
    const r = repo()
    writeFlows(
      r,
      [flow('rate-limiting', 'Login rate limiting', 'g', RATE_LIMITING)],
      [{ doc: DOC, anchor: 'tasks/notes', claimTitle: 'Notes are markdown', reason: 'no user-visible path' }],
    )

    await runGuardFlows({ cwd: r })
    expect(out).toContain('1 claim in no flow')
  })
})

describe('runGuardFlows --show — the drill-down', () => {
  let out: string
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    out = ''
    spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk)
      return true
    })
  })
  afterEach(() => spy.mockRestore())

  it('shows goal, milestones, binds, surfaces, journeys and gaps', async () => {
    const r = repo()
    await seedTaskbird(r)

    await runGuardFlows({ cwd: r, show: 'task-lifecycle' })

    expect(out).toContain('Task lifecycle — A user creates a task, sees it listed, completes it, and sees it done')
    expect(out).toContain('milestones  1 Creating a task retur… → 2 The list shows tasks…')
    expect(out).toContain('→ 4 Done tasks appear und…')
    expect(out).toContain('binds       docs/specs/tasks.md  §tasks/creating-tasks · §tasks/listing-tasks · §tasks/completing-tasks')
    expect(out).toContain('surfaces    api → task-lifecycle.api.1 (birth ✓) · web → awaiting driver')
    expect(out).toContain('journeys    api/create-task · api/list-tasks · api/complete-task')
    expect(out).toContain('gaps        web: awaiting web driver')
  })

  it('shows the run outcome (not birth) once a run has results', async () => {
    const r = repo()
    await seedTaskbird(r)
    await writeGuardLatest(
      r,
      latest([result({ id: 'task-lifecycle.api.1', outcome: 'fail', failedMilestone: 3, journeyDrifted: true })]),
    )

    await runGuardFlows({ cwd: r, show: 'task-lifecycle' })

    expect(out).toContain('api → task-lifecycle.api.1 (fail ✗ · journey drifted)')
  })

  it('errors with the known ids and exits 1 on an unknown flow id', async () => {
    const r = repo()
    await seedTaskbird(r)
    let exitCode: number | null = null
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code ?? 0
      throw new Error(`process.exit(${code})`)
    }) as never)
    try {
      await runGuardFlows({ cwd: r, show: 'nope' })
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith('process.exit(')) throw e
    } finally {
      exitSpy.mockRestore()
    }
    expect(out).toContain('No flow with id `nope`')
    expect(out).toContain('known ids: task-lifecycle')
    expect(exitCode).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// The flow instance — the milestone paint a failing run prints.
// ---------------------------------------------------------------------------

describe('flowInstanceLine', () => {
  it('paints passed → failed → not reached', () => {
    expect(flowInstanceLine(TASK_LIFECYCLE, 3)).toBe(
      'Creating a task r… ✓ ── The list shows ta… ✓ ── A task can be mar… ✗ ── Done tasks appear… · not reached',
    )
  })

  it('omits the not-reached tail when the LAST milestone failed', () => {
    const line = flowInstanceLine(TASK_LIFECYCLE, 4)!
    expect(line).toContain('Done tasks appear… ✗')
    expect(line).not.toContain('not reached')
  })

  it('returns null when the failure carries no milestone or an unknown one', () => {
    expect(flowInstanceLine(TASK_LIFECYCLE, undefined)).toBeNull()
    expect(flowInstanceLine(TASK_LIFECYCLE, 9)).toBeNull()
    expect(flowInstanceLine([], 1)).toBeNull()
  })

  it('milestone labels collapse whitespace and clip long claims', () => {
    expect(milestoneLabel('A  task\ncan be marked done', 40)).toBe('A task can be marked done')
    expect(milestoneChain(RATE_LIMITING, 40)).toBe('1 Login rate-limits after 5 failed attemp…')
  })
})

describe('failureDetailLines', () => {
  const flows = new Map([['task-lifecycle', flow('task-lifecycle', 't', 'g', TASK_LIFECYCLE)]])

  it('prints the flow instance under a failure with a milestone', () => {
    const lines = failureDetailLines(
      result({ id: 'task-lifecycle.api.1', outcome: 'fail', flowId: 'task-lifecycle', failedMilestone: 3, failure: { step: 3, expected: 'e', actual: 'a' } }),
      flows,
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^ {4}Creating a task r… ✓ ── /)
    expect(lines[0]).toContain('· not reached')
  })

  it('falls back to the step line for a plumbing failure with no milestone', () => {
    const lines = failureDetailLines(
      result({ id: 'x.cli.1', outcome: 'fail', flowId: 'task-lifecycle', failure: { step: 2, expected: 'e', actual: 'a' } }),
      flows,
    )
    expect(lines).toEqual(['    failed at step 2'])
  })

  it('falls back for a hand-written scenario (no flow) and for an unknown flow', () => {
    expect(failureDetailLines(result({ id: 'h', outcome: 'fail', failedMilestone: 2, failure: { step: 2, expected: 'e', actual: 'a' } }), flows)).toEqual([
      '    failed at step 2',
    ])
    expect(
      failureDetailLines(result({ id: 'h', outcome: 'fail', flowId: 'gone', failedMilestone: 2, failure: { step: 2, expected: 'e', actual: 'a' } }), flows),
    ).toEqual(['    failed at step 2'])
  })

  it('annotates journey drift on its own line, never as an outcome', () => {
    const lines = failureDetailLines(
      result({ id: 'task-lifecycle.api.1', outcome: 'fail', flowId: 'task-lifecycle', failedMilestone: 2, journeyDrifted: true, failure: { step: 2, expected: 'e', actual: 'a' } }),
      flows,
    )
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('journey drifted')
  })

  // Item 60 (Phase 6): the blocked-precondition annotation reads as its own line —
  // "a setup step broke", not "the documented behavior drifted".
  it('annotates a blocked precondition above the drift line, never as an outcome', () => {
    const lines = failureDetailLines(
      result({ id: 'task-lifecycle.api.1', outcome: 'fail', flowId: 'task-lifecycle', blockedPrecondition: true, failure: { step: 1, expected: 'e', actual: 'a' } }),
      flows,
    )
    // No milestone to place, so the step line leads; the annotation follows it.
    expect(lines).toEqual([
      '    failed at step 1',
      '    ⊘ blocked precondition — a setup step failed before any specified behavior was reached',
    ]);
    // Both annotations can ride the same failure, blocked-precondition first.
    const both = failureDetailLines(
      result({ id: 'task-lifecycle.api.1', outcome: 'fail', flowId: 'task-lifecycle', blockedPrecondition: true, journeyDrifted: true, failure: { step: 1, expected: 'e', actual: 'a' } }),
      flows,
    )
    expect(both).toHaveLength(3)
    expect(both[1]).toContain('blocked precondition')
    expect(both[2]).toContain('journey drifted')
  })

  it('adds nothing to a stale/orphaned result (it never executed)', () => {
    expect(failureDetailLines(result({ id: 's', outcome: 'stale', flowId: 'task-lifecycle' }), flows)).toEqual([])
  })
})

describe('runGuardRun — the flow instance in the failure output', () => {
  it('prints the milestone chain under the failing scenario', async () => {
    const r = repo()
    execSync('git init -q -b main', { cwd: r })
    writeRecipe(r)
    const milestones = [
      m(1, 'cli/version', 'The version prints and exits 0'),
      m(2, 'cli/boom', 'A bad command exits cleanly'),
      m(3, 'cli/whoami', 'whoami names the current user'),
    ]
    writeFlows(r, [flow('cli-lifecycle', 'CLI lifecycle', 'A user checks the version, runs a command, and sees who they are', milestones)])
    writeScenario(
      r,
      'cli/lifecycle.yaml',
      scenario({
        id: 'cli-lifecycle.cli.1',
        title: 'version, command, whoami',
        flow: { id: 'cli-lifecycle', fingerprint: 'sha256:f' },
        binds: specBinds('cli/version', 'cli/boom', 'cli/whoami'),
        steps: [
          { run: ['--version'], expect: { exit: 0 }, milestone: 1 },
          { run: ['boom'], expect: { exit: 0 }, milestone: 2 },
          { run: ['whoami'], expect: { exit: 0 }, milestone: 3 },
        ],
      }),
    )

    let exitCode: number | null = null
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code ?? 0
      throw new Error(`process.exit(${code})`)
    }) as never)
    const chunks: string[] = []
    const capture = ((chunk: unknown, ...rest: unknown[]) => {
      chunks.push(String(chunk))
      const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined
      cb?.()
      return true
    }) as never
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(capture)
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(capture)
    try {
      await runGuardRun({ cwd: r })
    } catch (e) {
      if (!(e instanceof Error) || !e.message.startsWith('process.exit(')) throw e
    } finally {
      outSpy.mockRestore()
      errSpy.mockRestore()
      exitSpy.mockRestore()
    }

    const printed = chunks.join('')
    expect(printed).toContain('✗ cli-lifecycle.cli.1')
    expect(printed).toContain('The version print… ✓ ── A bad command exi… ✗ ── whoami names the… · not reached')
    expect(exitCode).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// The estimate prompt's honest bound (a stage whose work count is an earlier
// stage's output can never quote a number the run might exceed).
// ---------------------------------------------------------------------------

describe('promptLlmEstimate — stage bounds', () => {
  let out: string
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    out = ''
    spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out += String(chunk)
      return true
    })
  })
  afterEach(() => spy.mockRestore())

  it('renders a stage bound line under the stage it belongs to', async () => {
    const ok = await promptLlmEstimate(
      {
        totalEstimatedTokens: 47_000,
        tiers: [],
        subjectLabel: '3 of 5 sections changed',
        estimatedCostUsd: 10.29,
        stages: [
          {
            stage: 'guardFlows',
            label: 'Synthesizing flows',
            model: 'sonnet',
            calls: 2,
            estimatedTokens: 41_000,
            estimatedCostUsd: 0.31,
            bound: 'flows ≤ runnable claims (23 today) — flow count is a synthesis output',
          },
          { stage: 'guardExtract', label: 'Extracting claims', model: 'sonnet', calls: 5, estimatedTokens: 6_000 },
        ],
      },
      { autoApprove: true, nouns: { verb: 'Generate' } },
    )

    expect(ok).toBe(true)
    expect(out).toContain('Synthesizing flows')
    expect(out).toContain('↳ flows ≤ runnable claims (23 today) — flow count is a synthesis output')
    // A stage without a bound prints no arrow line.
    expect(out.match(/↳/g)).toHaveLength(1)
  })
})
