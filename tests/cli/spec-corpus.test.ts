/**
 * The corpus-path `spec` CLI surface: conflicts list/show and status. Seeds
 * corpus.json + decisions.json directly (no LLM, no re-scan) and asserts the
 * open-vs-resolved accounting (verdict/exclude only — a legacy doc→doc relation
 * never resolves a conflict).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSpecConflictsList, runSpecConflictsShow } from '../../tools/cli/src/commands/spec-conflicts.js';
import { runSpecStatus } from '../../tools/cli/src/commands/spec.js';

let repo: string;
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

/** Run a command, capturing everything it writes to stdout (clack output). */
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

function writeCorpus(overlaps: Array<{ docs: [string, string]; note: string }>): void {
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
        overlaps,
      },
    ],
    relations: [],
  };
  fs.writeFileSync(path.join(repo, '.truecourse', 'specs', 'corpus.json'), JSON.stringify(corpus));
}

function writeDecisions(relations: unknown[]): void {
  const decisions = { version: 1, decisions: [], manualChains: [], manualIncludes: [], relations, manualAreas: [] };
  fs.writeFileSync(path.join(repo, '.truecourse', 'specs', 'decisions.json'), JSON.stringify(decisions));
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-spec-cli-'));
  fs.mkdirSync(path.join(repo, '.truecourse', 'specs'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'v1.md'), '# Booking v1\nCancellation allowed up to 24h before.');
  fs.writeFileSync(path.join(repo, 'docs', 'v2.md'), '# Booking v2\nCancellation allowed up to 48h before.');
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('spec conflicts list (corpus)', () => {
  it('reports an unresolved overlap as open', async () => {
    writeCorpus([{ docs: ['docs/v1.md', 'docs/v2.md'], note: '24h vs 48h cancellation' }]);
    const out = await capture(() => runSpecConflictsList({ cwd: repo }));
    expect(out).toContain('booking/appointments');
    expect(out).toContain('1 open');
    expect(out).toContain('0 resolved');
  });

  it('counts an overlap covered by a scoped relation as still OPEN — relations never resolve', async () => {
    writeCorpus([{ docs: ['docs/v1.md', 'docs/v2.md'], note: '24h vs 48h cancellation' }]);
    writeDecisions([
      { type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments', detectedFrom: 'manual' },
    ]);
    const out = await capture(() => runSpecConflictsList({ cwd: repo }));
    expect(out).toContain('1 open');
    expect(out).toContain('0 resolved');
  });
});

describe('spec conflicts show (corpus)', () => {
  it('prints prose excerpts for the area overlap', async () => {
    writeCorpus([{ docs: ['docs/v1.md', 'docs/v2.md'], note: 'cancellation window' }]);
    const out = await capture(() => runSpecConflictsShow('booking/appointments', { cwd: repo }));
    expect(out).toContain('docs/v1.md');
    expect(out).toContain('24h');
    expect(out).toContain('48h');
  });
});

describe('spec status (corpus)', () => {
  it('summarizes docs, areas, and open vs resolved overlaps', async () => {
    writeCorpus([{ docs: ['docs/v1.md', 'docs/v2.md'], note: '24h vs 48h' }]);
    const out = await capture(() => runSpecStatus({ cwd: repo }));
    expect(out).toContain('Areas');
    expect(out).toContain('booking/appointments');
    expect(out).toContain('1 open');
  });

  it('points a conflict-free corpus at `guard generate`, never `contracts generate`', async () => {
    writeCorpus([]);
    const out = await capture(() => runSpecStatus({ cwd: repo }));
    expect(out).toContain('truecourse guard generate');
    expect(out).not.toContain('contracts generate');
  });

  it('points a corpus with open overlaps at `spec conflicts list`', async () => {
    writeCorpus([{ docs: ['docs/v1.md', 'docs/v2.md'], note: '24h vs 48h' }]);
    const out = await capture(() => runSpecStatus({ cwd: repo }));
    expect(out).toContain('truecourse spec conflicts list');
    expect(out).not.toContain('contracts generate');
  });
});

describe('spec status --json', () => {
  it('emits the corpus summary as raw JSON', async () => {
    writeCorpus([{ docs: ['docs/v1.md', 'docs/v2.md'], note: '24h vs 48h' }]);
    const out = await capture(() => runSpecStatus({ cwd: repo, json: true }));
    const j = JSON.parse(out);
    expect(j.hasCorpus).toBe(true);
    expect(j.docs).toBe(2);
    expect(j.areas).toBe(1);
    expect(j.overlaps).toEqual({ open: 1, resolved: 0 });
    expect(j.areaList).toEqual([{ id: 'booking/appointments', docs: 2, overlaps: 1 }]);
    expect(j.orphaned).toEqual([]);
  });

  it('reports hasCorpus:false (exit 0) when no corpus exists', async () => {
    const out = await capture(() => runSpecStatus({ cwd: repo, json: true }));
    expect(JSON.parse(out)).toMatchObject({ hasCorpus: false, docs: 0, areas: 0 });
  });
});

// The scan outro is emitted from runSpecScan, which requires a live LLM pipeline
// + git repo to reach — assert its two known branches at the source, and that no
// user-facing next-step in the scan/spec flow still names `contracts generate`.
describe('spec scan outro points at guard generate, never at contracts generate', () => {
  const specSrc = fs.readFileSync(
    fileURLToPath(new URL('../../tools/cli/src/commands/spec.ts', import.meta.url)),
    'utf-8',
  );
  // The deep link's SHAPE lives in one place for every agentic command, so the
  // `?tab=activity` literal is asserted there rather than at each caller.
  const helpersSrc = fs.readFileSync(
    fileURLToPath(new URL('../../tools/cli/src/commands/helpers.ts', import.meta.url)),
    'utf-8',
  );

  it('conflict-free scan points at `truecourse guard generate`', () => {
    expect(specSrc).toContain('Corpus written to .truecourse/specs/corpus.json. Run `truecourse guard generate`.');
  });

  it('a scan with open conflicts points at `spec conflicts list`, then `guard generate`', () => {
    expect(specSrc).toContain('conflict');
    expect(specSrc).toContain('`truecourse spec conflicts list`');
    expect(specSrc).toContain('`truecourse guard generate`');
  });

  it('no user-facing next-step in the scan/spec flow names `contracts generate`', () => {
    expect(specSrc).not.toContain('contracts generate');
  });

  // §3.7 / plan 02 step 6: the scope orchestrator is interactive, but a CLI run
  // never blocks on a question. Both the live `onQuestion` line and the closing
  // summary must point at the dashboard deep link, or an unanswered question
  // silently becomes a default nobody sees.
  it('a live scan question prints the dashboard deep link, without blocking', () => {
    expect(helpersSrc).toContain('?tab=activity');
    expect(specSrc).toContain('Scan question:');
    expect(specSrc).toContain('Answer it in the dashboard: ${activityLink()}');
  });

  it('unanswered questions get a LOUD closing block naming the deep link', () => {
    expect(specSrc).toContain('pendingQuestions.length > 0');
    expect(specSrc).toContain('went unanswered — the scan proceeded on defaults');
    expect(specSrc).toContain('Answer them in the dashboard (${activityLink()})');
  });

  // The moment the run record exists, before any session — the §3.6 line that
  // makes a CLI run watchable from the dashboard.
  it('prints the "watch live" deep link as soon as the run record exists', () => {
    expect(specSrc).toContain('onRunStarted:');
    expect(specSrc).toContain('printWatchLive(dashboardUrl, project.slug, info.runId)');
    expect(helpersSrc).toContain('Watch live: ${activityUrl(dashboardUrl, slug, runId)}');
  });

  it('the orchestrator\'s findings are surfaced in the summary', () => {
    expect(specSrc).toContain('scanFindings.length > 0');
    expect(specSrc).toContain('Scan findings (from the scope orchestrator)');
  });
});
