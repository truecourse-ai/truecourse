import { describe, it, expect } from 'vitest'
import {
  interpolate,
  interpolateRequest,
  resolveHeaderValue,
  lookupJsonPath,
  captureValueToString,
  JSON_PATH_MISS,
  UnknownVariableError,
  UnknownCredentialError,
  UnknownFixtureError,
} from '@truecourse/guard-runner'

describe('interpolate', () => {
  const vars = new Map([
    ['id', '42'],
    ['token', 'abc'],
  ])

  it('replaces every ${name} with its captured value', () => {
    expect(interpolate('/todos/${id}?t=${token}', vars)).toBe('/todos/42?t=abc')
  })

  it('leaves text without placeholders untouched', () => {
    expect(interpolate('/todos', vars)).toBe('/todos')
  })

  it('throws UnknownVariableError for a name no step captured', () => {
    expect(() => interpolate('/todos/${nope}', vars)).toThrow(UnknownVariableError)
  })

  it('does not treat $name or {name} as placeholders', () => {
    expect(interpolate('/a/$id/{id}', vars)).toBe('/a/$id/{id}')
  })
})

describe('interpolateRequest', () => {
  const vars = new Map([['id', '7']])

  it('interpolates path, header values, and string json leaves', () => {
    const out = interpolateRequest(
      {
        method: 'POST',
        path: '/todos/${id}',
        headers: { 'x-ref': 'todo-${id}' },
        json: { parent: '${id}', tags: ['a-${id}'], count: 3, nested: { ref: '${id}' } },
      },
      vars,
    )
    expect(out.path).toBe('/todos/7')
    expect(out.headers).toEqual({ 'x-ref': 'todo-7' })
    expect(out.json).toEqual({ parent: '7', tags: ['a-7'], count: 3, nested: { ref: '7' } })
  })

  it('interpolates a raw body', () => {
    const out = interpolateRequest({ method: 'POST', path: '/x', body: 'id=${id}' }, vars)
    expect(out.body).toBe('id=7')
  })
})

describe('resolveHeaderValue', () => {
  const vars = new Map([['id', '7']])
  const creds = new Map([['api-key', 'sekret-token']])

  it('substitutes {{cred:name}} with the resolved secret', () => {
    expect(resolveHeaderValue('{{cred:api-key}}', vars, creds)).toBe('sekret-token')
    expect(resolveHeaderValue('Bearer {{cred:api-key}}', vars, creds)).toBe('Bearer sekret-token')
  })

  it('interpolates ${var} in the literal text around a credential', () => {
    expect(resolveHeaderValue('t-${id} {{cred:api-key}}', vars, creds)).toBe('t-7 sekret-token')
  })

  it('throws UnknownCredentialError naming an undeclared credential', () => {
    expect(() => resolveHeaderValue('{{cred:ghost}}', vars, creds)).toThrow(UnknownCredentialError)
    try {
      resolveHeaderValue('{{cred:ghost}}', vars, creds)
    } catch (e) {
      expect((e as UnknownCredentialError).credential).toBe('ghost')
    }
  })

  it('is injection-safe: a captured value that IS a placeholder is NEVER expanded to a secret', () => {
    // A response captured `${evil}` whose value is literally `{{cred:api-key}}`.
    const withEvil = new Map([['evil', '{{cred:api-key}}']])
    // Only the placeholder written in the TEMPLATE resolves; the one produced by
    // interpolation lands as literal text on the wire.
    expect(resolveHeaderValue('${evil}', withEvil, creds)).toBe('{{cred:api-key}}')
  })
})

describe('interpolateRequest — credential-aware headers', () => {
  const vars = new Map([['id', '7']])
  const creds = new Map([['api-key', 'sekret-token']])

  it('resolves credential placeholders in headers when a credentials map is supplied', () => {
    const out = interpolateRequest(
      { method: 'GET', path: '/me/${id}', headers: { Authorization: '{{cred:api-key}}' } },
      vars,
      creds,
    )
    expect(out.path).toBe('/me/7')
    expect(out.headers).toEqual({ Authorization: 'sekret-token' })
  })

  it('never expands a credential a captured var introduced (bounded injection path)', () => {
    const withEvil = new Map([['evil', '{{cred:api-key}}']])
    const out = interpolateRequest(
      { method: 'GET', path: '/me', headers: { Authorization: '${evil}' } },
      withEvil,
      creds,
    )
    expect(out.headers).toEqual({ Authorization: '{{cred:api-key}}' })
  })

  it('does not touch path or body — credentials live in headers only', () => {
    const out = interpolateRequest(
      { method: 'POST', path: '/x/{{cred:api-key}}', body: '{{cred:api-key}}' },
      vars,
      creds,
    )
    expect(out.path).toBe('/x/{{cred:api-key}}')
    expect(out.body).toBe('{{cred:api-key}}')
  })
})

describe('resolveHeaderValue — fixtures (Phase 2)', () => {
  const vars = new Map([['id', '7']])
  const creds = new Map([['api-key', 'sekret-token']])
  const fixtures = new Map([['user', { id: '4', username: 'pro' }]])

  it('substitutes {{fixture:name.field}} in a header value', () => {
    expect(resolveHeaderValue('user=${id} {{fixture:user.username}}', vars, creds, fixtures)).toBe('user=7 pro')
  })

  it('resolves credentials AND fixtures in the same header template', () => {
    expect(resolveHeaderValue('{{cred:api-key}} u={{fixture:user.id}}', vars, creds, fixtures)).toBe('sekret-token u=4')
  })

  it('throws UnknownFixtureError for an undeclared fixture name', () => {
    expect(() => resolveHeaderValue('{{fixture:ghost.id}}', vars, creds, fixtures)).toThrow(UnknownFixtureError)
  })

  it('throws UnknownFixtureError for an undeclared field on a known fixture', () => {
    try {
      resolveHeaderValue('{{fixture:user.email}}', vars, creds, fixtures)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(UnknownFixtureError)
      expect((e as UnknownFixtureError).fixture).toBe('user.email')
    }
  })

  it('is injection-safe: a captured value that IS a fixture placeholder is NEVER substituted', () => {
    const withEvil = new Map([['evil', '{{fixture:user.username}}']])
    expect(resolveHeaderValue('${evil}', withEvil, creds, fixtures)).toBe('{{fixture:user.username}}')
  })
})

describe('interpolateRequest — fixtures across path, query, and body (Phase 2)', () => {
  const vars = new Map<string, string>()
  const noCreds = new Map<string, string>()
  const fixtures = new Map([
    ['user', { id: '4', username: 'pro' }],
    ['eventType', { id: '3' }],
  ])

  it('substitutes fixtures in the url path and query params (broader than credentials)', () => {
    const out = interpolateRequest(
      { method: 'GET', path: '/users/{{fixture:user.id}}/bookings?type={{fixture:eventType.id}}' },
      vars,
      noCreds,
      fixtures,
    )
    expect(out.path).toBe('/users/4/bookings?type=3')
  })

  it('substitutes fixtures in a raw body and in JSON body leaves', () => {
    const raw = interpolateRequest(
      { method: 'POST', path: '/x', body: 'owner={{fixture:user.username}}' },
      vars,
      noCreds,
      fixtures,
    )
    expect(raw.body).toBe('owner=pro')

    const json = interpolateRequest(
      { method: 'POST', path: '/bookings', json: { userId: '{{fixture:user.id}}', tags: ['u-{{fixture:user.username}}'], n: 5 } },
      vars,
      noCreds,
      fixtures,
    )
    expect(json.json).toEqual({ userId: '4', tags: ['u-pro'], n: 5 })
  })

  it('resolves credentials in headers AND fixtures in the body in one pass', () => {
    const creds = new Map([['api-key', 'sk-1']])
    const out = interpolateRequest(
      {
        method: 'POST',
        path: '/bookings',
        headers: { Authorization: '{{cred:api-key}}' },
        json: { eventTypeId: '{{fixture:eventType.id}}' },
      },
      vars,
      creds,
      fixtures,
    )
    expect(out.headers).toEqual({ Authorization: 'sk-1' })
    expect(out.json).toEqual({ eventTypeId: '3' })
  })

  it('leaves a credential placeholder in the body literal — cred stays header-only even with fixtures', () => {
    const creds = new Map([['api-key', 'sk-1']])
    const out = interpolateRequest(
      { method: 'POST', path: '/x/{{cred:api-key}}', body: '{{cred:api-key}}' },
      vars,
      creds,
      fixtures,
    )
    expect(out.path).toBe('/x/{{cred:api-key}}')
    expect(out.body).toBe('{{cred:api-key}}')
  })
})

describe('lookupJsonPath', () => {
  const doc = { id: 1, items: [{ name: 'a' }, { name: 'b' }], meta: { deep: { v: null } } }

  it('resolves dotted paths and array indices', () => {
    expect(lookupJsonPath(doc, 'id')).toBe(1)
    expect(lookupJsonPath(doc, 'items[1].name')).toBe('b')
    expect(lookupJsonPath(doc, 'meta.deep.v')).toBe(null)
  })

  it('"" addresses the root', () => {
    expect(lookupJsonPath(doc, '')).toBe(doc)
  })

  it('resolves a bare [n] against a root array', () => {
    expect(lookupJsonPath([{ x: 9 }], '[0].x')).toBe(9)
  })

  it('returns JSON_PATH_MISS for absent segments (never undefined confusion)', () => {
    expect(lookupJsonPath(doc, 'nope')).toBe(JSON_PATH_MISS)
    expect(lookupJsonPath(doc, 'items[5].name')).toBe(JSON_PATH_MISS)
    expect(lookupJsonPath(doc, 'id.deeper')).toBe(JSON_PATH_MISS)
  })
})

describe('captureValueToString', () => {
  it('keeps strings plain and stringifies scalars', () => {
    expect(captureValueToString('x')).toBe('x')
    expect(captureValueToString(7)).toBe('7')
    expect(captureValueToString(true)).toBe('true')
    expect(captureValueToString(null)).toBe('null')
  })

  it('JSON-stringifies objects and arrays', () => {
    expect(captureValueToString({ a: 1 })).toBe('{"a":1}')
    expect(captureValueToString([1, 2])).toBe('[1,2]')
  })
})
