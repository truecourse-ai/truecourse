import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalBinary = process.env.CLAUDE_CODE_BINARY;
const originalCallsFile = process.env.TC_CLAUDE_CALLS_FILE;

afterEach(() => {
  if (originalBinary === undefined) delete process.env.CLAUDE_CODE_BINARY;
  else process.env.CLAUDE_CODE_BINARY = originalBinary;
  if (originalCallsFile === undefined) delete process.env.TC_CLAUDE_CALLS_FILE;
  else process.env.TC_CLAUDE_CALLS_FILE = originalCallsFile;
  vi.resetModules();
});

function fakeSessionLimitClaude(
  resetHint: string,
  exitCode = 1,
): { binary: string; callsFile: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-session-limit-'));
  const binary = path.join(dir, 'claude-session-limit.js');
  const callsFile = path.join(dir, 'calls.txt');
  fs.writeFileSync(
    binary,
    `#!/usr/bin/env node
const fs = require('node:fs');
const callsFile = process.env.TC_CLAUDE_CALLS_FILE;
const calls = fs.existsSync(callsFile) ? Number(fs.readFileSync(callsFile, 'utf8')) : 0;
fs.writeFileSync(callsFile, String(calls + 1));
process.stdout.write(JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: true,
  api_error_status: 429,
  result: "You've hit your session limit · resets ${resetHint}",
  total_cost_usd: 0,
  usage: { input_tokens: 0, output_tokens: 0 }
}));
process.exit(${exitCode});
`,
  );
  fs.chmodSync(binary, 0o755);
  return { binary, callsFile };
}

function fakeTransient429Claude(): { binary: string; callsFile: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-transient-429-'));
  const binary = path.join(dir, 'claude-transient-429.js');
  const callsFile = path.join(dir, 'calls.txt');
  fs.writeFileSync(
    binary,
    `#!/usr/bin/env node
const fs = require('node:fs');
const callsFile = process.env.TC_CLAUDE_CALLS_FILE;
const calls = fs.existsSync(callsFile) ? Number(fs.readFileSync(callsFile, 'utf8')) : 0;
fs.writeFileSync(callsFile, String(calls + 1));
if (calls === 0) {
  process.stdout.write(JSON.stringify({
    type: 'result', subtype: 'error', is_error: true, api_error_status: 429,
    result: 'Rate limited. Please retry shortly.'
  }));
  process.exit(1);
}
process.stdout.write(JSON.stringify({
  type: 'result', subtype: 'success', is_error: false,
  structured_output: { violations: [], serviceDescriptions: [] }
}));
process.exit(0);
`,
  );
  fs.chmodSync(binary, 0o755);
  return { binary, callsFile };
}

const serviceContext = {
  architecture: 'monolith',
  services: [
    {
      id: 'service-1',
      name: 'orders',
      type: 'backend',
      framework: 'express',
      fileCount: 1,
      layers: [],
    },
  ],
  dependencies: [],
  llmRules: [],
};

describe('ClaudeCodeProvider session-limit handling', () => {
  it.each(['6:40pm (Africa/Cairo)', '7pm (Africa/Cairo)'])(
    'surfaces the observed reset hint %s and does not retry a definite session limit',
    async (resetHint) => {
      const fake = fakeSessionLimitClaude(resetHint);
      process.env.CLAUDE_CODE_BINARY = fake.binary;
      process.env.TC_CLAUDE_CALLS_FILE = fake.callsFile;
      vi.resetModules();
      const { ClaudeCodeProvider } = await import(
        '../../packages/core/src/services/llm/cli-provider.js'
      );

      const provider = new ClaudeCodeProvider();
      const failure = provider.generateServiceViolations(serviceContext).catch((error: unknown) => error);

      await expect(failure).resolves.toMatchObject({
        name: 'LlmSessionLimitError',
        code: 'LLM_SESSION_LIMIT',
        statusCode: 429,
        resetHint,
      });
      expect(fs.readFileSync(fake.callsFile, 'utf8')).toBe('1');
    },
  );

  it('classifies the same error envelope when Claude exits successfully', async () => {
    const resetHint = '6:40pm (Africa/Cairo)';
    const fake = fakeSessionLimitClaude(resetHint, 0);
    process.env.CLAUDE_CODE_BINARY = fake.binary;
    process.env.TC_CLAUDE_CALLS_FILE = fake.callsFile;
    vi.resetModules();
    const { ClaudeCodeProvider } = await import(
      '../../packages/core/src/services/llm/cli-provider.js'
    );

    const failure = new ClaudeCodeProvider()
      .generateServiceViolations(serviceContext)
      .catch((error: unknown) => error);

    await expect(failure).resolves.toMatchObject({
      code: 'LLM_SESSION_LIMIT',
      resetHint,
    });
    expect(fs.readFileSync(fake.callsFile, 'utf8')).toBe('1');
  });

  it('keeps bounded retry behavior for a generic 429 without a session-limit signal', async () => {
    const fake = fakeTransient429Claude();
    process.env.CLAUDE_CODE_BINARY = fake.binary;
    process.env.TC_CLAUDE_CALLS_FILE = fake.callsFile;
    vi.resetModules();
    const { ClaudeCodeProvider } = await import(
      '../../packages/core/src/services/llm/cli-provider.js'
    );

    const result = await new ClaudeCodeProvider().generateServiceViolations(serviceContext);

    expect(result).toEqual({ violations: [], serviceDescriptions: [] });
    expect(fs.readFileSync(fake.callsFile, 'utf8')).toBe('2');
  });
});
