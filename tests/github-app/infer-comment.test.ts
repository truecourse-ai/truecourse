import { describe, it, expect } from 'vitest';
import {
  INFER_MARKER,
  renderInferComment,
  isInferComment,
  isInferCheckboxChecked,
  hasInferOffer,
  SCAN_MARKER,
  isScanComment,
  renderScanComment,
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

describe('scan vs infer markers do not collide', () => {
  it('each predicate only matches its own comment', () => {
    const scan = renderScanComment('offered');
    const infer = renderInferComment('offered');
    expect(INFER_MARKER).not.toBe(SCAN_MARKER);
    expect(isInferComment(scan)).toBe(false);
    expect(isScanComment(infer)).toBe(false);
    expect(isScanComment(scan)).toBe(true);
    expect(isInferComment(infer)).toBe(true);
  });
});
