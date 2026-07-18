import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  agentTransport,
  cliTransport,
  resolveTimeoutScale,
  resolveStallTimeoutMs,
  setLlmCallSink,
  stripCodeFences,
  extractJsonValue,
  type LlmCallRecord,
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

/** Write an executable node `claude` stand-in with the given script body. */
function fakeNodeBin(name: string, body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fakebin-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/usr/bin/env node\n${body}\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

/** Emits a real stream-json sequence (system:init → text delta → result),
 *  spaced so ttft is measurably > 0. */
function fakeStreamBin(): string {
  return fakeNodeBin(
    'claude-stream.js',
    `
const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
w({ type: 'system', subtype: 'init', session_id: 's' });
setTimeout(() => {
  w({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } } });
  setTimeout(() => {
    w({ type: 'result', subtype: 'success', is_error: false, result: 'Hello world',
        usage: { input_tokens: 5, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 10 },
        total_cost_usd: 0.002, num_turns: 1,
        modelUsage: { 'claude-test-1': { inputTokens: 5 } } });
    process.exit(0);
  }, 40);
}, 40);
`,
  );
}

/** Streams a first event + delta then hangs forever — exercises the stall path. */
function fakeStallBin(): string {
  return fakeNodeBin(
    'claude-stall.js',
    `
const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
w({ type: 'system', subtype: 'init' });
setTimeout(() => {
  w({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } } });
  setInterval(() => {}, 1000); // never emit result — hang until SIGKILL
}, 20);
`,
  );
}

/** Records the argv it was spawned with to `$TC_ARGV_OUT`, then emits a valid
 *  stream-json sequence so the call succeeds. Lets a test inspect the exact flags
 *  the transport passes to `claude`. */
function fakeArgvBin(): string {
  return fakeNodeBin(
    'claude-argv.js',
    `
const fs = require('fs');
fs.writeFileSync(process.env.TC_ARGV_OUT, JSON.stringify(process.argv.slice(2)));
const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
w({ type: 'system', subtype: 'init', session_id: 's' });
w({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } } });
w({ type: 'result', subtype: 'success', is_error: false, result: 'ok',
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    total_cost_usd: 0, num_turns: 1, modelUsage: {} });
process.exit(0);
`,
  );
}

/** Emits ONLY the old buffered `--output-format json` shape (a single result
 *  object, no stream lifecycle). The new parser must reject this honestly. */
function fakeBufferedBin(): string {
  return fakeNodeBin(
    'claude-buffered.js',
    `
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Hi',
  usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  total_cost_usd: 0.001, num_turns: 1, modelUsage: {} }) + '\\n');
process.exit(0);
`,
  );
}

function fakeSessionLimitStreamBin(exitCode: number, includeInit: boolean): string {
  return fakeNodeBin(
    `claude-session-limit-${exitCode}-${includeInit ? 'stream' : 'result'}.js`,
    `
const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
${includeInit ? "w({ type: 'system', subtype: 'init', session_id: 's' });" : ''}
w({
  type: 'result',
  subtype: 'error',
  is_error: true,
  api_error_status: 429,
  result: "You've hit your session limit · resets 7pm (Africa/Cairo)"
});
process.exit(${exitCode});
`,
  );
}

function fakeGenericApiErrorBin(exitCode: number, includeInit: boolean): string {
  return fakeNodeBin(
    `claude-generic-error-${exitCode}-${includeInit ? 'stream' : 'result'}.js`,
    `
const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
${includeInit ? "w({ type: 'system', subtype: 'init', session_id: 's' });" : ''}
w({
  type: 'result',
  subtype: 'error',
  is_error: true,
  api_error_status: 429,
  result: 'Rate limited. Please retry shortly.'
});
process.stderr.write('transport-stderr');
process.exit(${exitCode});
`,
  );
}

/** Capture the single call record the transport emits, restoring the sink. */
async function captureRecord(run: () => Promise<unknown>): Promise<{ rec?: LlmCallRecord; error?: unknown }> {
  let rec: LlmCallRecord | undefined;
  setLlmCallSink((r) => { rec = r; });
  try {
    try {
      await run();
      return { rec };
    } catch (error) {
      return { rec, error };
    }
  } finally {
    setLlmCallSink(undefined);
  }
}

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

  it('preserves a native Claude session-limit envelope reported through the mailbox', async () => {
    const io = tmpIo();
    fs.mkdirSync(path.join(io, 'responses'), { recursive: true });
    fs.writeFileSync(
      path.join(io, 'responses', 'limit-1.json'),
      JSON.stringify({
        error: {
          is_error: true,
          api_error_status: 429,
          result: "You've hit your session limit · resets 7pm (Africa/Cairo)",
        },
      }),
    );

    await expect(
      agentTransport(io, { pollMs: 5 })({ id: 'limit-1', system: 's', user: 'u' }),
    ).rejects.toMatchObject({
      code: 'LLM_SESSION_LIMIT',
      resetHint: '7pm (Africa/Cairo)',
    });
  });

  it('keeps accepting a successful mailbox response with a nullable error field', async () => {
    const io = tmpIo();
    fs.mkdirSync(path.join(io, 'responses'), { recursive: true });
    fs.writeFileSync(
      path.join(io, 'responses', 'nullable-error.json'),
      JSON.stringify({ text: 'ok', error: null }),
    );

    await expect(
      agentTransport(io, { pollMs: 5 })({ id: 'nullable-error', system: 's', user: 'u' }),
    ).resolves.toBe('ok');
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

describe('cliTransport streaming (stream-json)', () => {
  withScaleEnvRestore();
  withStallEnvRestore();

  it('parses NDJSON events, assembles the result text, and records observed ttft', async () => {
    delete process.env[STALL_ENV];
    const transport = cliTransport({ bin: fakeStreamBin() });
    const { rec, error } = await captureRecord(async () => {
      const text = await transport({ id: 'stream-1', stage: 'test', system: 's', user: 'u', timeoutMs: 5000 });
      expect(text).toBe('Hello world');
    });
    expect(error).toBeUndefined();
    expect(rec?.ok).toBe(true);
    // ttft = spawn → first text/thinking delta; timeToRequest = spawn → first event.
    expect(typeof rec?.ttftMs).toBe('number');
    expect(rec!.ttftMs!).toBeGreaterThan(0);
    expect(typeof rec?.timeToRequestMs).toBe('number');
    expect(rec!.timeToRequestMs!).toBeGreaterThanOrEqual(0);
    // The first event precedes the first delta.
    expect(rec!.timeToRequestMs!).toBeLessThanOrEqual(rec!.ttftMs!);
    // Usage comes from the terminal result event — byte-identical to buffered.
    expect(rec?.inputTokens).toBe(5);
    expect(rec?.outputTokens).toBe(3);
    expect(rec?.cacheCreateTokens).toBe(10);
    expect(rec?.costUsd).toBeCloseTo(0.002);
    expect(rec?.model).toBe('claude-test-1');
  });

  it('preserves a streamed Claude session-limit envelope when the CLI exits nonzero', async () => {
    const transport = cliTransport({ bin: fakeSessionLimitStreamBin(1, true) });

    await expect(
      transport({ id: 'limit-exit-1', stage: 'test', system: 's', user: 'u', timeoutMs: 5000 }),
    ).rejects.toMatchObject({
      code: 'LLM_SESSION_LIMIT',
      resetHint: '7pm (Africa/Cairo)',
    });
  });

  it('classifies a lone exit-zero Claude error result before enforcing successful streaming', async () => {
    const transport = cliTransport({ bin: fakeSessionLimitStreamBin(0, false) });

    await expect(
      transport({ id: 'limit-exit-0', stage: 'test', system: 's', user: 'u', timeoutMs: 5000 }),
    ).rejects.toMatchObject({
      code: 'LLM_SESSION_LIMIT',
      resetHint: '7pm (Africa/Cairo)',
    });
  });

  it('keeps nonzero generic API failures on the existing stderr-rich exit path', async () => {
    const transport = cliTransport({ bin: fakeGenericApiErrorBin(1, true) });

    await expect(
      transport({ id: 'generic-exit-1', stage: 'test', system: 's', user: 'u', timeoutMs: 5000 }),
    ).rejects.toThrow(/claude exited 1: transport-stderr/);
  });

  it('still rejects a lone exit-zero generic API error as non-streaming output', async () => {
    const transport = cliTransport({ bin: fakeGenericApiErrorBin(0, false) });

    await expect(
      transport({ id: 'generic-exit-0', stage: 'test', system: 's', user: 'u', timeoutMs: 5000 }),
    ).rejects.toThrow(/did not stream.*stream-json/);
  });

  it('kills a started-then-silent stream as a stall, distinct from the ceiling', async () => {
    process.env[STALL_ENV] = '80';
    delete process.env[SCALE_ENV];
    const transport = cliTransport({ bin: fakeStallBin() });
    const { rec, error } = await captureRecord(() =>
      // ceiling is huge (5s), so only the 80ms stall can settle this call.
      transport({ id: 'stall-1', stage: 'test', system: 's', user: 'u', timeoutMs: 5000 }),
    );
    expect(String((error as Error)?.message)).toMatch(/stalled: no stream event/);
    expect(String((error as Error)?.message)).not.toMatch(/timed out after/);
    expect(rec?.ok).toBe(false);
    expect(rec?.error).toMatch(/stalled/);
    // Whatever ttft/stall info was observed before the kill is carried on the record.
    expect(typeof rec?.timeToRequestMs).toBe('number');
    expect(typeof rec?.ttftMs).toBe('number');
  });

  it('rejects the old buffered single-object format with a stream-json expectation error', async () => {
    delete process.env[STALL_ENV];
    const transport = cliTransport({ bin: fakeBufferedBin() });
    const { rec, error } = await captureRecord(() =>
      transport({ id: 'buffered-1', stage: 'test', system: 's', user: 'u', timeoutMs: 5000 }),
    );
    expect(String((error as Error)?.message)).toMatch(/did not stream/);
    expect(String((error as Error)?.message)).toMatch(/stream-json/);
    expect(rec?.ok).toBe(false);
  });

  it('passes the system prompt via --system-prompt (full replace, not --append-system-prompt)', async () => {
    delete process.env[STALL_ENV];
    const argvOut = path.join(tmpIo(), 'argv.json');
    process.env.TC_ARGV_OUT = argvOut;
    try {
      const transport = cliTransport({ bin: fakeArgvBin() });
      const text = await transport({ id: 'argv-1', stage: 'test', system: 'MY-SYSTEM', user: 'u', timeoutMs: 5000 });
      expect(text).toBe('ok');
      const argv: string[] = JSON.parse(fs.readFileSync(argvOut, 'utf-8'));
      // The harness prompt is REPLACED, never appended to.
      expect(argv).toContain('--system-prompt');
      expect(argv).not.toContain('--append-system-prompt');
      // The system text is the argument that follows the flag.
      expect(argv[argv.indexOf('--system-prompt') + 1]).toBe('MY-SYSTEM');
    } finally {
      delete process.env.TC_ARGV_OUT;
    }
  });
});
