/**
 * The JSON Schema a tool's input is sent to a provider as. Pure: a Zod schema
 * and what the provider asks of a schema in, the wire schema out, plus the
 * data paths whose nullability was widened (so the driver can strip the
 * injected nulls from the reply) and whether the tool is sent strict.
 *
 * The session driver sends exactly what this returns and holds no schema logic
 * of its own. A schema the provider's strict mode cannot express throws, naming
 * `subject` and the schema path: it is never sent unenforced.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';
import { normalizeForStrictOutput, type SchemaPath } from './strict-schema.js';
import { compactSchema } from './compact-schema.js';

/** What a provider asks of a tool schema. */
export interface SchemaCapabilities {
  /** Every property required, optionals widened to nullable, `additionalProperties: false`. */
  readonly normalizeToolSchema?: boolean;
  /** Ask the provider to enforce the tool schema. */
  readonly strictTools?: boolean;
}

export interface WireSchema {
  /** The JSON Schema object sent as the tool's input schema. */
  schema: Record<string, unknown>;
  /** Data paths whose nullability was injected by normalization. */
  widened: readonly SchemaPath[];
  /** Whether the tool is sent with `strict: true`. */
  strict: boolean;
}

export function wireSchema(schema: ZodTypeAny, capabilities: SchemaCapabilities, subject?: string): WireSchema {
  const rawSchema = zodToJsonSchema(schema, { $refStrategy: 'none' });
  const { schema: inputSchema, widened } = capabilities.normalizeToolSchema
    ? normalizeForStrictOutput(rawSchema, subject)
    : { schema: rawSchema, widened: [] };
  return {
    schema: compactSchema(inputSchema),
    widened,
    strict: capabilities.strictTools === true,
  };
}
