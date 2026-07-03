import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { setRepoDocReader } from '../../packages/core/src/lib/repo-doc-reader';
import { buildStoredDocSource } from '../../packages/core/src/commands/spec-in-process';
import type { CuratedCorpus, DecisionsFile } from '@truecourse/spec-consolidator';

/**
 * The EE include/exclude re-curate runs the same `curate` OSS runs, but sources
 * docs from the store instead of the filesystem. `buildStoredDocSource` is that
 * transport: it takes the corpus's own known docs (+ decision toggles) and fetches
 * each body through the repo-doc seam, producing `DocCandidate`s whose `contentHash`
 * matches `discoverDocs` (`sha256` of the utf-8 body) so the per-doc caches HIT.
 */
describe('buildStoredDocSource (EE re-curate doc transport)', () => {
  it('sources the corpus doc set via readRepoDoc, with cache-matching content hashes', async () => {
    const bodies: Record<string, string | null> = {
      'docs/a.md': '# A\nalpha',
      'docs/b.md': '# B\nbeta',
      'docs/skipped.md': '# S\nskipped',
      'docs/excluded.md': '# X\nexcluded',
      'docs/gone.md': null, // deleted upstream → dropped from the set
    };
    setRepoDocReader(async (_repoKey, docPath) => bodies[docPath] ?? null);

    const corpus = {
      version: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      docs: [
        { ref: 'docs/a.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['x'] },
        { ref: 'docs/b.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['x'] },
      ],
      areas: [],
      relations: [],
      skippedDocs: [{ ref: 'docs/skipped.md', reason: 'low relevance' }],
    } as unknown as CuratedCorpus;
    const decisions = {
      version: 1,
      relations: [],
      manualAreas: [],
      manualIncludes: ['docs/gone.md'],
      manualExcludes: ['docs/excluded.md'],
    } as unknown as DecisionsFile;

    const docs = await buildStoredDocSource('owner/repo', corpus, decisions)();
    const byPath = new Map(docs.map((d) => [d.path, d]));

    // Union of kept + skipped + decision toggles; the null (deleted) doc is dropped.
    expect([...byPath.keys()].sort()).toEqual([
      'docs/a.md',
      'docs/b.md',
      'docs/excluded.md',
      'docs/skipped.md',
    ]);

    const a = byPath.get('docs/a.md')!;
    expect(a.content).toBe(bodies['docs/a.md']);
    // Hash matches discoverDocs so the area-tag/relevance caches hit (restore is free).
    expect(a.contentHash).toBe(
      createHash('sha256').update(bodies['docs/a.md'] as string).digest('hex'),
    );
    // In-memory body ⇒ stages never touch the filesystem.
    expect(a.absPath).toBe('');
    // lastTouched carried over from the corpus where known.
    expect(byPath.get('docs/b.md')!.lastTouched).toBe('2026-02-01T00:00:00Z');
  });
});
