import { describe, it, expect } from 'vitest';
import { diffByKey, diffContents } from '@truecourse/core/lib/artifact-diff';

describe('diffByKey', () => {
  const k = (t: { id: string }) => t.id;

  it('splits added (head-only) and removed (base-only)', () => {
    const base = [{ id: 'a' }, { id: 'gone' }];
    const head = [{ id: 'a' }, { id: 'new' }];
    const d = diffByKey(base, head, k);
    expect(d.added).toEqual([{ id: 'new' }]);
    expect(d.removed).toEqual([{ id: 'gone' }]);
    expect(d.unchangedCount).toBe(1);
  });

  it('empty base ⇒ everything added', () => {
    const d = diffByKey([], [{ id: 'a' }, { id: 'b' }], k);
    expect(d.added).toHaveLength(2);
    expect(d.removed).toEqual([]);
  });
});

describe('diffContents', () => {
  it('marks added / removed / modified by path + content', () => {
    const base = new Map([
      ['keep.tc', 'X'],
      ['edit.tc', 'old'],
      ['drop.tc', 'Y'],
    ]);
    const head = new Map([
      ['keep.tc', 'X'],
      ['edit.tc', 'new'],
      ['add.tc', 'Z'],
    ]);
    const d = diffContents(base, head);
    expect(d.added).toEqual(['add.tc']);
    expect(d.removed).toEqual(['drop.tc']);
    expect(d.modified).toEqual(['edit.tc']);
  });
});
