import { describe, it, expect } from 'vitest';
import { jsonSchemaHint } from '../../packages/shared/src/llm/transport';
import { ExtractionResultSchema } from '../../packages/contract-extractor/src/types';
import { LlmExtractionSchema } from '../../packages/spec-consolidator/src/prompt';

// Structured output sends these schemas through the AI SDK's generateObject (in
// EE). zodToJsonSchema runs at RUNTIME — the build can't catch a schema it can't
// convert. Pin that the real, complex extraction schemas convert to a valid,
// object-shaped JSON schema string (no throw, round-trips, enforceable).
describe('structured-output — real extractor schemas convert cleanly', () => {
  it.each([
    ['ExtractionResultSchema (contracts)', ExtractionResultSchema],
    ['LlmExtractionSchema (spec claims)', LlmExtractionSchema],
  ])('%s → valid object JSON schema', (_name, schema) => {
    const out = jsonSchemaHint(schema);
    // No `$ref` anywhere — provider structured-output validators reject refs that
    // aren't under `$defs`/`definitions` (zod-to-json-schema's default emits
    // `#/properties/...` refs for reused sub-schemas), which failed every
    // spec.claimExtract call. They must be inlined. Regression guard.
    expect(out).not.toContain('$ref');
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed.type === 'object' || Boolean(parsed.properties)).toBe(true);
  });
});
