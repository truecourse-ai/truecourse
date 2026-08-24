/**
 * `truecourse guard findings` — the read surface over the last generate's
 * findings, grouped by FLOW and split by whose fault each one is: `drift` (a
 * committed red test — the repo and the doc disagree), `defect` (ours — nothing
 * was committed), `escalation` (a defect re-generation keeps failing to fix).
 *
 * The `--json` envelope is the agent contract, so its SHAPE is pinned here: the
 * counts, the flow groups, every finding's own fields carried through verbatim
 * beside the derived `class`, and the auto-resolved ledger.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeGuardResult } from '@truecourse/guard-runner'
import { guardFindingClass, type GuardGenerateReport } from '@truecourse/shared'
import { runGuardFindings } from '../../tools/cli/src/commands/guard-findings'
import { makeTempRepo, rmrf } from '../guard-runner/helpers.js'

const repos: string[] = []
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})

const DOC = 'docs/specs/tasks.md'

function report(over: Partial<GuardGenerateReport> = {}): GuardGenerateReport {
  return {
    generatedAt: '2026-08-01T03:04:05.000Z',
    status: 'ok',
    sectionsTotal: 3,
    sectionsChanged: 1,
    skippedUnchanged: 2,
    noChanges: false,
    written: [],
    coverageGaps: [],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
    ...over,
  }
}

/** A committed red scenario — triage blamed the repo, so `guard run` reproduces it. */
const DRIFT = {
  doc: DOC,
  anchor: 'tasks/completing-tasks',
  kind: 'birth' as const,
  scenarioId: 'task-lifecycle.cli.1',
  committed: true,
  file: '.truecourse/scenarios/tasks/task-lifecycle.cli.1.yaml',
  flowId: 'task-lifecycle',
  surface: 'cli' as const,
  title: 'Completing a task reports it done',
  claim: 'A task can be marked done',
  step: 3,
  failedMilestone: 2,
  expected: 'stdout contains “Completed t1 ✓”',
  actual: 'Marked t1 as done',
  evidencePath: '.truecourse/guard/evidence/r1/task-lifecycle.cli.1',
  triage: {
    verdict: 'code-drift' as const,
    confidence: 'high' as const,
    brief: 'The doc promises `Completed t1 ✓`; the program prints `Marked t1 as done`.',
    recommendation: 'Fix the message, or update the doc if the new wording is intended.',
  },
}

/** A withheld generation defect — ours, and never a red scenario. */
const DEFECT = {
  doc: DOC,
  anchor: 'tasks/creating-tasks',
  kind: 'birth' as const,
  flowId: 'task-lifecycle',
  surface: 'api' as const,
  title: 'Creating a task returns it',
  step: 1,
  expected: 'status 201',
  actual: 'status 404',
  triage: {
    verdict: 'generation-defect' as const,
    confidence: 'high' as const,
    brief: 'The scenario asked /task, an endpoint the app never registered.',
    recommendation: 'Re-author against the route the app declares.',
  },
}

/** A defect the auto-resolve loop kept failing to fix — a human task. */
const ESCALATED = {
  doc: DOC,
  anchor: 'auth/rate-limits',
  kind: 'birth' as const,
  flowId: 'rate-limiting',
  surface: 'api' as const,
  title: 'Login rate-limits after 5 failed attempts',
  step: 6,
  expected: 'status 429',
  actual: 'status 200',
  autoResolveEscalation: { count: 3, source: 'triage' as const },
}

const LEDGER = [
  {
    kind: 'triage-resolve' as const,
    flowId: 'task-lifecycle',
    surface: 'api' as const,
    doc: DOC,
    anchor: 'tasks/creating-tasks',
    title: 'Creating a task returns it',
    verdict: 'generation-defect' as const,
    brief: 'the scenario asserted the wrong id shape',
  },
]

const FULL = report({ birthFindings: [DRIFT, DEFECT, ESCALATED], autoResolved: LEDGER })

describe('guardFindingClass — whose fault a finding says it is', () => {
  it('splits committed drift from our own withheld defects, escalation first', () => {
    expect(guardFindingClass(DRIFT)).toBe('drift')
    expect(guardFindingClass(DEFECT)).toBe('defect')
    // An escalation is a defect the loop kept failing to fix, so it outranks both.
    expect(guardFindingClass(ESCALATED)).toBe('escalation')
    // A fidelity rejection is never committed — ours, like any other defect.
    expect(guardFindingClass({ ...DEFECT, kind: 'fidelity' })).toBe('defect')
  })
})

describe('runGuardFindings — the terminal read', () => {
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

  it('exits 1 when no generate has ever run — the only nonzero exit', async () => {
    const r = repo()
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never)
    try {
      await expect(runGuardFindings({ cwd: r })).rejects.toThrow('process.exit(1)')
    } finally {
      exitSpy.mockRestore()
    }
    expect(out).toContain('guard generate')
  })

  it('exits 0 with a clean report — findings are news, not a gate', async () => {
    const r = repo()
    writeGuardResult(r, report())
    await runGuardFindings({ cwd: r })
    expect(out).toContain('No findings in the last generate.')
  })

  it('groups by flow and names each row by class, verdict and evidence', async () => {
    const r = repo()
    writeGuardResult(r, FULL)

    await runGuardFindings({ cwd: r })

    expect(out).toContain('findings    3 total · 1 drift · 1 tool defect · 1 escalated')
    // Grouped under the FLOW, not the doc›section.
    expect(out).toContain('task-lifecycle')
    expect(out).toContain('rate-limiting')
    // Drift: the verdict, the disagreement, the committed test, the evidence.
    expect(out).toContain('[drift] cli · Completing a task reports it done')
    expect(out).toContain('code-drift (high)')
    expect(out).toContain('do: Fix the message')
    expect(out).toContain('scenario: .truecourse/scenarios/tasks/task-lifecycle.cli.1.yaml')
    expect(out).toContain('evidence: .truecourse/guard/evidence/r1/task-lifecycle.cli.1')
    // Defect: OURS — it says nothing was committed and the flow re-authors.
    expect(out).toContain('[tool defect] api · Creating a task returns it')
    expect(out).toContain('withheld — no scenario was committed')
    // Escalation: the loop is not converging, so a human owns it.
    expect(out).toContain('[escalated] api · Login rate-limits after 5 failed attempts')
    expect(out).toContain('re-generation is not fixing this — 3 triage auto-resolutions')
    // The ledger rides under its own divider — an audit trail, not a task list.
    expect(out).toContain('auto-resolved (1)')
    expect(out).toContain('task-lifecycle · api — retired a generation-defect failure')
  })

  it('says so when a failing test committed with no verdict at all', async () => {
    const r = repo()
    const { triage: _dropped, ...untriaged } = DRIFT
    writeGuardResult(r, report({ birthFindings: [untriaged] }))
    await runGuardFindings({ cwd: r })
    expect(out).toContain('untriaged — no verdict was reached, so it committed as drift')
  })

  it('--kind narrows to one class; --flow narrows findings and the ledger alike', async () => {
    const r = repo()
    writeGuardResult(r, FULL)

    await runGuardFindings({ cwd: r, kind: 'drift' })
    expect(out).toContain('3 total · 1 match filter')
    expect(out).toContain('[drift]')
    expect(out).not.toContain('[tool defect]')
    // `--kind` names a FINDING class, and an auto-resolution is not a finding.
    expect(out).toContain('auto-resolved (1)')

    out = ''
    await runGuardFindings({ cwd: r, flow: 'rate-limiting' })
    expect(out).toContain('[escalated]')
    expect(out).not.toContain('[drift]')
    expect(out).not.toContain('auto-resolved')
  })

  it('refuses an unknown --kind rather than reporting a clean repo', async () => {
    const r = repo()
    writeGuardResult(r, FULL)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`)
    }) as never)
    try {
      await expect(runGuardFindings({ cwd: r, kind: 'birth' })).rejects.toThrow('process.exit(1)')
    } finally {
      exitSpy.mockRestore()
    }
    expect(out).toContain('drift | defect | escalation')
  })
})

describe('runGuardFindings --json — the agent contract', () => {
  let out: string
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    out = ''
    spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      out += args.map(String).join(' ')
    })
  })
  afterEach(() => spy.mockRestore())

  it('emits one stable envelope: counts, flow groups, and the ledger', async () => {
    const r = repo()
    writeGuardResult(r, FULL)

    await runGuardFindings({ cwd: r, json: true })
    const payload = JSON.parse(out)

    expect(payload).toMatchObject({
      generatedAt: '2026-08-01T03:04:05.000Z',
      filters: {},
      total: 3,
      matched: 3,
      counts: { drift: 1, defect: 1, escalation: 1 },
    })
    expect(payload.flows.map((f: { flowId: string }) => f.flowId)).toEqual([
      'task-lifecycle',
      'rate-limiting',
    ])
    // Each finding carries the DERIVED class plus its own fields, verbatim — an
    // agent reads the verdict and the evidence pointer without a second command.
    const [first] = payload.flows[0].findings
    expect(first).toMatchObject({
      class: 'drift',
      scenarioId: 'task-lifecycle.cli.1',
      surface: 'cli',
      committed: true,
      file: DRIFT.file,
      step: 3,
      failedMilestone: 2,
      expected: DRIFT.expected,
      actual: DRIFT.actual,
      evidencePath: DRIFT.evidencePath,
      triage: { verdict: 'code-drift', confidence: 'high' },
    })
    expect(payload.autoResolved).toEqual(LEDGER)
  })

  it('echoes the active filters and counts only what matched', async () => {
    const r = repo()
    writeGuardResult(r, FULL)

    await runGuardFindings({ cwd: r, kind: 'defect', json: true })
    const payload = JSON.parse(out)

    expect(payload.filters).toEqual({ kind: 'defect' })
    expect(payload).toMatchObject({ total: 3, matched: 1, counts: { drift: 0, defect: 1, escalation: 0 } })
    expect(payload.flows).toHaveLength(1)
  })

  it('emits the envelope for a clean report too — never an empty stdout', async () => {
    const r = repo()
    writeGuardResult(r, report())
    await runGuardFindings({ cwd: r, json: true })
    expect(JSON.parse(out)).toMatchObject({ total: 0, matched: 0, flows: [], autoResolved: [] })
  })
})
