import { describe, it, expect } from 'vitest'
import {
  interpolate,
  interpolateRequest,
  lookupJsonPath,
  captureValueToString,
  JSON_PATH_MISS,
  UnknownVariableError,
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
