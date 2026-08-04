import { describe, it, expect } from 'vitest';
import {
  GuardDecisionsSchema,
  GuardDismissedClaimSchema,
  GuardCoverageGapSchema,
  GuardGenerateReportSchema,
  dismissedClaimKey,
  gapDisplayKind,
  emptyGapDisplayTotals,
} from '../../packages/shared/src/guard/index';

describe('guard decisions schema', () => {
  it('round-trips a full decisions file', () => {
    const file = {
      version: 1,
      dismissedFlows: [],
      dismissedClaims: [
        { doc: 'docs/cli.md', anchor: 'version', title: 'the --version flag prints the semver', dismissedAt: '2026-07-08T00:00:00.000Z', note: 'wont fix' },
        { doc: 'docs/cli.md', anchor: 'help', title: 'help lists commands', dismissedAt: '2026-07-08T00:00:01.000Z' },
      ],
    };
    const parsed = GuardDecisionsSchema.parse(file);
    expect(parsed).toEqual(file);
  });

  it('defaults both dismissal lists to [] for a minimal file', () => {
    expect(GuardDecisionsSchema.parse({ version: 1 })).toEqual({ version: 1, dismissedClaims: [], dismissedFlows: [] });
  });

  it('a dismissed claim requires doc + anchor + title', () => {
    expect(() => GuardDismissedClaimSchema.parse({ doc: 'd', anchor: 'a', dismissedAt: 'x' })).toThrow();
  });

  it('the identity key is doc + anchor + title', () => {
    expect(dismissedClaimKey('d', 'a', 't')).toBe('d\0a\0t');
    expect(dismissedClaimKey('d', 'a', 't')).not.toBe(dismissedClaimKey('d', 'a', 't2'));
  });
});

describe('dismissed coverage gap kind', () => {
  it('a dismissed gap carries NO driver (the refine holds)', () => {
    const gap = { doc: 'docs/cli.md', anchor: 'version', kind: 'dismissed' as const, reason: 'dismissed: the --version claim' };
    expect(() => GuardCoverageGapSchema.parse(gap)).not.toThrow();
    // A driver on a non-awaiting-driver kind is rejected by the refine.
    expect(() => GuardCoverageGapSchema.parse({ ...gap, driver: 'cli' })).toThrow();
  });

  it('gapDisplayKind maps a dismissed gap to "dismissed" and it has a totals bucket', () => {
    expect(gapDisplayKind({ doc: 'd', anchor: 'a', kind: 'dismissed', reason: 'r' })).toBe('dismissed');
    expect(emptyGapDisplayTotals()).toHaveProperty('dismissed', 0);
  });
});

describe('guard generate report — orphanedDismissals + a finding carrying yaml/claim', () => {
  it('round-trips a report with orphanedDismissals and a finding carrying yaml + claim', () => {
    const rep = {
      generatedAt: '2026-07-08T03:04:05.000Z',
      status: 'ok' as const,
      sectionsTotal: 1,
      sectionsChanged: 1,
      skippedUnchanged: 0,
      noChanges: false,
      written: [],
      coverageGaps: [{ doc: 'docs/cli.md', anchor: 'version', kind: 'dismissed' as const, reason: 'dismissed: v' }],
      birthFindings: [
        {
          doc: 'docs/cli.md',
          anchor: 'version',
          title: 'bad',
          step: 1,
          expected: 'e',
          actual: 'a',
          evidencePath: '.truecourse/guard/evidence/run/bad.1',
          yaml: 'guard: 1\nid: version.1\ntitle: bad\n',
          claim: 'the --version flag prints the semver',
        },
      ],
      errors: [],
      extractionFailures: [],
      orphaned: [],
      orphanedDismissals: [{ doc: 'docs/cli.md', anchor: 'gone', title: 'stale claim text' }],
    };
    expect(() => GuardGenerateReportSchema.parse(rep)).not.toThrow();
  });

  it('an old-shape report with no orphanedDismissals / finding yaml still parses (optional)', () => {
    const rep = {
      generatedAt: '2026-07-08T03:04:05.000Z',
      status: 'ok' as const,
      sectionsTotal: 0,
      sectionsChanged: 0,
      skippedUnchanged: 0,
      noChanges: false,
      written: [],
      coverageGaps: [],
      birthFindings: [{ doc: 'd', anchor: 'a', title: 't', step: 1, expected: 'e', actual: 'a' }],
      errors: [],
      extractionFailures: [],
      orphaned: [],
    };
    expect(() => GuardGenerateReportSchema.parse(rep)).not.toThrow();
  });
});
