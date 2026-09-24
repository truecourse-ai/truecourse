/**
 * `firstInvalidMatchPattern` — the regex-compile check the scenario schema cannot
 * express. Every `matches` value (and an api log `pattern`) is a JS regex SOURCE
 * the runner compiles with `new RegExp(source, flags)`; one that does not compile throws
 * outright in the log matcher and turns every other matcher into an unconditional
 * mismatch, so it must die at authoring and at load, never mid-run.
 */
import { describe, it, expect } from 'vitest'
import {
  GuardJsonMatcherSchema,
  GuardStreamMatcherSchema,
  firstInvalidMatchPattern,
  type GuardApiStep,
  type GuardStep,
} from '@truecourse/shared'

const cli = (expectBlock: GuardStep['expect']): GuardStep => ({ run: ['ls'], expect: expectBlock })

describe('firstInvalidMatchPattern — cli steps', () => {
  it('returns null when every pattern compiles (or none is present)', () => {
    expect(firstInvalidMatchPattern([cli({ exit: 0 })])).toBeNull()
    expect(
      firstInvalidMatchPattern([cli({ stdout: { matches: 'added t[0-9]+' }, stderr: { contains: 'x' } })]),
    ).toBeNull()
  })

  it('names the step, the stream, the source and the compile error', () => {
    const bad = firstInvalidMatchPattern([cli({ exit: 0 }), cli({ stderr: { matches: 'a(b' } })])
    expect(bad).toMatchObject({ step: 2, where: 'expect.stderr', pattern: 'a(b' })
    expect(bad!.error).toBeTruthy()
  })

  it('compiles a source with its flags', () => {
    expect(firstInvalidMatchPattern([cli({ stdout: { matches: 'quota|limit', flags: 'is' } })])).toBeNull()
  })

  it('a capture slicer takes no flags, so its (?i) hint says to spell the case out', () => {
    const capture = { run: ['ls'], expect: { exit: 0 }, capture: { cost: { pattern: '(?i)cost (\\d+)' } } } as GuardStep
    const bad = firstInvalidMatchPattern([capture])
    expect(bad).toMatchObject({ where: 'capture.cost' })
    expect(bad!.error).not.toContain('"flags"')
    expect(bad!.error).toContain('spell the case out')
  })

  it('an inline (?i) group is refused, and the error names the flags field', () => {
    const bad = firstInvalidMatchPattern([cli({ stdout: { matches: '(?i)quota|limit' } })])
    expect(bad).toMatchObject({ step: 1, where: 'expect.stdout', pattern: '(?i)quota|limit' })
    expect(bad!.error).toContain('"flags": "i"')
  })

  it('reports the FIRST offender, stdout before stderr within one step', () => {
    const bad = firstInvalidMatchPattern([cli({ stdout: { matches: '[' }, stderr: { matches: '(' } })])
    expect(bad).toMatchObject({ step: 1, where: 'expect.stdout' })
  })
})

describe('firstInvalidMatchPattern — api steps', () => {
  const request = (expectBlock: unknown): GuardApiStep =>
    ({ request: { method: 'GET', path: '/todos' }, expect: expectBlock }) as GuardApiStep

  it('checks the body, header and json matchers', () => {
    expect(firstInvalidMatchPattern([request({ body: { matches: 'a{2,1}' } })])).toMatchObject({
      where: 'expect.body',
    })
    expect(firstInvalidMatchPattern([request({ headers: { 'x-req-id': { matches: '(' } } })])).toMatchObject({
      where: 'expect.headers.x-req-id',
    })
    expect(firstInvalidMatchPattern([request({ json: { 'data.id': { matches: '[' } } })])).toMatchObject({
      where: 'expect.json.data.id',
    })
    expect(firstInvalidMatchPattern([request({ json: { '': { matches: '[' } } })])).toMatchObject({
      where: 'expect.json.(root)',
    })
  })

  it('checks a log matcher only in its regex form — a substring match is never compiled', () => {
    const substring = { logs: { stream: 'stdout', match: 'a(b' } } as GuardApiStep
    expect(firstInvalidMatchPattern([substring])).toBeNull()

    const regex = { logs: { stream: 'stdout', match: { pattern: 'a(b' } } } as GuardApiStep
    expect(firstInvalidMatchPattern([regex])).toMatchObject({ step: 1, where: 'logs.match', pattern: 'a(b' })

    const flagged = { logs: { stream: 'stdout', match: { pattern: 'a(b', flags: 'i' } } } as GuardApiStep
    expect(firstInvalidMatchPattern([flagged])).toMatchObject({ where: 'logs.match', flags: 'i' })
  })

  it('leaves the lifecycle steps (boot / signal) alone — they carry no pattern', () => {
    const boot = { boot: { expect: { ready: true } } } as GuardApiStep
    const signal = { signal: { name: 'SIGTERM' } } as GuardApiStep
    expect(firstInvalidMatchPattern([boot, signal])).toBeNull()
  })
})

describe('matcher flags — the schema', () => {
  it('accepts i, m and s beside a `matches`', () => {
    expect(GuardStreamMatcherSchema.safeParse({ matches: 'quota', flags: 'i' }).success).toBe(true)
    expect(GuardJsonMatcherSchema.safeParse({ matches: 'quota', flags: 'ms' }).success).toBe(true)
  })

  it('refuses a flag JavaScript assertions have no use for, and flags with no `matches`', () => {
    expect(GuardStreamMatcherSchema.safeParse({ matches: 'quota', flags: 'g' }).success).toBe(false)
    expect(GuardStreamMatcherSchema.safeParse({ contains: 'quota', flags: 'i' }).success).toBe(false)
    expect(GuardJsonMatcherSchema.safeParse({ exists: true, flags: 'i' }).success).toBe(false)
    expect(GuardStreamMatcherSchema.safeParse({ matches: 'quota', flags: 'ii' }).success).toBe(false)
  })
})
