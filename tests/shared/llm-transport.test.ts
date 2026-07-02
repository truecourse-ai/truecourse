import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  agentTransport,
  cliTransport,
  resolveTimeoutScale,
  stripCodeFences,
  extractJsonValue,
} from '../../packages/shared/src/llm/transport.js';

function tmpIo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tc-llmio-'));
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A stand-in `claude` binary that ignores its args and blocks well past any
 *  test timeout, so the transport's own timer is what settles the call. */
function fakeSleepBin(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fakebin-'));
  const p = path.join(dir, 'claude-sleep.sh');
  fs.writeFileSync(p, '#!/bin/sh\nsleep 30\n');
  fs.chmodSync(p, 0o755);
  return p;
}

const SCALE_ENV = 'TRUECOURSE_LLM_TIMEOUT_SCALE';
function withScaleEnvRestore(): void {
  const orig = process.env[SCALE_ENV];
  afterEach(() => {
    if (orig === undefined) delete process.env[SCALE_ENV];
    else process.env[SCALE_ENV] = orig;
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

describe('cliTransport timeout scaling', () => {
  withScaleEnvRestore();

  it('reports the raw timeout when the scale is unset', async () => {
    delete process.env[SCALE_ENV];
    const transport = cliTransport({ bin: fakeSleepBin() });
    await expect(
      transport({ system: 's', user: 'u', timeoutMs: 60 }),
    ).rejects.toThrow(/timed out after 60ms/);
  });

  it('scales the SIGKILL deadline and reports the effective timeout', async () => {
    process.env[SCALE_ENV] = '2';
    const transport = cliTransport({ bin: fakeSleepBin() });
    // 120ms × 2 = 240ms effective; the message must reflect the scaled value.
    await expect(
      transport({ system: 's', user: 'u', timeoutMs: 120 }),
    ).rejects.toThrow(/timed out after 240ms/);
  });
});

describe('agentTransport timeout scaling', () => {
  withScaleEnvRestore();

  it('applies the scale to the deadline (a fractional scale shortens it)', async () => {
    process.env[SCALE_ENV] = '0.02';
    const io = tmpIo();
    const t0 = Date.now();
    await expect(
      // 1000ms × 0.02 = 20ms effective — must reject far sooner than the raw 1000ms.
      agentTransport(io, { pollMs: 5 })({ id: 'scaled-1', system: 's', user: 'u', timeoutMs: 1000 }),
    ).rejects.toThrow(/timed out/);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
