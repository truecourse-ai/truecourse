/**
 * `wireSchema`: the tool input schema a provider receives, given what that
 * provider asks of a schema.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { wireSchema } from '../../packages/llm-api/src/wire-schema.js';

const input = z.object({ query: z.string().min(1), limit: z.number().int().max(20).optional() });

describe('wireSchema', () => {
  it('sends the schema as authored when the provider does not normalize', () => {
    const wire = wireSchema(input, {});

    expect(wire.schema).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 }, limit: { type: 'integer', maximum: 20 } },
      required: ['query'],
      additionalProperties: false,
    });
    expect(wire.widened).toEqual([]);
    expect(wire.strict).toBe(false);
  });

  it('makes every property required and records the optionals it widened to nullable', () => {
    const wire = wireSchema(input, { normalizeToolSchema: true });

    expect(wire.schema.required).toEqual(['query', 'limit']);
    expect((wire.schema.properties as Record<string, unknown>).limit).toMatchObject({
      type: ['integer', 'null'],
      maximum: 20,
    });
    expect(wire.widened).toEqual([['limit']]);
  });

  it('asks for strict only when the provider enforces tool schemas', () => {
    expect(wireSchema(input, { strictTools: true }).strict).toBe(true);
    expect(wireSchema(input, { normalizeToolSchema: true }).strict).toBe(false);
  });

  it('factors repeated sub-schemas into definitions', () => {
    const point = z.object({
      x: z.number().describe('Horizontal offset from the left edge, in CSS pixels of the viewport.'),
      y: z.number().describe('Vertical offset from the top edge, in CSS pixels of the viewport.'),
    });
    const wire = wireSchema(z.object({ from: point, to: point }), {});

    expect(wire.schema.properties).toEqual({ from: { $ref: '#/$defs/s0' }, to: { $ref: '#/$defs/s0' } });
    expect(wire.schema.$defs).toHaveProperty('s0');
  });

  it('refuses a schema strict mode cannot express, naming the subject and the path', () => {
    expect(() => wireSchema(z.object({ env: z.record(z.string()) }), { normalizeToolSchema: true }, 'tool `run`')).toThrow(
      /for tool `run`: properties\.env is a typed record/,
    );
  });
});
