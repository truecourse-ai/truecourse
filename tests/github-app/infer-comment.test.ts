import { describe, it, expect } from 'vitest';
import {
  INFER_MARKER,
  renderInferComment,
  isInferComment,
  isInferCheckboxChecked,
  hasInferOffer,
  GATE_MARKER,
  isGateComment,
  renderGateComment,
} from '../../ee/packages/github-app/src/index';

describe('infer comment rendering', () => {
  it('every state carries the infer marker', () => {
    for (const s of ['offered', 'running', 'done', 'nochange', 'error', 'fork'] as const) {
      expect(renderInferComment(s)).toContain(INFER_MARKER);
      expect(isInferComment(renderInferComment(s))).toBe(true);
    }
  });

  it('offered shows an unchecked box; running/done do not', () => {
    expect(hasInferOffer(renderInferComment('offered'))).toBe(true);
    expect(isInferCheckboxChecked(renderInferComment('offered'))).toBe(false);
    expect(hasInferOffer(renderInferComment('running'))).toBe(false);
    expect(
      hasInferOffer(renderInferComment('done', { decisions: [] })),
    ).toBe(false);
  });

  it('done lists the decisions and count', () => {
    const body = renderInferComment('done', {
      decisions: [
        { kind: 'Operation', identity: 'GET /users', path: 'src/users.ts', line: 12 },
        { kind: 'Enum', identity: 'Role', reason: 'inferred from union' },
      ],
      commitSha: 'abcdef1234',
    });
    expect(body).toContain('2 undocumented decisions found');
    expect(body).toContain('GET /users');
    expect(body).toContain('src/users.ts:12');
    expect(body).toContain('inferred from union');
    expect(body).toContain('abcdef1');
  });

  it('nochange reads cleanly', () => {
    expect(renderInferComment('nochange')).toContain('No undocumented decisions');
  });
});

describe('gate vs infer markers do not collide', () => {
  it('each predicate only matches its own comment', () => {
    const gate = renderGateComment(
      { conclusion: 'success', added: [], resolved: [], belowThreshold: [] } as any,
      {},
    );
    const infer = renderInferComment('offered');
    expect(INFER_MARKER).not.toBe(GATE_MARKER);
    expect(isInferComment(gate)).toBe(false);
    expect(isGateComment(infer)).toBe(false);
    expect(isGateComment(gate)).toBe(true);
    expect(isInferComment(infer)).toBe(true);
  });
});
