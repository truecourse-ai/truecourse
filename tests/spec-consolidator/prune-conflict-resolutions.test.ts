/**
 * `pruneOrphanedConflictResolutions` deletes ONLY resolutions whose docs left
 * the corpus. It must NEVER delete a row just because the fresh scan didn't
 * re-flag its dispute — the overlap session is a stochastic judge (~50–60%
 * pair recall) and re-excerpts quotes on every scan, so "matches no current
 * flag" is not staleness. (The 2026-08-20 reference runs lost 16 of 20
 * code-verified user verdicts to the old flag-matching prune.)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneOrphanedConflictResolutions } from '../../packages/spec-consolidator/src/curate.js';
import { decisionsPath } from '../../packages/spec-consolidator/src/orchestrator.js';
import type { ConflictResolution, DecisionsFile } from '../../packages/spec-consolidator/src/types.js';
import type { CuratedCorpus } from '../../packages/spec-consolidator/src/corpus-types.js';

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-prune-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

const doc = (ref: string) => ({ ref, kind: 'unknown' as const, lastTouched: '2026-08-20T00:00:00Z' });

/** Corpus holding docs A+B with ONE flagged dispute between them (quoted). */
function corpusWith(overlapQuoteA: string): CuratedCorpus {
  return {
    version: 3,
    generatedAt: '2026-08-20T00:00:00Z',
    docs: [doc('docs/a.md'), doc('docs/b.md')],
    areas: [
      {
        id: 'core/x',
        product: 'core',
        concern: 'x',
        docRefs: ['docs/a.md', 'docs/b.md'],
        overlaps: [
          {
            docs: ['docs/a.md', 'docs/b.md'],
            note: 'disagree',
            sections: [
              { doc: 'docs/a.md', heading: 'A', quote: overlapQuoteA },
              { doc: 'docs/b.md', heading: 'B', quote: 'b says otherwise' },
            ],
          },
        ],
      },
    ],
    skippedDocs: [],
  } as CuratedCorpus;
}

const resolution = (over: Partial<ConflictResolution> = {}): ConflictResolution => ({
  docA: 'docs/a.md',
  anchorA: 'A',
  quoteA: 'a says this',
  docB: 'docs/b.md',
  anchorB: 'B',
  quoteB: 'b says otherwise',
  verdict: 'a',
  resolvedAt: '2026-08-14T00:00:00Z',
  note: 'code-verified',
  ...over,
});

const written = (): DecisionsFile => JSON.parse(fs.readFileSync(decisionsPath(repo), 'utf8'));

describe('pruneOrphanedConflictResolutions', () => {
  it('KEEPS a resolution whose quotes drifted (pair re-flagged with new excerpts)', () => {
    const r = resolution();
    const decisions: DecisionsFile = { version: 2, conflictResolutions: [r] };
    // Fresh flag quotes a DIFFERENT sentence — the old flag-matching identity
    // would have called this orphaned.
    const out = pruneOrphanedConflictResolutions(repo, corpusWith('a says this, reworded'), decisions);
    expect(out.conflictResolutions).toEqual([r]);
    expect(out).toBe(decisions); // untouched → same object, nothing written
    expect(fs.existsSync(decisionsPath(repo))).toBe(false);
  });

  it('KEEPS a resolution whose pair the fresh scan did not re-flag at all', () => {
    const corpus = corpusWith('a says this');
    corpus.areas[0].overlaps = []; // recall miss — no flag this run
    const r = resolution();
    const out = pruneOrphanedConflictResolutions(repo, corpus, { version: 2, conflictResolutions: [r] });
    expect(out.conflictResolutions).toEqual([r]);
  });

  it('DELETES a resolution naming a doc that left the corpus, and writes the file', () => {
    const keep = resolution();
    const stale = resolution({ docB: 'docs/gone.md' });
    const out = pruneOrphanedConflictResolutions(repo, corpusWith('a says this'), {
      version: 2,
      conflictResolutions: [keep, stale],
    });
    expect(out.conflictResolutions).toEqual([keep]);
    expect(written().conflictResolutions).toHaveLength(1);
  });

  it('no resolutions → decisions returned untouched', () => {
    const decisions: DecisionsFile = { version: 2 };
    expect(pruneOrphanedConflictResolutions(repo, corpusWith('a says this'), decisions)).toBe(decisions);
  });
});
