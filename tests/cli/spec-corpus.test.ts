/**
 * The corpus-path `spec` CLI surface (Phase 4): the read-only commands resolve
 * flagged within-area overlaps into doc→doc relations. Seeds corpus.json +
 * decisions.json directly (no LLM, no re-scan) and asserts the open-vs-resolved
 * accounting + relation listing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSpecConflictsList, runSpecConflictsShow } from '../../tools/cli/src/commands/spec-conflicts.js';
import { runSpecChainsList } from '../../tools/cli/src/commands/spec-chains.js';
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

  it('counts an overlap covered by a scoped relation as resolved', async () => {
    writeCorpus([{ docs: ['docs/v1.md', 'docs/v2.md'], note: '24h vs 48h cancellation' }]);
    writeDecisions([
      { type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments', detectedFrom: 'manual' },
    ]);
    const out = await capture(() => runSpecConflictsList({ cwd: repo }));
    expect(out).toContain('0 open');
    expect(out).toContain('1 resolved');
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

describe('spec chains list (corpus relations)', () => {
  it('lists user-authored relations', async () => {
    writeCorpus([]);
    writeDecisions([
      { type: 'replace', older: 'docs/v1.md', newer: 'docs/v2.md', detectedFrom: 'manual', note: 'superseded' },
    ]);
    const out = await capture(() => runSpecChainsList({ cwd: repo }));
    expect(out).toContain('replace');
    expect(out).toContain('docs/v1.md');
    expect(out).toContain('docs/v2.md');
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
});
