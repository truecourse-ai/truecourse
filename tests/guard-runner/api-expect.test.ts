import { describe, it, expect } from 'vitest'
import { evaluateApiExpect } from '@truecourse/guard-runner'
import type { GuardApiExpect } from '@truecourse/shared'

const identity = (t: string): string => t

function evaluate(
  exp: GuardApiExpect,
  overrides: Partial<{
    status: number | null
    headers: Record<string, string>
    body: string
  }> = {},
) {
  const body = overrides.body ?? '{"id":1,"title":"buy milk","done":false,"tags":["a","b"]}'
  return evaluateApiExpect({
    expect: exp,
    status: overrides.status ?? 200,
    headers: overrides.headers ?? { 'content-type': 'application/json', 'x-service': 'todos' },
    bodyText: body,
    rawBodyText: body,
    normalizeText: identity,
  })
}

describe('evaluateApiExpect', () => {
  it('passes an empty expectation', () => {
    expect(evaluate({})).toBeNull()
  })

  it('checks status first', () => {
    const m = evaluate({ status: 201, body: { contains: 'nope-too' } }, { status: 200 })
    expect(m).toMatchObject({ subject: 'status', expected: 'status 201', actual: 'status 200' })
  })

  it('matches headers case-insensitively', () => {
    expect(evaluate({ headers: { 'X-Service': { equals: 'todos' } } })).toBeNull()
    const m = evaluate({ headers: { 'x-missing': { contains: 'x' } } })
    expect(m).toMatchObject({ subject: 'headers', actual: 'header x-missing missing' })
  })

  it('matches the body text with the stream vocabulary', () => {
    expect(evaluate({ body: { contains: 'buy milk' } })).toBeNull()
    const m = evaluate({ body: { matches: '^\\[' } })
    expect(m).toMatchObject({ subject: 'body' })
  })

  describe('json path matchers', () => {
    it('equals compares JSON values structurally', () => {
      expect(evaluate({ json: { id: { equals: 1 }, done: { equals: false } } })).toBeNull()
      expect(evaluate({ json: { tags: { equals: ['a', 'b'] } } })).toBeNull()
      const m = evaluate({ json: { id: { equals: '1' } } })
      expect(m).toMatchObject({ subject: 'json', expected: 'json id equals "1"' })
    })

    it('contains/matches compare the value string form', () => {
      expect(evaluate({ json: { title: { contains: 'milk' } } })).toBeNull()
      expect(evaluate({ json: { id: { matches: '^\\d+$' } } })).toBeNull()
    })

    it('exists / absent check presence', () => {
      expect(evaluate({ json: { id: { exists: true }, nope: { absent: true } } })).toBeNull()
      expect(evaluate({ json: { nope: { exists: true } } })).toMatchObject({
        subject: 'json',
        actual: 'json nope missing',
      })
      const m = evaluate({ json: { id: { absent: true } } })
      expect(m?.actual).toContain('present')
    })

    it('"" addresses the whole body', () => {
      expect(evaluate({ json: { '': { contains: 'buy milk' } } })).toBeNull()
    })

    it('a value check on a missing path is a mismatch, not a crash', () => {
      const m = evaluate({ json: { 'meta.deep': { equals: 1 } } })
      expect(m).toMatchObject({ subject: 'json', actual: 'json meta.deep missing' })
    })

    it('a non-JSON body fails json matchers with the parse error', () => {
      const m = evaluate({ json: { id: { equals: 1 } } }, { body: '<html>oops</html>' })
      expect(m).toMatchObject({ subject: 'json', expected: 'a JSON response body' })
    })
  })

  it('returns the FIRST mismatch in status → headers → body → json order', () => {
    const m = evaluate(
      { status: 200, headers: { 'x-service': { equals: 'wrong' } }, body: { contains: 'nope' } },
      {},
    )
    expect(m?.subject).toBe('headers')
  })
})
