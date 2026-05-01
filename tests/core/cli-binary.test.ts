import { describe, it, expect } from 'vitest';
import { isCliBinaryAvailable } from '../../packages/core/src/lib/cli-binary.js';

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
