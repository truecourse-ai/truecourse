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

// Pure classification of the `claude` login probe's outcome — the part that
// decides whether a failing test call is an expired login vs some other error,
// tested without spawning a real subprocess.
describe('classifyClaudeProbe', () => {
  it('treats a clean exit as logged in', () => {
    expect(classifyClaudeProbe(0, '')).toEqual({ ok: true });
    expect(classifyClaudeProbe(0, 'some noise on stderr')).toEqual({ ok: true });
  });

  it('treats a non-zero exit with empty stderr as an auth problem', () => {
    // The real-world expired-login case: `claude exited 1` with nothing on
    // stderr. The message-pattern heuristic alone would miss it.
    expect(classifyClaudeProbe(1, '')).toEqual({ ok: false, reason: 'unauthenticated', detail: undefined });
    expect(classifyClaudeProbe(1, '   \n  ')).toEqual({ ok: false, reason: 'unauthenticated', detail: undefined });
  });

  it('classifies an auth-looking stderr as unauthenticated and keeps the detail', () => {
    const r = classifyClaudeProbe(1, 'Error: 401 Unauthorized — please run /login');
    expect(r).toEqual({
      ok: false,
      reason: 'unauthenticated',
      detail: 'Error: 401 Unauthorized — please run /login',
    });
  });

  it('surfaces a non-auth error verbatim instead of masking it as login', () => {
    const r = classifyClaudeProbe(2, 'error: unknown flag --frobnicate');
    expect(r).toEqual({ ok: false, reason: 'error', detail: 'error: unknown flag --frobnicate' });
  });
});
