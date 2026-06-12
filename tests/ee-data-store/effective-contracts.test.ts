import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { FsBlobStore } from '../../ee/packages/storage/src/index';
import { PgContractStore, PgSpecStore } from '../../ee/packages/data-store/src/index';
import { verifyInProcess } from '../../packages/core/src/commands/spec-in-process.js';
import {
  setContractStore,
  resetContractStore,
  saveContracts,
  saveWorkspaceContracts,
  type RepoRef,
} from '../../packages/core/src/lib/contract-store.js';
import { setSpecStore, resetSpecStore } from '../../packages/core/src/lib/spec-store.js';

/**
 * The enterprise EFFECTIVE-contracts merge at the gate's verify seam: a repo is
 * verified against `workspace ∪ repo` (repo wins by `${kind}:${identity}`). Real
 * Postgres (pglite) + fs blob store; code dir is empty so a `shipped` operation
 * with no route produces an `implementation.missing` drift.
 */

const ORG = 'org_A';
const ref: RepoRef = { repoKey: 'acme/api', commitSha: 'sha1' };

// A workspace operation contract with no code-side route → a "missing" drift.
const WS_WIDGETS = 'operation POST "/api/widgets" {\n  origin "ws.md" "Widgets" 1..2\n  tags []\n}\n';

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('effective contracts at verify (workspace ∪ repo, repo wins)', () => {
  let client: PGlite;
  let blobDir: string;
  let codeDir: string;

  beforeEach(async () => {
    client = new PGlite();
    blobDir = tmpDir('tc-eff-blob-');
    codeDir = tmpDir('tc-eff-code-');
    // An empty (route-less) code tree — a touch file so the walker has something.
    fs.writeFileSync(path.join(codeDir, 'index.ts'), 'export const x = 1;\n');
    const db = await makeDb(client);
    setContractStore(new PgContractStore(db, new FsBlobStore(blobDir)));
    // verifyInProcess persists the per-commit `verifyState` via the spec store;
    // install the Postgres one so it lands in the DB (not an `acme/api/.truecourse`
    // tree relative to cwd) — the gate always runs with the EE stores installed.
    setSpecStore(new PgSpecStore(db));
  });
  afterEach(async () => {
    resetContractStore();
    resetSpecStore();
    await client.close();
    fs.rmSync(blobDir, { recursive: true, force: true });
    fs.rmSync(codeDir, { recursive: true, force: true });
  });

  function missingWidgets(drifts: Array<{ artifactRef?: { identity?: string } | null; obligationKey?: string }>) {
    return drifts.find(
      (d) => d.artifactRef?.identity === 'POST /api/widgets' && d.obligationKey === 'implementation.missing',
    );
  }

  it('a repo with NO contracts of its own still drifts against the workspace (cross-repo ripple)', async () => {
    await saveWorkspaceContracts({ workspaceOrgId: ORG }, 'contracts', {
      'widgets/operations/post-api-widgets.tc': WS_WIDGETS,
    });
    // No saveContracts(ref, …) — the repo has no contracts of its own.
    const { verify } = await verifyInProcess(codeDir, {
      skipStash: true,
      codeDir,
      ref,
      workspaceOrgId: ORG,
    });
    expect(missingWidgets(verify.drifts)).toBeTruthy(); // the workspace contract is enforced
  });

  it('a repo contract OVERRIDES the workspace one on a key collision (repo wins)', async () => {
    await saveWorkspaceContracts({ workspaceOrgId: ORG }, 'contracts', {
      'widgets/operations/post-api-widgets.tc': WS_WIDGETS,
    });
    // The repo redefines the SAME operation as out-of-scope (in a differently
    // named file) → repo wins → the "missing" drift is suppressed.
    const repoSrc = tmpDir('tc-eff-reposrc-');
    fs.mkdirSync(path.join(repoSrc, 'custom'), { recursive: true });
    fs.writeFileSync(
      path.join(repoSrc, 'custom', 'widgets.tc'),
      'operation POST "/api/widgets" {\n  origin "repo.md" "Widgets" 1..2\n  status out-of-scope\n  tags []\n}\n',
    );
    await saveContracts(ref, 'contracts', repoSrc);
    fs.rmSync(repoSrc, { recursive: true, force: true });

    const { verify } = await verifyInProcess(codeDir, {
      skipStash: true,
      codeDir,
      ref,
      workspaceOrgId: ORG,
    });
    expect(missingWidgets(verify.drifts)).toBeFalsy(); // repo's out-of-scope wins → no drift
  });

  it('without a workspace org, a repo with no contracts is repo-only (no merge → errors)', async () => {
    await saveWorkspaceContracts({ workspaceOrgId: ORG }, 'contracts', {
      'widgets/operations/post-api-widgets.tc': WS_WIDGETS,
    });
    // No workspaceOrgId passed → the workspace layer is NOT consulted; with no
    // repo contracts either, verification has nothing to run against.
    await expect(
      verifyInProcess(codeDir, { skipStash: true, codeDir, ref }),
    ).rejects.toThrow(/Contracts directory not found/);
  });
});
