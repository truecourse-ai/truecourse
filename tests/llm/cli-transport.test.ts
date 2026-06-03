import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseEnvelope } from '../../packages/llm/src/cli-transport';

// The CLI transport's envelope parsing (moved here from the core provider):
// prefer `structured_output`, fall back to `result` text, surface `is_error`,
// and tolerate code fences.
const Schema = z.object({ ok: z.boolean(), note: z.string().default('') });

describe('parseEnvelope (CLI transport)', () => {
  it('parses structured_output when present', () => {
    const raw = JSON.stringify({
      type: 'result',
      is_error: false,
      structured_output: { ok: true, note: 'hi' },
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const { object, usage } = parseEnvelope(raw, Schema);
    expect(object.ok).toBe(true);
    expect(object.note).toBe('hi');
    expect(usage?.inputTokens).toBe(10);
    expect(usage?.totalTokens).toBe(15); // input + output only
  });

  it('falls back to the result field as JSON', () => {
    const raw = JSON.stringify({
      type: 'result',
      is_error: false,
      result: JSON.stringify({ ok: false }),
    });
    expect(parseEnvelope(raw, Schema).object.ok).toBe(false);
  });

  it('strips a markdown code fence around the result JSON', () => {
    const raw = JSON.stringify({
      is_error: false,
      result: '```json\n{"ok":true}\n```',
    });
    expect(parseEnvelope(raw, Schema).object.ok).toBe(true);
  });

  it('throws the agent error message on is_error (even with exit code 0)', () => {
    const raw = JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in' });
    expect(() => parseEnvelope(raw, Schema)).toThrow('Not logged in');
  });

  it('throws when the result is non-JSON prose', () => {
    const raw = JSON.stringify({ is_error: false, result: 'just some text' });
    expect(() => parseEnvelope(raw, Schema)).toThrow();
  });

  it('throws on a schema mismatch', () => {
    const raw = JSON.stringify({ is_error: false, structured_output: { ok: 'nope' } });
    expect(() => parseEnvelope(raw, Schema)).toThrow();
  });
});
