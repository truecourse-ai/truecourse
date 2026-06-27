/**
 * corpus-reader builds the per-area generation inputs: it applies the effective
 * doc→doc relations (replace drops the older doc, precedence orders newer first),
 * excludes the process bucket and now-empty areas, and resolves DocRefs to
 * content. All in-memory — no disk, no LLM.
 */
import { describe, it, expect } from 'vitest';
import { readCorpusForGenerate } from '../../packages/contract-extractor/src/index.js';
import type {
  CuratedCorpus,
  CorpusDoc,
  Area,
  Relation,
  DecisionsFile,
} from '../../packages/spec-consolidator/src/index.js';

function doc(ref: string, lastTouched: string, areaTags: string[]): CorpusDoc {
  return { ref, kind: 'prd', status: 'shipped', lastTouched, areaTags };
}
function area(id: string, docRefs: string[]): Area {
  const slash = id.indexOf('/');
  return { id, product: id.slice(0, slash), concern: id.slice(slash + 1), docRefs, overlaps: [] };
}
function corpus(docs: CorpusDoc[], areas: Area[], relations: Relation[] = []): CuratedCorpus {
  return { version: 3, generatedAt: '2026-06-26T00:00:00Z', docs, areas, relations };
}

const decisions: DecisionsFile = {
  version: 1,
  decisions: [],
  manualChains: [],
  manualIncludes: [],
  relations: [],
  manualAreas: [],
};

// In-memory content resolver — every ref maps to a trivial body.
const resolveContent = (ref: string) => `# ${ref}\nbody of ${ref}`;

describe('readCorpusForGenerate', () => {
  it('drops the older doc of a replace relation', () => {
    const c = corpus(
      [doc('v1.md', '2026-01-01T00:00:00Z', ['core/users-entity']), doc('v2.md', '2026-02-01T00:00:00Z', ['core/users-entity'])],
      [area('core/users-entity', ['v1.md', 'v2.md'])],
      [{ type: 'replace', older: 'v1.md', newer: 'v2.md', detectedFrom: 'filename' }],
    );
    const out = readCorpusForGenerate('/repo', { corpus: c, decisions, resolveContent });
    expect(out).toHaveLength(1);
    expect(out[0].docs.map((d) => d.ref)).toEqual(['v2.md']);
  });

  it('orders docs newest-first by default', () => {
    const c = corpus(
      [doc('old.md', '2026-01-01T00:00:00Z', ['core/auth']), doc('new.md', '2026-03-01T00:00:00Z', ['core/auth'])],
      [area('core/auth', ['old.md', 'new.md'])],
    );
    const out = readCorpusForGenerate('/repo', { corpus: c, decisions, resolveContent });
    expect(out[0].docs.map((d) => d.ref)).toEqual(['new.md', 'old.md']);
  });

  it('a precedence relation forces the newer doc above the older regardless of mtime', () => {
    const c = corpus(
      // a.md is OLDER by mtime, but a precedence relation says a refines b.
      [doc('a.md', '2026-01-01T00:00:00Z', ['core/auth']), doc('b.md', '2026-03-01T00:00:00Z', ['core/auth'])],
      [area('core/auth', ['a.md', 'b.md'])],
      [{ type: 'precedence', older: 'b.md', newer: 'a.md', scope: 'core/auth' }],
    );
    const out = readCorpusForGenerate('/repo', { corpus: c, decisions, resolveContent });
    expect(out[0].docs.map((d) => d.ref)).toEqual(['a.md', 'b.md']);
  });

  it('honors relation scope — a scoped replace only drops in its own area', () => {
    const c = corpus(
      [doc('v1.md', '2026-01-01T00:00:00Z', ['core/users-entity', 'core/auth']), doc('v2.md', '2026-02-01T00:00:00Z', ['core/users-entity', 'core/auth'])],
      [area('core/users-entity', ['v1.md', 'v2.md']), area('core/auth', ['v1.md', 'v2.md'])],
      [{ type: 'replace', older: 'v1.md', newer: 'v2.md', scope: 'core/users-entity' }],
    );
    const out = readCorpusForGenerate('/repo', { corpus: c, decisions, resolveContent });
    const users = out.find((a) => a.areaId === 'core/users-entity')!;
    const auth = out.find((a) => a.areaId === 'core/auth')!;
    expect(users.docs.map((d) => d.ref)).toEqual(['v2.md']); // dropped here
    expect(auth.docs.map((d) => d.ref).sort()).toEqual(['v1.md', 'v2.md']); // kept here
  });

  it('excludes process-bucket areas by default but includes them on request', () => {
    const c = corpus(
      [doc('overview.md', '2026-01-01T00:00:00Z', ['process/overview'])],
      [area('process/overview', ['overview.md'])],
    );
    expect(readCorpusForGenerate('/repo', { corpus: c, decisions, resolveContent })).toHaveLength(0);
    expect(
      readCorpusForGenerate('/repo', { corpus: c, decisions, resolveContent, includeProcess: true }),
    ).toHaveLength(1);
  });

  it('skips docs whose ref does not resolve, and drops an area left empty', () => {
    const c = corpus(
      [doc('gone.md', '2026-01-01T00:00:00Z', ['core/auth'])],
      [area('core/auth', ['gone.md'])],
    );
    const out = readCorpusForGenerate('/repo', { corpus: c, decisions, resolveContent: () => null });
    expect(out).toHaveLength(0);
  });

  it('topologically orders precedence — honors an edge a net-degree score would invert', () => {
    // Edges X>B, Y>B, Z>B, B>C. A scalar net-degree would put C above B; a real
    // topological sort keeps B above C.
    const refs = ['x.md', 'y.md', 'z.md', 'b.md', 'c.md'];
    const c = corpus(
      refs.map((r) => doc(r, '2026-01-01T00:00:00Z', ['core/x'])),
      [area('core/x', refs)],
      [
        { type: 'precedence', older: 'b.md', newer: 'x.md' },
        { type: 'precedence', older: 'b.md', newer: 'y.md' },
        { type: 'precedence', older: 'b.md', newer: 'z.md' },
        { type: 'precedence', older: 'c.md', newer: 'b.md' },
      ],
    );
    const order = readCorpusForGenerate('/repo', { corpus: c, decisions, resolveContent })[0].docs.map((d) => d.ref);
    expect(order.indexOf('b.md')).toBeLessThan(order.indexOf('c.md'));
  });

  it('does not drop an area-local doc when the replace newer lives in another area (no silent emptying)', () => {
    const c = corpus(
      [doc('old.md', '2026-01-01T00:00:00Z', ['core/users-entity']), doc('new.md', '2026-02-01T00:00:00Z', ['other/thing'])],
      [area('core/users-entity', ['old.md']), area('other/thing', ['new.md'])],
      // Global replace, but `new.md` is NOT in core/users-entity → must not empty it.
      [{ type: 'replace', older: 'old.md', newer: 'new.md' }],
    );
    const out = readCorpusForGenerate('/repo', { corpus: c, decisions, resolveContent });
    const users = out.find((a) => a.areaId === 'core/users-entity');
    expect(users).toBeDefined();
    expect(users!.docs.map((d) => d.ref)).toEqual(['old.md']);
  });

  it('reads user relations from decisions, not just the corpus', () => {
    const c = corpus(
      [doc('v1.md', '2026-01-01T00:00:00Z', ['core/users-entity']), doc('v2.md', '2026-02-01T00:00:00Z', ['core/users-entity'])],
      [area('core/users-entity', ['v1.md', 'v2.md'])],
      [],
    );
    const withUserRel: DecisionsFile = {
      ...decisions,
      relations: [{ type: 'replace', older: 'v1.md', newer: 'v2.md' }],
    };
    const out = readCorpusForGenerate('/repo', { corpus: c, decisions: withUserRel, resolveContent });
    expect(out[0].docs.map((d) => d.ref)).toEqual(['v2.md']);
  });
});
