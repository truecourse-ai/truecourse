import { describe, it, expect } from 'vitest';
import { toRepoRelative, relativizeViolationPaths } from '../../packages/core/src/commands/analyze-core';
import type { ViolationRecord } from '../../packages/core/src/types/snapshot';

const CLONE = '/tmp/tc-gate-baseline-hgixZF';

describe('analyze path relativization', () => {
  it('rewrites an absolute scan-root path to a repo-relative POSIX path', () => {
    expect(toRepoRelative(`${CLONE}/code/src/app.ts`, CLONE)).toBe('code/src/app.ts');
  });

  it('leaves an already-relative path untouched', () => {
    expect(toRepoRelative('code/src/app.ts', CLONE)).toBe('code/src/app.ts');
  });

  it('leaves an absolute path OUTSIDE the scan root untouched (no false relativization)', () => {
    // A sibling dir that shares a prefix but isn't under codeDir must not match.
    expect(toRepoRelative('/tmp/tc-gate-baseline-hgixZFxx/x.ts', CLONE)).toBe(
      '/tmp/tc-gate-baseline-hgixZFxx/x.ts',
    );
    expect(toRepoRelative('/etc/passwd', CLONE)).toBe('/etc/passwd');
  });

  it('relativizes a violation set in place, leaving null filePaths alone', () => {
    const violations = [
      { ruleKey: 'security/deterministic/sql-injection', filePath: `${CLONE}/code/src/repos/orders.repo.ts` },
      { ruleKey: 'architecture/x', filePath: null },
    ] as unknown as ViolationRecord[];
    relativizeViolationPaths(violations, CLONE);
    expect(violations[0].filePath).toBe('code/src/repos/orders.repo.ts');
    expect(violations[1].filePath).toBeNull();
  });
});
