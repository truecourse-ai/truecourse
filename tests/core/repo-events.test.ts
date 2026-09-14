import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  pickLatestEvent,
  resolveLatestEvent,
  type LatestEventKind,
} from '../../packages/core/src/commands/repo-events';
import { saveSpec, setSpecStore, resetSpecStore } from '../../packages/core/src/lib/spec-store';
import { memorySpecStore } from '../helpers/memory-spec-store';
import { installWorkTreeGuardStore, resetGuardStore } from '../helpers/work-tree-guard-store';
import type { GuardGenerateReport, GuardLatest } from '../../packages/shared/src/index';

// Distinct timestamps, oldest → newest, so "newest wins" is unambiguous.
const AT: Record<LatestEventKind, string> = {
  scanned: '2026-07-02T00:00:00.000Z',
  generated: '2026-07-05T00:00:00.000Z',
  guarded: '2026-07-06T00:00:00.000Z', // newest of all
};

const ALL_KINDS: LatestEventKind[] = ['scanned', 'generated', 'guarded'];

function guardLatest(ranAt: string): GuardLatest {
  return {
    run: { runId: 'r1', ranAt, branch: 'main', commit: 'abc', recipeFingerprint: 'sha256:r', scenarioFormat: 2 },
    summary: { total: 0, pass: 0, fail: 0, stale: 0, orphaned: 0, error: 0 },
    scenarios: [],
    sections: [],
  };
}

function guardReport(generatedAt: string): GuardGenerateReport {
  return {
    generatedAt,
    status: 'ok',
    sectionsTotal: 0,
    sectionsChanged: 0,
    skippedUnchanged: 0,
    noChanges: true,
    written: [],
    coverageGaps: [],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
  };
}

/** Write `obj` (or a raw string) to `<repo>/.truecourse/<rel>`. */
function seedRaw(repo: string, rel: string, content: string): void {
  const file = path.join(repo, '.truecourse', rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function seed(repo: string, rel: string, obj: unknown): void {
  seedRaw(repo, rel, JSON.stringify(obj, null, 2));
}

/** Seed exactly one lifecycle source, stamped at `at`, through its own store. */
async function seedSource(repo: string, kind: LatestEventKind, at: string): Promise<void> {
  switch (kind) {
    case 'scanned':
      return saveSpec({ repoKey: repo, commitSha: 'c1' }, 'corpus', { version: 3, generatedAt: at });
    case 'generated':
      return seed(repo, 'guard/result.json', guardReport(at));
    case 'guarded':
      return seed(repo, 'guard/LATEST.json', guardLatest(at));
  }
}

describe('pickLatestEvent (newest-wins, pure)', () => {
  it('picks the newest valid-timestamped candidate', () => {
    const event = pickLatestEvent([
      { kind: 'generated', at: AT.generated },
      { kind: 'guarded', at: AT.guarded },
      { kind: 'scanned', at: AT.scanned },
    ]);
    expect(event).toEqual({ kind: 'guarded', at: AT.guarded });
  });

  it('ignores candidates with a missing or unparseable timestamp', () => {
    const event = pickLatestEvent([
      { kind: 'guarded', at: null },
      { kind: 'generated', at: '' },
      { kind: 'scanned', at: 'not-a-date' },
      { kind: 'generated', at: AT.generated },
    ]);
    expect(event).toEqual({ kind: 'generated', at: AT.generated });
  });

  it('returns null when nothing is valid', () => {
    expect(pickLatestEvent([{ kind: 'scanned', at: 'x' }])).toBeNull();
    expect(pickLatestEvent([])).toBeNull();
  });

  it('breaks exact ties by candidate order (first wins)', () => {
    const same = '2026-07-07T12:00:00.000Z';
    const event = pickLatestEvent([
      { kind: 'scanned', at: same },
      { kind: 'guarded', at: same },
    ]);
    expect(event).toEqual({ kind: 'scanned', at: same });
  });
});

describe('resolveLatestEvent (per-repo store composition)', () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-repo-events-'));
    fs.mkdirSync(path.join(repo, '.truecourse'), { recursive: true });
    setSpecStore(memorySpecStore());
    installWorkTreeGuardStore();
  });

  afterEach(() => {
    resetSpecStore();
    resetGuardStore();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it.each(ALL_KINDS)('maps a lone %s source to its kind + timestamp', async (kind) => {
    await seedSource(repo, kind, AT[kind]);
    await expect(resolveLatestEvent(repo)).resolves.toEqual({ kind, at: AT[kind] });
  });

  it('returns the newest event when every source is present', async () => {
    for (const kind of ALL_KINDS) await seedSource(repo, kind, AT[kind]);
    // guarded is newest.
    await expect(resolveLatestEvent(repo)).resolves.toEqual({ kind: 'guarded', at: AT.guarded });
  });

  it('returns the newest among the present subset', async () => {
    await seedSource(repo, 'scanned', AT.scanned);
    await seedSource(repo, 'generated', AT.generated);
    await expect(resolveLatestEvent(repo)).resolves.toEqual({ kind: 'generated', at: AT.generated });
  });

  it('skips an unreadable source and still resolves from the rest', async () => {
    // A garbage guard LATEST (newest kind) must not win, nor throw.
    seedRaw(repo, 'guard/LATEST.json', '{ not json');
    await seedSource(repo, 'scanned', AT.scanned);
    await expect(resolveLatestEvent(repo)).resolves.toEqual({ kind: 'scanned', at: AT.scanned });
  });

  it('skips a source whose store throws, and still resolves from the rest', async () => {
    const store = memorySpecStore();
    setSpecStore({
      ...store,
      loadLatest: async () => {
        throw new Error('store is down');
      },
    });
    await seedSource(repo, 'generated', AT.generated);
    await expect(resolveLatestEvent(repo)).resolves.toEqual({ kind: 'generated', at: AT.generated });
  });

  it('returns null when no store has a timestamp', async () => {
    await expect(resolveLatestEvent(repo)).resolves.toBeNull();
  });

  it('tolerates an unreadable / nonexistent repo path (never throws)', async () => {
    const gone = path.join(repo, 'does', 'not', 'exist');
    await expect(resolveLatestEvent(gone)).resolves.toBeNull();
  });
});
