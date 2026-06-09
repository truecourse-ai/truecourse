import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { setKvCacheStore, resetKvCacheStore } from '@truecourse/llm';
import { FsBlobStore } from '../../ee/packages/storage/src/index';
import { PgBlobContractStore, PgSpecStore, PgKvCacheStore } from '../../ee/packages/data-store/src/index';
import { generateWorkspaceContractsInProcess } from '../../packages/core/src/commands/spec-in-process.js';
import {
  setSpecStore,
  resetSpecStore,
  saveWorkspaceSpec,
} from '../../packages/core/src/lib/spec-store.js';
import {
  setContractStore,
  resetContractStore,
  listWorkspaceContractFiles,
  readWorkspaceContractFile,
} from '../../packages/core/src/lib/contract-store.js';
import type { SliceRunner } from '../../packages/contract-extractor/src/index.js';

/**
 * End-to-end for the enterprise workspace contract path: persisted canonical
 * claims → in-memory generation (no disk) → workspace contract store. Stores are
 * Postgres (pglite) + fs blob, the slice cache is Postgres, and the extractor
 * runner is stubbed so no Claude subprocess runs.
 */

const ORG = 'org_A';

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

/** A claims.json with two in-scope modules → two slices → two operations. */
function claimsFixture() {
  const modules = [
    { name: 'orders', subject: 'POST /api/orders' },
    { name: 'auth', subject: 'GET /api/auth/me' },
  ];
  return {
    version: 1,
    generatedAt: '2026-05-22T00:00:00Z',
    modules: modules.map((m) => ({
      name: m.name,
      status: 'shipped' as const,
      sourceDocs: ['docs/source.md'],
      scope: { paths: [`/api/${m.name}/**`] },
    })),
    claims: modules.map((m, idx) => ({
      id: `claim-${idx}`,
      module: m.name,
      source: 'extracted',
      topic: 'endpoints',
      subject: m.subject,
      content: { method: m.subject.split(' ')[0], path: m.subject.split(' ')[1] },
      kind: 'definition',
      provenance: { file: 'docs/source.md', line: 1, quote: m.subject },
      metadata: { docKind: 'spec', lastTouched: '2026-05-22T00:00:00Z' },
    })),
  };
}

/** Stub runner: one Operation fragment per slice (mirrors the orchestrator test). */
function stubRunner(onCall?: () => void): SliceRunner {
  return async (slices) => {
    onCall?.();
    return slices.map((slice) => {
      const opName = slice.headingPath.join('/');
      const slug = opName.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
      return {
        slice,
        result: {
          fragments: [
            {
              kind: 'Operation',
              identity: `POST /api/${slug}`,
              tcSource: [
                `operation POST "/api/${slug}" {`,
                `  origin "${slice.specPath}" "${opName}" ${slice.lineRange[0]}..${slice.lineRange[1]}`,
                `  response 201 on success {}`,
                `  tags []`,
                `}`,
              ].join('\n'),
              origin: { source: slice.specPath, section: opName, lines: slice.lineRange },
              obligationKeys: [],
            },
          ],
        },
        durationMs: 1,
      };
    });
  };
}

describe('generateWorkspaceContractsInProcess (pglite + fs blob)', () => {
  let client: PGlite;
  let blobDir: string;
  let db: EeDb;

  beforeEach(async () => {
    client = new PGlite();
    blobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ws-blob-'));
    db = await makeDb(client);
    setSpecStore(new PgSpecStore(db));
    setContractStore(new PgBlobContractStore(db, new FsBlobStore(blobDir)));
    setKvCacheStore(new PgKvCacheStore(db)); // slice cache → Postgres (no stray files)
  });
  afterEach(async () => {
    resetSpecStore();
    resetContractStore();
    resetKvCacheStore();
    await client.close();
    fs.rmSync(blobDir, { recursive: true, force: true });
  });

  it('generates + stores the workspace corpus from persisted claims', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'claims', claimsFixture());

    const res = await generateWorkspaceContractsInProcess(ORG, {
      runner: stubRunner(),
      disableRepair: true,
    });
    expect(res.kind).toBe('generated');
    expect(res.fileCount).toBeGreaterThan(0);

    const files = await listWorkspaceContractFiles({ workspaceOrgId: ORG }, 'contracts');
    expect(files.length).toBeGreaterThan(0);
    const opFile = files.find((f) => f.includes('operations'));
    expect(opFile).toBeDefined();
    const content = await readWorkspaceContractFile({ workspaceOrgId: ORG }, 'contracts', opFile!);
    expect(content).toContain('operation POST');
  });

  it('costs 0 LLM on re-generation of unchanged claims (Postgres slice cache)', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'claims', claimsFixture());
    let calls = 0;
    const counting = stubRunner(() => {
      calls += 1;
    });

    await generateWorkspaceContractsInProcess(ORG, { runner: counting, disableRepair: true });
    expect(calls).toBe(1);
    await generateWorkspaceContractsInProcess(ORG, { runner: counting, disableRepair: true });
    expect(calls).toBe(1); // every slice hit the cache → runner never re-invoked
  });

  it('skips when the workspace has no canonical claims yet', async () => {
    const res = await generateWorkspaceContractsInProcess(ORG, {
      runner: stubRunner(),
      disableRepair: true,
    });
    expect(res).toMatchObject({ kind: 'skipped' });
    expect(await listWorkspaceContractFiles({ workspaceOrgId: ORG }, 'contracts')).toEqual([]);
  });
});
