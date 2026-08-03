import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { modelConfigSandbox } from '../helpers/model-config.js';

// OSS installs no default transport (`getDefaultTransport()` is undefined unless
// EE called `setDefaultTransport`), so the spawn branch is what real users hit —
// it needs its own coverage that the resolved model actually reaches argv.
//
// We do NOT mock cross-spawn (see tests/core/cli-binary.test.ts): the fake is a
// real executable that records its argv and emits the buffered
// `--output-format json` envelope this provider parses.

const sandbox = modelConfigSandbox(['CLAUDE_CODE_BINARY', 'CLAUDE_CODE_BIN', 'TC_ARGV_OUT']);
const { makeRepo, makeTmpDir } = sandbox;

/** Records argv to `$TC_ARGV_OUT`, then emits the buffered JSON envelope. */
function fakeArgvBin(): string {
  const dir = makeTmpDir('tc-argv-bin-');
  const p = path.join(dir, 'claude-argv.js');
  fs.writeFileSync(
    p,
    `#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(process.env.TC_ARGV_OUT, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({
  type: 'result', subtype: 'success', is_error: false,
  structured_output: { violations: [], serviceDescriptions: [] },
  usage: { input_tokens: 1, output_tokens: 1 },
}));
process.exit(0);
`,
  );
  fs.chmodSync(p, 0o755);
  return p;
}

const SERVICE_CTX = { architecture: 'monolith', services: [], dependencies: [], llmRules: [] };

/** Spawn one violation call against the fake binary and return its argv. */
async function argvFor(repoPath: string | null): Promise<string[]> {
  const argvOut = path.join(makeTmpDir('tc-argv-out-'), 'argv.json');
  process.env.TC_ARGV_OUT = argvOut;
  process.env.CLAUDE_CODE_BINARY = fakeArgvBin();

  // `config.claudeCodeBinary` is snapshotted at import time.
  vi.resetModules();
  const { ClaudeCodeProvider } = await import('../../packages/core/src/services/llm/cli-provider.js');
  const provider = new ClaudeCodeProvider();
  if (repoPath) provider.setRepoPath(repoPath);

  await provider.generateServiceViolations(SERVICE_CTX);

  return JSON.parse(fs.readFileSync(argvOut, 'utf-8')) as string[];
}

beforeEach(() => sandbox.reset());
afterEach(() => sandbox.cleanup());

describe('ClaudeCodeProvider — spawned argv carries the resolved model', () => {
  it('passes the stage default as --model (regression for #799)', async () => {
    const argv = await argvFor(makeRepo());

    expect(argv).toContain('--model');
    expect(argv[argv.indexOf('--model') + 1]).toBe('sonnet');
    expect(argv).not.toContain('--fallback-model');
  });

  it('passes both --model and --fallback-model from config.json', async () => {
    const repo = makeRepo({
      llm: { stages: { 'rules.violationGen': 'opus' }, fallbackModel: 'haiku' },
    });
    const argv = await argvFor(repo);

    expect(argv[argv.indexOf('--model') + 1]).toBe('opus');
    expect(argv[argv.indexOf('--fallback-model') + 1]).toBe('haiku');
  });

  it('honors the per-stage env var with no repo path set', async () => {
    process.env.TRUECOURSE_MODEL_RULES_VIOLATION_GEN = 'haiku';
    const argv = await argvFor(null);

    expect(argv[argv.indexOf('--model') + 1]).toBe('haiku');
  });
});
