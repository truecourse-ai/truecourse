/**
 * Reading a model's answer: the fence a model wraps JSON in even when told not
 * to, and the prose it sometimes puts either side of it.
 */
import { describe, it, expect } from 'vitest';
import {
  stripCodeFences,
  extractJsonValue,
} from '../../packages/shared/src/llm/index.js';

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
