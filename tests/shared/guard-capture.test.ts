import { describe, it, expect } from 'vitest'
import {
  GuardCliCaptureSchema,
  GuardComparisonSchema,
  GuardScenarioSchema,
  GuardStreamMatcherSchema,
  GuardJsonMatcherSchema,
  capturedNamesIn,
  capturedTokenRefs,
  capturingGroupCount,
  captureDefects,
  describeComparison,
  describeGuardScenarioSteps,
  stepCaptureNames,
  type GuardApiStep,
  type GuardCliStep,
} from '@truecourse/shared'

// ---------------------------------------------------------------------------
// The capture block
// ---------------------------------------------------------------------------

describe('GuardCliCaptureSchema — one capturing group is the value', () => {
  it('accepts a pattern with exactly one group, defaulting to stdout', () => {
    const parsed = GuardCliCaptureSchema.safeParse({ pattern: 'tick (\\d+)' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.from).toBeUndefined()
    expect(GuardCliCaptureSchema.safeParse({ pattern: 'x (\\d+)', from: 'stderr' }).success).toBe(true)
    expect(GuardCliCaptureSchema.safeParse({ pattern: 'x (\\d+)', from: 'output' }).success).toBe(true)
  })

  it('rejects a pattern with no capturing group', () => {
    const parsed = GuardCliCaptureSchema.safeParse({ pattern: 'tick \\d+' })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues[0].message).toContain('ONE capturing group')
  })

  it('rejects a pattern with two capturing groups — which one is the value?', () => {
    const parsed = GuardCliCaptureSchema.safeParse({ pattern: '(\\w+) (\\d+)' })
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues[0].message).toContain('2 capturing groups')
  })

  it('counts groups without being fooled by non-capturing groups or escaped parens', () => {
    expect(capturingGroupCount('(?:a|b)(\\d+)')).toBe(1)
    expect(capturingGroupCount('\\(([0-9]+)\\)')).toBe(1)
    expect(capturingGroupCount('[(](\\d)[)]')).toBe(1)
    expect(capturingGroupCount('no groups')).toBe(0)
    // A source that does not compile is the loader's regex check to report.
    expect(capturingGroupCount('([')).toBeNull()
  })

  it('rejects a capture name that no reference could spell', () => {
    const step = { run: ['x'], capture: { 'not-an-ident': { pattern: '(\\d)' } }, expect: {} }
    const parsed = GuardScenarioSchema.safeParse(cliScenario([step]))
    expect(parsed.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The comparison matcher
// ---------------------------------------------------------------------------

describe('GuardComparisonSchema — the numeric half of the vocabulary', () => {
  it('accepts each operator, alone and together, with a literal or a reference', () => {
    expect(GuardComparisonSchema.safeParse({ atMost: '${captured:estimate}' }).success).toBe(true)
    expect(GuardComparisonSchema.safeParse({ atLeast: 3 }).success).toBe(true)
    expect(GuardComparisonSchema.safeParse({ equals: '7' }).success).toBe(true)
    expect(GuardComparisonSchema.safeParse({ atLeast: 1, atMost: 10 }).success).toBe(true)
  })

  it('needs at least one operator — a bare extraction asserts nothing', () => {
    const parsed = GuardComparisonSchema.safeParse({ number: 'cost \\$([0-9.]+)' })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toContain('equals | atMost | atLeast')
    }
  })

  it('applies the one-capturing-group rule to its `number` extractor', () => {
    expect(GuardComparisonSchema.safeParse({ number: 'cost \\$([0-9.]+)', atMost: 1 }).success).toBe(true)
    expect(GuardComparisonSchema.safeParse({ number: 'cost [0-9.]+', atMost: 1 }).success).toBe(false)
  })

  it('rides the stream and json matchers as a fourth form', () => {
    expect(GuardStreamMatcherSchema.safeParse({ compare: { atMost: 5 } }).success).toBe(true)
    expect(GuardJsonMatcherSchema.safeParse({ compare: { atLeast: '${captured:n}' } }).success).toBe(true)
    // Still closed: a matcher with nothing in it is still rejected.
    expect(GuardStreamMatcherSchema.safeParse({}).success).toBe(false)
    expect(GuardJsonMatcherSchema.safeParse({}).success).toBe(false)
  })

  it('carries an `offset` — the DELTA claim, where the comparand is one side of a difference', () => {
    expect(GuardComparisonSchema.safeParse({ equals: '${captured:seatsBefore}', offset: -1 }).success).toBe(
      true,
    )
    expect(GuardComparisonSchema.safeParse({ atLeast: 3, offset: 2 }).success).toBe(true)
    // An offset with nothing to offset is still nothing asserted.
    expect(GuardComparisonSchema.safeParse({ offset: -1 }).success).toBe(false)
    expect(describeComparison({ equals: '${captured:seatsBefore}', offset: -1 })).toContain(
      'equals ${captured:seatsBefore} − 1',
    )
    expect(describeComparison({ atMost: 5, offset: 2 })).toContain('at most 5 + 2')
  })

  it('renders in the step view instead of a broken `matches /undefined/`', () => {
    const views = describeGuardScenarioSteps(
      cliScenario([
        {
          run: ['report'],
          expect: { stdout: { compare: { number: 'cost \\$([0-9.]+)', atMost: '${captured:estimate}' } } },
        },
      ]),
    )
    expect(views[0].expectation).toContain('at most ${captured:estimate}')
    expect(views[0].expectation).not.toContain('undefined')
  })
})

// ---------------------------------------------------------------------------
// The `${captured:…}` token
// ---------------------------------------------------------------------------

describe('${captured:…}', () => {
  it('reads names out of a string in first-seen order, deduped', () => {
    expect(capturedTokenRefs('a ${captured:x} b ${captured:y} c ${captured:x}')).toEqual(['x', 'y'])
    expect(capturedTokenRefs('${supplied:corpus.path} ${unique}')).toEqual([])
  })

  it('walks a whole step — values AND keys (an asserted path is a key)', () => {
    const names = capturedNamesIn({
      run: ['note', '${captured:version}.txt'],
      env: { TAG: '${captured:version}' },
      expect: { files: { '${captured:version}.txt': { contains: '${captured:body}' } } },
    })
    expect(names).toEqual(['version', 'body'])
  })
})

// ---------------------------------------------------------------------------
// Declaration + reference rules
// ---------------------------------------------------------------------------

describe('stepCaptureNames', () => {
  it('reads a cli step\'s capture block', () => {
    expect(stepCaptureNames({ run: [], capture: { a: { pattern: '(x)' } }, expect: {} } as GuardCliStep)).toEqual(['a'])
  })
  it('reads both api capture channels — body paths and headers share one namespace', () => {
    const step = {
      request: { method: 'POST', path: '/x' },
      capture: { id: 'id' },
      captureHeaders: { token: 'x-token' },
      expect: {},
    } as GuardApiStep
    expect(stepCaptureNames(step)).toEqual(['id', 'token'])
  })
  it('a step that captures nothing declares nothing', () => {
    expect(stepCaptureNames({ run: [], expect: {} } as GuardCliStep)).toEqual([])
    expect(stepCaptureNames({ boot: {} } as GuardApiStep)).toEqual([])
  })
})

describe('captureDefects — the load-time rules', () => {
  it('is silent when a later step uses what an earlier step captured', () => {
    expect(
      captureDefects([
        { run: ['--version'], capture: { v: { pattern: '(\\d+\\.\\d+\\.\\d+)' } }, expect: {} },
        { run: ['note', '${captured:v}.txt', 'x'], expect: {} },
      ] as GuardCliStep[]),
    ).toEqual([])
  })

  it('rejects a re-capture of a name — single assignment, not a run-time surprise', () => {
    const defects = captureDefects([
      { run: ['a'], capture: { total: { pattern: '(\\d+)' } }, expect: {} },
      { run: ['b'], capture: { total: { pattern: '(\\d+)' } }, expect: {} },
    ] as GuardCliStep[])
    expect(defects).toHaveLength(1)
    expect(defects[0].step).toBe(2)
    expect(defects[0].message).toContain('"total"')
    expect(defects[0].message).toContain('step 1')
  })

  it('rejects a re-capture ACROSS the two api channels — one name, one source', () => {
    const defects = captureDefects([
      {
        request: { method: 'POST', path: '/x' },
        capture: { token: 'body.token' },
        captureHeaders: { token: 'x-token' },
        expect: {},
      },
    ] as GuardApiStep[])
    expect(defects).toHaveLength(1)
    expect(defects[0].message).toContain('"token"')
  })

  it('rejects a FORWARD reference — the value does not exist yet', () => {
    const defects = captureDefects([
      { run: ['note', '${captured:v}.txt', 'x'], expect: {} },
      { run: ['--version'], capture: { v: { pattern: '(\\d+)' } }, expect: {} },
    ] as GuardCliStep[])
    expect(defects).toHaveLength(1)
    expect(defects[0].step).toBe(1)
    expect(defects[0].message).toContain('${captured:v}')
    expect(defects[0].message).toContain('no earlier step captures')
  })

  it('rejects a SELF reference — a capture is readable only by LATER steps', () => {
    const defects = captureDefects([
      {
        run: ['report'],
        capture: { cost: { pattern: 'cost (\\d+)' } },
        expect: { stdout: { compare: { number: 'cost (\\d+)', atMost: '${captured:cost}' } } },
      },
    ] as GuardCliStep[])
    expect(defects).toHaveLength(1)
    expect(defects[0].step).toBe(1)
    expect(defects[0].message).toContain('captures itself')
  })

  it('rejects a reference in SETUP — setup materializes before the first step', () => {
    const defects = captureDefects(
      [{ run: ['show', 'x'], capture: { v: { pattern: '(\\d+)' } }, expect: {} }] as GuardCliStep[],
      { files: { 'x.txt': '${captured:v}' } },
    )
    expect(defects).toHaveLength(1)
    expect(defects[0].step).toBeNull()
    expect(defects[0].message).toContain('setup')
  })

  it('reads references out of an api request AND its expectation', () => {
    const defects = captureDefects([
      {
        request: { method: 'GET', path: '/todos/${captured:id}' },
        expect: { json: { title: { equals: '${captured:title}' } } },
      },
    ] as GuardApiStep[])
    expect(defects).toHaveLength(2)
    expect(defects.map((d) => d.message).join(' ')).toContain('${captured:id}')
    expect(defects.map((d) => d.message).join(' ')).toContain('${captured:title}')
  })
})

/** A minimal, schema-valid cli scenario around `steps`. */
function cliScenario(steps: unknown[]): unknown {
  return {
    id: 'x',
    title: 'x',
    binds: [{ doc: 'docs/a.md', section: 'a', fingerprint: 'sha256:1' }],
    driver: 'cli',
    steps,
    normalize: [],
  }
}
