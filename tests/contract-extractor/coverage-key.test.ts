/**
 * coverageKey: the tolerant identity used by the completeness gate and the
 * target reconciler. It must fold benign drift (kind case, whitespace, HTTP
 * method case, trailing slash, path-param style) so an enumerated target and the
 * emitted fragment match — without collapsing genuinely distinct artifacts.
 */
import { describe, it, expect } from 'vitest';
import { coverageKey } from '../../packages/contract-extractor/src/index.js';

describe('coverageKey', () => {
  it('lowercases kind and trims/collapses whitespace', () => {
    expect(coverageKey('Entity', '  Order ')).toBe('entity:Order');
    expect(coverageKey('entity', 'Order')).toBe('entity:Order');
  });

  it('uppercases HTTP method and strips trailing slash', () => {
    expect(coverageKey('Operation', 'post /api/orders/')).toBe(coverageKey('Operation', 'POST /api/orders'));
  });

  it('folds colon path params (:id) and brace params ({id}) to one form', () => {
    expect(coverageKey('Operation', 'GET /api/orders/:id')).toBe(coverageKey('Operation', 'GET /api/orders/{id}'));
    expect(coverageKey('Operation', 'POST /api/orders/:id/pay')).toBe(coverageKey('Operation', 'POST /api/orders/{id}/pay'));
  });

  it('does NOT collapse distinct entity / enum names', () => {
    expect(coverageKey('Entity', 'Order')).not.toBe(coverageKey('Entity', 'Customer'));
    expect(coverageKey('Operation', 'GET /api/orders')).not.toBe(coverageKey('Operation', 'GET /api/customers'));
  });
});
