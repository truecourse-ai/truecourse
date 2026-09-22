/**
 * The hosted generate job puts the stored scenario set into its clone before
 * the engine runs. The set is more than its yaml: the committed flows and
 * claims beside the manifest are what synthesis reconciles against, and a
 * clone without them makes every flow look new — the churn TRU-103 removes
 * comes straight back through this seam. Pinned over the real Postgres store.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { guardFlowsPath, guardClaimsPath, scenariosDir } from '@truecourse/shared/work-tree';
import { PgGuardStore } from '../../packages/data-store/src/index';
import { setGuardStore, resetGuardStore, saveScenarios } from '@truecourse/core/lib/guard-store';
import { materializeStoredGuardState } from '../../apps/dashboard/server/src/jobs/materialize-guard';

const REPO = 'acme/api';
const COMMIT = 'a'.repeat(40);

const FLOWS = JSON.stringify({ version: 1, generatedAt: '2026-01-01T00:00:00.000Z', flows: [{ id: 'sign-in' }] });
const CLAIMS = JSON.stringify({ version: 1, claims: [{ id: 'c1' }] });
const YAML = 'id: sign-in-once\n';

let client: PGlite;
let treeDir: string;

beforeEach(async () => {
  client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  setGuardStore(new PgGuardStore(db as unknown as Db));
  treeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-materialize-guard-'));
});
afterEach(async () => {
  resetGuardStore();
  fs.rmSync(treeDir, { recursive: true, force: true });
  await client.close();
});

/** Store a scenario set holding the corpus files and one scenario. */
async function storeSet(): Promise<void> {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-materialize-src-'));
  try {
    fs.writeFileSync(path.join(src, 'flows.json'), FLOWS);
    fs.writeFileSync(path.join(src, 'claims.json'), CLAIMS);
    fs.mkdirSync(path.join(src, 'auth'));
    fs.writeFileSync(path.join(src, 'auth', 'sign-in.yaml'), YAML);
    await saveScenarios({ repoKey: REPO, commitSha: COMMIT }, src);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
  }
}

describe('materializeStoredGuardState', () => {
  it('puts the committed flows and claims into the clone beside the scenario yaml', async () => {
    await storeSet();

    expect(await materializeStoredGuardState(REPO, treeDir)).toBe(COMMIT);

    expect(fs.readFileSync(guardFlowsPath(treeDir), 'utf-8')).toBe(FLOWS);
    expect(fs.readFileSync(guardClaimsPath(treeDir), 'utf-8')).toBe(CLAIMS);
    expect(fs.readFileSync(path.join(scenariosDir(treeDir), 'auth', 'sign-in.yaml'), 'utf-8')).toBe(YAML);
  });

  it('writes nothing for a repository that never generated', async () => {
    expect(await materializeStoredGuardState(REPO, treeDir)).toBeNull();
    expect(fs.existsSync(scenariosDir(treeDir))).toBe(false);
  });
});
