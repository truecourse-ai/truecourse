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
import { runSpecConflictsList, runSpecConflictsResolve } from '../../tools/cli/src/commands/spec-conflicts.js';

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
