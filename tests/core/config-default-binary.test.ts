import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The config module reads process.env at import time, so each test must reset
// the module registry before re-importing.
const originalBinaryEnv = process.env.CLAUDE_CODE_BINARY;
const originalBinEnv = process.env.CLAUDE_CODE_BIN;

describe('config.claudeCodeBinary default', () => {
  beforeEach(() => {
    vi.resetModules();
    // Both vars participate now (CLAUDE_CODE_BINARY canonical, CLAUDE_CODE_BIN
    // legacy alias), so clear both for a deterministic baseline.
    delete process.env.CLAUDE_CODE_BINARY;
    delete process.env.CLAUDE_CODE_BIN;
  });

  afterEach(() => {
    if (originalBinaryEnv === undefined) delete process.env.CLAUDE_CODE_BINARY;
    else process.env.CLAUDE_CODE_BINARY = originalBinaryEnv;
    if (originalBinEnv === undefined) delete process.env.CLAUDE_CODE_BIN;
    else process.env.CLAUDE_CODE_BIN = originalBinEnv;
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

  it('honors the legacy CLAUDE_CODE_BIN alias when canonical is unset', async () => {
    process.env.CLAUDE_CODE_BIN = '/opt/legacy/claude';
    const { config } = await import('../../packages/core/src/config/index.js');
    expect(config.claudeCodeBinary).toBe('/opt/legacy/claude');
  });

  it('CLAUDE_CODE_BINARY takes precedence over the legacy CLAUDE_CODE_BIN', async () => {
    process.env.CLAUDE_CODE_BINARY = '/opt/canonical/claude';
    process.env.CLAUDE_CODE_BIN = '/opt/legacy/claude';
    const { config } = await import('../../packages/core/src/config/index.js');
    expect(config.claudeCodeBinary).toBe('/opt/canonical/claude');
  });
});
