import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { FsBlobStore } from '../../ee/packages/storage/src/index';
import { PgBlobContractStore } from '../../ee/packages/data-store/src/index';
// Import the store from the SAME package path the route module uses
// (`@truecourse/core/lib/contract-store`), so the test and the route share one
// `active` store instance — not the separate source-path module.
import {
  setContractStore,
  resetContractStore,
  saveContracts,
  saveWorkspaceContracts,
} from '@truecourse/core/lib/contract-store';
import { effectiveContractFiles } from '../../apps/dashboard/server/src/routes/contracts';

/**
 * The dashboard read-side effective merge: a repo's contract tree = its own
 * (authored + inferred) UNIONed with the workspace corpus it inherits, the repo
 * winning on a relpath collision, each file tagged with its layer for the badge.
 */

const REPO = 'acme/api';
const ORG = 'org_A';

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

describe('effectiveContractFiles (dashboard read-side merge)', () => {
  let client: PGlite;
  let blobDir: string;
  let repoSrc: string;

  beforeEach(async () => {
    client = new PGlite();
    blobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-eff-blob-'));
    repoSrc = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-eff-reposrc-'));
    setContractStore(new PgBlobContractStore(await makeDb(client), new FsBlobStore(blobDir)));

    // Repo's own contracts: orders (also defined by the workspace) + a repo-only file.
    const c = path.join(repoSrc, '.truecourse', 'contracts');
    fs.mkdirSync(path.join(c, 'orders', 'operations'), { recursive: true });
    fs.mkdirSync(path.join(c, 'billing'), { recursive: true });
    fs.writeFileSync(path.join(c, 'orders', 'operations', 'post-api-orders.tc'), 'operation POST "/api/orders" {}');
    fs.writeFileSync(path.join(c, 'billing', 'invoice.tc'), 'entity Invoice {}');
    await saveContracts({ repoKey: REPO, commitSha: 'c1' }, 'contracts', c);

    // Workspace corpus: the SAME orders operation (repo overrides) + a workspace-only widget.
    await saveWorkspaceContracts({ workspaceOrgId: ORG }, 'contracts', {
      'orders/operations/post-api-orders.tc': 'operation POST "/api/orders" {}',
      'widgets/operations/post-api-widgets.tc': 'operation POST "/api/widgets" {}',
    });
  });
  afterEach(async () => {
    resetContractStore();
    await client.close();
    fs.rmSync(blobDir, { recursive: true, force: true });
    fs.rmSync(repoSrc, { recursive: true, force: true });
  });

  it('unions workspace ∪ repo, repo winning on a relpath collision, tagging provenance', async () => {
    const files = await effectiveContractFiles(REPO, ORG);
    const byPath = new Map(files.map((f) => [f.path, f.provenance]));

    // Repo's own files → 'repo'.
    expect(byPath.get('billing/invoice.tc')).toBe('repo');
    // Collision (defined in BOTH) → repo wins, and appears exactly once.
    expect(byPath.get('orders/operations/post-api-orders.tc')).toBe('repo');
    expect(files.filter((f) => f.path === 'orders/operations/post-api-orders.tc')).toHaveLength(1);
    // Workspace-only → inherited.
    expect(byPath.get('widgets/operations/post-api-widgets.tc')).toBe('workspace');
  });

  it('is repo-only when there is no workspace org (OSS / unlinked repo)', async () => {
    const files = await effectiveContractFiles(REPO, undefined);
    expect(files.every((f) => f.provenance === 'repo')).toBe(true);
    expect(files.some((f) => f.path.startsWith('widgets/'))).toBe(false); // no inherited contracts
  });
});
