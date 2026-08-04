/**
 * `firstInvalidMatchPattern` — the regex-compile check the scenario schema cannot
 * express. Every `matches` value (and an api log `pattern`) is a JS regex SOURCE
 * the runner compiles with a bare `new RegExp`; one that does not compile throws
 * outright in the log matcher and turns every other matcher into an unconditional
 * mismatch, so it must die at authoring and at load, never mid-run.
 */
import { describe, it, expect } from 'vitest'
import { firstInvalidMatchPattern, type GuardApiStep, type GuardStep } from '@truecourse/shared'

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
  })

  it('leaves the lifecycle steps (boot / signal) alone — they carry no pattern', () => {
    const boot = { boot: { expect: { ready: true } } } as GuardApiStep
    const signal = { signal: { name: 'SIGTERM' } } as GuardApiStep
    expect(firstInvalidMatchPattern([boot, signal])).toBeNull()
  })
})
