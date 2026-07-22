/**
 * `spec conflicts resolve` — the SECTION-scoped verdict forms (plan item 31):
 * pick a side (`--right`) and dismiss (`--dismiss`), keyed by dispute identity,
 * writing `conflictResolutions[]` to decisions.json WITHOUT a re-scan. Plus the
 * `list` rendering of resolved/dismissed/orphaned states. Seeds corpus.json +
 * decisions.json directly (no LLM).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  runSpecConflictsList,
  runSpecConflictsResolve,
  runSpecConflictsShow,
} from '../../tools/cli/src/commands/spec-conflicts.js';

let repo: string;
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

async function capture(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c: any) => {
    chunks.push(typeof c === 'string' ? c : c.toString());
    return true;
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return stripAnsi(chunks.join(''));
}

const Q1 = 'Cancellation allowed up to 24h before.';
const Q2 = 'Cancellation allowed up to 48h before.';

function writeCorpus(): void {
  const corpus = {
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs: [
      { ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'] },
      { ref: 'docs/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/appointments'] },
    ],
    areas: [
      {
        id: 'booking/appointments',
        product: 'booking',
        concern: 'appointments',
        docRefs: ['docs/v1.md', 'docs/v2.md'],
        overlaps: [
          {
            docs: ['docs/v1.md', 'docs/v2.md'],
            note: '24h vs 48h cancellation',
            sections: [
              { doc: 'docs/v1.md', heading: 'Booking v1', quote: Q1 },
              { doc: 'docs/v2.md', heading: 'Booking v2', quote: Q2 },
            ],
          },
        ],
      },
    ],
    relations: [],
    skippedDocs: [],
  };
  fs.writeFileSync(path.join(repo, '.truecourse', 'specs', 'corpus.json'), JSON.stringify(corpus));
}

function readDecisions(): any {
  return JSON.parse(fs.readFileSync(path.join(repo, '.truecourse', 'specs', 'decisions.json'), 'utf-8'));
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-spec-conflicts-'));
  fs.mkdirSync(path.join(repo, '.truecourse', 'specs'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'v1.md'), `# Booking v1\n${Q1}`);
  fs.writeFileSync(path.join(repo, 'docs', 'v2.md'), `# Booking v2\n${Q2}`);
  writeCorpus();
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('spec conflicts resolve — side verdict', () => {
  it('--right writes a pick-a-side verdict with the disputed anchors + quotes (no re-scan)', async () => {
    const corpusMtimeBefore = fs.statSync(path.join(repo, '.truecourse', 'specs', 'corpus.json')).mtimeMs;
    await capture(() => runSpecConflictsResolve('1', { cwd: repo, right: 'docs/v2.md' }));

    const d = readDecisions();
    expect(d.conflictResolutions).toHaveLength(1);
    const r = d.conflictResolutions[0];
    // The overlap docs order is [v1, v2] → a=v1, b=v2 → --right v2 ⇒ verdict 'b'.
    expect(r).toMatchObject({ docA: 'docs/v1.md', anchorA: 'Booking v1', quoteA: Q1, docB: 'docs/v2.md', anchorB: 'Booking v2', quoteB: Q2, verdict: 'b' });
    expect(typeof r.resolvedAt).toBe('string');
    // The corpus is untouched (no re-scan) — the verdict is read live.
    expect(fs.statSync(path.join(repo, '.truecourse', 'specs', 'corpus.json')).mtimeMs).toBe(corpusMtimeBefore);
  });

  it('--dismiss writes a dismissal', async () => {
    await capture(() => runSpecConflictsResolve('booking/appointments', { cwd: repo, dismiss: true }));
    const d = readDecisions();
    expect(d.conflictResolutions).toHaveLength(1);
    expect(d.conflictResolutions[0].verdict).toBe('dismissed');
  });

  it('re-recording a verdict for the same dispute REPLACES it', async () => {
    await capture(() => runSpecConflictsResolve('1', { cwd: repo, right: 'docs/v1.md' }));
    await capture(() => runSpecConflictsResolve('1', { cwd: repo, right: 'docs/v2.md' }));
    const d = readDecisions();
    expect(d.conflictResolutions).toHaveLength(1);
    expect(d.conflictResolutions[0].verdict).toBe('b');
  });
});

describe('spec conflicts list — resolved/dismissed/orphaned rendering', () => {
  it('renders a side-resolved conflict with its winner', async () => {
    await capture(() => runSpecConflictsResolve('1', { cwd: repo, right: 'docs/v1.md' }));
    const out = await capture(() => runSpecConflictsList({ cwd: repo }));
    expect(out).toContain('resolved:');
    expect(out).toContain('v1.md is right');
    expect(out).toContain('0 open');
    expect(out).toContain('1 resolved');
  });

  it('renders a dismissed conflict', async () => {
    await capture(() => runSpecConflictsResolve('1', { cwd: repo, dismiss: true }));
    const out = await capture(() => runSpecConflictsList({ cwd: repo }));
    expect(out).toContain('dismissed');
    expect(out).toContain('0 open');
  });

  it('a covering doc relation leaves the conflict OPEN — relations never resolve', async () => {
    fs.writeFileSync(
      path.join(repo, '.truecourse', 'specs', 'decisions.json'),
      JSON.stringify({
        version: 1,
        manualIncludes: [],
        manualExcludes: [],
        relations: [
          { type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments', detectedFrom: 'manual' },
        ],
        manualAreas: [],
        conflictResolutions: [],
      }),
    );
    const out = await capture(() => runSpecConflictsList({ cwd: repo }));
    expect(out).toContain('1 open');
    expect(out).toContain('0 resolved');
  });

  it('surfaces an orphaned resolution that no longer matches a flagged conflict', async () => {
    // A verdict for a dispute the corpus does not flag (different doc pair).
    fs.writeFileSync(
      path.join(repo, '.truecourse', 'specs', 'decisions.json'),
      JSON.stringify({
        version: 1,
        manualIncludes: [],
        manualExcludes: [],
        relations: [],
        manualAreas: [],
        conflictResolutions: [
          { docA: 'docs/v1.md', anchorA: 'Gone', docB: 'docs/OTHER.md', anchorB: 'Gone', verdict: 'a', resolvedAt: '' },
        ],
      }),
    );
    const out = await capture(() => runSpecConflictsList({ cwd: repo }));
    expect(out).toContain('orphaned');
    // The real dispute is still open.
    expect(out).toContain('1 open');
  });
});

// ---------------------------------------------------------------------------
// Multi-conflict corpus with a verify-pass review — show / --json / bulk /
// --recommended. Two conflicts across two areas (index 1 = core/x carries a
// pick-b review; index 2 = core/y has none) plus a fix-doc-reviewed core/z (3).
// ---------------------------------------------------------------------------

const EXP_X = 'docs/a.md says 30 days but docs/b.md says 90 days for the same retention policy.';

function writeReviewCorpus(): void {
  const corpus = {
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs: [
      { ref: 'docs/a.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['core/x'] },
      { ref: 'docs/b.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['core/x'] },
      { ref: 'docs/c.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['core/y'] },
      { ref: 'docs/d.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['core/y'] },
      { ref: 'docs/e.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['core/z'] },
      { ref: 'docs/f.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['core/z'] },
    ],
    areas: [
      {
        id: 'core/x',
        product: 'core',
        concern: 'x',
        docRefs: ['docs/a.md', 'docs/b.md'],
        overlaps: [
          {
            docs: ['docs/a.md', 'docs/b.md'],
            note: 'retention 30 vs 90 days',
            sections: [
              { doc: 'docs/a.md', heading: 'Retention', quote: 'Data is retained for 30 days.' },
              { doc: 'docs/b.md', heading: 'Retention', quote: 'Data is retained for 90 days.' },
            ],
            areas: ['core/x'],
            review: {
              explanation: EXP_X,
              recommendation: { action: 'pick-b', rationale: 'The 90-day figure is the current policy of record.' },
            },
          },
        ],
      },
      {
        id: 'core/y',
        product: 'core',
        concern: 'y',
        docRefs: ['docs/c.md', 'docs/d.md'],
        overlaps: [{ docs: ['docs/c.md', 'docs/d.md'], note: 'sync vs async', sections: [], areas: ['core/y'] }],
      },
      {
        id: 'core/z',
        product: 'core',
        concern: 'z',
        docRefs: ['docs/e.md', 'docs/f.md'],
        overlaps: [
          {
            docs: ['docs/e.md', 'docs/f.md'],
            note: 'date format',
            sections: [
              { doc: 'docs/e.md', heading: 'Format', quote: 'Dates are ISO 8601.' },
              { doc: 'docs/f.md', heading: 'Format', quote: 'Dates are US mm/dd/yyyy.' },
            ],
            areas: ['core/z'],
            review: {
              explanation: 'e.md and f.md disagree on the date format.',
              recommendation: { action: 'fix-doc', rationale: 'Both are stale.', fix: 'Edit docs/f.md to use ISO 8601.' },
            },
          },
        ],
      },
    ],
    skippedDocs: [],
  };
  fs.writeFileSync(path.join(repo, '.truecourse', 'specs', 'corpus.json'), JSON.stringify(corpus));
  fs.writeFileSync(path.join(repo, 'docs', 'a.md'), '# Overview\nIntro line.\n\n# Retention\nData is retained for 30 days.\n');
  fs.writeFileSync(path.join(repo, 'docs', 'b.md'), '# Retention\nData is retained for 90 days.\n');
  fs.writeFileSync(path.join(repo, 'docs', 'c.md'), '# Sync\nWe sync synchronously.\n');
  fs.writeFileSync(path.join(repo, 'docs', 'd.md'), '# Sync\nWe sync asynchronously.\n');
  fs.writeFileSync(path.join(repo, 'docs', 'e.md'), '# Format\nDates are ISO 8601.\n');
  fs.writeFileSync(path.join(repo, 'docs', 'f.md'), '# Format\nDates are US mm/dd/yyyy.\n');
}

describe('spec conflicts show <n> — disputed passages + review', () => {
  it('prints each side’s resolved section with a path:line anchor and the review', async () => {
    writeReviewCorpus();
    const out = await capture(() => runSpecConflictsShow('1', { cwd: repo }));
    // Section anchors: a.md's Retention heading is line 4; b.md's is line 1.
    expect(out).toContain('docs/a.md:4');
    expect(out).toContain('docs/b.md:1');
    // The section's OWN text (not a head-slice) for both sides.
    expect(out).toContain('Data is retained for 30 days.');
    expect(out).toContain('Data is retained for 90 days.');
    // a.md's preamble section (Overview) is NOT part of the Retention excerpt.
    expect(out).not.toContain('Intro line.');
    // Review: explanation above, recommendation after.
    expect(out).toContain('Why:');
    expect(out).toContain(EXP_X);
    expect(out).toContain('Recommendation:');
    expect(out).toContain('pick b.md');
  });

  it('is addressable by the same index `list` shows', async () => {
    writeReviewCorpus();
    const list = await capture(() => runSpecConflictsList({ cwd: repo }));
    expect(list).toContain('2. core/y');
    const out = await capture(() => runSpecConflictsShow('2', { cwd: repo }));
    expect(out).toContain('core/y');
    expect(out).toContain('docs/c.md');
  });
});

describe('spec conflicts --json', () => {
  it('list --json emits a stable array keyed by list index', async () => {
    writeReviewCorpus();
    const out = await capture(() => runSpecConflictsList({ cwd: repo, json: true }));
    const arr = JSON.parse(out);
    expect(arr).toHaveLength(3);
    expect(arr[0]).toMatchObject({
      index: 1,
      area: 'core/x',
      docs: ['docs/a.md', 'docs/b.md'],
      resolved: false,
    });
    expect(arr[0].recommendation).toEqual({
      action: 'pick-b',
      rationale: 'The 90-day figure is the current policy of record.',
    });
    expect(arr[0].explanation).toBe(EXP_X);
    // core/y carries no review → no recommendation/explanation keys.
    expect(arr[1].recommendation).toBeUndefined();
    expect(arr[1].explanation).toBeUndefined();
  });

  it('show --json adds each side’s resolved excerpt {doc, heading, line, text}', async () => {
    writeReviewCorpus();
    const out = await capture(() => runSpecConflictsShow('1', { cwd: repo, json: true }));
    const j = JSON.parse(out);
    expect(j.index).toBe(1);
    expect(j.excerpts).toHaveLength(2);
    expect(j.excerpts[0]).toMatchObject({ doc: 'docs/a.md', heading: 'Retention', line: 4 });
    expect(j.excerpts[0].text).toContain('Data is retained for 30 days.');
    expect(j.excerpts[1]).toMatchObject({ doc: 'docs/b.md', heading: 'Retention', line: 1 });
  });
});

describe('spec conflicts resolve — bulk + recommended', () => {
  it('dismisses several conflicts by index in one call', async () => {
    writeReviewCorpus();
    await capture(() => runSpecConflictsResolve(['1', '2'], { cwd: repo, dismiss: true }));
    const d = readDecisions();
    expect(d.conflictResolutions).toHaveLength(2);
    expect(d.conflictResolutions.every((r: any) => r.verdict === 'dismissed')).toBe(true);
  });

  it('--area dismisses every conflict flagged in that area', async () => {
    writeReviewCorpus();
    await capture(() => runSpecConflictsResolve([], { cwd: repo, dismiss: true, area: 'core/x' }));
    const d = readDecisions();
    expect(d.conflictResolutions).toHaveLength(1);
    expect(d.conflictResolutions[0]).toMatchObject({ docA: 'docs/a.md', docB: 'docs/b.md', verdict: 'dismissed' });
  });

  it('--recommended applies a pick-b review as a side verdict', async () => {
    writeReviewCorpus();
    await capture(() => runSpecConflictsResolve(['1'], { cwd: repo, recommended: true }));
    const d = readDecisions();
    expect(d.conflictResolutions).toHaveLength(1);
    expect(d.conflictResolutions[0]).toMatchObject({ docA: 'docs/a.md', docB: 'docs/b.md', verdict: 'b' });
  });

  it('--recommended on a fix-doc review prints the fix and writes NO verdict', async () => {
    writeReviewCorpus();
    const out = await capture(() => runSpecConflictsResolve(['3'], { cwd: repo, recommended: true }));
    expect(out).toContain('Edit docs/f.md to use ISO 8601.');
    expect(out).toContain('re-run');
    expect(fs.existsSync(path.join(repo, '.truecourse', 'specs', 'decisions.json'))).toBe(false);
  });

  it('--recommended errors when the conflict has no recommendation', async () => {
    writeReviewCorpus();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit1');
    }) as never);
    await expect(capture(() => runSpecConflictsResolve(['2'], { cwd: repo, recommended: true }))).rejects.toThrow('exit1');
    expect(fs.existsSync(path.join(repo, '.truecourse', 'specs', 'decisions.json'))).toBe(false);
    exitSpy.mockRestore();
  });
});
