import { describe, it, expect } from 'vitest';
import { classifyClaudeProbe, isCliBinaryAvailable } from '../../packages/core/src/lib/cli-binary.js';

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
