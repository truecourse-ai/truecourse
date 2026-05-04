import { describe, it, expect, beforeAll } from 'vitest'
import {
  findStringLiteralUnions,
  findFieldWriteSites,
  inferPriorStates,
} from '../../../packages/analyzer/src/plugins/state-machine/ast'
import { initParsers, parseCode } from '../../../packages/analyzer/src/parser'

beforeAll(async () => {
  await initParsers()
})

// ---------------------------------------------------------------------------
// findStringLiteralUnions
// ---------------------------------------------------------------------------

describe('state-machine ast: findStringLiteralUnions', () => {
  it('extracts a multi-member string-literal union', () => {
    const src = `type Status = 'pending' | 'running' | 'done';\n`
    const tree = parseCode(src, 'typescript')
    const out = findStringLiteralUnions(tree, src)
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Status')
    expect(out[0].states).toEqual(['pending', 'running', 'done'])
    expect(out[0].line).toBe(1)
  })

  it('extracts a degenerate single-literal type alias', () => {
    const src = `type Only = 'x';\n`
    const tree = parseCode(src, 'typescript')
    const out = findStringLiteralUnions(tree, src)
    expect(out).toHaveLength(1)
    expect(out[0].states).toEqual(['x'])
  })

  it('skips unions that include non-literal members', () => {
    const src = `type Mixed = 'a' | string | 'c';\n`
    const tree = parseCode(src, 'typescript')
    const out = findStringLiteralUnions(tree, src)
    expect(out).toEqual([])
  })

  it('skips number-literal unions', () => {
    const src = `type N = 200 | 404;\n`
    const tree = parseCode(src, 'typescript')
    const out = findStringLiteralUnions(tree, src)
    expect(out).toEqual([])
  })

  it('finds multiple unions in one file', () => {
    const src = `
type Status = 'a' | 'b';
type Color = 'red' | 'blue' | 'green';
`
    const tree = parseCode(src, 'typescript')
    const out = findStringLiteralUnions(tree, src)
    const names = out.map((u) => u.name).sort()
    expect(names).toEqual(['Color', 'Status'])
  })
})

// ---------------------------------------------------------------------------
// findFieldWriteSites
// ---------------------------------------------------------------------------

describe('state-machine ast: findFieldWriteSites', () => {
  it('finds a direct assignment with a string-literal RHS', () => {
    const src = `function f(step: Step) { step.status = 'running'; }\n`
    const tree = parseCode(src, 'typescript')
    const out = findFieldWriteSites(tree, src, 'status')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('assignment')
    expect(out[0].receiver).toBe('step')
    expect(out[0].field).toBe('status')
    expect(out[0].value).toBe('running')
  })

  it('records null value when the RHS is not a literal', () => {
    const src = `function f(s: any) { s.status = computeNext(); }\n`
    const tree = parseCode(src, 'typescript')
    const out = findFieldWriteSites(tree, src, 'status')
    expect(out).toHaveLength(1)
    expect(out[0].value).toBeNull()
  })

  it('does not match assignments to other fields', () => {
    const src = `function f(s: any) { s.name = 'x'; }\n`
    const tree = parseCode(src, 'typescript')
    const out = findFieldWriteSites(tree, src, 'status')
    expect(out).toEqual([])
  })

  it('treats `new T({status: ... })` as an initial write', () => {
    const src = `const s = new Step({ status: 'pending' });\n`
    const tree = parseCode(src, 'typescript')
    const out = findFieldWriteSites(tree, src, 'status')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('initial')
    expect(out[0].value).toBe('pending')
  })

  it('treats `return { status: ... }` as an initial write', () => {
    const src = `function make() { return { status: 'pending', name: 'x' }; }\n`
    const tree = parseCode(src, 'typescript')
    const out = findFieldWriteSites(tree, src, 'status')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('initial')
    expect(out[0].value).toBe('pending')
  })

  it('does not treat a free-standing object literal in a function arg as initial', () => {
    const src = `someFn({ status: 'pending' });\n`
    const tree = parseCode(src, 'typescript')
    const out = findFieldWriteSites(tree, src, 'status')
    expect(out).toEqual([])
  })

  it('finds multiple writes in one function', () => {
    const src = `
function f(step: Step) {
  step.status = 'running';
  step.status = 'done';
}
`
    const tree = parseCode(src, 'typescript')
    const out = findFieldWriteSites(tree, src, 'status')
    expect(out.map((w) => w.value)).toEqual(['running', 'done'])
  })
})

// ---------------------------------------------------------------------------
// inferPriorStates
// ---------------------------------------------------------------------------

describe('state-machine ast: inferPriorStates', () => {
  it('returns priors=[literal] for a single-clause guard', () => {
    const src = `
function f(step: Step) {
  if (step.status === 'pending') {
    step.status = 'running';
  }
}
`
    const tree = parseCode(src, 'typescript')
    const sites = findFieldWriteSites(tree, src, 'status')
    const inf = inferPriorStates(sites[0], src)
    expect(inf.kind).toBe('guarded')
    if (inf.kind === 'guarded') expect(inf.priors).toEqual(['pending'])
  })

  it('flattens an OR chain into a multi-element priors list', () => {
    const src = `
function f(step: Step) {
  if (step.status === 'a' || step.status === 'b' || step.status === 'c') {
    step.status = 'done';
  }
}
`
    const tree = parseCode(src, 'typescript')
    const sites = findFieldWriteSites(tree, src, 'status')
    const inf = inferPriorStates(sites[0], src)
    expect(inf.kind).toBe('guarded')
    if (inf.kind === 'guarded') {
      expect([...inf.priors].sort()).toEqual(['a', 'b', 'c'])
    }
  })

  it('returns unguarded when there is no enclosing if', () => {
    const src = `
function f(step: Step) {
  step.status = 'running';
}
`
    const tree = parseCode(src, 'typescript')
    const sites = findFieldWriteSites(tree, src, 'status')
    const inf = inferPriorStates(sites[0], src)
    expect(inf.kind).toBe('unguarded')
  })

  it('returns unguarded when the guard is on a different field', () => {
    const src = `
function f(step: Step) {
  if (step.kind === 'foo') {
    step.status = 'running';
  }
}
`
    const tree = parseCode(src, 'typescript')
    const sites = findFieldWriteSites(tree, src, 'status')
    const inf = inferPriorStates(sites[0], src)
    expect(inf.kind).toBe('unguarded')
  })

  it('returns unguarded for negated guards (out of v1 scope)', () => {
    const src = `
function f(step: Step) {
  if (step.status !== 'blocked') {
    step.status = 'running';
  }
}
`
    const tree = parseCode(src, 'typescript')
    const sites = findFieldWriteSites(tree, src, 'status')
    const inf = inferPriorStates(sites[0], src)
    expect(inf.kind).toBe('unguarded')
  })

  it('marks initial writes as initial regardless of surrounding code', () => {
    const src = `
function make() {
  return { status: 'pending' };
}
`
    const tree = parseCode(src, 'typescript')
    const sites = findFieldWriteSites(tree, src, 'status')
    const inf = inferPriorStates(sites[0], src)
    expect(inf.kind).toBe('initial')
  })

  it('does not infer guards on writes nested inside the else branch', () => {
    const src = `
function f(step: Step) {
  if (step.status === 'pending') {
    something();
  } else {
    step.status = 'running';
  }
}
`
    const tree = parseCode(src, 'typescript')
    const sites = findFieldWriteSites(tree, src, 'status')
    expect(sites).toHaveLength(1)
    const inf = inferPriorStates(sites[0], src)
    expect(inf.kind).toBe('unguarded')
  })

  it('handles literal-on-the-left form `\'pending\' === step.status`', () => {
    const src = `
function f(step: Step) {
  if ('pending' === step.status) {
    step.status = 'running';
  }
}
`
    const tree = parseCode(src, 'typescript')
    const sites = findFieldWriteSites(tree, src, 'status')
    const inf = inferPriorStates(sites[0], src)
    expect(inf.kind).toBe('guarded')
    if (inf.kind === 'guarded') expect(inf.priors).toEqual(['pending'])
  })
})
