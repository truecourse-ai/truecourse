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
import { curate, readCorpus, OVERLAP_WINDOW_CHARS } from '../../packages/spec-consolidator/src/index.js';
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

/**
 * F12 visibility: the third-party drop rate is what made the bug invisible for
 * so long — cal.com's whole v2 API reference vanished into an undifferentiated
 * "7 dropped". Both counters are reported, not just the first: `restored` is the
 * regression detector. If the identity block is doing its job it should be ~0; a
 * nonzero value means the prompt half is incomplete and the deterministic net is
 * carrying the fix.
 */
describe('curate — third-party visibility', () => {
  const identity = { name: 'wekan', aliases: ['Wekan'], sources: ['git-remote'] };

  const DOCS_WITH_VENDOR = [
    doc('docs/auth.md', 'How auth works here.'),
    doc('docs/trello.md', 'Trello is a third-party kanban platform.'),
    doc('docs/api.md', 'The Wekan API exposes custom fields.'),
  ];

  // Reproduces the measured failure: the model calls our OWN api doc third-party
  // because it names our product, exactly like a vendor's docs would.
  const vendorConfused: RelevanceRunner = async ({ doc }) =>
    doc.path === 'docs/auth.md'
      ? { path: doc.path, include: true, reason: 'spec' }
      : {
          path: doc.path,
          include: false,
          category: 'third-party',
          reason: `vendor API research (${doc.path})`,
        };

  it('counts third-party drops and backstop restores separately', async () => {
    const res = await curate(repo, {
      docSource: () => DOCS_WITH_VENDOR,
      decisions: EMPTY_DECISIONS,
      repoIdentity: identity,
      relevanceRunner: vendorConfused,
      areaTagRunner: areaTagger,
      disableVocabNormalization: true,
      disableOverlapDetection: true,
      skipCorpusWrite: true,
    });

    expect(res.stats.thirdPartyDropped).toBe(2); // both were dropped as third-party
    expect(res.stats.thirdPartyRestored).toBe(1); // only ours names our product
    // The genuine vendor doc stays dropped; our API reference is back.
    expect(res.stats.docsKept).toBe(2);
    expect(res.skippedDocs.map((s) => s.path)).toEqual(['docs/trello.md']);
  });

  it('records the skip category on the corpus so the dashboard can group drops', async () => {
    const res = await curate(repo, {
      docSource: () => DOCS_WITH_VENDOR,
      decisions: EMPTY_DECISIONS,
      repoIdentity: identity,
      relevanceRunner: vendorConfused,
      areaTagRunner: areaTagger,
      disableVocabNormalization: true,
      disableOverlapDetection: true,
      skipCorpusWrite: true,
    });
    expect(res.corpus.skippedDocs).toEqual([
      { ref: 'docs/trello.md', reason: expect.stringMatching(/vendor/), category: 'third-party' },
    ]);
  });

  // EE scans an ephemeral shallow clone in a temp dir. If an explicit null were
  // treated as "resolve it yourself", the basename `tc-gate-scan-XXXX` would
  // become the repo's identity.
  it('honors an explicitly null identity instead of resolving one', async () => {
    let seen: unknown = 'unset';
    await curate(repo, {
      docSource: () => [doc('docs/auth.md')],
      decisions: EMPTY_DECISIONS,
      repoIdentity: null,
      relevanceRunner: async ({ doc, identity }) => {
        seen = identity;
        return { path: doc.path, include: true, reason: 'spec' };
      },
      areaTagRunner: areaTagger,
      disableVocabNormalization: true,
      disableOverlapDetection: true,
      skipCorpusWrite: true,
    });
    expect(seen).toBeNull();
  });
});

/**
 * A stored conflict verdict that matches no overlap the fresh corpus flags is
 * PRUNED in the same write cycle the corpus rides — decisions.json never
 * accumulates bookkeeping about disputes that stopped existing. "Orphaned" is
 * decided by the shared resolved-derivation, so the prune and every surface that
 * renders conflicts agree by construction.
 */
describe('curate — orphaned conflict-verdict prune', () => {
  const specsDir = () => path.join(repo, '.truecourse', 'specs');
  const decisionsFile = () => path.join(specsDir(), 'decisions.json');

  /** A section-scoped verdict on a doc pair, anchored at both preambles (the
   *  shape that matches a flagged overlap carrying no section pointers). */
  const verdict = (docA: string, docB: string) => ({
    docA,
    anchorA: null,
    docB,
    anchorB: null,
    verdict: 'a' as const,
    resolvedAt: '2026-07-20T00:00:00Z',
  });

  const seedDecisions = (conflictResolutions: unknown[], extra: Record<string, unknown> = {}): void => {
    fs.mkdirSync(specsDir(), { recursive: true });
    fs.writeFileSync(
      decisionsFile(),
      JSON.stringify({
        version: 1,
        manualIncludes: [],
        manualExcludes: [],
        manualAreas: [],
        conflictResolutions,
        ...extra,
      }),
    );
  };

  const readStored = () => JSON.parse(fs.readFileSync(decisionsFile(), 'utf-8'));

  /** curate() reading decisions.json from disk (never the injected seam). */
  const runFromDisk = (extra: Parameters<typeof curate>[1] = {}) => run({ decisions: undefined, ...extra });

  it('keeps a verdict that still matches a flagged conflict', async () => {
    seedDecisions([verdict('docs/users-v1.md', 'docs/users-v2.md')]);

    const result = await runFromDisk();

    // The pair IS flagged by this corpus, so the verdict stands — on disk and in
    // the decisions the run reports.
    expect(readStored().conflictResolutions).toHaveLength(1);
    expect(result.decisions.conflictResolutions).toHaveLength(1);
  });

  it('removes a verdict that matches no flagged conflict, keeping the rest of the file', async () => {
    seedDecisions([verdict('docs/gone.md', 'docs/moved.md')], {
      manualIncludes: ['docs/auth.md'],
      manualAreas: [{ doc: 'docs/auth.md', areas: ['core/auth'] }],
    });

    const result = await runFromDisk();

    const stored = readStored();
    expect(stored.conflictResolutions).toEqual([]);
    // Only the stranded verdict goes — every other decision is untouched.
    expect(stored.manualIncludes).toEqual(['docs/auth.md']);
    expect(stored.manualAreas).toEqual([{ doc: 'docs/auth.md', areas: ['core/auth'] }]);
    expect(result.decisions.conflictResolutions).toEqual([]);
  });

  it('prunes ONLY the orphan when a live verdict sits beside it', async () => {
    seedDecisions([verdict('docs/gone.md', 'docs/moved.md'), verdict('docs/users-v1.md', 'docs/users-v2.md')]);

    await runFromDisk();

    expect(readStored().conflictResolutions).toEqual([
      expect.objectContaining({ docA: 'docs/users-v1.md', docB: 'docs/users-v2.md' }),
    ]);
  });

  it('leaves decisions.json byte-identical when nothing is orphaned', async () => {
    seedDecisions([verdict('docs/users-v1.md', 'docs/users-v2.md')], { relations: [{ legacy: true }] });
    const before = fs.readFileSync(decisionsFile(), 'utf-8');

    await runFromDisk();

    // No write at all — not even a reformat that would drop the legacy key.
    expect(fs.readFileSync(decisionsFile(), 'utf-8')).toBe(before);
  });

  it('leaves decisions.json alone when no corpus is written', async () => {
    seedDecisions([verdict('docs/gone.md', 'docs/moved.md')]);
    const before = fs.readFileSync(decisionsFile(), 'utf-8');

    await runFromDisk({ skipCorpusWrite: true });

    // The prune rides the corpus write; a dry read must never mutate the store.
    expect(fs.readFileSync(decisionsFile(), 'utf-8')).toBe(before);
  });
});
