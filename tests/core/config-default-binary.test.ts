import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The config module reads process.env at import time, so each test must reset
// the module registry before re-importing.
const originalBinaryEnv = process.env.CLAUDE_CODE_BINARY;

describe('config.claudeCodeBinary default', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.CLAUDE_CODE_BINARY;
  });

  afterEach(() => {
    if (originalBinaryEnv === undefined) delete process.env.CLAUDE_CODE_BINARY;
    else process.env.CLAUDE_CODE_BINARY = originalBinaryEnv;
  });

  it('defaults to claude', async () => {
    const { config } = await import('../../packages/core/src/config/index.js');
    expect(config.claudeCodeBinary).toBe('claude');
  });

  it('CLAUDE_CODE_BINARY env override wins', async () => {
    process.env.CLAUDE_CODE_BINARY = '/opt/claude/bin/claude';
    const { config } = await import('../../packages/core/src/config/index.js');
    expect(config.claudeCodeBinary).toBe('/opt/claude/bin/claude');
  });

  it('CLAUDE_CODE_BINARY env override accepts Windows paths', async () => {
    process.env.CLAUDE_CODE_BINARY = 'C:\\custom\\claude.exe';
    const { config } = await import('../../packages/core/src/config/index.js');
    expect(config.claudeCodeBinary).toBe('C:\\custom\\claude.exe');
  });
});
