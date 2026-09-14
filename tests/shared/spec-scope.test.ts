import { describe, it, expect } from 'vitest';
import { buildSpecScope } from '../../packages/shared/src/index.js';

/**
 * A spec scope — the opt-in inverse of `.truecourseignore`, scoping doc
 * discovery to markdown that matches a glob. Load-bearing properties: an
 * absent/empty scope is inactive (everything in scope, unchanged behavior),
 * gitignore-style globs, and a build that degrades malformed input to inactive
 * rather than throwing.
 */

describe('buildSpecScope', () => {
  it('is inactive for an absent, empty, or all-blank list', () => {
    for (const globs of [undefined, null, [], ['', '   '], 'not-an-array', 42]) {
      const scope = buildSpecScope(globs as unknown);
      expect(scope.active).toBe(false);
      expect(scope.globs).toEqual([]);
      // Inactive → everything matches.
      expect(scope.includes('anything/at/all.md')).toBe(true);
    }
  });

  it('matches gitignore-style globs when active', () => {
    const scope = buildSpecScope(['docs/**', 'specs/*.md']);
    expect(scope.active).toBe(true);
    expect(scope.globs).toEqual(['docs/**', 'specs/*.md']);
    expect(scope.includes('docs/spec.md')).toBe(true);
    expect(scope.includes('docs/nested/deep/api.md')).toBe(true);
    expect(scope.includes('specs/orders.md')).toBe(true);
    // `specs/*.md` does not cross a slash.
    expect(scope.includes('specs/sub/orders.md')).toBe(false);
    // Outside every glob.
    expect(scope.includes('README.md')).toBe(false);
    expect(scope.includes('src/app.ts')).toBe(false);
  });

  it('drops non-string / blank entries but stays active on the rest', () => {
    const scope = buildSpecScope(['docs/**', '', 123, null, '  specs/**  ']);
    expect(scope.active).toBe(true);
    expect(scope.globs).toEqual(['docs/**', 'specs/**']);
    expect(scope.includes('specs/x.md')).toBe(true);
  });

  it('never includes an empty or root-escaping path', () => {
    const scope = buildSpecScope(['**']);
    expect(scope.includes('')).toBe(false);
    expect(scope.includes('../sibling.md')).toBe(false);
  });

  it('mixes a file-level pattern with a directory glob', () => {
    const scope = buildSpecScope(['SPEC.md', 'docs/**']);
    expect(scope.active).toBe(true);
    expect(scope.includes('SPEC.md')).toBe(true);
    expect(scope.includes('docs/a.md')).toBe(true);
    expect(scope.includes('other/b.md')).toBe(false);
  });
});
