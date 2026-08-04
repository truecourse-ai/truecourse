/**
 * Tests for the EE lens module (`@/ee/ee-lens`) — the pure extraction of
 * RepoPage's inline EE tab-order constants and its URL-coherence effect.
 *
 * `resolveEeLens` is the effect's decision core: given the current search
 * params, PR scope, and active left tab, it returns the `{section, tab}`
 * the URL should be rewritten to, or `null` when the URL is already
 * coherent (no rewrite / no navigate).
 *
 * The first describe block is a CHARACTERIZATION of the original behavior
 * as it lived inline in RepoPage:
 *   - only an explicit ?section=guard|codequality counts as a lens;
 *     anything else (missing, unknown) rewrites to codequality.
 *   - the early-return (null) keys off the ACTIVE leftTab being a member of
 *     the lens's curated order (and not settings-in-PR) — not the ?tab param.
 *   - on rewrite, a ?tab that IS valid for the target order is kept; only
 *     missing/invalid/settings-in-PR tabs are replaced with the lens default.
 */
import { describe, it, expect } from 'vitest';
import {
  EE_ANALYSIS_TAB_ORDER,
  EE_GUARD_TAB_ORDER,
  eeLensTabOrder,
  eeDefaultTab,
  resolveEeLens,
} from '@/ee/ee-lens';

/** Shorthand: build the resolveEeLens input from a query string. */
function resolve(
  query: string,
  { prNumber = null, leftTab = null }: { prNumber?: number | null; leftTab?: string | null } = {},
) {
  return resolveEeLens({
    searchParams: new URLSearchParams(query),
    prNumber,
    leftTab,
  });
}

describe('ee-lens — curated tab orders and defaults (characterization)', () => {
  it('exposes the curated orders RepoPage used inline', () => {
    expect(EE_ANALYSIS_TAB_ORDER).toEqual(['analytics', 'violations', 'settings']);
  });

  it('eeLensTabOrder maps a lens to its curated order', () => {
    expect(eeLensTabOrder('codequality')).toEqual(EE_ANALYSIS_TAB_ORDER);
    expect(eeLensTabOrder('guard')).toEqual(EE_GUARD_TAB_ORDER);
  });

  it('eeDefaultTab is the first curated tab of each lens', () => {
    expect(eeDefaultTab('codequality')).toBe('analytics');
    expect(eeDefaultTab('guard')).toBe('coverage');
  });
});

describe('resolveEeLens — lens coherence (characterization of the old RepoPage effect)', () => {
  it('no section/tab at all lands on Code Quality Analytics', () => {
    expect(resolve('', { leftTab: null })).toEqual({
      section: 'codequality',
      tab: 'analytics',
    });
  });

  it('explicit codequality with a curated active tab is already coherent (null)', () => {
    expect(
      resolve('section=codequality&tab=violations', { leftTab: 'violations' }),
    ).toBeNull();
  });

  it('explicit codequality with an off-lens tab (graphs) rewrites to the default', () => {
    expect(resolve('section=codequality&tab=graphs', { leftTab: 'graphs' })).toEqual({
      section: 'codequality',
      tab: 'analytics',
    });
  });

  it('settings is evicted while viewing a PR (repo-wide config is not PR-scoped)', () => {
    expect(
      resolve('section=codequality&tab=settings&pr=5', {
        prNumber: 5,
        leftTab: 'settings',
      }),
    ).toEqual({ section: 'codequality', tab: 'analytics' });
  });

  it('an unknown ?section rewrites to Code Quality', () => {
    expect(resolve('section=zzz', { leftTab: null })).toEqual({
      section: 'codequality',
      tab: 'analytics',
    });
  });

  it('on rewrite, a ?tab valid for the target order is KEPT, not replaced', () => {
    // The original effect only replaced missing/invalid/settings-in-PR tabs:
    // an implicit section with a tab that fits codequality keeps that tab.
    expect(resolve('tab=violations', { leftTab: null })).toEqual({
      section: 'codequality',
      tab: 'violations',
    });
  });
});

describe('ee-lens — the Guard lens', () => {
  it('exposes all five guard tabs, Coverage first (the default)', () => {
    expect(EE_GUARD_TAB_ORDER).toEqual([
      'coverage',
      'guardflows',
      'tests',
      'journeys',
      'guarddrifts',
    ]);
    expect(eeLensTabOrder('guard')).toEqual(EE_GUARD_TAB_ORDER);
    expect(eeDefaultTab('guard')).toBe('coverage');
  });

  it('THE regression: ?section=guard on its Coverage tab is coherent — no rewrite to codequality', () => {
    expect(resolve('section=guard&tab=coverage', { leftTab: 'coverage' })).toBeNull();
  });

  it('?section=guard without a tab lands on Coverage', () => {
    expect(resolve('section=guard', { leftTab: null })).toEqual({
      section: 'guard',
      tab: 'coverage',
    });
  });

  it('?section=guard with an off-lens tab rewrites to Coverage', () => {
    expect(resolve('section=guard&tab=verify', { leftTab: 'verify' })).toEqual({
      section: 'guard',
      tab: 'coverage',
    });
  });

  it('Flows, Journeys, and Runs (guarddrifts) are coherent guard tabs', () => {
    expect(resolve('section=guard&tab=guardflows', { leftTab: 'guardflows' })).toBeNull();
    expect(resolve('section=guard&tab=journeys', { leftTab: 'journeys' })).toBeNull();
    expect(
      resolve('section=guard&tab=guarddrifts', { leftTab: 'guarddrifts' }),
    ).toBeNull();
  });

  it('PR mode: guard Runs stays put while a PR is scoped', () => {
    expect(
      resolve('section=guard&tab=guarddrifts&pr=7', {
        prNumber: 7,
        leftTab: 'guarddrifts',
      }),
    ).toBeNull();
  });
});
