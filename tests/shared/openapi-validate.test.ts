import { describe, it, expect } from 'vitest'
import { validateAgainstSchema, responseJsonSchema } from '@truecourse/shared/openapi'

describe('validateAgainstSchema', () => {
  it('passes a conforming object', () => {
    const schema = { type: 'object', properties: { id: { type: 'integer' }, title: { type: 'string' } } }
    expect(validateAgainstSchema({ id: 1, title: 'x' }, schema)).toBeNull()
  })

  it('flags a missing required property with its path (the drift signal)', () => {
    const schema = {
      type: 'object',
      required: ['id', 'nextCursor'],
      properties: { id: { type: 'integer' }, nextCursor: { type: 'string' } },
    }
    const v = validateAgainstSchema({ id: 1 }, schema)
    expect(v).not.toBeNull()
    expect(v!.path).toBe('nextCursor')
    expect(v!.actual).toBe('missing')
    expect(v!.expected).toContain('required')
  })

  it('reports the missing-required path deep in the object graph', () => {
    const schema = {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          properties: {
            pagination: { type: 'object', required: ['nextCursor'], properties: { nextCursor: { type: 'string' } } },
          },
        },
      },
    }
    const v = validateAgainstSchema({ data: { pagination: {} } }, schema)
    expect(v!.path).toBe('data.pagination.nextCursor')
  })

  it('flags a wrong scalar type', () => {
    const schema = { type: 'object', properties: { id: { type: 'integer' } } }
    const v = validateAgainstSchema({ id: 'oops' }, schema)
    expect(v!.path).toBe('id')
    expect(v!.expected).toContain('integer')
  })

  it('requires an integer to be a whole number', () => {
    const schema = { type: 'integer' }
    expect(validateAgainstSchema(3, schema)).toBeNull()
    expect(validateAgainstSchema(3.5, schema)).not.toBeNull()
  })

  it('allows extra undocumented fields by default', () => {
    const schema = { type: 'object', properties: { id: { type: 'integer' } } }
    expect(validateAgainstSchema({ id: 1, extra: true }, schema)).toBeNull()
  })

  it('flags an extra field only when additionalProperties is false', () => {
    const schema = { type: 'object', additionalProperties: false, properties: { id: { type: 'integer' } } }
    const v = validateAgainstSchema({ id: 1, extra: true }, schema)
    expect(v!.path).toBe('extra')
    expect(v!.expected).toContain('additionalProperties')
  })

  it('accepts null for a nullable (3.0) or null-typed (3.1) field', () => {
    expect(validateAgainstSchema({ a: null }, { type: 'object', properties: { a: { type: 'string', nullable: true } } })).toBeNull()
    expect(validateAgainstSchema({ a: null }, { type: 'object', properties: { a: { type: ['string', 'null'] } } })).toBeNull()
    const v = validateAgainstSchema({ a: null }, { type: 'object', properties: { a: { type: 'string' } } })
    expect(v!.path).toBe('a')
    expect(v!.actual).toBe('null')
  })

  it('checks enum membership', () => {
    const schema = { type: 'object', properties: { s: { enum: ['open', 'closed'] } } }
    expect(validateAgainstSchema({ s: 'open' }, schema)).toBeNull()
    const v = validateAgainstSchema({ s: 'nope' }, schema)
    expect(v!.path).toBe('s')
    expect(v!.expected).toContain('enum')
  })

  it('validates array items per-element with an [i] path', () => {
    const schema = { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } }
    expect(validateAgainstSchema([{ id: 1 }, { id: 2 }], schema)).toBeNull()
    const v = validateAgainstSchema([{ id: 1 }, {}], schema)
    expect(v!.path).toBe('[1].id')
  })

  it('validates nested array items inside an object with a dotted+indexed path', () => {
    const schema = {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } } },
    }
    const v = validateAgainstSchema({ items: [{ id: 1 }, {}] }, schema)
    expect(v!.path).toBe('items[1].id')
  })

  it('allOf requires all branches to hold', () => {
    const schema = { allOf: [{ type: 'object', required: ['a'] }, { type: 'object', required: ['b'] }] }
    expect(validateAgainstSchema({ a: 1, b: 2 }, schema)).toBeNull()
    expect(validateAgainstSchema({ a: 1 }, schema)).not.toBeNull()
  })

  it('anyOf/oneOf require at least one branch to hold', () => {
    const schema = { anyOf: [{ type: 'string' }, { type: 'integer' }] }
    expect(validateAgainstSchema('x', schema)).toBeNull()
    expect(validateAgainstSchema(3, schema)).toBeNull()
    expect(validateAgainstSchema(true, schema)).not.toBeNull()
    const oneOf = { oneOf: [{ type: 'string' }, { type: 'integer' }] }
    expect(validateAgainstSchema('x', oneOf)).toBeNull()
    expect(validateAgainstSchema(true, oneOf)).not.toBeNull()
  })

  it('treats an unconstrained (non-object) schema as permissive', () => {
    expect(validateAgainstSchema({ anything: 1 }, true)).toBeNull()
    expect(validateAgainstSchema({ anything: 1 }, {})).toBeNull()
  })
})

describe('responseJsonSchema', () => {
  const operation = {
    responses: {
      '200': { content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
      '4XX': { content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
      default: { content: { 'application/merge-patch+json': { schema: { type: 'object' } } } },
    },
  }

  it('resolves an exact status', () => {
    expect(responseJsonSchema(operation, 200)).toMatchObject({ properties: { ok: { type: 'boolean' } } })
  })

  it('falls back to the NXX range then default', () => {
    expect(responseJsonSchema(operation, 404)).toMatchObject({ properties: { error: { type: 'string' } } })
    expect(responseJsonSchema(operation, 503)).toMatchObject({ type: 'object' })
  })

  it('returns undefined when the operation declares no JSON response schema for the status', () => {
    const op = { responses: { '204': { description: 'no content' } } }
    expect(responseJsonSchema(op, 204)).toBeUndefined()
    expect(responseJsonSchema({ responses: {} }, 200)).toBeUndefined()
    expect(responseJsonSchema(undefined, 200)).toBeUndefined()
  })
})
