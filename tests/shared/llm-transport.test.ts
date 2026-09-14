import { describe, it, expect, afterEach } from 'vitest';
import {
  resolveTimeoutScale,
  resolveStallTimeoutMs,
  stripCodeFences,
  extractJsonValue,
} from '../../packages/shared/src/llm/transport.js';

const SCALE_ENV = 'TRUECOURSE_LLM_TIMEOUT_SCALE';
function withScaleEnvRestore(): void {
  const orig = process.env[SCALE_ENV];
  afterEach(() => {
    if (orig === undefined) delete process.env[SCALE_ENV];
    else process.env[SCALE_ENV] = orig;
  });
}

const STALL_ENV = 'TRUECOURSE_LLM_STALL_TIMEOUT_MS';
function withStallEnvRestore(): void {
  const orig = process.env[STALL_ENV];
  afterEach(() => {
    if (orig === undefined) delete process.env[STALL_ENV];
    else process.env[STALL_ENV] = orig;
  });
}

describe('stripCodeFences', () => {
  it('strips a fenced JSON block', () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('passes unfenced text through (trimmed)', () => {
    expect(stripCodeFences('  {"a":1}  ')).toBe('{"a":1}');
  });
});

describe('extractJsonValue', () => {
  const parse = (s: string): unknown => JSON.parse(extractJsonValue(s));

  it('handles a clean fenced block', () => {
    expect(parse('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
  });
  it('handles trailing prose after the JSON (the chatty-Haiku failure)', () => {
    const raw = '```json\n[{"blockId":"x","topics":[],"claims":[]}]\n```\nNote: these are design choices, not specs.';
    expect(parse(raw)).toEqual([{ blockId: 'x', topics: [], claims: [] }]);
  });
  it('handles an unclosed fence with trailing prose (no closing ```)', () => {
    const raw = '```json\n[{"a":1}]\nThese assertions are about the system.';
    expect(parse(raw)).toEqual([{ a: 1 }]);
  });
  it('handles content on the same line as the fence', () => {
    expect(parse('```json {"a":1}')).toEqual({ a: 1 });
  });
  it('handles a leading sentence before the JSON', () => {
    expect(parse('Here is the result: {"a":1}')).toEqual({ a: 1 });
  });
  it('is not fooled by brackets inside string values', () => {
    expect(parse('{"path":"/orders/[id]","note":"a}b"}')).toEqual({ path: '/orders/[id]', note: 'a}b' });
  });
  it('passes a bare object/array through unchanged', () => {
    expect(parse('[1,2,3]')).toEqual([1, 2, 3]);
  });
});


describe('resolveTimeoutScale', () => {
  withScaleEnvRestore();

  it('defaults to 1 when unset', () => {
    delete process.env[SCALE_ENV];
    expect(resolveTimeoutScale()).toBe(1);
  });
  it('parses a float', () => {
    process.env[SCALE_ENV] = '2.5';
    expect(resolveTimeoutScale()).toBe(2.5);
  });
  it('parses an integer', () => {
    process.env[SCALE_ENV] = '3';
    expect(resolveTimeoutScale()).toBe(3);
  });
  it('falls back to 1 on non-numeric garbage', () => {
    process.env[SCALE_ENV] = 'slow';
    expect(resolveTimeoutScale()).toBe(1);
  });
  it('falls back to 1 on an empty string', () => {
    process.env[SCALE_ENV] = '';
    expect(resolveTimeoutScale()).toBe(1);
  });
  it('falls back to 1 on zero', () => {
    process.env[SCALE_ENV] = '0';
    expect(resolveTimeoutScale()).toBe(1);
  });
  it('falls back to 1 on a negative value', () => {
    process.env[SCALE_ENV] = '-2';
    expect(resolveTimeoutScale()).toBe(1);
  });
});



describe('resolveStallTimeoutMs', () => {
  withScaleEnvRestore();
  withStallEnvRestore();

  it('defaults to 5 minutes when unset', () => {
    delete process.env[STALL_ENV];
    delete process.env[SCALE_ENV];
    expect(resolveStallTimeoutMs()).toBe(300_000);
  });
  it('reads the env override', () => {
    process.env[STALL_ENV] = '1000';
    delete process.env[SCALE_ENV];
    expect(resolveStallTimeoutMs()).toBe(1000);
  });
  it('applies the same timeout scale as the ceiling', () => {
    process.env[STALL_ENV] = '1000';
    process.env[SCALE_ENV] = '3';
    expect(resolveStallTimeoutMs()).toBe(3000);
  });
  it('falls back to the default on garbage/zero', () => {
    process.env[STALL_ENV] = 'slow';
    delete process.env[SCALE_ENV];
    expect(resolveStallTimeoutMs()).toBe(300_000);
    process.env[STALL_ENV] = '0';
    expect(resolveStallTimeoutMs()).toBe(300_000);
  });
});


/**
 * The kill-mode telemetry. A generate that dies at the ceiling asks exactly one
 * question — was the model still working, or was the process dead? — and these
 * fields are what answer it from a log written days earlier.
 */


