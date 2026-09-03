/**
 * A hosted scan snapshots the documents it kept. The corpus names documents by
 * path and the clone that held them is disposed the moment the scan settles,
 * so the persist step reads every kept body out of the tree and stores it
 * under the scan's commit — repository docs and llms.txt source pages alike —
 * and the server's document reader answers from that snapshot.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { PgSpecStore } from '@truecourse/data-store';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';

vi.mock('@truecourse/core/commands/spec-in-process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@truecourse/core/commands/spec-in-process')>()),
  curateInProcess: vi.fn(),
}));

// The dist entries the server imports — a source import would install the
// seams on a parallel module copy.
import { curateInProcess } from '@truecourse/core/commands/spec-in-process';
import { loadSpecDoc, resetSpecStore, setSpecStore } from '@truecourse/core/lib/spec-store';
import { readRepoDoc, setRepoDocReader } from '@truecourse/core/lib/repo-doc-reader';
import { runStoredSpecScan, snapshotDocs } from '../../apps/dashboard/server/src/services/spec-scan.service';
import { setWorkTreeProvider } from '../../apps/dashboard/server/src/services/work-tree.service';

const REPO = 'acme/widgets';

let client: PGlite;
let tree: string;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

const corpus = (refs: string[]): CuratedCorpus =>
  ({
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs: refs.map((ref) => ({ ref, kind: 'prd', lastTouched: '', areaTags: [] })),
    areas: [],
    relations: [],
    skippedDocs: [],
  }) as unknown as CuratedCorpus;

beforeEach(async () => {
  client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  setSpecStore(new PgSpecStore(db));
  setRepoDocReader((repoKey, docPath, opts) => loadSpecDoc(repoKey, docPath, opts?.commit));

  tree = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-scan-snapshot-')));
  fs.mkdirSync(path.join(tree, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'docs', 'orders.md'), '# Orders\n\nAn order has lines.\n');
  fs.mkdirSync(path.join(tree, '.truecourse', 'specs', 'sources', 'stripe'), { recursive: true });
  fs.writeFileSync(path.join(tree, '.truecourse', 'specs', 'sources', 'stripe', 'refunds.md'), '# Refunds\n');
  git(tree, 'init', '--initial-branch=main');
  git(tree, 'config', 'user.name', 'Test');
  git(tree, 'config', 'user.email', 'test@example.com');
  git(tree, 'add', '-A');
  git(tree, 'commit', '-m', 'one');
  setWorkTreeProvider(async () => ({ dir: tree, dispose: () => fs.rmSync(tree, { recursive: true, force: true }) }));
});

afterEach(async () => {
  setWorkTreeProvider(null);
  resetSpecStore();
  await client.close();
  fs.rmSync(tree, { recursive: true, force: true });
});

describe('snapshotDocs', () => {
  it('reads every kept document the corpus names, and skips one that escapes the tree', () => {
    const files = snapshotDocs(tree, corpus(['docs/orders.md', '.truecourse/specs/sources/stripe/refunds.md', '../etc/passwd', 'docs/gone.md']));
    expect(Object.keys(files).sort()).toEqual(['.truecourse/specs/sources/stripe/refunds.md', 'docs/orders.md']);
    expect(files['docs/orders.md']).toContain('An order has lines');
  });
});

describe('the hosted scan', () => {
  it('stores the documents under the scan commit, where the doc reader finds them after the clone is gone', async () => {
    vi.mocked(curateInProcess).mockResolvedValue({
      curate: { corpus: corpus(['docs/orders.md', '.truecourse/specs/sources/stripe/refunds.md']), decisions: { version: 2 } },
    } as never);
    const commit = git(tree, 'rev-parse', 'HEAD');

    await runStoredSpecScan(REPO, {});

    expect(fs.existsSync(tree)).toBe(false);
    expect(await readRepoDoc(REPO, 'docs/orders.md')).toContain('An order has lines');
    expect(await readRepoDoc(REPO, 'docs/orders.md', { commit })).toContain('An order has lines');
    expect(await readRepoDoc(REPO, '.truecourse/specs/sources/stripe/refunds.md')).toBe('# Refunds\n');
    expect(await readRepoDoc(REPO, 'docs/never-kept.md')).toBeNull();
  });
});
