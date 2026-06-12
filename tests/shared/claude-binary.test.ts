import { afterEach, describe, it, expect } from 'vitest';
import { resolveClaudeBinary } from '../../packages/shared/src/claude-binary.js';

// Single source of truth for which `claude` binary every command, the LLM
// provider, and each extraction runner spawns. `CLAUDE_CODE_BINARY` is
// canonical; `CLAUDE_CODE_BIN` is a legacy alias. This precedence is what lets
// the up-front preflight test the same binary the real work will use.
describe('resolveClaudeBinary', () => {
  const { CLAUDE_CODE_BINARY, CLAUDE_CODE_BIN } = process.env;
  afterEach(() => {
    if (CLAUDE_CODE_BINARY === undefined) delete process.env.CLAUDE_CODE_BINARY;
    else process.env.CLAUDE_CODE_BINARY = CLAUDE_CODE_BINARY;
    if (CLAUDE_CODE_BIN === undefined) delete process.env.CLAUDE_CODE_BIN;
    else process.env.CLAUDE_CODE_BIN = CLAUDE_CODE_BIN;
  });

  it("defaults to 'claude' when neither var is set", () => {
    delete process.env.CLAUDE_CODE_BINARY;
    delete process.env.CLAUDE_CODE_BIN;
    expect(resolveClaudeBinary()).toBe('claude');
  });

  it('prefers CLAUDE_CODE_BINARY over the legacy CLAUDE_CODE_BIN', () => {
    process.env.CLAUDE_CODE_BINARY = '/opt/canonical/claude';
    process.env.CLAUDE_CODE_BIN = '/opt/legacy/claude';
    expect(resolveClaudeBinary()).toBe('/opt/canonical/claude');
  });

  it('falls back to the legacy CLAUDE_CODE_BIN when canonical is unset/empty', () => {
    delete process.env.CLAUDE_CODE_BINARY;
    process.env.CLAUDE_CODE_BIN = '/opt/legacy/claude';
    expect(resolveClaudeBinary()).toBe('/opt/legacy/claude');
    process.env.CLAUDE_CODE_BINARY = '';
    expect(resolveClaudeBinary()).toBe('/opt/legacy/claude');
  });
});
