import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { PgSpecStore, PgKvCacheStore, PgBlobContractStore } from '../../ee/packages/data-store/src/index';
import { FsBlobStore } from '../../ee/packages/storage/src/index';
import { setSpecStore, resetSpecStore, loadLatestSpec } from '../../packages/core/src/lib/spec-store.js';
import {
  setContractStore,
  resetContractStore,
  listContractFiles,
  readContractFile,
} from '../../packages/core/src/lib/contract-store.js';
import { setKvCacheStore, resetKvCacheStore } from '@truecourse/llm';
import {
  scanInProcess,
  getScanState,
  upsertDecision,
  revokeDecision,
  resolveAllDefaultsRemerge,
  refreshRepoCanonicalSpec,
  regenerateRepoContractsFromDecisions,
} from '../../packages/core/src/commands/spec-in-process.js';
import type { Block, BlockRunner } from '../../packages/spec-consolidator/src/index.js';
import type { SliceRunner } from '../../packages/contract-extractor/src/index.js';

const REPO = 'acme/api';
const COMMIT = 'c0ffee1';

// Two docs disagree on the same endpoint's response → one content conflict.
const conflictRunner: BlockRunner = async (blocks: Block[]) =>
  blocks.map((block) => {
    const heading = block.headingPath.at(-1) ?? '';
    if (heading === 'POST /api/orders') {
      const response = block.filePath.includes('b.md') ? '201' : '200';
      return {
        block,
        extraction: {
          topics: ['endpoints'] as const,
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

const PIPELINE_OFF = {
  blockRunner: conflictRunner,
  disableLlmChainDetection: true,
  disableChainRecheck: true,
  disableConflictExplanations: true,
  disableConflictResolution: true,
  disableRelevanceFilter: true,
  skipGit: true,
} as const;

interface OpenConflict {
  id: string;
  candidateFingerprint: string;
  defaultPick: number;
}

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

// Stub contract slice runner — one Operation fragment per slice, no LLM.
function stubRunner(): SliceRunner {
  return async (slices) =>
    slices.map((slice) => {
      const opName = slice.headingPath.join('/');
      const slug = opName.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
      return {
        slice,
        result: {
          fragments: [
            {
              kind: 'Operation' as const,
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
}

describe('hosted repo conflict resolution — body-free re-merge (no working tree)', () => {
  let client: PGlite;
  let repoDir: string;
  let blobDir: string;

  beforeEach(async () => {
    client = new PGlite();
    const db = await makeDb(client);
    blobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-repo-remerge-blob-'));
    setSpecStore(new PgSpecStore(db)); // hosted store → specsMaterializeInPlace() is false
    setContractStore(new PgBlobContractStore(db, new FsBlobStore(blobDir)));
    setKvCacheStore(new PgKvCacheStore(db));
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-repo-remerge-'));
    fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'docs', 'a.md'), '# Orders A\n\n## POST /api/orders\nCreate.');
    fs.writeFileSync(path.join(repoDir, 'docs', 'b.md'), '# Orders B\n\n## POST /api/orders\nCreate.');
  });
  afterEach(async () => {
    resetSpecStore();
    resetContractStore();
    resetKvCacheStore();
    await client.close();
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(blobDir, { recursive: true, force: true });
  });

  /** Run the gate-style scan (persists claims + rawClaims + chains + scan-state). */
  async function scan(): Promise<OpenConflict> {
    await scanInProcess(repoDir, { ref: { repoKey: REPO, commitSha: COMMIT }, ...PIPELINE_OFF });
    const state = await getScanState(REPO);
    expect(state?.openConflicts).toHaveLength(1);
    return state!.openConflicts[0] as unknown as OpenConflict;
  }

  it('getScanState re-merges on read — a decision resolves the conflict WITHOUT a re-scan', async () => {
    const open = await scan();

    // Persist ONLY the decision (git-free); no re-scan / re-clone of the docs.
    await upsertDecision(REPO, {
      conflictId: open.id,
      resolution: { kind: 'pick', candidateIndex: open.defaultPick },
      candidateFingerprint: open.candidateFingerprint,
    });

    // getScanState re-derives from the persisted rawClaims+chains+decisions.
    const resolved = await getScanState(REPO);
    expect(resolved?.openConflicts).toHaveLength(0);
    expect(resolved?.decidedConflicts).toHaveLength(1);

    // Revoke re-opens it — still no docs.
    await revokeDecision(REPO, open.id);
    const reopened = await getScanState(REPO);
    expect(reopened?.openConflicts).toHaveLength(1);
    expect(reopened?.decidedConflicts).toHaveLength(0);
  }, 90_000);

  it('resolveAllDefaultsRemerge accepts the engine default on every open conflict', async () => {
    await scan();
    const after = await resolveAllDefaultsRemerge(REPO);
    expect(after?.openConflicts).toHaveLength(0);
    expect(after?.decidedConflicts).toHaveLength(1);

    // Durable: a fresh read still shows it resolved.
    const reread = await getScanState(REPO);
    expect(reread?.openConflicts).toHaveLength(0);
  }, 90_000);

  it('refreshRepoCanonicalSpec persists the re-merged canonical claims (Spec view fresh, no LLM)', async () => {
    const open = await scan();
    // While the conflict is open, the disputed subject is NOT in the canonical claims.
    const before = await loadLatestSpec<{ claims: Array<{ subject: string }> }>(REPO, 'claims');
    expect(before?.claims.some((c) => c.subject === 'POST /api/orders')).toBe(false);

    await upsertDecision(REPO, {
      conflictId: open.id,
      resolution: { kind: 'pick', candidateIndex: open.defaultPick },
      candidateFingerprint: open.candidateFingerprint,
    });
    // Fast synchronous step (no docs/git/LLM) — what the decision route runs inline.
    const refreshed = await refreshRepoCanonicalSpec(REPO);
    expect(refreshed).not.toBeNull();

    // The persisted canonical claims the Spec tab reads now reflect the resolution.
    const after = await loadLatestSpec<{ claims: Array<{ subject: string }> }>(REPO, 'claims');
    expect(after?.claims.some((c) => c.subject === 'POST /api/orders')).toBe(true);
  }, 90_000);

  it('regenerates the repo contracts from the re-merged claims, keyed by the latest commit', async () => {
    const open = await scan();
    await upsertDecision(REPO, {
      conflictId: open.id,
      resolution: { kind: 'pick', candidateIndex: open.defaultPick },
      candidateFingerprint: open.candidateFingerprint,
    });

    // Regenerate from STORE state (no working tree, stub runner ⇒ no LLM).
    const res = await regenerateRepoContractsFromDecisions(REPO, {
      runner: stubRunner(),
      disableRepair: true,
    });
    expect(res.kind).toBe('generated');
    expect(res.fileCount).toBeGreaterThan(0);

    // The .tc corpus lands in the contract store under the latest commit, so the
    // Contracts tab (loadLatest) + the gate (this commit) both see it.
    const latest = await listContractFiles(REPO, 'contracts');
    expect(latest.length).toBeGreaterThan(0);
    const atCommit = await listContractFiles(REPO, 'contracts', COMMIT);
    expect(atCommit).toEqual(latest);
    const opFile = latest.find((f) => f.includes('operations'));
    expect(opFile).toBeDefined();
    const content = await readContractFile(REPO, 'contracts', opFile!, COMMIT);
    expect(content).toContain('operation POST');
  }, 90_000);
});
