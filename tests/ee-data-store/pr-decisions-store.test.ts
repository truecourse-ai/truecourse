/**
 * PR-scoped decisions in EE: the `decisions` ledger routes the core's `_pr/<n>`
 * sentinel commit to a distinct `${repoKey}#pr/<n>` scope (the repo row stays
 * `repoKey`), supports a delete (dropping an overlay on merge/close), and the core
 * decisions API merges / promotes / discards the overlay over the installed store.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { PgSpecStore } from '../../ee/packages/data-store/src/index';
import {
  setSpecStore,
  resetSpecStore,
} from '../../packages/core/src/lib/spec-store';
import {
  getDecisions,
  addManualInclude,
  addManualExclude,
  promoteDecisionsOverlay,
  discardDecisionsOverlay,
  recuratePrCorpus,
} from '../../packages/core/src/commands/spec-in-process';
import type { RepoRef } from '@truecourse/core/lib/spec-store';

const REPO = 'org-1/my-repo';

async function makeDb(client: PGlite): Promise<Db> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as Db;
}

const repoRow: RepoRef = { repoKey: REPO, commitSha: '_repo' };
const prRow = (n: number): RepoRef => ({ repoKey: REPO, commitSha: `_pr/${n}` });

describe('PgSpecStore — decisions scope routing (_pr/N)', () => {
  let client: PGlite;
  let store: PgSpecStore;
  beforeEach(async () => {
    client = new PGlite();
    store = new PgSpecStore(await makeDb(client));
  });
  afterEach(async () => {
    await client.close();
  });

  it('routes the repo row and a PR overlay to independent scopes', async () => {
    await store.saveSpec(repoRow, 'decisions', { version: 1, tag: 'repo' });
    await store.saveSpec(prRow(7), 'decisions', { version: 1, tag: 'pr7' });

    expect(await store.loadSpec(repoRow, 'decisions')).toEqual({ version: 1, tag: 'repo' });
    expect(await store.loadSpec(prRow(7), 'decisions')).toEqual({ version: 1, tag: 'pr7' });
    // loadLatest for decisions is always the repo row (no commit dimension).
    expect(await store.loadLatest(REPO, 'decisions')).toEqual({ version: 1, tag: 'repo' });
  });

  it('an empty/`_repo` sentinel commit both map to the repo scope', async () => {
    await store.saveSpec({ repoKey: REPO, commitSha: '' }, 'decisions', { version: 1, tag: 'x' });
    expect(await store.loadSpec(repoRow, 'decisions')).toEqual({ version: 1, tag: 'x' });
  });

  it('two PRs are independent rows', async () => {
    await store.saveSpec(prRow(7), 'decisions', { version: 1, tag: 'pr7' });
    await store.saveSpec(prRow(8), 'decisions', { version: 1, tag: 'pr8' });
    expect(await store.loadSpec(prRow(7), 'decisions')).toEqual({ version: 1, tag: 'pr7' });
    expect(await store.loadSpec(prRow(8), 'decisions')).toEqual({ version: 1, tag: 'pr8' });
  });

  it('deleteSpec drops only the addressed overlay row; idempotent', async () => {
    await store.saveSpec(repoRow, 'decisions', { version: 1, tag: 'repo' });
    await store.saveSpec(prRow(7), 'decisions', { version: 1, tag: 'pr7' });
    await store.deleteSpec(prRow(7), 'decisions');
    expect(await store.loadSpec(prRow(7), 'decisions')).toBeNull();
    expect(await store.loadSpec(repoRow, 'decisions')).toEqual({ version: 1, tag: 'repo' });
    // deleting an absent row is a no-op
    await expect(store.deleteSpec(prRow(7), 'decisions')).resolves.toBeUndefined();
  });

  it('deleteSpec only supports the decisions artifact', async () => {
    await expect(store.deleteSpec({ repoKey: REPO, commitSha: 'abc' }, 'corpus')).rejects.toThrow(
      /only the decisions artifact/,
    );
  });
});

describe('core decisions overlay API (over the installed PgSpecStore)', () => {
  let client: PGlite;
  beforeEach(async () => {
    client = new PGlite();
    setSpecStore(new PgSpecStore(await makeDb(client)));
  });
  afterEach(async () => {
    resetSpecStore();
    await client.close();
  });

  it('a PR-scoped mutation writes the overlay, never the repo row', async () => {
    await addManualInclude(REPO, 'a.md', { pr: 7 });
    // repo row untouched
    expect((await getDecisions(REPO)).manualIncludes).toEqual([]);
    // effective (repo ∪ overlay) sees it
    expect((await getDecisions(REPO, { pr: 7 })).manualIncludes).toEqual(['a.md']);
  });

  it('getDecisions with pr merges repo + overlay (overlay verb wins)', async () => {
    await addManualExclude(REPO, 'x.md'); // repo-scope
    await addManualInclude(REPO, 'x.md', { pr: 7 }); // PR overlay flips the verb
    const effective = await getDecisions(REPO, { pr: 7 });
    expect(effective.manualIncludes).toContain('x.md');
    expect(effective.manualExcludes).not.toContain('x.md');
    // the repo row itself is unchanged
    expect((await getDecisions(REPO)).manualExcludes).toEqual(['x.md']);
  });

  it('promoteDecisionsOverlay merges the overlay onto the repo row, drops it, and is idempotent', async () => {
    await addManualInclude(REPO, 'a.md', { pr: 7 });
    const first = await promoteDecisionsOverlay(REPO, 7);
    expect(first).toBe(true);
    // repo row now carries the promoted include
    expect((await getDecisions(REPO)).manualIncludes).toEqual(['a.md']);
    // overlay row is gone → effective == repo row
    expect((await getDecisions(REPO, { pr: 7 })).manualIncludes).toEqual(['a.md']);
    // a second promotion is a no-op
    expect(await promoteDecisionsOverlay(REPO, 7)).toBe(false);
  });

  it('promoteDecisionsOverlay returns false when there is no overlay', async () => {
    expect(await promoteDecisionsOverlay(REPO, 99)).toBe(false);
  });

  it('discardDecisionsOverlay removes the overlay without touching the repo row', async () => {
    await addManualInclude(REPO, 'repo.md'); // repo-scope
    await addManualInclude(REPO, 'pr.md', { pr: 7 }); // overlay
    await discardDecisionsOverlay(REPO, 7);
    const effective = await getDecisions(REPO, { pr: 7 });
    expect(effective.manualIncludes).toEqual(['repo.md']);
  });

  it('two PRs promote independently', async () => {
    await addManualInclude(REPO, 'a.md', { pr: 7 });
    await addManualInclude(REPO, 'b.md', { pr: 8 });
    await promoteDecisionsOverlay(REPO, 7);
    expect((await getDecisions(REPO)).manualIncludes).toEqual(['a.md']);
    // PR 8's overlay is still pending
    expect((await getDecisions(REPO, { pr: 8 })).manualIncludes.sort()).toEqual(['a.md', 'b.md']);
  });

  it('recuratePrCorpus returns null when the repo has no corpus at head or baseline', async () => {
    expect(await recuratePrCorpus(REPO, 'headsha', 7)).toBeNull();
  });
});
