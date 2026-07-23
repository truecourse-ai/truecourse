import { describe, it, expect } from 'vitest'
import {
  interpolateRequest,
  interpolateApiExpect,
  evaluateApiExpect,
} from '@truecourse/guard-runner'
import type { GuardApiExpect, GuardHttpRequest } from '@truecourse/shared'

/**
 * A2 — native-when-whole-value interpolation. A `{{fixture:<name>.<field>}}` /
 * `${var}` placeholder that is the ENTIRE matcher value or the ENTIRE JSON-body leaf
 * substitutes the NATIVE JSON value (the fixture manifest's type, or the capture's
 * type). A placeholder embedded in a longer string stays a string. These are pure-unit
 * tests over `interpolateApiExpect` / `interpolateRequest` / `evaluateApiExpect` — no
 * server boots.
 */

/** Native fixture manifest values: numbers, booleans, null are kept in their JSON type. */
const fixtures = new Map<string, Record<string, unknown>>([
  ['evt', { id: 3 }],
  ['flags', { active: true, missing: null }],
])
const noVars = new Map<string, string>()
const noCreds = new Map<string, string>()

/** Run one matcher-only expectation against a JSON body; returns null when it holds. */
function evalJson(expect: GuardApiExpect, body: string) {
  return evaluateApiExpect({
    expect,
    status: 200,
    headers: {},
    bodyText: body,
    rawBodyText: body,
    normalizeText: (t) => t,
  })
}

describe('native-when-whole-value — expectation matcher values', () => {
  it('(1) a numeric fixture used as a whole `equals` value compares as a JSON number', () => {
    const out = interpolateApiExpect({ json: { id: { equals: '{{fixture:evt.id}}' } } }, noVars, fixtures)
    expect(out.json!.id.equals).toBe(3) // native number, not "3"
    // And it actually matches a numeric response field (the old string "3" never did).
    expect(evalJson(out, '{"id":3}')).toBeNull()
  })

  it('(3a) boolean and null fixtures are native in `equals` values', () => {
    const out = interpolateApiExpect(
      { json: { a: { equals: '{{fixture:flags.active}}' }, m: { equals: '{{fixture:flags.missing}}' } } },
      noVars,
      fixtures,
    )
    expect(out.json!.a.equals).toBe(true)
    expect(out.json!.m.equals).toBe(null)
    expect(evalJson(out, '{"a":true,"m":null}')).toBeNull()
  })

  it('(4a) a placeholder embedded in a longer `equals` string stays a string', () => {
    const out = interpolateApiExpect({ json: { s: { equals: 'id-{{fixture:evt.id}}' } } }, noVars, fixtures)
    expect(out.json!.s.equals).toBe('id-3')
  })

  it('(5) a `${var}` capture of a numeric field compares natively in a later expect', () => {
    const vars = new Map([['count', '5']])
    const nativeVars = new Map<string, unknown>([['count', 5]])
    const out = interpolateApiExpect({ json: { n: { equals: '${count}' } } }, vars, new Map(), nativeVars)
    expect(out.json!.n.equals).toBe(5)
    expect(evalJson(out, '{"n":5}')).toBeNull()
  })

  it('(5b) boolean and null `${var}` captures are native in `equals` values', () => {
    const vars = new Map([
      ['ok', 'true'],
      ['gone', 'null'],
    ])
    const nativeVars = new Map<string, unknown>([
      ['ok', true],
      ['gone', null],
    ])
    const out = interpolateApiExpect(
      { json: { ok: { equals: '${ok}' }, gone: { equals: '${gone}' } } },
      vars,
      new Map(),
      nativeVars,
    )
    expect(out.json!.ok.equals).toBe(true)
    expect(out.json!.gone.equals).toBe(null)
  })
})

describe('native-when-whole-value — request JSON body leaves', () => {
  it('(2) a numeric fixture as a whole body leaf lands as a JSON number', () => {
    const req: GuardHttpRequest = { method: 'POST', path: '/x', json: { eventTypeId: '{{fixture:evt.id}}' } }
    const out = interpolateRequest(req, noVars, noCreds, fixtures)
    expect(out.json).toEqual({ eventTypeId: 3 })
    // Concretely: it serializes as a number, not a quoted string.
    expect(JSON.stringify(out.json)).toBe('{"eventTypeId":3}')
  })

  it('(3b) boolean and null fixtures are native body leaves', () => {
    const req: GuardHttpRequest = {
      method: 'POST',
      path: '/x',
      json: { active: '{{fixture:flags.active}}', deleted: '{{fixture:flags.missing}}' },
    }
    const out = interpolateRequest(req, noVars, noCreds, fixtures)
    expect(out.json).toEqual({ active: true, deleted: null })
  })

  it('(4b) a placeholder embedded in a longer body-leaf string stays a string', () => {
    const req: GuardHttpRequest = {
      method: 'POST',
      path: '/x',
      json: { slug: 'evt-{{fixture:evt.id}}', both: '{{fixture:evt.id}}-{{fixture:evt.id}}' },
    }
    const out = interpolateRequest(req, noVars, noCreds, fixtures)
    expect(out.json).toEqual({ slug: 'evt-3', both: '3-3' })
  })

  it('(2b) a numeric `${var}` capture as a whole body leaf lands as a JSON number', () => {
    const vars = new Map([['id', '7']])
    const nativeVars = new Map<string, unknown>([['id', 7]])
    const req: GuardHttpRequest = { method: 'POST', path: '/x', json: { parentId: '${id}' } }
    const out = interpolateRequest(req, vars, noCreds, new Map(), nativeVars)
    expect(out.json).toEqual({ parentId: 7 })
  })

  it('an object `${var}` capture as a whole leaf embeds the native structure', () => {
    const vars = new Map([['loc', '{"type":"link","url":"https://x"}']])
    const nativeVars = new Map<string, unknown>([['loc', { type: 'link', url: 'https://x' }]])
    const req: GuardHttpRequest = { method: 'POST', path: '/x', json: { location: '${loc}' } }
    const out = interpolateRequest(req, vars, noCreds, new Map(), nativeVars)
    expect(out.json).toEqual({ location: { type: 'link', url: 'https://x' } })
    // And in an equals value it compares structurally, not as a JSON-stringified string.
    const exp = interpolateApiExpect({ json: { location: { equals: '${loc}' } } }, vars, new Map(), nativeVars)
    expect(evalJson(exp, '{"location":{"type":"link","url":"https://x"}}')).toBeNull()
  })

  it('a string-typed fixture stays a string even as a whole leaf', () => {
    const fx = new Map<string, Record<string, unknown>>([['user', { name: 'pro' }]])
    const req: GuardHttpRequest = { method: 'POST', path: '/x', json: { owner: '{{fixture:user.name}}' } }
    const out = interpolateRequest(req, noVars, noCreds, fx)
    expect(out.json).toEqual({ owner: 'pro' })
  })
})
