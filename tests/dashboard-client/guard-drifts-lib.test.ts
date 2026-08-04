/**
 * The guard drift/report shaping helpers — pure, deterministic, and the client
 * mirror of the core composition, so they get their own fast unit test: drift
 * ordering (fail → error → stale → orphaned, stable within tier), the report
 * settled/unsettled split, gap-by-kind + the full blocked-on tally, and error
 * pattern grouping.
 */

import { describe, it, expect } from 'vitest';
import type { GuardGenerateReport, GuardScenarioResult } from '@truecourse/shared';
import { GUARD_DRIFT_ORDER, formatGuardDuration, orderGuardDrifts, sectionLeaf, shortFingerprint } from '@/lib/guard-drifts';
import { blockedOnTally, deferredSectionCount, gapsByKind, groupErrorsByPattern, settledCounts } from '@/lib/guard-report';

function scn(id: string, outcome: GuardScenarioResult['outcome']): GuardScenarioResult {
  return {
    id,
    title: id,
    binds: { doc: 'docs/spec.md', section: id, fingerprint: 'sha256:x' },
    outcome,
    durationMs: 1,
  };
}

describe('orderGuardDrifts', () => {
  it('orders non-pass scenarios fail → error → stale → orphaned', () => {
    const scenarios = [scn('o', 'orphaned'), scn('p', 'pass'), scn('f', 'fail'), scn('s', 'stale'), scn('e', 'error')];
    expect(orderGuardDrifts(scenarios).map((s) => s.outcome)).toEqual(['fail', 'error', 'stale', 'orphaned']);
  });

  it('drops passing scenarios and preserves original order within a tier', () => {
    const scenarios = [scn('f2', 'fail'), scn('p', 'pass'), scn('f1', 'fail')];
    expect(orderGuardDrifts(scenarios).map((s) => s.id)).toEqual(['f2', 'f1']);
  });

  it('returns empty for a missing run', () => {
    expect(orderGuardDrifts(null)).toEqual([]);
    expect(orderGuardDrifts(undefined)).toEqual([]);
  });

  it('matches the core DRIFT_ORDER exactly', () => {
    expect(GUARD_DRIFT_ORDER).toEqual(['fail', 'error', 'stale', 'orphaned']);
  });
});

describe('formatGuardDuration', () => {
  it('keeps sub-second durations as exact milliseconds', () => {
    expect(formatGuardDuration(0)).toBe('0ms');
    expect(formatGuardDuration(873)).toBe('873ms');
    expect(formatGuardDuration(999)).toBe('999ms');
    expect(formatGuardDuration(4)).toBe('4ms');
  });

  it('renders under a minute as one-decimal seconds', () => {
    expect(formatGuardDuration(1000)).toBe('1.0s');
    expect(formatGuardDuration(15635)).toBe('15.6s');
    expect(formatGuardDuration(59400)).toBe('59.4s');
  });

  it('renders a minute or more as minutes + zero-padded seconds', () => {
    expect(formatGuardDuration(60000)).toBe('1m 00s');
    expect(formatGuardDuration(125000)).toBe('2m 05s');
    // A rounded-up 60 carries into the next minute instead of "1m 60s".
    expect(formatGuardDuration(119700)).toBe('2m 00s');
  });
});

describe('sectionLeaf / shortFingerprint', () => {
  it('takes the trailing heading of an anchor', () => {
    expect(sectionLeaf('cli/version/flags')).toBe('flags');
    expect(sectionLeaf('whole-doc')).toBe('whole-doc');
  });
  it('strips the sha256 prefix and clips', () => {
    expect(shortFingerprint('sha256:9f2caabbccddeeff00')).toBe('9f2caabbccdd');
  });
});

const REPORT: GuardGenerateReport = {
  generatedAt: '2026-07-07T00:00:00.000Z',
  status: 'ok',
  sectionsTotal: 20,
  sectionsChanged: 10,
  skippedUnchanged: 10,
  noChanges: false,
  written: [],
  coverageGaps: [
    { doc: 'd', anchor: 'a1', kind: 'no-claim', reason: 'nothing assertable' },
    { doc: 'd', anchor: 'a2', kind: 'awaiting-driver', driver: 'web', reason: 'browser UI boundary' },
    { doc: 'd', anchor: 'a3', kind: 'blocked-on', reason: 'blocked on git: needs a repo' },
    { doc: 'd', anchor: 'a4', kind: 'blocked-on', reason: 'blocked on git, db: needs both' },
  ],
  birthFindings: [
    { doc: 'd', anchor: 'sec/x', title: 't1', step: 1, expected: 'e', actual: 'a' },
    { doc: 'd', anchor: 'sec/y', title: 't2', step: 1, expected: 'e', actual: 'a' },
  ],
  errors: [
    { doc: 'd', anchor: 'sec/x', message: 'invalid verb "frobnicate" at step 3' },
    { doc: 'd', anchor: 'sec/z', message: 'invalid verb "wibble" at step 9' },
    { doc: 'd', anchor: 'sec/w', message: 'schema mismatch on setup.files' },
  ],
  extractionFailures: [],
  orphaned: [],
};

describe('settledCounts', () => {
  it('splits changed sections into settled and unsettled (birth findings + errors)', () => {
    // unsettled distinct (doc,anchor): sec/x, sec/y (findings) + sec/z, sec/w (errors) = 4
    // (sec/x appears in both a finding and an error → counted once)
    const c = settledCounts(REPORT);
    expect(c.changed).toBe(10);
    expect(c.unsettled).toBe(4);
    expect(c.settled).toBe(6);
    expect(c.unchanged).toBe(10);
  });
});

describe('gapsByKind / blockedOnTally', () => {
  it('counts gaps by kind', () => {
    const k = gapsByKind(REPORT.coverageGaps);
    expect(k['no-claim']).toBe(1);
    expect(k.web).toBe(1);
    expect(k['blocked-on']).toBe(2);
    expect(k.tui).toBe(0);
  });

  it('tallies every blocked-on capability, descending by count', () => {
    // git appears in both blocked-on gaps (2), db in one (1)
    expect(blockedOnTally(REPORT.coverageGaps)).toEqual([
      { capability: 'git', count: 2 },
      { capability: 'db', count: 1 },
    ]);
  });
});

describe('groupErrorsByPattern', () => {
  it('folds quoted spans + numbers to group, keeping a FULL message + distinct sections', () => {
    const groups = groupErrorsByPattern(REPORT.errors);
    // The two `invalid verb "…" at step N` messages collapse to one pattern, over
    // their two distinct sections (doc + anchor, not bare anchors).
    const verbGroup = groups.find((g) => g.pattern.includes('invalid verb'));
    expect(verbGroup?.sections).toEqual([
      { doc: 'd', anchor: 'sec/x' },
      { doc: 'd', anchor: 'sec/z' },
    ]);
    // The representative message is kept verbatim (unfolded) for the detail view.
    expect(verbGroup?.message).toBe('invalid verb "frobnicate" at step 3');
    // The schema-mismatch message is its own group.
    expect(groups.some((g) => g.pattern.includes('schema mismatch'))).toBe(true);
    // Most-affected pattern first.
    expect(groups[0].sections).toHaveLength(2);
  });
});

describe('deferredSectionCount', () => {
  it('counts DISTINCT sections across errors — a section erroring twice counts once', () => {
    expect(deferredSectionCount(REPORT.errors)).toBe(3);
    expect(
      deferredSectionCount([
        { doc: 'd', anchor: 'sec/x', message: 'first pattern' },
        { doc: 'd', anchor: 'sec/x', message: 'second pattern on the same section' },
      ]),
    ).toBe(1);
  });
});
