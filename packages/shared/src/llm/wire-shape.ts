/**
 * The shape a schema takes on the wire to a model, when the shape the product
 * keeps has no form every provider accepts.
 *
 * A map (`z.record`) is an open object in JSON Schema, which strict tool
 * schemas refuse. On the wire it is a list of entries instead, each an object
 * with two named fields: `namedEntries(record, 'name', 'value')` says what the
 * key and the value are called, and a record that reaches the wire without
 * names is a programming error, thrown when the wire shape is built.
 * Refinements and transforms never reach the wire: a JSON Schema cannot carry
 * them. The model's value is resolved back to the kept shape, and the original
 * schema, refinements and all, is what finally parses it.
 *
 * A schema with no record in it is its own wire shape, unchanged.
 */

import { z, type ZodTypeAny } from 'zod';

interface EntryNames {
  key: string;
  value: string;
}

const entryNames = new WeakMap<ZodTypeAny, EntryNames>();

/**
 * Name the two fields a record's entries carry on the wire, e.g.
 * `namedEntries(z.record(z.string(), z.string()), 'name', 'value')` for env
 * bindings. Returns the record itself, so the kept schema is unchanged.
 */
export function namedEntries<R extends z.ZodRecord<z.KeySchema, ZodTypeAny>>(record: R, key: string, value: string): R {
  entryNames.set(record, { key, value });
  return record;
}

/** The schemas directly inside `schema`, in the positions a wire shape can reach. */
function inner(schema: ZodTypeAny): ZodTypeAny[] {
  if (schema instanceof z.ZodObject) return Object.values(schema.shape as z.ZodRawShape);
  if (schema instanceof z.ZodArray) return [schema.element];
  if (schema instanceof z.ZodRecord) return [schema.keySchema, schema.valueSchema];
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodCatch ||
    schema instanceof z.ZodReadonly
  ) {
    return [schema._def.innerType];
  }
  if (schema instanceof z.ZodEffects) return [schema.innerType()];
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) return [...schema.options];
  if (schema instanceof z.ZodIntersection) return [schema._def.left, schema._def.right];
  if (schema instanceof z.ZodTuple) return schema.items;
  if (schema instanceof z.ZodLazy) return [schema.schema];
  return [];
}

function holdsRecord(schema: ZodTypeAny, seen = new Set<ZodTypeAny>()): boolean {
  if (seen.has(schema)) return false;
  seen.add(schema);
  return schema instanceof z.ZodRecord || inner(schema).some((child) => holdsRecord(child, seen));
}

function described<T extends ZodTypeAny>(wire: T, from: ZodTypeAny): T {
  return from.description === undefined ? wire : wire.describe(from.description);
}

function toWire(schema: ZodTypeAny): ZodTypeAny {
  if (!holdsRecord(schema)) return schema;
  if (schema instanceof z.ZodRecord) {
    const names = entryNames.get(schema);
    if (!names) throw new Error('a record reaches the wire without entry names: declare them with namedEntries()');
    const entry = z
      .object({ [names.key]: toWire(schema.keySchema), [names.value]: toWire(schema.valueSchema) })
      .strict();
    return described(z.array(entry), schema);
  }
  if (schema instanceof z.ZodObject) {
    const shape = Object.fromEntries(
      Object.entries(schema.shape as z.ZodRawShape).map(([key, child]) => [key, toWire(child)]),
    );
    return new z.ZodObject({ ...schema._def, shape: () => shape });
  }
  if (schema instanceof z.ZodArray) return new z.ZodArray({ ...schema._def, type: toWire(schema.element) });
  if (schema instanceof z.ZodOptional) return new z.ZodOptional({ ...schema._def, innerType: toWire(schema._def.innerType) });
  if (schema instanceof z.ZodNullable) return new z.ZodNullable({ ...schema._def, innerType: toWire(schema._def.innerType) });
  if (schema instanceof z.ZodDefault) return new z.ZodDefault({ ...schema._def, innerType: toWire(schema._def.innerType) });
  if (schema instanceof z.ZodEffects) return described(toWire(schema.innerType()), schema);
  if (schema instanceof z.ZodUnion) return new z.ZodUnion({ ...schema._def, options: schema.options.map(toWire) });
  throw new Error(`a ${schema._def.typeName} holding a record has no wire shape`);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `value` in the shape `schema` reads: every entry list turned back into its
 * record. Anything that does not fit the wire is left as written.
 */
function fromWire(schema: ZodTypeAny, value: unknown): unknown {
  if (!holdsRecord(schema) || value === undefined || value === null) return value;
  if (schema instanceof z.ZodRecord) {
    const names = entryNames.get(schema)!;
    if (!Array.isArray(value) || !value.every(isPlainObject)) return value;
    return Object.fromEntries(value.map((entry) => [entry[names.key], fromWire(schema.valueSchema, entry[names.value])]));
  }
  if (schema instanceof z.ZodObject) {
    if (!isPlainObject(value)) return value;
    const shape = schema.shape as z.ZodRawShape;
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [key, key in shape ? fromWire(shape[key], field) : field]),
    );
  }
  if (schema instanceof z.ZodArray) return Array.isArray(value) ? value.map((v) => fromWire(schema.element, v)) : value;
  if (schema instanceof z.ZodUnion) {
    const option = (schema.options as ZodTypeAny[]).find((o) => toWire(o).safeParse(value).success);
    return option ? fromWire(option, value) : value;
  }
  const [only] = inner(schema);
  return fromWire(only, value);
}

/** `value`, valid against `schema`, as the model writes it: every record a list of entries. */
function toWireValue(schema: ZodTypeAny, value: unknown): unknown {
  if (!holdsRecord(schema) || value === undefined || value === null) return value;
  if (schema instanceof z.ZodRecord) {
    const names = entryNames.get(schema)!;
    if (!isPlainObject(value)) return value;
    return Object.entries(value).map(([key, field]) => ({
      [names.key]: key,
      [names.value]: toWireValue(schema.valueSchema, field),
    }));
  }
  if (schema instanceof z.ZodObject) {
    if (!isPlainObject(value)) return value;
    const shape = schema.shape as z.ZodRawShape;
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [key, key in shape ? toWireValue(shape[key], field) : field]),
    );
  }
  if (schema instanceof z.ZodArray) return Array.isArray(value) ? value.map((v) => toWireValue(schema.element, v)) : value;
  if (schema instanceof z.ZodUnion) {
    const option = (schema.options as ZodTypeAny[]).find((o) => o.safeParse(value).success);
    return option ? toWireValue(option, value) : value;
  }
  const [only] = inner(schema);
  return toWireValue(only, value);
}

/** A schema as the model is sent it, and the way back from what the model wrote. */
export interface WireShape<T extends ZodTypeAny> {
  /** What the model is sent. The schema itself when it holds no record. */
  readonly schema: z.ZodType<unknown>;
  /**
   * A value the model wrote, in the shape the original schema reads. Throws a
   * `ZodError` in the wire's own terms when the value does not fit the wire.
   */
  resolve(value: unknown): unknown;
  /**
   * {@link resolve} without the check, for a caller that validates the answer
   * itself: whatever does not fit the wire is left as the model wrote it.
   */
  convert(value: unknown): unknown;
  /**
   * A value of the original schema as the model would write it, for a briefing
   * to show. Whatever does not fit the original is left as it is.
   */
  write(value: unknown): unknown;
  /** {@link resolve}, then the original schema's parse, refinements included. */
  safeParse(value: unknown): z.SafeParseReturnType<unknown, z.output<T>>;
}

export function wireShape<T extends ZodTypeAny>(original: T): WireShape<T> {
  const schema = toWire(original);
  // The raw value is what gets resolved: the original applies its own defaults
  // and transforms, and applying them twice would be wrong.
  const resolve = (value: unknown): unknown => {
    if (schema === original) return value;
    schema.parse(value);
    return fromWire(original, value);
  };
  return {
    schema,
    resolve,
    convert: (value) => fromWire(original, value),
    write: (value) => toWireValue(original, value),
    safeParse(value) {
      let resolved: unknown;
      try {
        resolved = resolve(value);
      } catch (error) {
        if (error instanceof z.ZodError) return { success: false, error };
        throw error;
      }
      return original.safeParse(resolved);
    },
  };
}
