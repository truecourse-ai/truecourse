import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { FsBlobStore } from '../../ee/packages/storage/src/index';
import { PgContractStore } from '../../ee/packages/data-store/src/index';
import {
  setContractStore,
  resetContractStore,
  saveContracts,
  saveWorkspaceContracts,
  hasContracts,
  listContractFiles,
  readContractFile,
  listWorkspaceContractFiles,
  readWorkspaceContractFile,
  type RepoRef,
} from '../../packages/core/src/lib/contract-store.js';

/**
 * The enterprise data store serves the TWO contract layers a repo's EFFECTIVE
 * contracts merge from — the workspace layer (shared across the org) and the
 * repo layer (its own `.tc`). The resolver's `workspace ∪ repo` merge (repo wins
 * by `${kind}:${identity}`) is a contract-verifier concern; here we assert the
 * store faithfully persists + serves both layers, which is what the merge (and
 * the dashboard's provenance display) reads. Real Postgres (pglite) + fs blobs.
 */

const ORG = 'org_A';
const ref: RepoRef = { repoKey: 'acme/api', commitSha: 'sha1' };

// A workspace operation contract; the repo redefines the SAME operation identity
// (POST /api/widgets) as out-of-scope in a differently named file — the collision
// the resolver's "repo wins" merge resolves, from these two stored layers.
const WS_WIDGETS = 'operation POST "/api/widgets" {\n  origin "ws.md" "Widgets" 1..2\n  tags []\n}\n';
const WS_REL = 'widgets/operations/post-api-widgets.tc';
const REPO_WIDGETS =
  'operation POST "/api/widgets" {\n  origin "repo.md" "Widgets" 1..2\n  status out-of-scope\n  tags []\n}\n';
const REPO_REL = 'custom/widgets.tc';

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('effective-contract layers (workspace + repo) served by the EE store', () => {
  let client: PGlite;
  let blobDir: string;

  beforeEach(async () => {
    client = new PGlite();
    blobDir = tmpDir('tc-eff-blob-');
    setContractStore(new PgContractStore(await makeDb(client), new FsBlobStore(blobDir)));
  });
  afterEach(async () => {
    resetContractStore();
    await client.close();
    fs.rmSync(blobDir, { recursive: true, force: true });
  });

  it('a repo with NO contracts of its own still inherits the workspace layer (cross-repo ripple source)', async () => {
    await saveWorkspaceContracts({ workspaceOrgId: ORG }, 'contracts', { [WS_REL]: WS_WIDGETS });

    // The repo layer is empty…
    expect(await hasContracts(ref, 'contracts')).toBe(false);
    // …but the workspace layer is available for the effective merge to pull from.
    expect(await listWorkspaceContractFiles({ workspaceOrgId: ORG }, 'contracts')).toContain(WS_REL);
    expect(await readWorkspaceContractFile({ workspaceOrgId: ORG }, 'contracts', WS_REL)).toBe(WS_WIDGETS);
  });

  it('serves BOTH layers for a key collision — the inputs the resolver merges (repo wins)', async () => {
    await saveWorkspaceContracts({ workspaceOrgId: ORG }, 'contracts', { [WS_REL]: WS_WIDGETS });

    const repoSrc = tmpDir('tc-eff-reposrc-');
    fs.mkdirSync(path.join(repoSrc, 'custom'), { recursive: true });
    fs.writeFileSync(path.join(repoSrc, REPO_REL), REPO_WIDGETS);
    await saveContracts(ref, 'contracts', repoSrc);
    fs.rmSync(repoSrc, { recursive: true, force: true });

    // Repo layer present + serving its own (out-of-scope) definition…
    expect(await hasContracts(ref, 'contracts')).toBe(true);
    expect(await listContractFiles(ref.repoKey, 'contracts', ref.commitSha)).toContain(REPO_REL);
    expect(await readContractFile(ref.repoKey, 'contracts', REPO_REL, ref.commitSha)).toContain('out-of-scope');
    // …and the workspace layer still present, so the merge sees both for the key.
    expect(await readWorkspaceContractFile({ workspaceOrgId: ORG }, 'contracts', WS_REL)).toBe(WS_WIDGETS);
  });
});
