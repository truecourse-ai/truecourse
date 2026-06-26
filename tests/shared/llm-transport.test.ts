import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  agentTransport,
  cliTransport,
  stripCodeFences,
  type LlmTransport,
} from '../../packages/shared/src/llm/transport.js';
import { spawnRunner } from '../../packages/spec-consolidator/src/runner.js';
import type { Block } from '../../packages/spec-consolidator/src/slicer.js';

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

// The fake `claude` is a /bin/sh script, so this runs on Unix CI (ubuntu) and
// is skipped on Windows. The regression it guards (#660) is itself Windows-only,
// but the structural assertions — neither prompt on the command line — hold
// everywhere and are what actually prevent the `spawn ENAMETOOLONG` reappearing.
describe.skipIf(process.platform === 'win32')('cliTransport (#660: prompts off the command line)', () => {
  // A fake claude that records its argv + stdin + the system-prompt-file's
  // content into `rec/`, then emits a valid JSON envelope so cliTransport
  // resolves. argv carries only flags now, so it is safe to tokenize by line.
  function fakeClaude(): { bin: string; rec: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fakeclaude-'));
    const rec = path.join(dir, 'rec');
    fs.mkdirSync(rec);
    const bin = path.join(dir, 'claude');
    fs.writeFileSync(
      bin,
      [
        '#!/bin/sh',
        `printf '%s\\n' "$@" > "${rec}/argv.txt"`,
        `cat > "${rec}/stdin.txt"`,
        'prev=""',
        'for a in "$@"; do',
        `  [ "$prev" = "--append-system-prompt-file" ] && cp "$a" "${rec}/sysfile.txt"`,
        '  prev="$a"',
        'done',
        `printf '{"result":"ok"}'`,
        '',
      ].join('\n'),
    );
    fs.chmodSync(bin, 0o755);
    return { bin, rec };
  }

  it('streams the user prompt over stdin and the system prompt via a temp file', async () => {
    const { bin, rec } = fakeClaude();
    // Both prompts are deliberately larger than Windows' 32,767-char cmdline cap.
    const system = 'S'.repeat(50_000);
    const user = 'U'.repeat(50_000);

    const out = await cliTransport({ bin })({ system, user, model: 'haiku', stage: 'contract.extract' });
    expect(out).toBe('ok');

    const argvLines = fs.readFileSync(path.join(rec, 'argv.txt'), 'utf-8').split('\n');
    // The system prompt goes through a file, not the old inline `--append-system-prompt`.
    expect(argvLines).toContain('--append-system-prompt-file');
    expect(argvLines).not.toContain('--append-system-prompt');
    // Neither prompt is present as an argv token.
    expect(argvLines).not.toContain(system);
    expect(argvLines).not.toContain(user);
    // Small flags still ride on argv.
    expect(argvLines).toContain('--model');
    expect(argvLines).toContain('haiku');

    // The user prompt arrives via stdin; the system prompt via the temp file.
    expect(fs.readFileSync(path.join(rec, 'stdin.txt'), 'utf-8')).toBe(user);
    expect(fs.readFileSync(path.join(rec, 'sysfile.txt'), 'utf-8')).toBe(system);

    // The temp system-prompt file is cleaned up once the call resolves.
    const sysFilePath = argvLines[argvLines.indexOf('--append-system-prompt-file') + 1];
    expect(fs.existsSync(sysFilePath)).toBe(false);
  });
});

describe('runner ↔ transport seam', () => {
  it('block runner parses the transport response into an extraction', async () => {
    const transport: LlmTransport = async (req) => {
      // the runner should pass the block's prompt through
      expect(req.stage).toBe('spec.claimExtract');
      expect(req.user).toContain('hello world');
      return '```json\n{"topics":[],"claims":[]}\n```';
    };
    const block: Block = {
      id: 'b1',
      filePath: 'a.md',
      headingPath: ['Intro'],
      startLine: 1,
      text: 'hello world',
    } as Block;
    const runner = spawnRunner({ transport });
    const [result] = await runner([block]);
    expect(result.error).toBeUndefined();
    expect(result.extraction).toEqual({ topics: [], claims: [] });
  });
});
