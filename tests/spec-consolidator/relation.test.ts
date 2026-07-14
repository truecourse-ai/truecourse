/**
 * The relation stage collapses the old version-chain machinery into a flat
 * Relation[]: the deterministic filename detector + one LLM pass become
 * `replace` relations, de-duped with filename winning, and user-authored
 * relations merge in via effectiveRelations (user wins, gains `manual`
 * provenance).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { detectRelations, effectiveRelations } from '../../packages/spec-consolidator/src/index.js';
import type { DocCandidate, Relation } from '../../packages/spec-consolidator/src/index.js';

function doc(p: string, lastTouched = '2026-01-01T00:00:00Z'): DocCandidate {
  return {
    path: p,
    absPath: `/abs/${p}`,
    kind: 'prd',
    preview: `preview of ${p}`,
    lastTouched,
    contentHash: `hash-${p}`,
    size: 100,
  };
}

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-relation-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('detectRelations', () => {
  it('turns a filename chain into a replace relation (no LLM)', async () => {
    const docs = [doc('docs/plan-v1.md'), doc('docs/plan-v2.md')];
    const relations = await detectRelations(repo, docs, { disableLlm: true });
    expect(relations).toEqual([
      { type: 'replace', older: 'docs/plan-v1.md', newer: 'docs/plan-v2.md', detectedFrom: 'filename' },
    ]);
  });

  it('expands a 3-doc chain into consecutive replace relations', async () => {
    const docs = [doc('docs/plan-v1.md'), doc('docs/plan-v2.md'), doc('docs/plan-v3.md')];
    const relations = await detectRelations(repo, docs, { disableLlm: true });
    expect(relations).toEqual([
      { type: 'replace', older: 'docs/plan-v1.md', newer: 'docs/plan-v2.md', detectedFrom: 'filename' },
      { type: 'replace', older: 'docs/plan-v2.md', newer: 'docs/plan-v3.md', detectedFrom: 'filename' },
    ]);
  });

  it('adds LLM-detected chains with llm provenance', async () => {
    const docs = [doc('a.md'), doc('b.md')];
    const relations = await detectRelations(repo, docs, {
      chainRunner: async () => ({ chains: [{ members: ['a.md', 'b.md'], reason: 'rewrite' }] }),
    });
    expect(relations).toEqual([
      { type: 'replace', older: 'a.md', newer: 'b.md', detectedFrom: 'llm' },
    ]);
  });

  it('transitively reduces an LLM chain of any length to its consecutive edges', async () => {
    // The LLM returns both the full chain and a redundant transitive edge a→d.
    const docs = [doc('a.md'), doc('b.md'), doc('c.md'), doc('d.md')];
    const relations = await detectRelations(repo, docs, {
      chainRunner: async () => ({
        chains: [
          { members: ['a.md', 'b.md', 'c.md', 'd.md'], reason: 'chain' },
          { members: ['a.md', 'd.md'], reason: 'transitive' },
        ],
      }),
    });
    expect(relations.map((r) => [r.older, r.newer])).toEqual([
      ['a.md', 'b.md'],
      ['b.md', 'c.md'],
      ['c.md', 'd.md'],
    ]);
  });

  it('de-dups across detectors, filename winning over llm on the same pair', async () => {
    const docs = [doc('docs/plan-v1.md'), doc('docs/plan-v2.md')];
    const relations = await detectRelations(repo, docs, {
      // LLM proposes the same pair; the filename relation must win.
      chainRunner: async () => ({ chains: [{ members: ['docs/plan-v1.md', 'docs/plan-v2.md'], reason: 'x' }] }),
    });
    expect(relations).toHaveLength(1);
    expect(relations[0].detectedFrom).toBe('filename');
  });
});

describe('effectiveRelations', () => {
  it('merges user relations, which win on the same pair and gain manual provenance', () => {
    const auto: Relation[] = [
      { type: 'replace', older: 'a.md', newer: 'b.md', detectedFrom: 'llm' },
    ];
    const user: Relation[] = [
      { type: 'precedence', older: 'a.md', newer: 'b.md', scope: 'core/users-entity', note: 'refine' },
    ];
    const eff = effectiveRelations(auto, user);
    expect(eff).toHaveLength(1);
    expect(eff[0].type).toBe('precedence');
    expect(eff[0].detectedFrom).toBe('manual');
    expect(eff[0].scope).toBe('core/users-entity');
  });

  it('keeps non-overlapping auto + user relations', () => {
    const auto: Relation[] = [{ type: 'replace', older: 'a.md', newer: 'b.md', detectedFrom: 'filename' }];
    const user: Relation[] = [{ type: 'keep-both', older: 'c.md', newer: 'd.md' }];
    const eff = effectiveRelations(auto, user);
    expect(eff).toHaveLength(2);
  });

  it('keeps two user relations on the same pair scoped to different areas (scope is load-bearing)', () => {
    const user: Relation[] = [
      { type: 'replace', older: 'a.md', newer: 'b.md', scope: 'core/auth' },
      { type: 'keep-both', older: 'a.md', newer: 'b.md', scope: 'core/events' },
    ];
    const eff = effectiveRelations([], user);
    expect(eff).toHaveLength(2);
    expect(eff.map((r) => r.scope).sort()).toEqual(['core/auth', 'core/events']);
  });

  it('a user relation supersedes an auto relation on the same pair (even when scoped)', () => {
    const auto: Relation[] = [{ type: 'replace', older: 'a.md', newer: 'b.md', detectedFrom: 'filename' }];
    const user: Relation[] = [{ type: 'precedence', older: 'a.md', newer: 'b.md', scope: 'core/auth' }];
    const eff = effectiveRelations(auto, user);
    expect(eff).toHaveLength(1);
    expect(eff[0].type).toBe('precedence');
  });
});
