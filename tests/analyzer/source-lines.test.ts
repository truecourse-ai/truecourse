import { describe, it, expect } from 'vitest';
import { splitLines } from '../../packages/analyzer/src/rules/_shared/source-lines';

describe('splitLines', () => {
  it('splits source into lines identically to String.split', () => {
    const source = 'const a = 1\nconst b = 2\n\nconst c = 3';
    expect([...splitLines(source)]).toEqual(source.split('\n'));
  });

  it('returns a single trailing empty entry for a trailing newline', () => {
    const source = 'a\nb\n';
    expect([...splitLines(source)]).toEqual(['a', 'b', '']);
  });

  it('handles empty and single-line sources', () => {
    expect([...splitLines('')]).toEqual(['']);
    expect([...splitLines('only one line')]).toEqual(['only one line']);
  });

  it('memoizes: repeated calls with the same source return the same cached array', () => {
    // This is the fix for PR #820 review item #3: rule visitors fire once per
    // matching AST node and re-split the whole file each time. Handing back the
    // same cached array for the same file collapses O(nodes) splits into one.
    const source = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const first = splitLines(source);
    const second = splitLines(source);
    expect(second).toBe(first); // same instance, not a re-split
  });

  it('re-splits when the source changes', () => {
    const a = 'alpha\nbeta';
    const b = 'gamma\ndelta';
    const linesA = splitLines(a);
    const linesB = splitLines(b);
    expect(linesB).not.toBe(linesA);
    expect([...linesA]).toEqual(['alpha', 'beta']);
    expect([...linesB]).toEqual(['gamma', 'delta']);
  });

  it('stays correct when two sources are queried alternately (cache miss, never wrong lines)', () => {
    const a = 'a1\na2';
    const b = 'b1\nb2\nb3';
    // Identity-keyed cache: alternating inputs only costs re-splits, it can
    // never return the wrong source's lines.
    expect([...splitLines(a)]).toEqual(['a1', 'a2']);
    expect([...splitLines(b)]).toEqual(['b1', 'b2', 'b3']);
    expect([...splitLines(a)]).toEqual(['a1', 'a2']);
    expect([...splitLines(b)]).toEqual(['b1', 'b2', 'b3']);
  });
});
