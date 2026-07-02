/**
 * Area-vocab normalization is the load-bearing determinism in the corpus path:
 * the classifier proposes free-form `product/concern` tags and these helpers
 * canonicalize them so synonyms collapse into one area without any per-repo
 * hardcoded vocabulary.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeArea,
  splitArea,
  slugifyAxis,
  isProcessArea,
  CORE_PRODUCT,
  PROCESS_PRODUCT,
  CuratedCorpusSchema,
} from '../../packages/spec-consolidator/src/index.js';

describe('slugifyAxis', () => {
  it('lowercases, hyphenates, and trims', () => {
    expect(slugifyAxis('Users Entity')).toBe('users-entity');
    expect(slugifyAxis('  Auth / RBAC  ')).toBe('auth-rbac');
    expect(slugifyAxis('events!!')).toBe('events');
    expect(slugifyAxis('---')).toBe('');
  });
});

describe('normalizeArea', () => {
  it('builds product/concern ids', () => {
    expect(normalizeArea({ product: 'core', concern: 'users entity' })).toBe('core/users-entity');
  });

  it('folds concern synonyms onto one canonical slug', () => {
    expect(normalizeArea({ product: 'core', concern: 'authentication' })).toBe('core/auth');
    expect(normalizeArea({ product: 'core', concern: 'authorization' })).toBe('core/auth');
    expect(normalizeArea({ product: 'core', concern: 'RBAC' })).toBe('core/auth');
    // users / user / users-entity all collapse
    expect(normalizeArea({ product: 'core', concern: 'users' })).toBe('core/users-entity');
    expect(normalizeArea({ product: 'core', concern: 'user' })).toBe('core/users-entity');
  });

  it('folds product synonyms (shared/platform/backend → core)', () => {
    expect(normalizeArea({ product: 'shared', concern: 'errors' })).toBe('core/errors');
    expect(normalizeArea({ product: 'Platform', concern: 'auth' })).toBe('core/auth');
  });

  it('keeps distinct products apart even when the concern matches', () => {
    const a = normalizeArea({ product: 'capacity-app', concern: 'events' });
    const b = normalizeArea({ product: 'ccm-dashboard', concern: 'events' });
    expect(a).toBe('capacity-app/events');
    expect(b).toBe('ccm-dashboard/events');
    expect(a).not.toBe(b);
  });

  it('maps meta product onto the process bucket', () => {
    expect(normalizeArea({ product: 'meta', concern: 'open-questions' })).toBe('process/open-questions');
    expect(normalizeArea({ product: 'process', concern: 'goals' })).toBe('process/goals');
  });

  it('returns null when an axis is empty after slugging', () => {
    expect(normalizeArea({ product: '', concern: 'auth' })).toBeNull();
    expect(normalizeArea({ product: 'core', concern: '!!!' })).toBeNull();
  });

  it('folds accented Latin (NFKD) instead of mangling it', () => {
    expect(normalizeArea({ product: 'Über', concern: 'Café' })).toBe('uber/cafe');
  });

  it('keeps non-Latin axes instead of dropping them, and keeps distinct ones distinct', () => {
    const a = normalizeArea({ product: 'core', concern: '用户' });
    const b = normalizeArea({ product: 'core', concern: '订单' });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b); // distinct concerns must not collide to one ungrouped bucket
    expect(a!.startsWith('core/')).toBe(true);
  });

  it('routes any process-named concern under the process product (the fixed slice)', () => {
    expect(normalizeArea({ product: 'core', concern: 'Goals' })).toBe('process/goals');
    expect(normalizeArea({ product: 'capacity-app', concern: 'open questions' })).toBe('process/open-questions');
    expect(normalizeArea({ product: 'core', concern: 'non-goals' })).toBe('process/non-goals');
  });
});

describe('splitArea / isProcessArea', () => {
  it('splits an id back into axes', () => {
    expect(splitArea('capacity-app/events')).toEqual({ product: 'capacity-app', concern: 'events' });
  });

  it('treats a bare slug as a core concern', () => {
    expect(splitArea('auth')).toEqual({ product: CORE_PRODUCT, concern: 'auth' });
  });

  it('flags process areas', () => {
    expect(isProcessArea(`${PROCESS_PRODUCT}/overview`)).toBe(true);
    expect(isProcessArea('core/auth')).toBe(false);
  });
});

describe('CuratedCorpusSchema', () => {
  it('parses a minimal corpus and defaults relations to []', () => {
    const parsed = CuratedCorpusSchema.parse({
      version: 3,
      generatedAt: '2026-06-26T00:00:00Z',
      docs: [],
      areas: [],
    });
    expect(parsed.relations).toEqual([]);
  });
});
