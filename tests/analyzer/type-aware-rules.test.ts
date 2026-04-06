import { describe, it, expect } from 'vitest';
import { ALL_DEFAULT_RULES } from '../../packages/analyzer/src/rules/index';
import { createTypeQueryService } from '../../packages/analyzer/src/ts-compiler';

/**
 * Minimal type-aware infrastructure test — verifies TypeQueryService can be created.
 * Full type-aware rule tests will be added when those rules are ported.
 */
describe('TypeQueryService infrastructure', () => {
  it('createTypeQueryService exists and is callable', () => {
    expect(typeof createTypeQueryService).toBe('function');
  });

  it('ALL_DEFAULT_RULES contains at least one rule', () => {
    expect(ALL_DEFAULT_RULES.length).toBeGreaterThan(0);
  });
});
