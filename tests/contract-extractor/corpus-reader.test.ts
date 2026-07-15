/**
 * corpus-reader builds the per-area generation inputs: docs ordered newest-first,
 * the process bucket and now-empty areas excluded, and DocRefs resolved to
 * content. All in-memory — no disk, no LLM.
 */
import { describe, it, expect } from 'vitest';
import { readCorpusForGenerate } from '../../packages/contract-extractor/src/index.js';
import type { CuratedCorpus, CorpusDoc, Area } from '../../packages/spec-consolidator/src/index.js';

function doc(ref: string, lastTouched: string, areaTags: string[]): CorpusDoc {
  return { ref, kind: 'prd', status: 'shipped', lastTouched, areaTags };
}
function area(id: string, docRefs: string[]): Area {
  const slash = id.indexOf('/');
  return { id, product: id.slice(0, slash), concern: id.slice(slash + 1), docRefs, overlaps: [] };
}
function corpus(docs: CorpusDoc[], areas: Area[]): CuratedCorpus {
  return { version: 3, generatedAt: '2026-06-26T00:00:00Z', docs, areas, skippedDocs: [] };
}

// In-memory content resolver — every ref maps to a trivial body.
const resolveContent = (ref: string) => `# ${ref}\nbody of ${ref}`;

describe('readCorpusForGenerate', () => {
  it('orders docs newest-first', () => {
    const c = corpus(
      [doc('old.md', '2026-01-01T00:00:00Z', ['core/auth']), doc('new.md', '2026-03-01T00:00:00Z', ['core/auth'])],
      [area('core/auth', ['old.md', 'new.md'])],
    );
    const out = readCorpusForGenerate('/repo', { corpus: c, resolveContent });
    expect(out[0].docs.map((d) => d.ref)).toEqual(['new.md', 'old.md']);
  });

  it('breaks a lastTouched tie by ref, ascending', () => {
    const c = corpus(
      [doc('b.md', '2026-01-01T00:00:00Z', ['core/auth']), doc('a.md', '2026-01-01T00:00:00Z', ['core/auth'])],
      [area('core/auth', ['b.md', 'a.md'])],
    );
    const out = readCorpusForGenerate('/repo', { corpus: c, resolveContent });
    expect(out[0].docs.map((d) => d.ref)).toEqual(['a.md', 'b.md']);
  });

  it('a corpus JSON carrying an unrecognized relations field reads like any other', () => {
    const raw = {
      ...corpus(
        [doc('v1.md', '2026-01-01T00:00:00Z', ['core/users-entity']), doc('v2.md', '2026-02-01T00:00:00Z', ['core/users-entity'])],
        [area('core/users-entity', ['v1.md', 'v2.md'])],
      ),
      relations: [{ type: 'replace', older: 'v1.md', newer: 'v2.md', detectedFrom: 'filename' }],
    } as unknown as CuratedCorpus;
    const out = readCorpusForGenerate('/repo', { corpus: raw, resolveContent });
    // Nothing is dropped or reordered by the unrecognized field — both docs
    // generate, newest first.
    expect(out[0].docs.map((d) => d.ref)).toEqual(['v2.md', 'v1.md']);
  });

  it('excludes process-bucket areas by default but includes them on request', () => {
    const c = corpus(
      [doc('overview.md', '2026-01-01T00:00:00Z', ['process/overview'])],
      [area('process/overview', ['overview.md'])],
    );
    expect(readCorpusForGenerate('/repo', { corpus: c, resolveContent })).toHaveLength(0);
    expect(readCorpusForGenerate('/repo', { corpus: c, resolveContent, includeProcess: true })).toHaveLength(1);
  });

  it('skips docs whose ref does not resolve, and drops an area left empty', () => {
    const c = corpus(
      [doc('gone.md', '2026-01-01T00:00:00Z', ['core/auth'])],
      [area('core/auth', ['gone.md'])],
    );
    const out = readCorpusForGenerate('/repo', { corpus: c, resolveContent: () => null });
    expect(out).toHaveLength(0);
  });
});
