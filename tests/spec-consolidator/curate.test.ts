/**
 * End-to-end curate(): discover → relevance keep/drop → area-tag → group →
 * overlap-flag → assemble + persist corpus.json. All LLM stages are stubbed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { planDocChunks } from '@truecourse/shared';
import { curate, readCorpus, writeCorpus, CuratedCorpusSchema, OVERLAP_WINDOW_CHARS } from '../../packages/spec-consolidator/src/index.js';
import type {
  AreaTagRunner,
  DecisionsFile,
  DocCandidate,
  OverlapRunner,
  RelevanceRunner,
  VerifyOverlapRunner,
} from '../../packages/spec-consolidator/src/index.js';

function doc(p: string, content = `body of ${p}`): DocCandidate {
  return {
    path: p,
    absPath: '',
    content,
    kind: 'prd',
    preview: content.split('\n').slice(0, 5).join('\n'),
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}`,
    size: content.length,
  };
}

const DOCS = [
  doc('docs/users-v1.md'),
  doc('docs/users-v2.md'),
  doc('docs/auth.md'),
  doc('notes/scratch.md'),
];

// Skip the scratch note; keep the rest.
const relevance: RelevanceRunner = async ({ doc }) => ({
  path: doc.path,
  include: doc.path !== 'notes/scratch.md',
  reason: doc.path === 'notes/scratch.md' ? 'scratch' : 'spec',
});

// Tag by path: the users docs are users-entity; auth.md spans auth + users-entity.
const areaTagger: AreaTagRunner = async ({ doc }) => {
  if (doc.path === 'docs/auth.md') {
    return {
      tags: [
        { product: 'core', concern: 'auth' },
        { product: 'core', concern: 'users' },
      ],
      status: 'shipped',
    };
  }
  return { tags: [{ product: 'core', concern: 'users' }], status: 'shipped' };
};

const flagAll: OverlapRunner = async ({ a, b }) => ({ overlap: true, note: `${a.path} vs ${b.path}` });

// Verify keeps every flag by default; individual tests override to refute.
const confirmAll: VerifyOverlapRunner = async () => ({ verdict: 'confirmed', reason: 'genuine' });

const EMPTY_DECISIONS: DecisionsFile = {
  version: 1,
  decisions: [],
  manualChains: [],
  manualIncludes: [],
  relations: [],
  manualAreas: [],
};

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-curate-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function run(extra: Parameters<typeof curate>[1] = {}) {
  return curate(repo, {
    docSource: () => DOCS,
    decisions: EMPTY_DECISIONS,
    relevanceRunner: relevance,
    areaTagRunner: areaTagger,
    overlapRunner: flagAll,
    verifyOverlapRunner: confirmAll,
    skipGit: true,
    ...extra,
  });
}

describe('curate', () => {
  it('curates docs into an area-grouped corpus with overlaps', async () => {
    const result = await run();

    // Relevance dropped the scratch note.
    expect(result.skippedDocs).toEqual([{ path: 'notes/scratch.md', reason: 'scratch' }]);
    expect(result.corpus.docs.map((d) => d.ref).sort()).toEqual([
      'docs/auth.md',
      'docs/users-v1.md',
      'docs/users-v2.md',
    ]);

    // Areas: core/auth (auth.md only) + core/users-entity (all three).
    const areaIds = result.corpus.areas.map((a) => a.id);
    expect(areaIds).toEqual(['core/auth', 'core/users-entity']);
    const usersArea = result.corpus.areas.find((a) => a.id === 'core/users-entity')!;
    expect(usersArea.docRefs).toEqual(['docs/auth.md', 'docs/users-v1.md', 'docs/users-v2.md']);

    // A corpus carries no relations field.
    expect(result.corpus.relations).toBeUndefined();

    // Every within-area pair is examined.
    const overlapPairs = usersArea.overlaps.map((o) => o.docs);
    expect(overlapPairs).toContainEqual(['docs/auth.md', 'docs/users-v1.md']);
    expect(overlapPairs).toContainEqual(['docs/auth.md', 'docs/users-v2.md']);
    expect(overlapPairs).toContainEqual(['docs/users-v1.md', 'docs/users-v2.md']);

    // Stats.
    expect(result.stats.docsScanned).toBe(4);
    expect(result.stats.docsKept).toBe(3);
    expect(result.stats.areaCount).toBe(2);
    expect(result.stats.overlapFlags).toBe(3);
  });

  it('persists corpus.json (round-trips through readCorpus)', async () => {
    const result = await run();
    const read = readCorpus(repo);
    expect(read).not.toBeNull();
    expect(read!.version).toBe(3);
    expect(read!.areas.map((a) => a.id)).toEqual(['core/auth', 'core/users-entity']);
    // The returned in-memory corpus must equal the persisted file (same generatedAt).
    expect(read!.generatedAt).toBe(result.corpus.generatedAt);
    expect(read).toEqual(result.corpus);
  });

  it('skips the write when skipCorpusWrite is set', async () => {
    const result = await run({ skipCorpusWrite: true });
    expect(result.corpus.areas).toHaveLength(2);
    expect(readCorpus(repo)).toBeNull();
  });

  it('applies manualAreas and tolerates legacy relations in decisions', async () => {
    // A legacy `relations` entry is still parsed (back-compat) but inert — the
    // scan neither consumes it nor lets it skip an overlap pair.
    const decisions: DecisionsFile = {
      ...EMPTY_DECISIONS,
      relations: [
        { type: 'precedence', older: 'docs/users-v1.md', newer: 'docs/users-v2.md', scope: 'core/users-entity' },
      ],
      manualAreas: [{ doc: 'docs/auth.md', areas: ['core/auth'] }],
    };
    const result = await run({ decisions });

    // auth.md re-homed to core/auth only → users-entity now has just the two users docs.
    const usersArea = result.corpus.areas.find((a) => a.id === 'core/users-entity')!;
    expect(usersArea.docRefs).toEqual(['docs/users-v1.md', 'docs/users-v2.md']);

    // The legacy relation does NOT skip the pair — the disagreement is still flagged.
    expect(usersArea.overlaps).toHaveLength(1);
    expect(usersArea.overlaps[0].docs).toEqual(['docs/users-v1.md', 'docs/users-v2.md']);
  });

  it('force-excludes a doc via manualExcludes — dropped from the corpus + its overlaps', async () => {
    const decisions: DecisionsFile = { ...EMPTY_DECISIONS, manualExcludes: ['docs/auth.md'] };
    const result = await run({ decisions });

    // auth.md is gone entirely: not a kept doc, its core/auth area vanishes, and
    // the two overlaps it drove are gone. The (v1,v2) pair stays flagged — the
    // filename replace relation never resolves the disagreement.
    expect(result.corpus.docs.map((d) => d.ref)).not.toContain('docs/auth.md');
    expect(result.corpus.areas.map((a) => a.id)).toEqual(['core/users-entity']);
    const usersArea = result.corpus.areas.find((a) => a.id === 'core/users-entity')!;
    expect(usersArea.docRefs).toEqual(['docs/users-v1.md', 'docs/users-v2.md']);
    expect(usersArea.overlaps).toHaveLength(1);
    expect(usersArea.overlaps[0].docs).toEqual(['docs/users-v1.md', 'docs/users-v2.md']);
    expect(result.stats.docsKept).toBe(2);
  });

  it('reads manualAreas from decisions.json on disk when not injected', async () => {
    const specsDir = path.join(repo, '.truecourse', 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(
      path.join(specsDir, 'decisions.json'),
      JSON.stringify({
        version: 1,
        manualIncludes: [],
        relations: [],
        manualAreas: [{ doc: 'docs/auth.md', areas: ['core/auth'] }],
      }),
    );
    const result = await curate(repo, {
      docSource: () => DOCS,
      relevanceRunner: relevance,
      areaTagRunner: areaTagger,
      overlapRunner: flagAll,
      verifyOverlapRunner: confirmAll,
      skipGit: true,
    });
    const usersArea = result.corpus.areas.find((a) => a.id === 'core/users-entity')!;
    expect(usersArea.docRefs).toEqual(['docs/users-v1.md', 'docs/users-v2.md']);
  });
});

// ---------------------------------------------------------------------------
// Corpus stats persistence — docsScanned / docsKept / ignored-non-markdown are
// written into corpus.json so `spec status`, the guard CLI, and the dashboard
// can explain an empty corpus without re-running the scan.
// ---------------------------------------------------------------------------

describe('curate — persisted corpus stats', () => {
  it('writes docsScanned/docsKept into corpus.json and round-trips', async () => {
    const result = await run();
    const read = readCorpus(repo);
    expect(read!.stats).toBeDefined();
    expect(read!.stats!.docsScanned).toBe(4);
    expect(read!.stats!.docsKept).toBe(3);
    // The in-memory corpus equals the persisted file (stats included).
    expect(read!.stats).toEqual(result.corpus.stats);
  });

  it('defaults ignoredNonMarkdown to an empty record when discovery ran via docSource', async () => {
    const result = await run();
    // docSource bypasses the filesystem walk → no ignored-extension bookkeeping.
    expect(result.corpus.stats!.ignoredNonMarkdown).toEqual({});
  });

  it('back-compat: an older corpus.json with no `stats` field still parses', () => {
    const legacy = {
      version: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      docs: [],
      areas: [],
      skippedDocs: [],
    };
    const parsed = CuratedCorpusSchema.parse(legacy);
    expect(parsed.stats).toBeUndefined();
    // …and reading it off disk fails soft to the parsed shape (not null).
    const dir = path.join(repo, '.truecourse', 'specs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'corpus.json'), JSON.stringify(legacy));
    const read = readCorpus(repo);
    expect(read).not.toBeNull();
    expect(read!.stats).toBeUndefined();
  });

  it('writeCorpus persists the stats it is given', () => {
    writeCorpus(repo, {
      docs: [],
      areas: [],
      stats: { docsScanned: 9, docsKept: 0, ignoredNonMarkdown: { '.rst': 4 } },
    });
    const read = readCorpus(repo);
    expect(read!.stats).toEqual({ docsScanned: 9, docsKept: 0, ignoredNonMarkdown: { '.rst': 4 } });
  });
});

describe('curate — ignored non-markdown from a real walk', () => {
  const keepAll: RelevanceRunner = async ({ doc }) => ({ path: doc.path, include: true, reason: 'spec' });
  const tagOne: AreaTagRunner = async () => ({ tags: [{ product: 'core', concern: 'x' }], status: 'shipped' });

  function place(rel: string, body: string): void {
    const full = path.join(repo, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }

  it('counts ignored doc-like files from the filesystem into stats.ignoredNonMarkdown', async () => {
    place('README.md', '# kept');
    place('docs/guide.rst', 'rst');
    place('docs/other.rst', 'rst');
    place('CHANGES.adoc', 'adoc');

    const result = await curate(repo, {
      decisions: EMPTY_DECISIONS,
      relevanceRunner: keepAll,
      areaTagRunner: tagOne,
      disableOverlapDetection: true,
      skipGit: true,
    });
    expect(result.stats.ignoredNonMarkdown).toEqual({ '.rst': 2, '.adoc': 1 });
    expect(readCorpus(repo)!.stats!.ignoredNonMarkdown).toEqual({ '.rst': 2, '.adoc': 1 });
  });

  it('rst-only repo: docsScanned 0, ignored counts explain the empty corpus', async () => {
    place('docs/guide.rst', 'rst');
    place('docs/api.rst', 'rst');

    const result = await curate(repo, {
      decisions: EMPTY_DECISIONS,
      relevanceRunner: keepAll,
      areaTagRunner: tagOne,
      disableOverlapDetection: true,
      skipGit: true,
    });
    expect(result.stats.docsScanned).toBe(0);
    expect(result.stats.docsKept).toBe(0);
    expect(result.stats.ignoredNonMarkdown).toEqual({ '.rst': 2 });
  });
});

// ---------------------------------------------------------------------------
// Overlap verification (precision pass) — the recall-biased detector over-flags;
// an explicit `refuted` verdict prunes a flag before the corpus is assembled, so
// a refuted flag never reaches corpus.json. Confirmed + error-path flags stay.
// ---------------------------------------------------------------------------

describe('curate — overlap verification', () => {
  it('a refuted flag is pruned from the corpus, excluded from openOverlaps, counted in overlapRefuted', async () => {
    // Refute exactly the (v1,v2) pair; keep every other flag.
    const verify: VerifyOverlapRunner = async ({ a, b }) => {
      const pair = [a.path, b.path].sort().join('|');
      return pair === 'docs/users-v1.md|docs/users-v2.md'
        ? { verdict: 'refuted', reason: 'complementary detail' }
        : { verdict: 'confirmed', reason: 'genuine' };
    };
    const result = await run({ verifyOverlapRunner: verify });

    const usersArea = result.corpus.areas.find((a) => a.id === 'core/users-entity')!;
    const pairs = usersArea.overlaps.map((o) => o.docs);
    // The refuted (v1,v2) pair is GONE from the corpus; the other two survive.
    expect(pairs).not.toContainEqual(['docs/users-v1.md', 'docs/users-v2.md']);
    expect(pairs).toContainEqual(['docs/auth.md', 'docs/users-v1.md']);
    expect(pairs).toContainEqual(['docs/auth.md', 'docs/users-v2.md']);

    // Stats: openOverlaps excludes the refuted flag; overlapRefuted counts it.
    expect(result.stats.overlapRefuted).toBe(1);
    expect(result.stats.overlapFlags).toBe(2);
    expect(result.stats.openOverlaps.map((o) => [o.a, o.b])).not.toContainEqual([
      'docs/users-v1.md',
      'docs/users-v2.md',
    ]);
  });

  it('confirmed flags stay exactly as before (nothing refuted)', async () => {
    const result = await run(); // confirmAll
    expect(result.stats.overlapRefuted).toBe(0);
    expect(result.stats.overlapFlags).toBe(3);
  });

  it('fail-open: a verifier that throws leaves every flag in the corpus', async () => {
    const throwing: VerifyOverlapRunner = async () => {
      throw new Error('judge unavailable');
    };
    const result = await run({ verifyOverlapRunner: throwing });
    // No verdict = no prune: all three flags survive.
    expect(result.stats.overlapRefuted).toBe(0);
    expect(result.stats.overlapFlags).toBe(3);
    const usersArea = result.corpus.areas.find((a) => a.id === 'core/users-entity')!;
    expect(usersArea.overlaps).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Overlap full-matrix coverage — a within-area doc pair is judged across its
// COMPLETE window matrix; nothing is truncated no matter how large the docs.
// ---------------------------------------------------------------------------

describe('curate — overlap full window matrix', () => {
  // A realistic long configuration reference: many `## key` sections, well past a
  // single OVERLAP_WINDOW_CHARS window, so both docs split into several windows.
  function configReference(product: string, sections: number): string {
    const out = [
      `# ${product} Configuration Reference`,
      '',
      `Every runtime setting the ${product} service reads at boot, with its type, default, and reload semantics.`,
      '',
    ];
    for (let i = 0; i < sections; i++) {
      out.push(
        `## ${product}.pipeline.stage-${i}`,
        '',
        `Controls how stage ${i} of the request pipeline behaves. Accepts a string; the default is "auto".`,
        `When set to a non-default value the ${product} runtime applies policy ${i} to every inbound request and records the decision in the audit log.`,
        `Type: string. Default: auto. Scope: runtime. Reloadable: yes. Since: 1.${i}. Related: ${product}.pipeline.stage-${(i + 1) % sections}.`,
        '',
      );
    }
    return out.join('\n');
  }

  // Distinct products so the relevance prefilter never treats them as near-duplicates.
  const bigA = configReference('gateway', 300);
  const bigB = configReference('ingress', 300);
  const DOCS_BIG: DocCandidate[] = [
    { path: 'docs/gateway-config-a.md', absPath: '', content: bigA, kind: 'prd', preview: bigA.slice(0, 200), lastTouched: '2026-01-01T00:00:00Z', contentHash: 'hash-big-a', size: bigA.length },
    { path: 'docs/gateway-config-b.md', absPath: '', content: bigB, kind: 'prd', preview: bigB.slice(0, 200), lastTouched: '2026-01-01T00:00:00Z', contentHash: 'hash-big-b', size: bigB.length },
  ];
  // Both docs land in the same area, so they form one within-area pair.
  const tagSame: AreaTagRunner = async () => ({ tags: [{ product: 'core', concern: 'config' }], status: 'shipped' });
  const keepAll: RelevanceRunner = async ({ doc }) => ({ path: doc.path, include: true, reason: 'spec' });
  const noOverlap: OverlapRunner = async () => ({ overlap: false, note: '' });

  it('judges the pair across every window combination of both oversized docs', async () => {
    let calls = 0;
    const counting: OverlapRunner = async (i) => {
      calls++;
      return noOverlap(i);
    };
    const result = await curate(repo, {
      docSource: () => DOCS_BIG,
      decisions: EMPTY_DECISIONS,
      relevanceRunner: keepAll,
      areaTagRunner: tagSame,
      overlapRunner: counting,
      skipGit: true,
    });

    // The pair formed (both docs share the one area) and the judge saw the FULL
    // matrix: every window of A against every window of B, no truncation.
    expect(result.corpus.areas.some((a) => a.docRefs.length === 2)).toBe(true);
    const nA = planDocChunks('docs/gateway-config-a.md', bigA, OVERLAP_WINDOW_CHARS).length;
    const nB = planDocChunks('docs/gateway-config-b.md', bigB, OVERLAP_WINDOW_CHARS).length;
    expect(nA).toBeGreaterThan(3);
    expect(nB).toBeGreaterThan(3);
    expect(calls).toBe(nA * nB);
  });
});

// ---------------------------------------------------------------------------
// Include-scope — exercises the real filesystem discovery path (NOT docSource,
// which bypasses scoping) so config `spec.include` actually applies.
// ---------------------------------------------------------------------------

describe('curate — include-scope', () => {
  const keepAll: RelevanceRunner = async ({ doc }) => ({ path: doc.path, include: true, reason: 'spec' });
  const tagOne: AreaTagRunner = async () => ({ tags: [{ product: 'core', concern: 'x' }], status: 'shipped' });

  function place(rel: string, body: string): void {
    const full = path.join(repo, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  function config(include: string[]): void {
    place('.truecourse/config.json', JSON.stringify({ spec: { include } }));
  }
  function runFs(decisions: DecisionsFile = EMPTY_DECISIONS) {
    return curate(repo, {
      decisions,
      relevanceRunner: keepAll,
      areaTagRunner: tagOne,
      disableOverlapDetection: true,
      skipGit: true,
    });
  }

  it('scans only in-scope docs and reports the active scope', async () => {
    config(['docs/**']);
    place('docs/spec.md', '# in scope');
    place('reference/answers.md', '# out of scope');

    const result = await runFs();
    expect(result.stats.scopeGlobs).toEqual(['docs/**']);
    expect(result.stats.docsScanned).toBe(1);
    expect(result.corpus.docs.map((d) => d.ref)).toEqual(['docs/spec.md']);
  });

  it('an out-of-scope doc never appears in skippedDocs', async () => {
    config(['docs/**']);
    place('docs/spec.md', '# in scope');
    place('reference/answers.md', '# out of scope');

    const result = await runFs();
    // Out-of-scope docs never enter the universe, so they are neither kept nor
    // "skipped" — they must not surface in the dashboard's not-included list.
    const skippedPaths = result.skippedDocs.map((s) => s.path);
    expect(skippedPaths).not.toContain('reference/answers.md');
    expect(result.corpus.skippedDocs.map((s) => s.ref)).not.toContain('reference/answers.md');
  });

  it('surfaces an out-of-scope manualInclude instead of silently dropping it', async () => {
    config(['docs/**']);
    place('docs/spec.md', '# in scope');
    place('reference/answers.md', '# out of scope, but force-included');

    const decisions: DecisionsFile = { ...EMPTY_DECISIONS, manualIncludes: ['reference/answers.md'] };
    const result = await runFs(decisions);
    // A manual include is a relevance-level override, not a universe override:
    // the out-of-scope path stays out, but is surfaced so it isn't a silent no-op.
    expect(result.stats.outOfScopeManualIncludes).toEqual(['reference/answers.md']);
    expect(result.corpus.docs.map((d) => d.ref)).toEqual(['docs/spec.md']);
  });

  it('no scope configured → empty scopeGlobs, everything scanned', async () => {
    place('docs/spec.md', '# a');
    place('reference/x.md', '# b');

    const result = await runFs();
    expect(result.stats.scopeGlobs).toEqual([]);
    expect(result.stats.outOfScopeManualIncludes).toEqual([]);
    expect(result.stats.docsScanned).toBe(2);
  });
});
