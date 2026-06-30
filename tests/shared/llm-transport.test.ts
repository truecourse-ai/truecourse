import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  agentTransport,
  stripCodeFences,
  extractJsonValue,
} from '../../packages/shared/src/llm/transport.js';

function tmpIo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tc-llmio-'));
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

describe('agentTransport (filesystem mailbox)', () => {
  it('writes a request file and returns the answered text', async () => {
    const io = tmpIo();
    const transport = agentTransport(io, { pollMs: 5 });
    const pending = transport({
      id: 'test-1',
      stage: 'test',
      model: 'haiku',
      system: 'SYS',
      user: 'USER',
      responseFormat: 'json',
    });

    // act as the answering agent: wait for the request, then write the response
    const reqPath = path.join(io, 'requests', 'test-1.json');
    for (let i = 0; i < 200 && !fs.existsSync(reqPath); i++) await sleep(5);
    const req = JSON.parse(fs.readFileSync(reqPath, 'utf-8'));
    expect(req).toMatchObject({ id: 'test-1', stage: 'test', system: 'SYS', user: 'USER', responseFormat: 'json' });
    fs.writeFileSync(path.join(io, 'responses', 'test-1.json'), JSON.stringify({ text: '{"ok":true}' }));

    expect(await pending).toBe('{"ok":true}');
  });

  it('throws when the agent reports an error', async () => {
    const io = tmpIo();
    // pre-seed the answer (resume path), so the call resolves immediately
    fs.mkdirSync(path.join(io, 'responses'), { recursive: true });
    fs.writeFileSync(path.join(io, 'responses', 'err-1.json'), JSON.stringify({ error: 'boom' }));
    await expect(agentTransport(io, { pollMs: 5 })({ id: 'err-1', system: 's', user: 'u' })).rejects.toThrow(/boom/);
  });

  it('reuses an existing response without re-writing the request (resume)', async () => {
    const io = tmpIo();
    fs.mkdirSync(path.join(io, 'responses'), { recursive: true });
    fs.writeFileSync(path.join(io, 'responses', 'r-1.json'), JSON.stringify({ text: 'cached' }));
    const text = await agentTransport(io, { pollMs: 5 })({ id: 'r-1', system: 's', user: 'u' });
    expect(text).toBe('cached');
    // request file should NOT have been written, since the answer already existed
    expect(fs.existsSync(path.join(io, 'requests', 'r-1.json'))).toBe(false);
  });

  it('times out when no answer appears', async () => {
    const io = tmpIo();
    await expect(
      agentTransport(io, { pollMs: 5 })({ id: 'slow-1', system: 's', user: 'u', timeoutMs: 40 }),
    ).rejects.toThrow(/timed out/);
  });
});
