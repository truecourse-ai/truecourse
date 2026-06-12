import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { FsBlobStore } from '../../ee/packages/storage/src/index';
import { PgContractStore, PgSpecStore } from '../../ee/packages/data-store/src/index';
import {
  setContractStore,
  resetContractStore,
  hasContracts,
  saveContracts,
  type RepoRef,
} from '@truecourse/core/lib/contract-store';
import { setSpecStore, resetSpecStore, saveSpec } from '@truecourse/core/lib/spec-store';
import { driftsForCommit } from '../../ee/packages/github-app/src/gate-runner';
import type { SpecScanPipeline } from '../../ee/packages/github-app/src/spec-scan';
import type { VerifyFn } from '../../ee/packages/github-app/src/gate-runner';

const REPO = 'acme/api';

let client: PGlite;
let blobDir: string;
let fixtureDir: string;
let checkoutDir: string;

/** A tiny contracts tree to ingest as a "generated" set. */
function makeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fix-'));
  const f = path.join(dir, '_shared', 'auth.tc');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'auth requirement');
  return dir;
}

beforeEach(async () => {
  client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  blobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-blob-'));
  setContractStore(new PgContractStore(db as unknown as EeDb, new FsBlobStore(blobDir)));
  setSpecStore(new PgSpecStore(db as unknown as EeDb));
  fixtureDir = makeFixture();
  checkoutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-checkout-'));
});

afterEach(async () => {
  resetContractStore();
  resetSpecStore();
  await client.close();
  for (const d of [blobDir, fixtureDir, checkoutDir]) fs.rmSync(d, { recursive: true, force: true });
});

const verifyOk: VerifyFn = async () => [{ filePath: 'a.ts', lineStart: 1 } as never];
/** A clean scan (no unresolved conflicts) — the common cold-path case. */
const cleanScan = () => vi.fn(async () => ({ openConflicts: 0 }));

describe('driftsForCommit — gate contract sourcing (warm/cold/null/fail)', () => {
  it('WARM: contracts already stored → no generation, returns verified drifts', async () => {
    await saveContracts({ repoKey: REPO, commitSha: 'warm1' }, 'contracts', fixtureDir);
    const generate = vi.fn(async () => ({ fileCount: 0 }));
    const scan = cleanScan();
    const result = await driftsForCommit(
      { scan, generate } as SpecScanPipeline,
      verifyOk,
      REPO,
      'warm1',
      checkoutDir,
    );
    expect(scan).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled(); // warm → no cold generation
    expect(result.drifts).toHaveLength(1);
    expect(result.openConflicts).toBe(0); // no persisted scan-state → 0 conflicts
  });

  it('WARM with persisted conflicts → recovers the open-conflict count from scan-state', async () => {
    // Contracts were generated earlier (e.g. the scan checkbox) but the spec had
    // unresolved conflicts. A warm gate run must NOT trust the cached, auto-
    // defaulted contracts — it recovers the conflict count from the stored scan-
    // state so decideGate still goes neutral.
    const ref: RepoRef = { repoKey: REPO, commitSha: 'warmc' };
    await saveContracts(ref, 'contracts', fixtureDir);
    await saveSpec(ref, 'scanState', {
      openConflicts: [{ id: 'c1' }, { id: 'c2' }],
      decidedConflicts: [],
    });
    const scan = cleanScan();
    const result = await driftsForCommit(
      { scan, generate: vi.fn(async () => ({ fileCount: 0 })) } as SpecScanPipeline,
      verifyOk,
      REPO,
      'warmc',
      checkoutDir,
    );
    expect(scan).not.toHaveBeenCalled(); // warm → no re-scan
    expect(result.drifts).toHaveLength(1);
    expect(result.openConflicts).toBe(2); // recovered from the persisted scan-state
  });

  it('COLD: no contracts → scans + generates on the checkout, persists, then verifies', async () => {
    const scan = cleanScan();
    const generate = vi.fn(async (root: string, ref: RepoRef) => {
      expect(root).toBe(checkoutDir); // generation runs on the gate's own checkout
      await saveContracts(ref, 'contracts', fixtureDir); // simulate real generation
      return { fileCount: 1 };
    });
    const result = await driftsForCommit(
      { scan, generate } as SpecScanPipeline,
      verifyOk,
      REPO,
      'cold1',
      checkoutDir,
    );
    expect(scan).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.drifts).toHaveLength(1);
    expect(result.openConflicts).toBe(0);
    expect(await hasContracts({ repoKey: REPO, commitSha: 'cold1' }, 'contracts')).toBe(true);
  });

  it('COLD with unresolved conflicts → reports the open-conflict count from the scan', async () => {
    const scan = vi.fn(async () => ({ openConflicts: 3 })); // spec docs conflicted
    const generate = vi.fn(async (_root: string, ref: RepoRef) => {
      await saveContracts(ref, 'contracts', fixtureDir); // auto-defaulted contracts
      return { fileCount: 1 };
    });
    const result = await driftsForCommit(
      { scan, generate } as SpecScanPipeline,
      verifyOk,
      REPO,
      'conflict1',
      checkoutDir,
    );
    expect(result.drifts).toHaveLength(1); // contracts still generated...
    expect(result.openConflicts).toBe(3); // ...but the caller learns they're a guess
  });

  it('NULL: generation produces no contracts (no spec) → null (neutral, not error)', async () => {
    const scan = cleanScan();
    const generate = vi.fn(async () => ({ fileCount: 0 })); // stores nothing
    const result = await driftsForCommit(
      { scan, generate } as SpecScanPipeline,
      verifyOk,
      REPO,
      'none1',
      checkoutDir,
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.drifts).toBeNull();
  });

  it('FAILURE: a generation throw propagates (→ gate error Check, never neutral)', async () => {
    const scan = cleanScan();
    const generate = vi.fn(async () => {
      throw new Error('LLM exploded');
    });
    await expect(
      driftsForCommit({ scan, generate } as SpecScanPipeline, verifyOk, REPO, 'boom1', checkoutDir),
    ).rejects.toThrow(/LLM exploded/);
  });

  it('FAILURE: a verify throw AFTER contracts exist propagates (not swallowed to neutral)', async () => {
    // Contracts present (warm) but verification itself fails — e.g. a GC'd/
    // missing object surfaces as a loadContracts integrity error. This must
    // propagate to the gate's error Check, never collapse to a neutral null.
    await saveContracts({ repoKey: REPO, commitSha: 'vbroke' }, 'contracts', fixtureDir);
    const verifyThrows: VerifyFn = async () => {
      throw new Error('missing object sha256-xyz for _shared/auth.tc');
    };
    await expect(
      driftsForCommit(
        { scan: cleanScan(), generate: vi.fn(async () => ({ fileCount: 0 })) } as SpecScanPipeline,
        verifyThrows,
        REPO,
        'vbroke',
        checkoutDir,
      ),
    ).rejects.toThrow(/missing object/);
  });

  it('relativizes drift paths against the checkout root', async () => {
    await saveContracts({ repoKey: REPO, commitSha: 'rel1' }, 'contracts', fixtureDir);
    const abs = path.join(checkoutDir, 'src', 'x.ts');
    const verify: VerifyFn = async () => [{ filePath: abs, lineStart: 3 } as never];
    const result = await driftsForCommit(
      { scan: cleanScan(), generate: vi.fn(async () => ({ fileCount: 0 })) } as SpecScanPipeline,
      verify,
      REPO,
      'rel1',
      checkoutDir,
    );
    expect(result.drifts![0]!.filePath).toBe('src/x.ts'); // repo-relative, no temp-clone leak
  });
});
