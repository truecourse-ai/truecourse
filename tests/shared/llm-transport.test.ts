import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  agentTransport,
  buildCliStdinPayload,
  cliInputFormatArgs,
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

/** Streams an event every 20ms forever and never emits a result — a call that is
 *  ALIVE the whole time it runs, so only the ceiling can end it. */
function fakeChattyBin(): string {
  return fakeNodeBin(
    'claude-chatty.js',
    `
const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
w({ type: 'system', subtype: 'init' });
setInterval(() => {
  w({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '.' } } });
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


/** Records argv AND stdin to `$TC_ARGV_OUT` / `$TC_STDIN_OUT`, then succeeds. */
function fakeArgvStdinBin(): string {
  return fakeNodeBin(
    'claude-argv-stdin.js',
    `
const fs = require('fs');
fs.writeFileSync(process.env.TC_ARGV_OUT, JSON.stringify(process.argv.slice(2)));
let stdin = '';
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => {
  fs.writeFileSync(process.env.TC_STDIN_OUT, stdin);
  const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  w({ type: 'system', subtype: 'init', session_id: 's' });
  w({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } } });
  w({ type: 'result', subtype: 'success', is_error: false, result: 'ok',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      total_cost_usd: 0, num_turns: 1, modelUsage: {} });
  process.exit(0);
});
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

/**
 * The kill-mode telemetry. A generate that dies at the ceiling asks exactly one
 * question — was the model still working, or was the process dead? — and these
 * fields are what answer it from a log written days earlier.
 */
describe('cliTransport call record — which clock ended the call', () => {
  withScaleEnvRestore();
  withStallEnvRestore();

  it('a successful call records outcome=ok, the limits in force, and the events seen', async () => {
    delete process.env[STALL_ENV];
    delete process.env[SCALE_ENV];
    const transport = cliTransport({ bin: fakeStreamBin() });
    const { rec } = await captureRecord(() =>
      transport({ id: 'ok-1', stage: 'test', system: 's', user: 'u', timeoutMs: 5000 }),
    );
    expect(rec?.outcome).toBe('ok');
    expect(rec?.ok).toBe(true);
    // The limits are recorded even when neither fired — a post-mortem needs to
    // know what the call was judged against, not just what killed it.
    expect(rec?.timeoutMs).toBe(5000);
    expect(rec?.stallTimeoutMs).toBe(300_000);
    expect(rec!.eventCount).toBeGreaterThan(0);
    expect(typeof rec?.msSinceLastEvent).toBe('number');
  });

  it('records the SCALED ceiling, not the raw request value', async () => {
    delete process.env[STALL_ENV];
    process.env[SCALE_ENV] = '2';
    const transport = cliTransport({ bin: fakeStreamBin() });
    const { rec } = await captureRecord(() =>
      transport({ id: 'scaled-rec', stage: 'test', system: 's', user: 'u', timeoutMs: 1000 }),
    );
    expect(rec?.timeoutMs).toBe(2000);
    expect(rec?.stallTimeoutMs).toBe(600_000);
  });

  it('a ceiling kill with NO events records outcome=timeout and eventCount 0 (silent)', async () => {
    delete process.env[STALL_ENV];
    delete process.env[SCALE_ENV];
    const transport = cliTransport({ bin: fakeSleepBin() });
    const { rec, error } = await captureRecord(() =>
      transport({ id: 'silent-1', stage: 'test', system: 's', user: 'u', timeoutMs: 80 }),
    );
    expect(String((error as Error)?.message)).toMatch(/timed out after 80ms/);
    expect(rec?.outcome).toBe('timeout');
    // Never streamed a byte: the pre-first-token silence mode. Only the ceiling
    // covers this — the stall clock never armed.
    expect(rec?.eventCount).toBe(0);
    expect(rec?.msSinceLastEvent).toBeUndefined();
    expect(rec?.ttftMs).toBeUndefined();
    expect(rec?.timeoutMs).toBe(80);
  });

  it('a ceiling kill on a STILL-STREAMING call is distinguishable from a silent one', async () => {
    process.env[STALL_ENV] = '5000'; // far wider than the 20ms event cadence
    delete process.env[SCALE_ENV];
    const transport = cliTransport({ bin: fakeChattyBin() });
    // The ceiling must comfortably clear node's boot, or the process is still
    // starting when it fires and the record is legitimately silent.
    const { rec, error } = await captureRecord(() =>
      transport({ id: 'chatty-1', stage: 'test', system: 's', user: 'u', timeoutMs: 1200 }),
    );
    expect(String((error as Error)?.message)).toMatch(/timed out after 1200ms/);
    expect(rec?.outcome).toBe('timeout');
    // The discriminator: events were still arriving when the ceiling fired, so
    // this call was ALIVE — widening the ceiling would have let it finish.
    expect(rec!.eventCount).toBeGreaterThan(1);
    expect(rec!.msSinceLastEvent!).toBeLessThan(500);
  });

  it('a stall kill records outcome=stall with the silence that triggered it', async () => {
    process.env[STALL_ENV] = '80';
    delete process.env[SCALE_ENV];
    const transport = cliTransport({ bin: fakeStallBin() });
    const { rec } = await captureRecord(() =>
      transport({ id: 'stall-2', stage: 'test', system: 's', user: 'u', timeoutMs: 5000 }),
    );
    expect(rec?.outcome).toBe('stall');
    expect(rec?.stallTimeoutMs).toBe(80);
    expect(rec!.eventCount).toBeGreaterThan(0);
    expect(rec!.msSinceLastEvent!).toBeGreaterThanOrEqual(80);
  });

  it('a non-timeout failure records outcome=error', async () => {
    delete process.env[STALL_ENV];
    delete process.env[SCALE_ENV];
    const transport = cliTransport({ bin: fakeBufferedBin() });
    const { rec } = await captureRecord(() =>
      transport({ id: 'err-2', stage: 'test', system: 's', user: 'u', timeoutMs: 5000 }),
    );
    expect(rec?.outcome).toBe('error');
    expect(rec?.ok).toBe(false);
  });
});

describe('cliTransport — prompt travels over stdin, never argv', () => {
  it('a user prompt that BEGINS WITH DASHES cannot be parsed as a CLI flag', async () => {
    // The live failure this pins: the relevance identity block opens with
    // `--- IDENTITY: … ---`; as a positional argv `claude` read it as an
    // unknown option and exited 1 — silently fail-opening every relevance
    // verdict on the branch. Stdin has no option grammar.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-argvout-'));
    const argvOut = path.join(dir, 'argv.json');
    const stdinOut = path.join(dir, 'stdin.txt');
    process.env.TC_ARGV_OUT = argvOut;
    process.env.TC_STDIN_OUT = stdinOut;
    try {
      const transport = cliTransport({ bin: fakeArgvStdinBin() });
      const user = '--- IDENTITY: the repository being scanned ---\nproduct: x\n--- end ---\njudge this doc';
      const out = await transport({
        id: 't', stage: 'spec.relevance', system: 'sys', user,
        responseFormat: 'json', timeoutMs: 10_000,
      });
      expect(out).toBe('ok');
      const argv: string[] = JSON.parse(fs.readFileSync(argvOut, 'utf8'));
      expect(argv.join(' ')).not.toContain('IDENTITY');
      expect(argv.filter((a) => a.startsWith('---'))).toEqual([]);
      expect(fs.readFileSync(stdinOut, 'utf8')).toBe(user);
    } finally {
      delete process.env.TC_ARGV_OUT;
      delete process.env.TC_STDIN_OUT;
    }
  });
});

describe('cliTransport — image attachments', () => {
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUg==';

  it('a text-only request writes the raw prompt and asks for no input format', () => {
    const payload = buildCliStdinPayload({ system: 's', user: 'just words' });
    expect(payload).toBe('just words');
    expect(cliInputFormatArgs({ system: 's', user: 'just words' })).toEqual([]);
    expect(cliInputFormatArgs({ system: 's', user: 'u', images: [] })).toEqual([]);
  });

  it('an image request writes ONE newline-terminated user envelope, text block first', () => {
    const req = {
      system: 's',
      user: 'is the banner visible?',
      images: [{ mediaType: 'image/png' as const, data: PNG_B64 }],
    };
    expect(cliInputFormatArgs(req)).toEqual(['--input-format', 'stream-json']);
    const payload = buildCliStdinPayload(req);
    expect(payload.endsWith('\n')).toBe(true);
    expect(payload.trimEnd().includes('\n')).toBe(false); // exactly one NDJSON line
    expect(JSON.parse(payload)).toEqual({
      type: 'user',
      session_id: '',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'is the banner visible?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_B64 } },
        ],
      },
    });
  });

  it('every image becomes its own block, after the single text block', () => {
    const payload = buildCliStdinPayload({
      system: 's',
      user: 'u',
      images: [
        { mediaType: 'image/png', data: 'AAA' },
        { mediaType: 'image/jpeg', data: 'BBB' },
      ],
    });
    const content = JSON.parse(payload).message.content;
    expect(content.map((c: { type: string }) => c.type)).toEqual(['text', 'image', 'image']);
    expect(content[2].source.media_type).toBe('image/jpeg');
  });

  it('the spawned call carries --input-format and the envelope on stdin', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-argvout-'));
    const argvOut = path.join(dir, 'argv.json');
    const stdinOut = path.join(dir, 'stdin.txt');
    process.env.TC_ARGV_OUT = argvOut;
    process.env.TC_STDIN_OUT = stdinOut;
    try {
      const transport = cliTransport({ bin: fakeArgvStdinBin() });
      const out = await transport({
        id: 't', stage: 'guard.visualJudge', system: 'sys', user: 'look',
        images: [{ mediaType: 'image/png', data: PNG_B64 }],
        responseFormat: 'json', timeoutMs: 10_000,
      });
      expect(out).toBe('ok');
      const argv: string[] = JSON.parse(fs.readFileSync(argvOut, 'utf8'));
      expect(argv.join(' ')).toContain('--input-format stream-json');
      // Every other flag the text path passes is untouched.
      expect(argv).toContain('--include-partial-messages');
      expect(argv).toContain('--tools');
      const stdin = JSON.parse(fs.readFileSync(stdinOut, 'utf8'));
      expect(stdin.message.content[1].source.data).toBe(PNG_B64);
    } finally {
      delete process.env.TC_ARGV_OUT;
      delete process.env.TC_STDIN_OUT;
    }
  });

  it('the agent mailbox passes images through to the answerer', async () => {
    const io = tmpIo();
    const transport = agentTransport(io, { pollMs: 10 });
    const pending = transport({
      id: 'img-1', stage: 'guard.visualJudge', system: 's', user: 'u',
      images: [{ mediaType: 'image/png', data: PNG_B64 }],
      timeoutMs: 5_000,
    });
    const reqPath = path.join(io, 'requests', 'img-1.json');
    for (let i = 0; i < 100 && !fs.existsSync(reqPath); i++) await sleep(10);
    const written = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
    expect(written.images).toEqual([{ mediaType: 'image/png', data: PNG_B64 }]);
    fs.writeFileSync(path.join(io, 'responses', 'img-1.json'), JSON.stringify({ text: 'ok' }));
    expect(await pending).toBe('ok');
  });
});
