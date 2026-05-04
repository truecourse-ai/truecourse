import { describe, it, expect, beforeAll } from 'vitest'
import {
  findFieldWriteSites,
  inferPriorStates,
} from '../../../packages/analyzer/src/plugins/state-machine/ast'
import { initParsers, parseCode } from '../../../packages/analyzer/src/parser'

beforeAll(async () => { await initParsers() })

// Confirms tree-sitter-javascript node names + field names match the
// helpers we wrote against tree-sitter-typescript. Type-alias discovery
// is TS-only and intentionally excluded — JS has no `type X = ...` syntax.

describe('state-machine ast (javascript): findFieldWriteSites', () => {
  it('finds a direct assignment in JS', () => {
    const src = `function f(step) { step.status = 'running'; }\n`
    const tree = parseCode(src, 'javascript')
    const out = findFieldWriteSites(tree, src, 'status')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('assignment')
    expect(out[0].receiver).toBe('step')
    expect(out[0].value).toBe('running')
  })

  it('treats `new X({status: ... })` as initial in JS', () => {
    const src = `const s = new Step({ status: 'pending' });\n`
    const tree = parseCode(src, 'javascript')
    const out = findFieldWriteSites(tree, src, 'status')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('initial')
    expect(out[0].value).toBe('pending')
  })

  it('treats `return { status: ... }` as initial in JS', () => {
    const src = `function make() { return { status: 'pending' }; }\n`
    const tree = parseCode(src, 'javascript')
    const out = findFieldWriteSites(tree, src, 'status')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('initial')
    expect(out[0].value).toBe('pending')
  })
})

describe('state-machine ast (javascript): inferPriorStates', () => {
  it('reads a single-clause guard in JS', () => {
    const src = `
function f(step) {
  if (step.status === 'pending') {
    step.status = 'running';
  }
}
`
    const tree = parseCode(src, 'javascript')
    const sites = findFieldWriteSites(tree, src, 'status')
    const inf = inferPriorStates(sites[0], src)
    expect(inf.kind).toBe('guarded')
    if (inf.kind === 'guarded') expect(inf.priors).toEqual(['pending'])
  })

  it('reads an OR-chain in JS', () => {
    const src = `
function f(step) {
  if (step.status === 'a' || step.status === 'b') {
    step.status = 'done';
  }
}
`
    const tree = parseCode(src, 'javascript')
    const sites = findFieldWriteSites(tree, src, 'status')
    const inf = inferPriorStates(sites[0], src)
    expect(inf.kind).toBe('guarded')
    if (inf.kind === 'guarded') expect([...inf.priors].sort()).toEqual(['a', 'b'])
  })

  it('returns unguarded when no enclosing if in JS', () => {
    const src = `function f(step) { step.status = 'running'; }\n`
    const tree = parseCode(src, 'javascript')
    const sites = findFieldWriteSites(tree, src, 'status')
    const inf = inferPriorStates(sites[0], src)
    expect(inf.kind).toBe('unguarded')
  })
})
