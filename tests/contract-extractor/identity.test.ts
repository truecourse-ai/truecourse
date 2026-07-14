/**
 * canonicalIdentity + slugIdentity: the single source of truth for an artifact's
 * identity (Phase 1 of the determinism fix). One identity, folded once at parse,
 * feeds both the merge key and the filename slug — so what dedups, what is
 * written, and what a filename is derived from can never diverge.
 */
import { describe, it, expect } from 'vitest';
import { canonicalIdentity, slugIdentity, coverageKey } from '../../packages/contract-extractor/src/index.js';

describe('canonicalIdentity', () => {
  it('collapses whitespace but preserves type-name casing and dots', () => {
    expect(canonicalIdentity('Entity', '  Order ')).toBe('Order');
    expect(canonicalIdentity('StateMachine', 'Order.status')).toBe('Order.status');
    expect(canonicalIdentity('Enum', 'OrderStatus')).toBe('OrderStatus');
  });

  it('folds benign HTTP drift (method case, trailing slash, :id vs {id})', () => {
    expect(canonicalIdentity('Operation', 'post /api/orders/')).toBe('POST /api/orders');
    expect(canonicalIdentity('Operation', 'GET /api/orders/:id')).toBe('GET /api/orders/{id}');
    expect(canonicalIdentity('Operation', 'get /api/orders/:id/pay')).toBe('GET /api/orders/{id}/pay');
  });

  it('is idempotent', () => {
    for (const id of ['POST /api/orders', 'Order.status', 'Order', 'order.owner-only']) {
      expect(canonicalIdentity('X', canonicalIdentity('X', id))).toBe(canonicalIdentity('X', id));
    }
  });
});

describe('slugIdentity', () => {
  it('lowercases, keeps dots as separators, and collapses other punctuation to one dash', () => {
    expect(slugIdentity('Order')).toBe('order');
    expect(slugIdentity('Order.status')).toBe('order.status');
    expect(slugIdentity('POST /api/orders/{id}')).toBe('post-api-orders-id');
  });

  it('slugs punctuation CONSISTENTLY (the old writer dropped underscores, the normalizer dashed them)', () => {
    // Both must land on the same slug now — the bug was the two sluggers disagreeing.
    expect(slugIdentity('max_retry')).toBe('max-retry');
    expect(slugIdentity('max-retry')).toBe('max-retry');
    expect(slugIdentity('max retry')).toBe('max-retry');
  });

  it('is idempotent', () => {
    for (const id of ['order.status', 'post-api-orders-id', 'max-retry']) {
      expect(slugIdentity(slugIdentity(id))).toBe(slugIdentity(id));
    }
  });
});

describe('merge key and filename slug agree (the Phase-1 invariant)', () => {
  it('two cosmetically-different identities fold to one merge key AND one slug', () => {
    const a = canonicalIdentity('Operation', 'post /api/orders/');
    const b = canonicalIdentity('Operation', 'POST /api/orders');
    expect(a).toBe(b);
    expect(slugIdentity(a)).toBe(slugIdentity(b));
    expect(coverageKey('Operation', 'post /api/orders/')).toBe(coverageKey('Operation', 'POST /api/orders'));
  });
});
