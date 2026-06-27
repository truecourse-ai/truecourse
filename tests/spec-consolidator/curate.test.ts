/**
 * End-to-end curate(): discover → relevance keep/drop → area-tag → group →
 * relations → overlap-flag → assemble + persist corpus.json. All LLM stages are
 * stubbed; the filename relation detector runs for real (deterministic).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { curate, readCorpus } from '../../packages/spec-consolidator/src/index.js';
import type {
  AreaTagRunner,
  DecisionsFile,
  DocCandidate,
  OverlapRunner,
  RelevanceRunner,
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
    disableLlmRelationDetection: true,
    skipGit: true,
    ...extra,
  });
}

describe('curate', () => {
  it('curates docs into an area-grouped corpus with relations + overlaps', async () => {
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

    // Filename relation: v1 → v2.
    expect(result.corpus.relations).toEqual([
      { type: 'replace', older: 'docs/users-v1.md', newer: 'docs/users-v2.md', detectedFrom: 'filename' },
    ]);

    // Overlap flagged on the unresolved pairs only — the (v1,v2) pair is skipped
    // because the replace relation resolves it.
    const overlapPairs = usersArea.overlaps.map((o) => o.docs);
    expect(overlapPairs).toContainEqual(['docs/auth.md', 'docs/users-v1.md']);
    expect(overlapPairs).toContainEqual(['docs/auth.md', 'docs/users-v2.md']);
    expect(overlapPairs).not.toContainEqual(['docs/users-v1.md', 'docs/users-v2.md']);

    // Stats.
    expect(result.stats.docsScanned).toBe(4);
    expect(result.stats.docsKept).toBe(3);
    expect(result.stats.areaCount).toBe(2);
    expect(result.stats.overlapFlags).toBe(2);
    expect(result.stats.resolvedRelations).toBe(1);
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

  it('applies injected user relations (folded in, user wins) and manualAreas', async () => {
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

    // The user precedence relation wins the pair over the auto filename replace.
    const eff = result.relations.find((r) => r.older === 'docs/users-v1.md' && r.newer === 'docs/users-v2.md');
    expect(eff?.type).toBe('precedence');
    expect(eff?.detectedFrom).toBe('manual');

    // That pair is resolved → no overlap flagged for it (and it's the only pair now).
    expect(usersArea.overlaps).toHaveLength(0);
  });

  it('reads relations + manualAreas from decisions.json on disk when not injected', async () => {
    const specsDir = path.join(repo, '.truecourse', 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(
      path.join(specsDir, 'decisions.json'),
      JSON.stringify({
        version: 1,
        decisions: [],
        manualChains: [],
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
      disableLlmRelationDetection: true,
      skipGit: true,
    });
    const usersArea = result.corpus.areas.find((a) => a.id === 'core/users-entity')!;
    expect(usersArea.docRefs).toEqual(['docs/users-v1.md', 'docs/users-v2.md']);
  });
});
