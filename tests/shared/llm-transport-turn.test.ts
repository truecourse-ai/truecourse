import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cliTransport,
  getStageUsage,
  resetStageUsage,
} from '../../packages/shared/src/llm/transport.js';

/**
 * A stand-in `claude` for the TURN protocol: records each invocation's argv +
 * stdin into a JSON log, then emits a stream-json sequence whose result echoes
 * the session id it was given (`--session-id` or `--resume`), like the real
 * binary does.
 */
function fakeTurnBin(logPath: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-turnbin-'));
  const p = path.join(dir, 'claude-turn.js');
  fs.writeFileSync(
    p,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
let stdin = '';
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', () => {
  const log = ${JSON.stringify(logPath)};
  const calls = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : [];
  calls.push({ args, stdin });
  fs.writeFileSync(log, JSON.stringify(calls));
  const argValue = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const sid = argValue('--resume') ?? argValue('--session-id') ?? 'fresh-uuid';
  const w = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  w({ type: 'system', subtype: 'init', session_id: sid });
  w({
    type: 'result', subtype: 'success', is_error: false,
    result: 'turn-reply-' + calls.length, session_id: sid,
    usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 },
    total_cost_usd: 0.01,
  });
  process.exit(0);
});
`,
  );
  fs.chmodSync(p, 0o755);
  return p;
}

function readLog(logPath: string): Array<{ args: string[]; stdin: string }> {
  return JSON.parse(fs.readFileSync(logPath, 'utf8'));
}

describe('cliTransport turn seam (claude -p sessions)', () => {
  let logPath: string;
  let bin: string;

  beforeEach(() => {
    logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-turnlog-')), 'calls.json');
    bin = fakeTurnBin(logPath);
    resetStageUsage();
  });

  it('exposes a turn fn without native tools', () => {
    const transport = cliTransport({ bin });
    expect(typeof transport.turn).toBe('function');
    expect(transport.turn!.nativeTools).toBeUndefined();
  });

  it('first turn mints a session id; later turns resume it and send only the tail', async () => {
    const transport = cliTransport({ bin });
    const turn = transport.turn!;

    const first = await turn({
      stage: 'guard.worker',
      model: 'opus',
      system: 'SYSTEM PROMPT',
      messages: [{ role: 'user', text: 'open the session' }],
      tools: [],
      timeoutMs: 30_000,
    });
    expect(first.text).toBe('turn-reply-1');
    expect(first.sessionId).toBeTruthy();

    const second = await turn({
      stage: 'guard.worker',
      model: 'opus',
      system: 'SYSTEM PROMPT',
      messages: [
        { role: 'user', text: 'open the session' },
        { role: 'assistant', text: 'acting' },
        { role: 'user', text: 'run_scenario result:\nexit 0' },
      ],
      tools: [],
      sessionId: first.sessionId,
      timeoutMs: 30_000,
    });
    expect(second.text).toBe('turn-reply-2');
    expect(second.sessionId).toBe(first.sessionId);

    const calls = readLog(logPath);
    expect(calls).toHaveLength(2);

    // Turn 1: fresh session, prompt over stdin, system prompt in force.
    const a1 = calls[0]!;
    expect(a1.args).toContain('--session-id');
    expect(a1.args).not.toContain('--resume');
    expect(a1.args[a1.args.indexOf('--session-id') + 1]).toBe(first.sessionId);
    expect(a1.stdin).toBe('open the session');
    expect(a1.args[a1.args.indexOf('--system-prompt') + 1]).toBe('SYSTEM PROMPT');
    // The one-shot argv contract still holds for turns.
    expect(a1.args).toContain('-p');
    expect(a1.args[a1.args.indexOf('--tools') + 1]).toBe('');

    // Turn 2: resume, and ONLY the trailing message travels.
    const a2 = calls[1]!;
    expect(a2.args).toContain('--resume');
    expect(a2.args).not.toContain('--session-id');
    expect(a2.args[a2.args.indexOf('--resume') + 1]).toBe(first.sessionId);
    expect(a2.stdin).toBe('run_scenario result:\nexit 0');
    // The system prompt is re-passed on every turn.
    expect(a2.args[a2.args.indexOf('--system-prompt') + 1]).toBe('SYSTEM PROMPT');
  });

  it('records per-turn usage under the stage', async () => {
    const transport = cliTransport({ bin });
    await transport.turn!({
      stage: 'guard.worker',
      system: 'S',
      messages: [{ role: 'user', text: 'go' }],
      tools: [],
    });
    const usage = getStageUsage().get('guard.worker');
    expect(usage).toBeDefined();
    expect(usage!.calls).toBe(1);
    expect(usage!.inputTokens).toBe(7);
    expect(usage!.outputTokens).toBe(3);
    expect(usage!.cacheReadTokens).toBe(2);
    expect(usage!.cacheCreateTokens).toBe(1);
    expect(usage!.costUsd).toBeCloseTo(0.01);
  });

  it('returns per-turn usage on the reply', async () => {
    const transport = cliTransport({ bin });
    const reply = await transport.turn!({
      stage: 'guard.worker',
      system: 'S',
      messages: [{ role: 'user', text: 'go' }],
      tools: [],
    });
    expect(reply.usage).toEqual({
      inputTokens: 7,
      outputTokens: 3,
      cacheReadTokens: 2,
      cacheCreateTokens: 1,
      costUsd: 0.01,
    });
  });

  it('rejects a history that does not end on a user-side message', async () => {
    const transport = cliTransport({ bin });
    await expect(
      transport.turn!({
        system: 'S',
        messages: [
          { role: 'user', text: 'go' },
          { role: 'assistant', text: 'done?' },
        ],
        tools: [],
      }),
    ).rejects.toThrow(/trailing user or tool message/);
  });

  it('one-shot calls through the same transport still work (refactor guard)', async () => {
    const transport = cliTransport({ bin });
    const text = await transport({ stage: 's', system: 'SYS', user: 'hello' });
    expect(text).toBe('turn-reply-1');
    const calls = readLog(logPath);
    // One-shot calls carry no session flags at all.
    expect(calls[0]!.args).not.toContain('--session-id');
    expect(calls[0]!.args).not.toContain('--resume');
    expect(calls[0]!.stdin).toBe('hello');
  });
});

describe('agentTransport turn seam (filesystem mailbox)', () => {
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  it('writes a turn request with the full history and returns the answered text', async () => {
    const { agentTransport } = await import('../../packages/shared/src/llm/transport.js')
    const io = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-turn-io-'))
    const transport = agentTransport(io, { pollMs: 20 })

    const pending = transport.turn!({
      id: 'guard.generate:flow-1:t2',
      stage: 'guard.generate',
      system: 'S',
      messages: [
        { role: 'user', text: 'open' },
        { role: 'assistant', text: 'acting' },
        { role: 'user', text: 'run_scenario result:\nexit 0' },
      ],
      tools: [{ name: 'run_scenario', description: 'd', schema: '{}' }],
      sessionId: 'sess-io',
      timeoutMs: 5_000,
    })

    // The answering agent reads the request and writes raw assistant text.
    const reqPath = path.join(io, 'requests', 'guard.generate_flow-1_t2.json')
    for (let i = 0; i < 100 && !fs.existsSync(reqPath); i++) await sleep(10)
    const written = JSON.parse(fs.readFileSync(reqPath, 'utf-8'))
    expect(written.kind).toBe('turn')
    expect(written.messages).toHaveLength(3)
    expect(written.tools[0].name).toBe('run_scenario')
    expect(written.sessionId).toBe('sess-io')
    fs.writeFileSync(
      path.join(io, 'responses', 'guard.generate_flow-1_t2.json'),
      JSON.stringify({ text: '```json\n{"outcome":{"ok":true}}\n```' }),
    )

    const reply = await pending
    expect(reply.text).toContain('"outcome"')
    expect(reply.sessionId).toBe('sess-io')
  })
})
