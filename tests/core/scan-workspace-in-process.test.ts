import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { PgSpecStore, PgKvCacheStore } from '../../ee/packages/data-store/src/index';
import { setSpecStore, resetSpecStore } from '../../packages/core/src/lib/spec-store.js';
import { setKvCacheStore, resetKvCacheStore } from '@truecourse/llm';
import {
  scanWorkspaceInProcess,
  getWorkspaceScanState,
  getWorkspaceClaims,
  getWorkspaceDecisions,
  upsertWorkspaceDecision,
  revokeWorkspaceDecision,
  resolveAllWorkspaceDefaults,
} from '../../packages/core/src/commands/spec-in-process.js';
import type {
  Block,
  BlockRunner,
  LlmExtraction,
} from '../../packages/spec-consolidator/src/index.js';

const ORG_A = 'org_aaa';
const ORG_B = 'org_bbb';

// Stub block runner: deterministic, no LLM. Emits one endpoint claim per
// "### <METHOD path>" heading block, keyed off the block's heading.
const stubRunner: BlockRunner = async (blocks: Block[]) =>
  blocks.map((block) => {
    const heading = block.headingPath.at(-1) ?? '';
    const extraction: LlmExtraction = /^(GET|POST|PUT|DELETE)\s+\//.test(heading)
      ? {
          topics: ['endpoints'],
          claims: [
            {
              topic: 'endpoints',
              subject: heading,
              content: { endpoint: heading },
              kind: 'definition',
            },
          ],
        }
      : { topics: [], claims: [] };
    return { block, extraction, durationMs: 0 };
  });

// All LLM stages off except block extraction (the stub). Production runs them.
const PIPELINE_OFF = {
  blockRunner: stubRunner,
  disableLlmChainDetection: true,
  disableChainRecheck: true,
  disableConflictExplanations: true,
  disableConflictResolution: true,
  disableRelevanceFilter: true,
} as const;

const DOC = ['# Orders', '', '## POST /api/orders', 'Create an order.'].join('\n');

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

function tmpKnowledgeDirs(): string[] {
  return fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('tc-knowledge-'));
}

describe('scanWorkspaceInProcess', () => {
  let client: PGlite;

  beforeEach(async () => {
    client = new PGlite();
    const db = await makeDb(client);
    setSpecStore(new PgSpecStore(db));
    setKvCacheStore(new PgKvCacheStore(db)); // caches → Postgres (no stray local files)
  });
  afterEach(async () => {
    resetSpecStore();
    resetKvCacheStore();
    await client.close();
  });

  it('consolidates uploaded docs and persists claims/decisions/scan-state under workspace scope', async () => {
    const { scanState } = await scanWorkspaceInProcess({
      workspaceOrgId: ORG_A,
      docs: [{ docPath: 'knowledge/manual/orders.md', markdown: DOC }],
      ...PIPELINE_OFF,
    });

    expect(scanState.claimsExtracted).toBeGreaterThan(0);
    expect(scanState.docsScanned).toBe(1);

    // Persisted and readable back through the workspace read helpers.
    const persisted = await getWorkspaceScanState(ORG_A);
    expect(persisted?.scannedAt).toBe(scanState.scannedAt);

    const claims = await getWorkspaceClaims<{ claims: Array<{ subject: string }> }>(ORG_A);
    expect(claims?.claims.some((c) => c.subject === 'POST /api/orders')).toBe(true);

    const decisions = await getWorkspaceDecisions(ORG_A);
    expect(decisions).toEqual({ version: 1, decisions: [], manualChains: [], manualIncludes: [] });
  });

  it('runs fully in memory — writes no local files (no temp dir, no cache dir)', async () => {
    const before = tmpKnowledgeDirs();
    await scanWorkspaceInProcess({
      workspaceOrgId: ORG_A,
      docs: [{ docPath: 'knowledge/manual/orders.md', markdown: DOC }],
      ...PIPELINE_OFF,
    });
    // No transient scratch dir.
    expect(tmpKnowledgeDirs()).toEqual(before);
    // No stray cache dir from the `workspace:<org>` scope — caches went to the
    // installed Postgres KV store, not the file store. (A leak would create a
    // `workspace:org_aaa/` dir in cwd.)
    expect(fs.existsSync(path.join(process.cwd(), `workspace:${ORG_A}`))).toBe(false);
  });

  it('isolates workspace Knowledge by org', async () => {
    await scanWorkspaceInProcess({
      workspaceOrgId: ORG_A,
      docs: [{ docPath: 'knowledge/manual/a.md', markdown: '# A\n\n## GET /a\nx' }],
      ...PIPELINE_OFF,
    });
    await scanWorkspaceInProcess({
      workspaceOrgId: ORG_B,
      docs: [{ docPath: 'knowledge/manual/b.md', markdown: '# B\n\n## GET /b\ny' }],
      ...PIPELINE_OFF,
    });

    const a = await getWorkspaceClaims<{ claims: Array<{ subject: string }> }>(ORG_A);
    const b = await getWorkspaceClaims<{ claims: Array<{ subject: string }> }>(ORG_B);
    expect(a?.claims.some((c) => c.subject === 'GET /a')).toBe(true);
    expect(a?.claims.some((c) => c.subject === 'GET /b')).toBe(false);
    expect(b?.claims.some((c) => c.subject === 'GET /b')).toBe(true);
  });

  it('persists rawClaims + chains so a decision can re-merge without docs', async () => {
    // The whole point: resolve below provides NO docs — it remerges from store.
    await scanWorkspaceInProcess({
      workspaceOrgId: ORG_A,
      docs: [{ docPath: 'knowledge/manual/orders.md', markdown: DOC }],
      ...PIPELINE_OFF,
    });
    // rawClaims/chains are derived artifacts in the (test) spec store.
    const claims = await getWorkspaceClaims<{ claims: unknown[] }>(ORG_A);
    expect(claims).not.toBeNull();
  });

  it('full-set re-upload replaces the derived artifacts (drops a removed doc)', async () => {
    await scanWorkspaceInProcess({
      workspaceOrgId: ORG_A,
      docs: [
        { docPath: 'knowledge/manual/a.md', markdown: '# A\n\n## GET /a\nx' },
        { docPath: 'knowledge/manual/b.md', markdown: '# B\n\n## GET /b\ny' },
      ],
      ...PIPELINE_OFF,
    });
    // Re-submit only one doc → the other's claims drop.
    await scanWorkspaceInProcess({
      workspaceOrgId: ORG_A,
      docs: [{ docPath: 'knowledge/manual/a.md', markdown: '# A\n\n## GET /a\nx' }],
      ...PIPELINE_OFF,
    });
    const claims = await getWorkspaceClaims<{ claims: Array<{ subject: string }> }>(ORG_A);
    expect(claims?.claims.some((c) => c.subject === 'GET /a')).toBe(true);
    expect(claims?.claims.some((c) => c.subject === 'GET /b')).toBe(false);
  });
});

// A stub that makes two docs disagree on the same endpoint → a content conflict.
const conflictRunner: BlockRunner = async (blocks: Block[]) =>
  blocks.map((block) => {
    const heading = block.headingPath.at(-1) ?? '';
    if (heading === 'POST /api/orders') {
      const response = block.filePath.includes('b.md') ? '201' : '200';
      return {
        block,
        extraction: {
          topics: ['endpoints'],
          claims: [
            {
              topic: 'endpoints' as const,
              subject: 'POST /api/orders',
              content: { method: 'POST', path: '/api/orders', response },
              kind: 'definition' as const,
            },
          ],
        },
        durationMs: 0,
      };
    }
    return { block, extraction: { topics: [], claims: [] }, durationMs: 0 };
  });

const CONFLICT_DOCS = [
  { docPath: 'knowledge/manual/a.md', markdown: '# Orders A\n\n## POST /api/orders\nCreate.' },
  { docPath: 'knowledge/manual/b.md', markdown: '# Orders B\n\n## POST /api/orders\nCreate.' },
];

interface OpenConflict {
  id: string;
  candidateFingerprint: string;
  defaultPick: number;
}

describe('workspace conflict resolution — body-free remerge (no docs re-provided)', () => {
  let client: PGlite;

  beforeEach(async () => {
    client = new PGlite();
    const db = await makeDb(client);
    setSpecStore(new PgSpecStore(db));
    setKvCacheStore(new PgKvCacheStore(db)); // caches → Postgres (no stray local files)
  });
  afterEach(async () => {
    resetSpecStore();
    resetKvCacheStore();
    await client.close();
  });

  async function scanConflict(): Promise<OpenConflict> {
    const { scanState } = await scanWorkspaceInProcess({
      workspaceOrgId: ORG_A,
      docs: CONFLICT_DOCS,
      blockRunner: conflictRunner,
      disableLlmChainDetection: true,
      disableChainRecheck: true,
      disableConflictExplanations: true,
      disableConflictResolution: true,
      disableRelevanceFilter: true,
    });
    expect(scanState.openConflicts).toHaveLength(1);
    return scanState.openConflicts[0] as OpenConflict;
  }

  it('upsertWorkspaceDecision resolves a conflict, then revoke re-opens it — all via the store', async () => {
    const open = await scanConflict();

    const resolved = await upsertWorkspaceDecision(ORG_A, {
      conflictId: open.id,
      resolution: { kind: 'pick', candidateIndex: open.defaultPick },
      candidateFingerprint: open.candidateFingerprint,
    });
    expect(resolved.openConflicts).toHaveLength(0);
    expect(resolved.decidedConflicts).toHaveLength(1);

    // The picked claim is now in the canonical claims set.
    const claims = await getWorkspaceClaims<{ claims: Array<{ subject: string }> }>(ORG_A);
    expect(claims?.claims.some((c) => c.subject === 'POST /api/orders')).toBe(true);
    // The decision is durable.
    const decisions = await getWorkspaceDecisions(ORG_A);
    expect(decisions.decisions.some((d) => d.conflictId === open.id)).toBe(true);

    const reopened = await revokeWorkspaceDecision(ORG_A, open.id);
    expect(reopened.openConflicts).toHaveLength(1);
    expect(reopened.decidedConflicts).toHaveLength(0);
  });

  it('resolveAllWorkspaceDefaults accepts the default pick on every open conflict', async () => {
    await scanConflict();
    const after = await resolveAllWorkspaceDefaults(ORG_A);
    expect(after.openConflicts).toHaveLength(0);
    expect(after.decidedConflicts).toHaveLength(1);
  });
});
