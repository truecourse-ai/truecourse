/**
 * The strict-output schema normalizer: what it rewrites so an OpenAI-family
 * provider accepts the schema, what it refuses outright (the call site must opt
 * out explicitly), and the null-stripping that hands the caller's Zod a reply it
 * accepts.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeForStrictOutput,
  stripInjectedNulls,
  SchemaNotEnforceableError,
  ARRAY_ELEMENTS,
} from '../../packages/llm-api/src/strict-schema.js';
import { assertOpenAiStrictValid } from './strict-assert.js';

describe('normalizeForStrictOutput — required + nullability', () => {
  it('makes an optional property required, widens it to accept null, and records the path', () => {
    const { schema, widened } = normalizeForStrictOutput({
      type: 'object',
      properties: { build: { type: 'string' }, install: { type: 'string' } },
      required: ['build'],
      additionalProperties: false,
    });

    assertOpenAiStrictValid(schema);
    expect(schema.required).toEqual(['build', 'install']);
    expect((schema.properties as Record<string, unknown>).install).toEqual({ type: ['string', 'null'] });
    expect((schema.properties as Record<string, unknown>).build).toEqual({ type: 'string' });
    expect(widened).toEqual([['install']]);
  });

  it('keeps sibling constraints when extending a primitive type', () => {
    const { schema } = normalizeForStrictOutput({
      type: 'object',
      properties: { note: { type: 'string', minLength: 1, description: 'why' } },
      additionalProperties: false,
    });
    expect((schema.properties as Record<string, unknown>).note).toEqual({
      type: ['string', 'null'],
      minLength: 1,
      description: 'why',
    });
  });

  it('wraps a non-primitive optional in a null union rather than extending `type`', () => {
    const { schema, widened } = normalizeForStrictOutput({
      type: 'object',
      properties: {
        flavor: { type: 'string', enum: ['a', 'b'] },
        example: {
          type: 'object',
          properties: { block: { type: 'string' } },
          required: ['block'],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    });

    assertOpenAiStrictValid(schema);
    const props = schema.properties as Record<string, Record<string, unknown>>;
    // An enum can't take null via `type` (the value set would still exclude it).
    expect(props.flavor.anyOf).toEqual([{ type: 'string', enum: ['a', 'b'] }, { type: 'null' }]);
    expect((props.example.anyOf as unknown[])[1]).toEqual({ type: 'null' });
    expect(widened).toEqual([['flavor'], ['example']]);
  });

  it('normalizes nested optionals, including inside array items', () => {
    const { schema, widened } = normalizeForStrictOutput({
      type: 'object',
      properties: {
        claims: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              claim: { type: 'string' },
              support: {
                type: 'object',
                properties: { subject: { type: 'string' }, extension: { type: 'string' } },
                required: ['subject'],
                additionalProperties: false,
              },
            },
            required: ['claim'],
            additionalProperties: false,
          },
        },
      },
      required: ['claims'],
      additionalProperties: false,
    });

    assertOpenAiStrictValid(schema);
    expect(widened).toEqual([
      ['claims', ARRAY_ELEMENTS, 'support', 'extension'],
      ['claims', ARRAY_ELEMENTS, 'support'],
    ]);
  });

  it('leaves an already-nullable optional alone and does NOT record it', () => {
    const { schema, widened } = normalizeForStrictOutput({
      type: 'object',
      properties: {
        status: { type: ['string', 'null'] },
        note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
      additionalProperties: false,
    });

    assertOpenAiStrictValid(schema);
    expect(schema.required).toEqual(['status', 'note']);
    const props = schema.properties as Record<string, unknown>;
    expect(props.status).toEqual({ type: ['string', 'null'] });
    expect(props.note).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(widened).toEqual([]);
  });

  it('treats a `.default()` property as optional and drops the rejected `default` keyword', () => {
    const { schema, widened } = normalizeForStrictOutput({
      type: 'object',
      properties: { reason: { type: 'string', default: '' } },
      required: [],
      additionalProperties: false,
    });

    assertOpenAiStrictValid(schema);
    expect((schema.properties as Record<string, unknown>).reason).toEqual({ type: ['string', 'null'] });
    expect(widened).toEqual([['reason']]);
  });

  it('drops the root `$schema` meta-annotation', () => {
    const { schema } = normalizeForStrictOutput({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    });
    expect(schema.$schema).toBeUndefined();
    assertOpenAiStrictValid(schema);
  });

  it('fills in a missing `additionalProperties: false` on every object node', () => {
    const { schema } = normalizeForStrictOutput({
      type: 'object',
      properties: { inner: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] } },
      required: ['inner'],
    });
    assertOpenAiStrictValid(schema);
    expect(schema.additionalProperties).toBe(false);
  });

  it('rewrites openApi3 `nullable: true` into a null union without recording it', () => {
    const { schema, widened } = normalizeForStrictOutput({
      type: 'object',
      properties: {
        targetServiceId: { type: 'string', nullable: true, description: 'id' },
        fixPrompt: { type: 'string', nullable: true },
      },
      required: ['targetServiceId', 'fixPrompt'],
      additionalProperties: false,
    });

    assertOpenAiStrictValid(schema);
    const props = schema.properties as Record<string, unknown>;
    expect(props.targetServiceId).toEqual({ type: ['string', 'null'], description: 'id' });
    expect(props.fixPrompt).toEqual({ type: ['string', 'null'] });
    expect(widened).toEqual([]);
  });

  it('collapses a positional tuple into a single element schema', () => {
    const { schema } = normalizeForStrictOutput({
      type: 'object',
      properties: {
        lines: { type: 'array', minItems: 2, maxItems: 2, items: [{ type: 'integer' }, { type: 'integer' }] },
        pair: { type: 'array', items: [{ type: 'integer' }, { type: 'string' }] },
      },
      required: ['lines', 'pair'],
      additionalProperties: false,
    });

    assertOpenAiStrictValid(schema);
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.lines).toEqual({ type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer' } });
    expect(props.pair.items).toEqual({ anyOf: [{ type: 'integer' }, { type: 'string' }] });
  });

  it('never mutates the input schema', () => {
    const input = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string', default: '' } },
      required: ['a'],
    };
    const snapshot = JSON.stringify(input);
    normalizeForStrictOutput(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('normalizeForStrictOutput — inexpressible schemas throw', () => {
  it('rejects a typed record, naming the path', () => {
    expect(() =>
      normalizeForStrictOutput(
        {
          type: 'object',
          properties: { env: { type: 'object', additionalProperties: { type: 'string' } } },
          required: ['env'],
          additionalProperties: false,
        },
        'guard.recipe',
      ),
    ).toThrow(/guard\.recipe: properties\.env is a typed record/);
  });

  it('rejects an open `{}` sub-schema', () => {
    expect(() =>
      normalizeForStrictOutput({
        type: 'object',
        properties: { content: {} },
        required: ['content'],
        additionalProperties: false,
      }),
    ).toThrow(/properties\.content is an open `\{\}` sub-schema/);
  });

  it('rejects a passthrough object (additionalProperties: true)', () => {
    expect(() =>
      normalizeForStrictOutput({
        type: 'object',
        properties: { as: { type: 'string' } },
        additionalProperties: true,
      }),
    ).toThrow(/allows additional properties/);
  });

  it('rejects an array root', () => {
    expect(() => normalizeForStrictOutput({ type: 'array', items: { type: 'object' } })).toThrow(
      /is not an object-rooted schema/,
    );
  });

  it('rejects a scalar root and a union root', () => {
    expect(() => normalizeForStrictOutput({ type: 'string' })).toThrow(/object-rooted/);
    expect(() => normalizeForStrictOutput({ anyOf: [{ type: 'object' }] })).toThrow(/object-rooted/);
  });

  it('throws SchemaNotEnforceableError and points at the opt-out', () => {
    try {
      normalizeForStrictOutput({ type: 'string' }, 'spec.vocab');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaNotEnforceableError);
      expect((err as Error).message).toContain('enforceSchema: false');
    }
  });
});

describe('stripInjectedNulls', () => {
  it('deletes nulls at recorded paths, including inside arrays', () => {
    const value = {
      claims: [
        { claim: 'a', flavor: null, support: null },
        { claim: 'b', flavor: 'example', support: { subject: 's', extension: null } },
      ],
      untestable: null,
    };
    stripInjectedNulls(value, [
      ['claims', ARRAY_ELEMENTS, 'flavor'],
      ['claims', ARRAY_ELEMENTS, 'support', 'extension'],
      ['claims', ARRAY_ELEMENTS, 'support'],
      ['untestable'],
    ]);

    expect(value).toEqual({
      claims: [{ claim: 'a' }, { claim: 'b', flavor: 'example', support: { subject: 's' } }],
    });
  });

  it('leaves nulls at unrecorded paths — a legitimately nullable field keeps its null', () => {
    const value = { status: null, reason: null };
    stripInjectedNulls(value, [['reason']]);
    expect(value).toEqual({ status: null });
  });

  it('leaves a non-null value at a recorded path alone', () => {
    const value = { reason: 'because' };
    stripInjectedNulls(value, [['reason']]);
    expect(value).toEqual({ reason: 'because' });
  });
});
