/**
 * Repo Knowledge inheritance (core): the decisions merge (repo wins per identity),
 * the materialization seam (workspace doc bodies + merged decisions land in the
 * checkout, transient), the corpus content signature (volatile-field-stable), and
 * the cross-tree cache-hit that makes an inherited doc ~free at repo scan time.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  mergeInheritedDecisions,
  materializeWorkspaceInheritance,
  corpusContentSha,
  EMPTY_DECISIONS,
} from '@truecourse/core/commands/spec-in-process';
import { setSpecInheritanceHook } from '@truecourse/core/lib/spec-inheritance-hook';
import type { CuratedCorpus, DecisionsFile, ConflictResolution } from '@truecourse/spec-consolidator';
import type { DocCandidate } from '../../packages/spec-consolidator/src/index.js';
import {
  CURATE_DOC_CACHE_NAME,
  DocVerdictSchema,
  curateDocCacheKey,
} from '../../packages/core/src/services/spec-scan/curate-doc';
import { cachedSessionOutcome } from '../../packages/core/src/services/agent/session-cache';
import { getCacheEntry, setKvCacheStore, resetKvCacheStore, type KvCacheStore } from '@truecourse/llm';

function decisions(over: Partial<DecisionsFile>): DecisionsFile {
  return { ...EMPTY_DECISIONS, ...over };
}

function resolution(over: Partial<ConflictResolution>): ConflictResolution {
  return {
    docA: 'knowledge/confluence/ADR-003.md',
    anchorA: null,
    docB: 'knowledge/jira/KAN-5.md',
    anchorB: null,
    verdict: 'a',
    resolvedAt: '2026-07-14T00:00:00.000Z',
    ...over,
  };
}

afterEach(() => {
  setSpecInheritanceHook(null);
  resetKvCacheStore();
});

// --- Decisions merge (repo wins per identity) -------------------------------

describe('mergeInheritedDecisions', () => {
  it('carries a workspace-resolved conflict through when the repo has no verdict of its own', async () => {
    const workspace = decisions({ conflictResolutions: [resolution({ verdict: 'a' })] });
    const merged = mergeInheritedDecisions(workspace, EMPTY_DECISIONS);
    expect(merged.conflictResolutions).toHaveLength(1);
    expect(merged.conflictResolutions[0].verdict).toBe('a');
  });

  it('the repo verdict wins on the same dispute identity (unordered pair + anchors)', async () => {
    const workspace = decisions({ conflictResolutions: [resolution({ verdict: 'a' })] });
    // Same dispute, docs recorded in the opposite order — repo overlay wins.
    const repo = decisions({
      conflictResolutions: [
        resolution({ docA: 'knowledge/jira/KAN-5.md', docB: 'knowledge/confluence/ADR-003.md', verdict: 'b' }),
      ],
    });
    const merged = mergeInheritedDecisions(workspace, repo);
    expect(merged.conflictResolutions).toHaveLength(1);
    expect(merged.conflictResolutions[0].verdict).toBe('b');
  });

  it('unions includes/excludes across layers and lets a repo area override win for the same doc', async () => {
    const workspace = decisions({
      manualIncludes: ['ws-inc.md'],
      manualExcludes: ['ws-only.md'],
      manualAreas: [{ doc: 'shared.md', areas: ['ws/x'] }],
    });
    const repo = decisions({
      manualExcludes: ['repo-only.md'],
      manualAreas: [{ doc: 'shared.md', areas: ['repo/y'] }],
    });
    const merged = mergeInheritedDecisions(workspace, repo);

    expect(new Set(merged.manualExcludes)).toEqual(new Set(['ws-only.md', 'repo-only.md']));
    expect(merged.manualIncludes).toContain('ws-inc.md'); // workspace include survives
    // The repo's area override for a doc replaces the workspace's.
    const area = merged.manualAreas.find((a) => a.doc === 'shared.md')!;
    expect(area.areas).toEqual(['repo/y']);
  });
});

// --- Materialization seam ---------------------------------------------------

describe('materializeWorkspaceInheritance', () => {
  it('no hook installed → repo decisions pass through unchanged, nothing written', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-inh-'));
    try {
      const repoDecisions = decisions({ manualIncludes: ['docs/x.md'] });
      const out = await materializeWorkspaceInheritance(tmp, 'acme/api', repoDecisions);
      expect(out.inherited).toBe(false);
      expect(out.decisions).toBe(repoDecisions); // same reference
      expect(fs.readdirSync(tmp)).toHaveLength(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('hook installed → writes doc bodies at their knowledge/ paths + returns merged decisions (repo wins)', async () => {
    setSpecInheritanceHook(async (repoKey) => {
      expect(repoKey).toBe('acme/api');
      return {
        docs: [
          { docPath: 'knowledge/confluence/ADR-003.md', markdown: '# ADR-003\nWorkspace body.' },
          { docPath: 'knowledge/jira/KAN-5.md', markdown: '# KAN-5\nTicket body.' },
        ],
        decisions: decisions({ conflictResolutions: [resolution({ verdict: 'a' })], manualExcludes: ['ws.md'] }),
      };
    });

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-inh-'));
    try {
      const repoDecisions = decisions({ manualExcludes: ['repo.md'] });
      const out = await materializeWorkspaceInheritance(tmp, 'acme/api', repoDecisions);

      expect(out.inherited).toBe(true);
      // Bodies materialized at their exact namespaced paths.
      expect(fs.readFileSync(path.join(tmp, 'knowledge/confluence/ADR-003.md'), 'utf-8')).toContain('Workspace body.');
      expect(fs.readFileSync(path.join(tmp, 'knowledge/jira/KAN-5.md'), 'utf-8')).toContain('Ticket body.');
      // Decisions merged: workspace resolution carried through, both excludes present.
      expect(out.decisions.conflictResolutions).toHaveLength(1);
      expect(new Set(out.decisions.manualExcludes)).toEqual(new Set(['ws.md', 'repo.md']));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('hook returns null (no workspace) → inert, repo decisions unchanged', async () => {
    setSpecInheritanceHook(async () => null);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-inh-'));
    try {
      const out = await materializeWorkspaceInheritance(tmp, 'acme/api', EMPTY_DECISIONS);
      expect(out.inherited).toBe(false);
      expect(fs.readdirSync(tmp)).toHaveLength(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// --- Corpus content signature -----------------------------------------------

function corpus(over: Partial<CuratedCorpus> = {}): CuratedCorpus {
  return {
    version: 3,
    generatedAt: '2026-07-14T00:00:00.000Z',
    docs: [
      { ref: 'knowledge/jira/KAN-5.md', kind: 'spec', lastTouched: '2026-07-01T00:00:00.000Z', areaTags: ['product/auth'] },
    ],
    areas: [{ id: 'product/auth', product: 'product', concern: 'auth', docRefs: ['knowledge/jira/KAN-5.md'], overlaps: [] }],
    skippedDocs: [],
    ...over,
  };
}

describe('corpusContentSha', () => {
  it('null → the empty signature', () => {
    expect(corpusContentSha(null)).toBe('');
  });

  it('ignores volatile fields (generatedAt + per-doc lastTouched)', () => {
    const a = corpus();
    const b = corpus({
      generatedAt: '2030-01-01T00:00:00.000Z',
      docs: [{ ref: 'knowledge/jira/KAN-5.md', kind: 'spec', lastTouched: '2099-12-31T00:00:00.000Z', areaTags: ['product/auth'] }],
    });
    expect(corpusContentSha(a)).toBe(corpusContentSha(b));
  });

  it('changes when a doc ref (meaningful content) changes', () => {
    const a = corpus();
    const b = corpus({
      docs: [{ ref: 'knowledge/jira/KAN-6.md', kind: 'spec', lastTouched: '2026-07-01T00:00:00.000Z', areaTags: ['product/auth'] }],
    });
    expect(corpusContentSha(a)).not.toBe(corpusContentSha(b));
  });
});

// --- Cross-tree cache hit (workspace-seeded → repo scan is free) ------------

describe('inherited-doc cache reuse across trees', () => {
  it('the curate-doc verdict the workspace paid for hits at a DIFFERENT (repo) tree scope — no session', async () => {
    // A content-addressed KV store that IGNORES scope — the shape the EE Postgres
    // cache has (keys are content hashes, not tree paths), which is what makes an
    // inherited doc a cache hit in the repo's own scan tree.
    const mem = new Map<string, unknown>();
    const store: KvCacheStore = {
      async get(_scope, name, key) {
        return mem.has(`${name}::${key}`) ? mem.get(`${name}::${key}`) : null;
      },
      async set(_scope, name, key, value) {
        mem.set(`${name}::${key}`, value);
      },
    };
    setKvCacheStore(store);

    const body = '# KAN-5\nThe auth ticket body.';
    const doc: DocCandidate = {
      path: 'knowledge/jira/KAN-5.md',
      absPath: '',
      content: body,
      kind: 'spec',
      preview: body.slice(0, 40),
      lastTouched: '2026-07-01T00:00:00.000Z',
      contentHash: createHash('sha256').update(body).digest('hex'),
      size: body.length,
    };
    // The key is a pure function of the prompt, the identity, the path and the
    // content — never of the tree the scan happens to run in.
    const key = curateDocCacheKey({ identity: null, doc });
    const verdict = { keep: true, reason: 'a spec', areas: [] };

    let sessions = 0;
    const curate = (repoRoot: string) =>
      cachedSessionOutcome({
        repoRoot,
        cacheName: CURATE_DOC_CACHE_NAME,
        key,
        schema: DocVerdictSchema,
        run: async () => {
          sessions++;
          return { status: 'completed', output: verdict, pendingQuestions: [], spent: { turns: 1, tokens: 1, costUsd: 0 } };
        },
      });

    // The workspace curates it (cold: one session) in ITS scratch tree.
    expect(await curate('/tmp/workspace-tree')).toMatchObject({ output: verdict });
    expect(sessions).toBe(1);

    // The repo's own scan, a DIFFERENT tree — same docPath + content → cache hit,
    // no second session.
    expect(await curate('/tmp/repo-clone-tree')).toMatchObject({ fromCache: true, output: verdict });
    expect(sessions).toBe(1);

    // And the estimate's cache probe agrees (it would count this doc as unchanged).
    expect(await getCacheEntry('/tmp/another-repo-tree', CURATE_DOC_CACHE_NAME, key)).toEqual(verdict);
  });
});
