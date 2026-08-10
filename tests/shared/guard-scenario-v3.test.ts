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
  GuardStepSchema,
  describeGuardScenarioSteps,
  firstInvalidMatchPattern,
  hasMilestone,
  isDeleteStep,
  isGitStep,
  isOptionalArg,
  isPatchStep,
  isProcessStep,
  isPromptKeyedStdin,
  isRunStep,
  isWriteStep,
  milestoneClaims,
  milestoneOrder,
  milestoneRefs,
  runArgvWords,
} from '@truecourse/shared'
import type { GuardRunArg } from '@truecourse/shared'

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

  it('tells the FIVE cli step kinds apart', () => {
    const [run, write, del, git, tty] = GuardCliScenarioSchema.parse(V3_SCENARIO).steps
    // `patch` joined the union after v3 shipped and did NOT move the version — the
    // number gates backward readability, and every v3 file still parses (see
    // GUARD_FORMAT_VERSION). So it is parsed here rather than seeded into the v3
    // reference scenario above, which stays what v3 itself introduced.
    const patch = GuardCliStepSchema.parse({ patch: { 'config.json': { set: { strict: true } } } })
    expect([
      isRunStep(run),
      isWriteStep(write),
      isDeleteStep(del),
      isGitStep(git),
      isPatchStep(patch),
    ]).toEqual([true, true, true, true, true])
    expect(isProcessStep(write)).toBe(false)
    expect(isProcessStep(patch)).toBe(false)
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

  it('accepts a `matches` FILE matcher — several independent markers in one file', () => {
    const step = GuardCliStepSchema.parse({
      run: ['analyze'],
      expect: {
        exit: 0,
        files: { 'out/report.md': { matches: '^(?=[\\s\\S]*alpha)(?=[\\s\\S]*beta)[\\s\\S]*$' } },
      },
    })
    expect(isRunStep(step) && step.expect.files!['out/report.md'].matches).toContain('alpha')
    // A write step's file-only expectation carries it too.
    expect(() =>
      GuardCliStepSchema.parse({ write: { 'a.txt': 'x' }, expect: { files: { 'a.txt': { matches: 'x' } } } }),
    ).not.toThrow()
    // …and the empty matcher still names every alternative it could have been.
    const empty = GuardCliStepSchema.safeParse({ run: [], expect: { files: { 'a.txt': {} } } })
    expect(empty.success).toBe(false)
    expect(JSON.stringify(empty.error)).toContain('exists | absent | equals | contains | matches')
    // The step list renders it the way the stream matcher is rendered.
    expect(
      describeGuardScenarioSteps({
        guard: GUARD_FORMAT_VERSION,
        id: 'x',
        title: 'x',
        binds: BINDS,
        driver: 'cli',
        normalize: [],
        steps: [{ run: ['analyze'], expect: { files: { 'out.md': { matches: 'a|b' } } } }],
      })[0].expectation,
    ).toBe('out.md matches /a|b/')
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

  /**
   * The omittable argv pair: how a scenario names a flag whose value comes from a
   * DECLARED-OPTIONAL registration field, so the pair can disappear on a machine
   * that left the field blank instead of resolving to nothing.
   */
  describe('an optional argv pair', () => {
    const step = {
      run: [
        'setup',
        '--provider',
        '${supplied:llm-api-credentials.provider}',
        { optional: ['--base-url', '${supplied:llm-api-credentials.base-url}'] },
      ],
      expect: { exit: 0 },
    }

    /** The step, parsed and narrowed — every case below reads its argv. */
    const parseRun = (): GuardRunArg[] => {
      const parsed = GuardCliStepSchema.parse(step)
      if (!isRunStep(parsed)) throw new Error('expected a run step')
      return parsed.run
    }

    it('parses beside the plain arguments, keeping the pair intact', () => {
      const run = parseRun()
      expect(run[3]).toEqual({
        optional: ['--base-url', '${supplied:llm-api-credentials.base-url}'],
      })
      expect(isOptionalArg(run[3])).toBe(true)
      expect(isOptionalArg(run[0])).toBe(false)
    })

    // The pair only means something against a token: dropping a pair whose value is
    // a literal could never happen, so calling it optional would be a lie.
    it('rejects a pair whose value references no supplied field', () => {
      expect(() =>
        GuardCliStepSchema.parse({
          run: ['setup', { optional: ['--base-url', 'https://llm.internal'] }],
          expect: { exit: 0 },
        }),
      ).toThrow(/must reference one/)
    })

    it('rejects a pair that is not exactly a flag and a value', () => {
      expect(() =>
        GuardCliStepSchema.parse({
          run: [{ optional: ['--base-url'] }],
          expect: { exit: 0 },
        }),
      ).toThrow()
    })

    // The step LIST shows what the step means to run; only the runner knows which
    // machine drops what, so the display form flattens the pair.
    it('flattens to its two words in the step list', () => {
      expect(runArgvWords(parseRun())).toEqual([
        'setup',
        '--provider',
        '${supplied:llm-api-credentials.provider}',
        '--base-url',
        '${supplied:llm-api-credentials.base-url}',
      ])
      const scenario = GuardCliScenarioSchema.parse({
        guard: GUARD_FORMAT_VERSION,
        id: 's.cli.1',
        title: 't',
        binds: BINDS,
        driver: 'cli',
        normalize: [],
        steps: [step],
      })
      expect(describeGuardScenarioSteps(scenario)[0].command).toBe(
        'setup --provider ${supplied:llm-api-credentials.provider} --base-url ${supplied:llm-api-credentials.base-url}',
      )
    })
  })

  /**
   * The per-step time limit: a step whose command legitimately takes minutes (one
   * that sends source to a model) declares the patience its claim needs, beside the
   * command that needs it. Additive — a step that declares none is unchanged, which
   * is why the format version does not move.
   */
  describe('the per-step `timeoutMs`', () => {
    it('round-trips on a run step and on a git step, in milliseconds', () => {
      const run = GuardCliStepSchema.parse({
        run: ['analyze', '--llm'],
        timeoutMs: 900_000,
        expect: { exit: 0 },
      })
      expect(isRunStep(run) && run.timeoutMs).toBe(900_000)
      const git = GuardCliStepSchema.parse({ git: ['status'], timeoutMs: 5_000, expect: { exit: 0 } })
      expect(isGitStep(git) && git.timeoutMs).toBe(5_000)
      // A whole scenario carries it through the envelope unchanged.
      const parsed = GuardScenarioSchema.parse({
        guard: GUARD_FORMAT_VERSION,
        id: 's.cli.1',
        title: 't',
        binds: BINDS,
        driver: 'cli',
        normalize: [],
        steps: [{ run: ['analyze', '--llm'], timeoutMs: 900_000, expect: { exit: 0 } }],
      })
      expect(parsed.driver === 'cli' && isRunStep(parsed.steps[0]) && parsed.steps[0].timeoutMs).toBe(900_000)
    })

    it('is absent when undeclared — the runner default is not written into the file', () => {
      const step = GuardCliStepSchema.parse({ run: ['--version'], expect: { exit: 0 } })
      expect(isRunStep(step) && step.timeoutMs).toBeUndefined()
      expect(Object.hasOwn(step, 'timeoutMs')).toBe(false)
    })

    it('rejects a budget that is not a positive whole number of ms, and one past the cap', () => {
      for (const bad of [0, -1, 1.5, 3_600_001]) {
        expect(() => GuardCliStepSchema.parse({ run: [], timeoutMs: bad, expect: {} })).toThrow()
      }
      // One hour exactly is the ceiling, not past it.
      expect(() =>
        GuardCliStepSchema.parse({ run: [], timeoutMs: 3_600_000, expect: {} }),
      ).not.toThrow()
    })

    it('is a step field, never a scenario one', () => {
      expect(() =>
        GuardScenarioSchema.parse({
          guard: GUARD_FORMAT_VERSION,
          id: 's.cli.1',
          title: 't',
          binds: BINDS,
          driver: 'cli',
          normalize: [],
          timeoutMs: 900_000,
          steps: [{ run: [], expect: {} }],
        }),
      ).toThrow()
    })
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

describe('scripted terminal answers, keyed to the prompt they answer', () => {
  /** A step scripting input — the field under test, everything else fixed. */
  const ttyStep = (stdin: unknown, tty = true) => ({
    run: ['spec', 'scan'],
    ...(tty ? { tty: true } : {}),
    stdin,
    expect: { exit: 0 },
  })

  it('parses a list of {marker, answer} beside the plain string form', () => {
    const step = GuardCliStepSchema.parse(
      ttyStep([
        { marker: 'Proceed with scan?', answer: 'n' },
        { marker: 'Delete the cache?', answer: '\r' },
      ]),
    )
    expect(isRunStep(step) && step.stdin).toEqual([
      { marker: 'Proceed with scan?', answer: 'n' },
      { marker: 'Delete the cache?', answer: '\r' },
    ])
    // The old form is untouched — committed scenarios keep parsing.
    const plain = GuardCliStepSchema.parse(ttyStep('y\n'))
    expect(isRunStep(plain) && plain.stdin).toBe('y\n')
  })

  it('tells the two forms apart, so a runner never guesses which it has', () => {
    expect(isPromptKeyedStdin([{ marker: 'Proceed?', answer: 'y' }])).toBe(true)
    expect(isPromptKeyedStdin('y\n')).toBe(false)
    expect(isPromptKeyedStdin(undefined)).toBe(false)
  })

  it('needs a terminal: keyed answers on a piped step are a scenario defect', () => {
    expect(() =>
      GuardStepSchema.parse(ttyStep([{ marker: 'Proceed with scan?', answer: 'n' }], false)),
    ).toThrow(/tty: true/)
    // …and the same sentence rejects it through the cli step union and the file.
    expect(() =>
      GuardCliStepSchema.parse(ttyStep([{ marker: 'Proceed with scan?', answer: 'n' }], false)),
    ).toThrow()
  })

  it('rejects an empty script, an empty marker, an empty answer, and stray keys', () => {
    expect(() => GuardStepSchema.parse(ttyStep([]))).toThrow()
    expect(() => GuardStepSchema.parse(ttyStep([{ marker: '', answer: 'y' }]))).toThrow()
    expect(() => GuardStepSchema.parse(ttyStep([{ marker: 'Proceed?', answer: '' }]))).toThrow()
    expect(() => GuardStepSchema.parse(ttyStep([{ marker: 'Proceed?' }]))).toThrow()
    expect(() =>
      GuardStepSchema.parse(ttyStep([{ marker: 'Proceed?', answer: 'y', when: 'later' }])),
    ).toThrow()
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
