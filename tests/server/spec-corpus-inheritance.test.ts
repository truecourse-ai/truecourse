/**
 * Repo corpus GET — workspace-layer enrichment (server side). A connected repo folds
 * its workspace Knowledge corpus into its own spec, so corpus docs whose ref starts
 * `knowledge/` are inherited: the route tags them `layer: 'workspace'` and, through
 * the ledger-reader seam, attaches the source title + deep-link. Repo-local docs are
 * untouched; OSS (in-place store, no seam) is fully inert.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { enrichWorkspaceLayer } from '../../apps/dashboard/server/src/routes/spec';
import {
  setSpecStore,
  resetSpecStore,
  type SpecStore,
} from '@truecourse/core/lib/spec-store';
import {
  setKnowledgeLedgerReader,
  type KnowledgeDocMeta,
} from '@truecourse/core/lib/knowledge-ledger-reader';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';

/** A hosted (stored, not in-place) spec store — flips `specsMaterializeInPlace()` off.
 *  Only `materializesInPlace` is read by the enrichment; the rest never runs. */
const hostedStore = { materializesInPlace: false } as unknown as SpecStore;

function corpusFixture(): CuratedCorpus {
  return {
    version: 3,
    generatedAt: '2026-07-14T00:00:00.000Z',
    docs: [
      { ref: 'docs/adr-001.md', kind: 'adr', lastTouched: '2026-07-01T00:00:00.000Z', areaTags: ['product/auth'] },
      {
        ref: 'knowledge/confluence/KAN-5.md',
        kind: 'spec',
        lastTouched: '2026-07-02T00:00:00.000Z',
        areaTags: ['product/auth'],
      },
    ],
    areas: [
      { id: 'product/auth', product: 'product', concern: 'auth', docRefs: ['docs/adr-001.md', 'knowledge/confluence/KAN-5.md'], overlaps: [] },
    ],
    relations: [],
    skippedDocs: [],
  };
}

afterEach(() => {
  resetSpecStore();
  setKnowledgeLedgerReader(null);
});

type EnrichedDoc = CuratedCorpus['docs'][number] & {
  layer?: 'workspace';
  title?: string;
  url?: string | null;
};

describe('enrichWorkspaceLayer', () => {
  it('OSS (in-place store) is inert — no layer, no title, even on a knowledge/ ref', async () => {
    // Default FileSpecStore materializes in place → OSS. No seam installed.
    const out = await enrichWorkspaceLayer('acme/api', corpusFixture());
    const docs = out!.docs as EnrichedDoc[];
    expect(docs.every((d) => d.layer === undefined && d.title === undefined)).toBe(true);
    // Returned object is the input untouched.
    expect(out).toEqual(corpusFixture());
  });

  it('hosted: knowledge/ docs get layer=workspace + ledger title/url; repo-local docs untouched', async () => {
    setSpecStore(hostedStore);
    const seen: string[][] = [];
    setKnowledgeLedgerReader(async (repoKey, docPaths) => {
      seen.push([repoKey, ...docPaths]);
      const map = new Map<string, KnowledgeDocMeta>();
      map.set('knowledge/confluence/KAN-5.md', { title: 'Auth spec (KAN-5)', url: 'https://x/KAN-5' });
      return map;
    });

    const out = await enrichWorkspaceLayer('acme/api', corpusFixture());
    const docs = out!.docs as EnrichedDoc[];
    const repoLocal = docs.find((d) => d.ref === 'docs/adr-001.md')!;
    const inherited = docs.find((d) => d.ref === 'knowledge/confluence/KAN-5.md')!;

    expect(repoLocal.layer).toBeUndefined();
    expect(repoLocal.title).toBeUndefined();
    expect(inherited.layer).toBe('workspace');
    expect(inherited.title).toBe('Auth spec (KAN-5)');
    expect(inherited.url).toBe('https://x/KAN-5');
    // The seam was queried once, with only the inherited refs.
    expect(seen).toEqual([['acme/api', 'knowledge/confluence/KAN-5.md']]);
  });

  it('hosted with no seam installed: layer=workspace but no title/url', async () => {
    setSpecStore(hostedStore);
    setKnowledgeLedgerReader(null);

    const out = await enrichWorkspaceLayer('acme/api', corpusFixture());
    const inherited = (out!.docs as EnrichedDoc[]).find((d) => d.ref === 'knowledge/confluence/KAN-5.md')!;
    expect(inherited.layer).toBe('workspace');
    expect(inherited.title).toBeUndefined();
    expect(inherited.url).toBeUndefined();
  });

  it('hosted: a knowledge/ ref with no live ledger row gets the layer but no title (falls back to ref)', async () => {
    setSpecStore(hostedStore);
    setKnowledgeLedgerReader(async () => new Map()); // ledger pruned this ref

    const out = await enrichWorkspaceLayer('acme/api', corpusFixture());
    const inherited = (out!.docs as EnrichedDoc[]).find((d) => d.ref === 'knowledge/confluence/KAN-5.md')!;
    expect(inherited.layer).toBe('workspace');
    expect(inherited.title).toBeUndefined();
  });

  it('a null corpus passes through', async () => {
    setSpecStore(hostedStore);
    expect(await enrichWorkspaceLayer('acme/api', null)).toBeNull();
  });
});
