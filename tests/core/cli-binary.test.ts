import { describe, it, expect, afterEach } from 'vitest';
import {
  classifyClaudeProbe,
  cleanClaudeEnv,
  isCliBinaryAvailable,
} from '../../packages/core/src/lib/cli-binary.js';

// We don't mock cross-spawn — the helper is thin and the contract we care
// about is "does it correctly recognize available vs missing binaries on the
// current platform." `node` is guaranteed to be on PATH (we're running under
// it), and a UUID-named binary is guaranteed to be missing.
describe('isCliBinaryAvailable', () => {
  it('returns true for a binary that exists on PATH', () => {
    expect(isCliBinaryAvailable('node')).toBe(true);
  });

  it('returns false for a binary that does not exist', () => {
    expect(isCliBinaryAvailable('truecourse-nonexistent-binary-7f3a9c')).toBe(false);
  });

  it('returns false for an absolute path that does not exist', () => {
    expect(isCliBinaryAvailable('/no/such/path/claude-cli')).toBe(false);
  });
});

// The env every `claude` child gets. Two opposing requirements meet here: our
// own nesting-guard vars must NOT reach the child (or it thinks it is running
// inside Claude Code), while the user's credential MUST — `CLAUDE_CODE_OAUTH_TOKEN`
// (from `claude setup-token`) is the documented way to authenticate `claude`
// headlessly, and it happens to share the guards' prefix.
describe('cleanClaudeEnv', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('keeps CLAUDE_CODE_OAUTH_TOKEN — the documented headless credential', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-fixture';
    expect(cleanClaudeEnv().CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-fixture');
  });

  it('still strips the CLAUDE_CODE* / CLAUDE_INTERNAL* nesting guards', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-fixture';
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
    process.env.CLAUDE_CODE_SSE_PORT = '54321';
    process.env.CLAUDE_CODEX = 'not-a-real-guard-but-same-prefix';
    process.env.CLAUDE_INTERNAL_SOMETHING = 'x';

    const env = cleanClaudeEnv();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(env.CLAUDE_CODE_SSE_PORT).toBeUndefined();
    expect(env.CLAUDE_CODEX).toBeUndefined();
    expect(env.CLAUDE_INTERNAL_SOMETHING).toBeUndefined();
    // …and the exemption is not a prefix of its own: the token still survives.
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-fixture');
  });

  it('exempts exactly one name, not everything that starts with it', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN_BACKUP = 'stale-copy';
    expect(cleanClaudeEnv().CLAUDE_CODE_OAUTH_TOKEN_BACKUP).toBeUndefined();
  });

  it('does not touch unrelated variables', () => {
    process.env.TRUECOURSE_CLI_BINARY_FIXTURE = 'kept';
    const env = cleanClaudeEnv();
    expect(env.TRUECOURSE_CLI_BINARY_FIXTURE).toBe('kept');
    expect(env.PATH).toBe(process.env.PATH);
  });

  it('leaves process.env itself alone (it returns a copy)', () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
    cleanClaudeEnv();
    expect(process.env.CLAUDE_CODE_ENTRYPOINT).toBe('cli');
  });
});

// Pure packaging of the `claude` login probe's outcome. We deliberately do NOT
// classify *why* a call failed — a non-zero exit carries claude's raw output
// through verbatim so the caller shows exactly what the CLI said.
describe('classifyClaudeProbe', () => {
  it('treats a clean exit as logged in', () => {
    expect(classifyClaudeProbe(0, '')).toEqual({ ok: true });
    expect(classifyClaudeProbe(0, 'some noise')).toEqual({ ok: true });
  });

  it('carries the raw output through verbatim on a non-zero exit', () => {
    const r = classifyClaudeProbe(1, 'Error: 401 Unauthorized — please run /login');
    expect(r).toEqual({
      ok: false,
      reason: 'failed',
      code: 1,
      output: 'Error: 401 Unauthorized — please run /login',
    });
  });

  it('does not guess a cause — any failure is just "failed" with its output', () => {
    expect(classifyClaudeProbe(2, 'error: unknown flag --frobnicate')).toEqual({
      ok: false,
      reason: 'failed',
      code: 2,
      output: 'error: unknown flag --frobnicate',
    });
  });

  it('trims surrounding whitespace and preserves the exit code (incl. null)', () => {
    expect(classifyClaudeProbe(1, '   \n  ')).toEqual({ ok: false, reason: 'failed', code: 1, output: '' });
    expect(classifyClaudeProbe(null, '  boom  ')).toEqual({ ok: false, reason: 'failed', code: null, output: 'boom' });
  });
});
