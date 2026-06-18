import { describe, it, expect } from 'vitest';
import { diffDecisions } from '../../ee/packages/github-app/src/index';

const op = (identity: string) => ({ kind: 'Operation', identity });

describe('diffDecisions', () => {
  it('no baseline ⇒ falls back to the full head set', () => {
    const head = [op('GET /x'), op('POST /y')];
    const d = diffDecisions(head, null);
    expect(d.fellBack).toBe(true);
    expect(d.added).toEqual(head);
    expect(d.resolved).toEqual([]);
  });

  it('computes added/resolved by (kind, identity)', () => {
    const base = [op('GET /x'), op('GET /gone')];
    const head = [op('GET /x'), op('POST /new')];
    const d = diffDecisions(head, base);
    expect(d.fellBack).toBe(false);
    expect(d.added).toEqual([op('POST /new')]);
    expect(d.resolved).toEqual([op('GET /gone')]);
  });

  it('same identity but different kind is NOT a match', () => {
    const d = diffDecisions([{ kind: 'Entity', identity: 'Order' }], [{ kind: 'Enum', identity: 'Order' }]);
    expect(d.added).toEqual([{ kind: 'Entity', identity: 'Order' }]);
    expect(d.resolved).toEqual([{ kind: 'Enum', identity: 'Order' }]);
  });

  it('ignores the LLM reason when keying', () => {
    const base = [{ kind: 'Operation', identity: 'GET /x', reason: 'old reason' }];
    const head = [{ kind: 'Operation', identity: 'GET /x', reason: 'new reason' }];
    const d = diffDecisions(head, base);
    expect(d.added).toEqual([]);
    expect(d.resolved).toEqual([]);
  });

  it('empty baseline (inferred nothing) ⇒ all head decisions are new', () => {
    const head = [op('GET /x')];
    const d = diffDecisions(head, []);
    expect(d.fellBack).toBe(false);
    expect(d.added).toEqual(head);
    expect(d.resolved).toEqual([]);
  });
});
