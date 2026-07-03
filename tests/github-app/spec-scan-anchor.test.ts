/**
 * `materializeAnchorContracts` restores a stored contract set — its `.tc` tree AND
 * the generate manifest — into a clone's `.truecourse/contracts/`, so an anchored
 * regenerate at the merge commit no-ops unchanged areas and reproduces exactly the
 * reviewed contracts. Old sets with no stored manifest still materialize (just no
 * manifest.json) without error.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { PgContractStore } from '../../ee/packages/data-store/src/index';
import {
  setContractStore,
  resetContractStore,
  saveContracts,
  type RepoRef,
} from '@truecourse/core/lib/contract-store';
import { materializeAnchorContracts } from '../../ee/packages/github-app/src/spec-scan';

const REPO = 'acme/api';
const ref = (sha: string): RepoRef => ({ repoKey: REPO, commitSha: sha });

let client: PGlite;
let srcDir: string;
let cloneDir: string;

function writeFile(root: string, rel: string, body: string): void {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
}

beforeEach(async () => {
  client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  setContractStore(new PgContractStore(db as unknown as EeDb));
  srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-anchor-src-'));
  cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-anchor-clone-'));
});
afterEach(async () => {
  resetContractStore();
  await client.close();
  for (const d of [srcDir, cloneDir]) fs.rmSync(d, { recursive: true, force: true });
});

describe('materializeAnchorContracts', () => {
  it('writes the stored `.tc` tree AND the generate manifest into the clone', async () => {
    const contracts = path.join(srcDir, '.truecourse', 'contracts');
    writeFile(contracts, '_shared/auth.tc', 'auth requirement');
    writeFile(contracts, 'order/order-model.tc', 'Order entity');
    writeFile(contracts, 'manifest.json', JSON.stringify({ version: 1, areas: { order: { specHash: 'abc' } } }));
    await saveContracts(ref('head'), 'contracts', contracts);

    await materializeAnchorContracts(ref('head'), cloneDir);

    const dst = path.join(cloneDir, '.truecourse', 'contracts');
    expect(fs.readFileSync(path.join(dst, '_shared/auth.tc'), 'utf-8')).toBe('auth requirement');
    expect(fs.readFileSync(path.join(dst, 'order/order-model.tc'), 'utf-8')).toBe('Order entity');
    expect(fs.readFileSync(path.join(dst, 'manifest.json'), 'utf-8')).toContain('specHash');
  });

  it('an old set with no stored manifest materializes the `.tc` tree without error', async () => {
    const contracts = path.join(srcDir, '.truecourse', 'contracts');
    writeFile(contracts, '_shared/auth.tc', 'auth requirement');
    await saveContracts(ref('old'), 'contracts', contracts);

    await materializeAnchorContracts(ref('old'), cloneDir);

    const dst = path.join(cloneDir, '.truecourse', 'contracts');
    expect(fs.existsSync(path.join(dst, '_shared/auth.tc'))).toBe(true);
    expect(fs.existsSync(path.join(dst, 'manifest.json'))).toBe(false);
  });
});
