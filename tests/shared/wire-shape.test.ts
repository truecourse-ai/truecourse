/**
 * `wireShape`: a schema holding records, sent to a model as named entry lists
 * and read back into the kept shape.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { jsonSchemaHint, namedEntries, wireShape } from '../../packages/shared/src/llm/index'

const Recipe = z
  .object({
    env: namedEntries(z.record(z.string(), z.string()), 'name', 'value').optional(),
    servers: namedEntries(
      z.record(
        z.string().min(1),
        z.object({ serve: z.array(z.string()).min(1), env: namedEntries(z.record(z.string(), z.string()), 'name', 'value') }).strict(),
      ),
      'name',
      'server',
    ),
  })
  .strict()
  .refine((r) => Object.keys(r.servers).length > 0, 'declare a server')

const kept = {
  env: { NODE_ENV: 'test' },
  servers: { web: { serve: ['yarn', 'start'], env: { PORT: '${PORT}' } } },
}
const written = {
  env: [{ name: 'NODE_ENV', value: 'test' }],
  servers: [{ name: 'web', server: { serve: ['yarn', 'start'], env: [{ name: 'PORT', value: '${PORT}' }] } }],
}

describe('wireShape', () => {
  const wire = wireShape(Recipe)

  it('sends every record as a list of entries with the names it was given', () => {
    const json = JSON.parse(jsonSchemaHint(wire.schema)) as { properties: Record<string, unknown> }

    expect(json.properties.env).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, value: { type: 'string' } },
        required: ['name', 'value'],
        additionalProperties: false,
      },
    })
    expect(JSON.stringify(json)).not.toContain('"additionalProperties":{')
  })

  it('reads what the model wrote back into the kept shape', () => {
    expect(wire.resolve(written)).toEqual(kept)
    expect(wire.safeParse(written)).toEqual({ success: true, data: kept })
  })

  it('writes a kept value the way the model would', () => {
    expect(wire.write(kept)).toEqual(written)
  })

  it('reports a value off the wire in the wire\'s own terms', () => {
    const result = wire.safeParse({ servers: [{ name: 'web' }] })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['servers.0.server'])
  })

  it('applies the refinements the wire cannot carry once the value is back in its own shape', () => {
    const result = wire.safeParse({ servers: [] })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe('declare a server')
  })

  it('leaves a schema that holds no record as it is', () => {
    const plain = z.object({ a: z.string() }).strict()

    expect(wireShape(plain).schema).toBe(plain)
  })

  it('refuses a record that reaches the wire without entry names', () => {
    expect(() => wireShape(z.object({ headers: z.record(z.string(), z.string()) }))).toThrow(/without entry names/)
  })
})
