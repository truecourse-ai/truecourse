/**
 * Scenario format v3 — the step vocabulary the hand-authored reference needs and
 * v2 could not carry: `git` / `write` / `delete` steps, per-step `cwd` / `tty` /
 * `note`, the combined-stream `output` matcher, milestones as a LIST of claim
 * identities, and the flow corpus's `kind` / `variantOf` / `notes` /
 * `startingState`.
 */

import { describe, it, expect } from 'vitest'
import {
  GUARD_FORMAT_VERSION,
  GuardCliStepSchema,
  GuardCliScenarioSchema,
  GuardFlowSchema,
  GuardFlowsFileSchema,
  GuardScenarioSchema,
  describeGuardScenario,
  describeGuardScenarioSteps,
  firstInvalidMatchPattern,
  hasMilestone,
  isDeleteStep,
  isGitStep,
  isProcessStep,
  isRunStep,
  isWriteStep,
  milestoneClaims,
  milestoneOrder,
  milestoneRefs,
} from '@truecourse/shared'

const BINDS = [{ doc: 'docs/spec.md', section: 'a/b', fingerprint: 'sha256:x' }]

/** A whole scenario using every v3 capability, as a reference file writes it. */
const V3_SCENARIO = {
  guard: GUARD_FORMAT_VERSION,
  id: 'commit-a-baseline.cli.1',
  title: 'A developer commits the baseline and refreshes it',
  binds: BINDS,
  driver: 'cli',
  normalize: [],
  setup: {
    files: { 'src/index.js': 'export const x = 1\n' },
    env: { TOOL_HOME: '${sandbox}/home' },
    git: {
      branch: 'main',
      identity: { name: 'TrueCourse Reference', email: 'reference@truecourse.test' },
      root: 'repo',
      commits: [{ files: ['src/index.js'], message: 'seed' }],
    },
  },
  steps: [
    {
      run: ['analyze'],
      cwd: 'repo',
      expect: { exit: 0 },
      note: 'The baseline the commit below is about.',
      milestone: ['analyze-writes-a-baseline', 'baseline-is-json'],
    },
    { write: { 'repo/src/added.js': 'export const y = 2\n' }, expect: { files: { 'repo/src/added.js': { exists: true } } } },
    { delete: ['repo/src/index.js'], expect: { files: { 'repo/src/index.js': { absent: true } } } },
    {
      git: ['commit', '--no-verify', '-m', 'add baseline'],
      cwd: 'repo',
      identity: { name: 'Other Dev', email: 'other@truecourse.test' },
      expect: { exit: 0 },
      milestone: 'no-verify-bypasses-the-hook',
    },
    {
      run: ['hooks', 'install'],
      tty: true,
      stdin: 'y\n',
      expect: { exit: 0, output: { contains: 'installed' } },
    },
  ],
} as const

describe('guard scenario format v3 — the step vocabulary', () => {
  it('is version 3', () => {
    expect(GUARD_FORMAT_VERSION).toBe(3)
  })

  it('round-trips a scenario using every new capability', () => {
    const parsed = GuardCliScenarioSchema.parse(V3_SCENARIO)
    expect(parsed.steps).toHaveLength(5)
    expect(parsed.setup?.git?.identity).toEqual({
      name: 'TrueCourse Reference',
      email: 'reference@truecourse.test',
    })
    expect(parsed.setup?.git?.root).toBe('repo')
    // The discriminated union routes it too (the loader's entry point).
    expect(GuardScenarioSchema.parse(V3_SCENARIO).driver).toBe('cli')
  })

  it('tells the four cli step kinds apart', () => {
    const [run, write, del, git, tty] = GuardCliScenarioSchema.parse(V3_SCENARIO).steps
    expect([isRunStep(run), isWriteStep(write), isDeleteStep(del), isGitStep(git)]).toEqual([
      true,
      true,
      true,
      true,
    ])
    expect(isProcessStep(write)).toBe(false)
    expect(isProcessStep(git)).toBe(true)
    expect(isRunStep(tty) && tty.tty).toBe(true)
  })

  it('carries per-step cwd, tty with scripted stdin, and the authoring note', () => {
    const steps = GuardCliScenarioSchema.parse(V3_SCENARIO).steps
    expect(steps[0].cwd).toBe('repo')
    expect(steps[0].note).toBe('The baseline the commit below is about.')
    expect(isRunStep(steps[4]) && steps[4].stdin).toBe('y\n')
  })

  it('accepts the combined-stream `output` matcher next to exit and files', () => {
    const step = GuardCliStepSchema.parse({
      run: ['analyze'],
      expect: { exit: 1, output: { matches: '(?=[\\s\\S]*[Rr]oslyn)[\\s\\S]*' } },
    })
    expect(isRunStep(step) && step.expect.output?.matches).toContain('Rr]oslyn')
    // …and the loader's regex check reaches into it, like stdout/stderr.
    expect(
      firstInvalidMatchPattern([
        GuardCliStepSchema.parse({ run: [], expect: { output: { matches: 'a[0-9' } } }),
      ]),
    ).toMatchObject({ step: 1, where: 'expect.output' })
  })

  it('carries SEVERAL milestones per step, by claim identity or by position', () => {
    const steps = GuardCliScenarioSchema.parse(V3_SCENARIO).steps
    expect(milestoneRefs(steps[0].milestone)).toEqual([
      'analyze-writes-a-baseline',
      'baseline-is-json',
    ])
    expect(milestoneClaims(steps[0].milestone)).toHaveLength(2)
    // A claim-only tag has no position — nothing resolves it until claims are stored.
    expect(milestoneOrder(steps[0].milestone)).toBeUndefined()
    expect(hasMilestone(steps[0].milestone)).toBe(true)
    expect(hasMilestone(steps[1].milestone)).toBe(false)
    // The positional form the engine emits still parses, and still resolves.
    const positional = GuardCliStepSchema.parse({ run: [], expect: {}, milestone: 2 })
    expect(milestoneOrder(positional.milestone)).toBe(2)
    expect(milestoneClaims(positional.milestone)).toEqual([])
    // A mixed list keeps both halves.
    const mixed = GuardCliStepSchema.parse({ run: [], expect: {}, milestone: [3, 'a-claim'] })
    expect(milestoneOrder(mixed.milestone)).toBe(3)
    expect(milestoneClaims(mixed.milestone)).toEqual(['a-claim'])
  })

  it('rejects an empty milestone list and a stream matcher on a write step', () => {
    expect(() => GuardCliStepSchema.parse({ run: [], expect: {}, milestone: [] })).toThrow()
    expect(() =>
      GuardCliStepSchema.parse({ write: { 'a.txt': 'x' }, expect: { exit: 0 } }),
    ).toThrow()
    expect(() => GuardCliStepSchema.parse({ delete: [], expect: {} })).toThrow()
    expect(() => GuardCliStepSchema.parse({ git: [], expect: {} })).toThrow()
  })

  it('a v2-shaped scenario body parses unchanged under v3', () => {
    const v2Body = {
      guard: GUARD_FORMAT_VERSION,
      id: 's.cli.1',
      title: 't',
      binds: BINDS,
      driver: 'cli',
      normalize: [],
      steps: [{ run: ['--version'], stdin: 'x', env: { A: 'b' }, repeat: 2, expect: { exit: 0 }, milestone: 1 }],
    }
    expect(() => GuardScenarioSchema.parse(v2Body)).not.toThrow()
  })
})

describe('guard scenario format v3 — how the new steps read', () => {
  it('renders every step kind in the structured step list', () => {
    const views = describeGuardScenarioSteps(V3_SCENARIO)
    expect(views.map((v) => v.command)).toEqual([
      'analyze',
      'write repo/src/added.js',
      'delete repo/src/index.js',
      'git commit --no-verify -m add baseline',
      'hooks install',
    ])
    expect(views[0]).toMatchObject({
      cwd: 'repo',
      claims: ['analyze-writes-a-baseline', 'baseline-is-json'],
      note: 'The baseline the commit below is about.',
    })
    expect(views[0].milestone).toBeUndefined()
    expect(views[4]).toMatchObject({ tty: true, expectation: 'exit 0 · output contains “installed”' })
    expect(views[1].expectation).toBe('repo/src/added.js exists')
  })

  it('tells the story of every step kind in words', () => {
    const story = describeGuardScenario(V3_SCENARIO)
    expect(story?.steps.map((s) => s.does)).toEqual([
      'run the program with `analyze`',
      'write repo/src/added.js',
      'delete repo/src/index.js',
      'run `git commit --no-verify -m add baseline`',
      'run the program with `hooks install`',
    ])
    expect(story?.steps[0].claims).toEqual(['analyze-writes-a-baseline', 'baseline-is-json'])
    expect(story?.steps[4].tty).toBe(true)
    expect(story?.steps[4].expectations).toContain(
      'the output (stdout and stderr together) contains “installed”',
    )
  })
})

describe('guard flow corpus — kind, variant, notes and the starting state', () => {
  const FLOW = {
    id: 'run-llm-rules-through-the-api-transport',
    title: 'A developer runs the LLM rules through the provider API',
    goal: 'A developer runs the LLM rules through the provider API',
    kind: 'variant',
    variantOf: 'analyze-a-repository-for-the-first-time',
    notes: 'One of the two configuration paths of the same capability.',
    startingState: {
      stepCreatable: ['the store and the analysis snapshot (analyze)'],
      seedable: ['env — the tool home inside the sandbox'],
      supplied: ['llm-api-credentials — a provider key the user registered'],
    },
    fingerprint: 'sha256:f',
    milestones: [{ order: 1, doc: 'docs/spec.md', anchor: 'a/b', claimTitle: 'c' }],
    bindings: [{ doc: 'docs/spec.md', anchor: 'a/b', fingerprint: 'sha256:x' }],
    composedOf: [],
    synthesisInputsHash: 'sha256:h',
  }

  it('round-trips the classification, the variant link and the dependency classes', () => {
    const flow = GuardFlowSchema.parse(FLOW)
    expect(flow.kind).toBe('variant')
    expect(flow.variantOf).toBe('analyze-a-repository-for-the-first-time')
    expect(flow.notes).toContain('configuration paths')
    expect(flow.startingState?.supplied).toHaveLength(1)
    expect(flow.startingState?.seedable).toHaveLength(1)
  })

  it('keeps them optional — a flow without them parses exactly as before', () => {
    const { kind, variantOf, notes, startingState, ...bare } = FLOW
    void [kind, variantOf, notes, startingState]
    const flow = GuardFlowSchema.parse(bare)
    expect(flow.kind).toBeUndefined()
    expect(flow.startingState).toBeUndefined()
  })

  it('rejects a kind outside the closed set, and defaults the missing state lists', () => {
    expect(() => GuardFlowSchema.parse({ ...FLOW, kind: 'smoke' })).toThrow()
    const flow = GuardFlowSchema.parse({ ...FLOW, startingState: { seedable: ['a git repo'] } })
    expect(flow.startingState).toEqual({ stepCreatable: [], seedable: ['a git repo'], supplied: [] })
  })

  it('rides the whole flows file', () => {
    const file = GuardFlowsFileSchema.parse({
      version: 1,
      generatedAt: '2026-08-06T00:00:00.000Z',
      flows: [FLOW],
      noFlowClaims: [],
    })
    expect(file.flows[0].kind).toBe('variant')
  })
})
