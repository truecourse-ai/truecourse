import { describe, it, expect } from 'vitest';
import { diffByKey, diffContents, stripOriginLines } from '@truecourse/core/lib/artifact-diff';

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

  it('with stripOriginLines: an origin-line-only change is NOT a modification', () => {
    const base = new Map([
      ['auth.tc', 'auth-requirement bearer {\n  origin "corpus.json#core/auth" "Authentication" 11..15\n  scheme bearer\n}'],
      ['real.tc', 'entity Order {\n  origin "corpus.json#core/orders" "Orders" 3..9\n  field id: string\n}'],
    ]);
    const head = new Map([
      // auth: ONLY the origin line range moved (11..15 → 11..16); body identical.
      ['auth.tc', 'auth-requirement bearer {\n  origin "corpus.json#core/auth" "Authentication" 11..16\n  scheme bearer\n}'],
      // real: a genuine body change (a new field) on top of an origin shift.
      ['real.tc', 'entity Order {\n  origin "corpus.json#core/orders" "Orders" 4..11\n  field id: string\n  field total: number\n}'],
    ]);
    const d = diffContents(base, head, stripOriginLines);
    expect(d.modified).toEqual(['real.tc']); // auth.tc dropped — origin-only noise
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });
});
