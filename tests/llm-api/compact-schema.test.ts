import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { jsonSchemaHint } from '../../packages/shared/src/llm/transport.js';
import { AuthoredFragmentSchema } from '../../packages/core/src/services/interface-author/draft.js';
import { compactNormalizedSchema } from '../../packages/llm-api/src/compact-schema.js';
import { normalizeForStrictOutput, stripInjectedNulls } from '../../packages/llm-api/src/strict-schema.js';
import { assertOpenAiStrictValid } from './strict-assert.js';

type Schema = Record<string, unknown>;

/** Resolve the emitted local graph independently, proving no constraints moved
 * or disappeared. Only schema positions are walked; const/enum remain data. */
function expand(schema: Schema): Schema {
  function resolve(node: Schema, ancestors = new Set<string>()): Schema {
    if (typeof node.$ref === 'string') {
      expect(Object.keys(node)).toEqual(['$ref']);
      expect(node.$ref).toMatch(/^#\/\$defs\/[^/]+$/);
      expect(ancestors.has(node.$ref), 'definitions must not be cyclic').toBe(false);
      const name = node.$ref.slice('#/$defs/'.length);
      const target = (schema.$defs as Record<string, Schema>)[name];
      expect(target, `missing definition ${name}`).toBeDefined();
      return resolve(target, new Set([...ancestors, node.$ref]));
    }
    const result: Schema = { ...node };
    delete result.$defs;
    if (node.properties) {
      result.properties = Object.fromEntries(Object.entries(node.properties as Record<string, Schema>)
        .map(([key, child]) => [key, resolve(child, ancestors)]));
    }
    if (node.items) result.items = resolve(node.items as Schema, ancestors);
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
      if (Array.isArray(node[key])) result[key] = node[key].map((child: Schema) => resolve(child, ancestors));
    }
    return result;
  }
  return resolve(schema);
}

describe('compactNormalizedSchema', () => {
  it('substantially shrinks real authoring schemas while preserving every expanded constraint', () => {
    const { schema, widened } = normalizeForStrictOutput(JSON.parse(jsonSchemaHint(AuthoredFragmentSchema)));
    const before = JSON.stringify(schema);
    const pathsBefore = JSON.stringify(widened);
    const compact = compactNormalizedSchema(schema);

    expect(compact.type).toBe('object');
    expect(compact.$defs).toBeDefined();
    expect(JSON.stringify(compact).length).toBeLessThan(before.length * 0.3);
    expect(expand(compact)).toEqual(schema);
    assertOpenAiStrictValid(expand(compact), 'expanded compact authoring schema');
    expect(JSON.stringify(schema)).toBe(before);
    expect(JSON.stringify(widened)).toBe(pathsBefore);
    expect(compactNormalizedSchema(schema)).toEqual(compact);
  });

  it('retains null stripping at every nested readable locator occurrence', () => {
    const { schema, widened } = normalizeForStrictOutput(JSON.parse(jsonSchemaHint(AuthoredFragmentSchema)));
    expect(expand(compactNormalizedSchema(schema))).toEqual(schema);
    const locator = () => ({
      role: 'button', name: 'Save', exact: null, pick: null,
      within: { role: 'dialog', name: 'Editor', exact: null },
    });
    const reply = {
      interfaces: [], states: null, unresolved: null, findings: null,
      resources: [{
        id: 'editor', kind: 'screen', title: 'Editor', of: null, address: '/editor', description: null,
        readables: {
          markers: [{ id: null, within: locator(), marker: 'Save changes', when: null }],
          elements: [{ id: null, element: locator(), when: null }],
          controls: [{ id: null, control: locator(), states: ['disabled'], when: null }],
          rows: [{
            id: null, within: locator(), item: 'row', template: 'Invoice <name>',
            slots: [{ name: 'name', kind: 'text', values: null }], when: null,
          }],
        },
      }],
    };

    const stripped = stripInjectedNulls(reply, widened);
    const parsed = AuthoredFragmentSchema.safeParse(stripped);
    expect(parsed.success, parsed.success ? undefined : parsed.error.message).toBe(true);
    const readables = stripped.resources[0].readables;
    for (const target of [readables.markers[0].within, readables.elements[0].element,
      readables.controls[0].control, readables.rows[0].within]) {
      expect(target).toEqual({ role: 'button', name: 'Save', within: { role: 'dialog', name: 'Editor' } });
    }
  });

  it('preserves genuine nullability and required enum constraints alongside repeated optionals', () => {
    const item = z.object({
      mode: z.enum(['save', 'cancel', 'archive']),
      note: z.string().nullable(),
      details: z.object({ reason: z.string().min(1), optional: z.boolean().optional() }).optional(),
    }).strict();
    const original = z.object({ first: item, second: item }).strict();
    const { schema, widened } = normalizeForStrictOutput(JSON.parse(jsonSchemaHint(original)));
    expect(expand(compactNormalizedSchema(schema))).toEqual(schema);
    const cleaned = stripInjectedNulls({
      first: { mode: 'save', note: null, details: { reason: 'ready', optional: null } },
      second: { mode: 'cancel', note: null, details: null },
    }, widened);
    expect(original.safeParse(cleaned).success).toBe(true);
    expect(cleaned.first.note).toBeNull();
    expect(cleaned.second.note).toBeNull();
    expect(original.safeParse({ ...cleaned, first: { ...cleaned.first, mode: 'unknown' } }).success).toBe(false);
  });

  it('does not treat literal schema-shaped enum/const data as schema nodes', () => {
    const literal = { $ref: '#/a-literal-value', properties: { text: 'x'.repeat(250) } };
    const shared = { type: 'string', description: 'A repeated explanation.'.repeat(20) };
    const schema = {
      type: 'object', properties: { a: shared, b: shared, literal: { const: literal } },
      required: ['a', 'b', 'literal'], additionalProperties: false,
    };
    const compact = compactNormalizedSchema(schema);
    expect(compact.$defs).toBeDefined();
    expect(expand(compact)).toEqual(schema);
  });

  it('leaves existing reference graphs intact and does not inflate small schemas', () => {
    const referenced = {
      type: 'object', properties: { item: { $ref: '#/$defs/item' } },
      $defs: { item: { type: 'string' } }, required: ['item'], additionalProperties: false,
    };
    expect(compactNormalizedSchema(referenced)).toEqual(referenced);
    const small = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } };
    expect(compactNormalizedSchema(small)).toEqual(small);
  });
});
