/**
 * On a default-branch push (merge/squash), the baseline maps the commit back to
 * its merged PR to (a) promote that PR's decisions overlay before the scan folds
 * them and (b) anchor contract regeneration to the PR head so the reviewed
 * contracts reproduce. `resolveMergedPr` picks the PR; `resolveMergeAnchor` does
 * the promotion + anchor selection and degrades to no anchor on any failure.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { PgSpecStore } from '../../ee/packages/data-store/src/index';
import { setSpecStore, resetSpecStore } from '@truecourse/core/lib/spec-store';
import {
  setContractStore,
  resetContractStore,
  type ContractStore,
} from '@truecourse/core/lib/contract-store';
// Bare specifiers so the store singletons match the ones the github-app source
// reads through (it imports core via `@truecourse/core/...`, not the src path).
import {
  getDecisions,
  addRelation,
} from '@truecourse/core/commands/spec-in-process';
import {
  resolveMergedPr,
  resolveMergeAnchor,
} from '../../ee/packages/github-app/src/baseline';

const REPO = 'acme/api';

/** A GitHub "list PRs associated with a commit" fixture row (raw shape). */
function prRow(over: {
  number: number;
  mergedAt?: string | null;
  mergeCommitSha?: string | null;
  headSha?: string;
}) {
  return {
    number: over.number,
    merged_at: over.mergedAt ?? null,
    merge_commit_sha: over.mergeCommitSha ?? null,
    head: { sha: over.headSha ?? `head-${over.number}` },
  };
}

/** Octokit stub whose `paginate` runs the passed method and unwraps `.data`. */
function fakeOctokit(rows: unknown[], opts: { throwOnList?: boolean } = {}): any {
  return {
    paginate: async (m: any, p: any) => {
      if (opts.throwOnList) throw new Error('github 502');
      return (await m(p)).data;
    },
    repos: { listPullRequestsAssociatedWithCommit: async () => ({ data: rows }) },
  };
}

describe('resolveMergedPr', () => {
  it('prefers the merged PR whose merge_commit_sha is exactly the commit', async () => {
    const octokit = fakeOctokit([
      prRow({ number: 8, mergedAt: 't', mergeCommitSha: 'other', headSha: 'h8' }),
      prRow({ number: 7, mergedAt: 't', mergeCommitSha: 'C', headSha: 'h7' }),
    ]);
    expect(await resolveMergedPr(octokit, REPO, 'C')).toEqual({ number: 7, headSha: 'h7' });
  });

  it('falls back to any merged PR when none records this as its merge commit (squash/rebase)', async () => {
    const octokit = fakeOctokit([
      prRow({ number: 5, mergedAt: 't', mergeCommitSha: 'someMerge', headSha: 'h5' }),
    ]);
    expect(await resolveMergedPr(octokit, REPO, 'C')).toEqual({ number: 5, headSha: 'h5' });
  });

  it('returns null when no associated PR merged', async () => {
    const octokit = fakeOctokit([prRow({ number: 9, mergedAt: null })]);
    expect(await resolveMergedPr(octokit, REPO, 'C')).toBeNull();
  });
});

describe('resolveMergeAnchor', () => {
  let client: PGlite;
  let contractsAtHead = true;

  const fakeContracts = {
    hasContracts: async () => contractsAtHead,
  } as unknown as ContractStore;

  beforeEach(async () => {
    client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    setSpecStore(new PgSpecStore(db as unknown as EeDb));
    setContractStore(fakeContracts);
    contractsAtHead = true;
  });
  afterEach(async () => {
    resetSpecStore();
    resetContractStore();
    await client.close();
  });

  const req = { repoFullName: REPO, installationId: 5, commitSha: 'C' };
  const mergedRows = [prRow({ number: 7, mergedAt: 't', mergeCommitSha: 'C', headSha: 'h7' })];

  it('merged PR with contracts at head → promotes overlay + anchors to the head', async () => {
    await addRelation(REPO, { type: 'replace', older: 'a.md', newer: 'b.md' }, { pr: 7 });
    const anchor = await resolveMergeAnchor({ octokitFor: () => fakeOctokit(mergedRows) }, req);
    expect(anchor).toEqual({ repoKey: REPO, commitSha: 'h7' });
    // Overlay promoted onto the repo row + dropped.
    expect((await getDecisions(REPO)).relations).toHaveLength(1);
    expect((await getDecisions(REPO, { pr: 7 })).relations).toHaveLength(1);
  });

  it('merged PR without contracts at head → promotes but no anchor', async () => {
    contractsAtHead = false;
    await addRelation(REPO, { type: 'replace', older: 'a.md', newer: 'b.md' }, { pr: 7 });
    const anchor = await resolveMergeAnchor({ octokitFor: () => fakeOctokit(mergedRows) }, req);
    expect(anchor).toBeUndefined();
    expect((await getDecisions(REPO)).relations).toHaveLength(1); // still promoted
  });

  it('no merged PR → no anchor and no promotion', async () => {
    await addRelation(REPO, { type: 'replace', older: 'a.md', newer: 'b.md' }, { pr: 7 });
    const anchor = await resolveMergeAnchor(
      { octokitFor: () => fakeOctokit([prRow({ number: 7, mergedAt: null })]) },
      req,
    );
    expect(anchor).toBeUndefined();
    // Overlay untouched (repo row empty, overlay still pending).
    expect((await getDecisions(REPO)).relations).toEqual([]);
    expect((await getDecisions(REPO, { pr: 7 })).relations).toHaveLength(1);
  });

  it('octokit error → degrades to no anchor, never throws, never promotes', async () => {
    await addRelation(REPO, { type: 'replace', older: 'a.md', newer: 'b.md' }, { pr: 7 });
    const anchor = await resolveMergeAnchor(
      { octokitFor: () => fakeOctokit([], { throwOnList: true }) },
      req,
    );
    expect(anchor).toBeUndefined();
    expect((await getDecisions(REPO)).relations).toEqual([]); // not promoted
  });

  it('no octokitFor → no anchor (resolution skipped)', async () => {
    expect(await resolveMergeAnchor({}, req)).toBeUndefined();
  });

  it('is idempotent across a double run (closed handler already promoted, then baseline)', async () => {
    await addRelation(REPO, { type: 'replace', older: 'a.md', newer: 'b.md' }, { pr: 7 });
    const deps = { octokitFor: () => fakeOctokit(mergedRows) };
    const first = await resolveMergeAnchor(deps, req);
    const second = await resolveMergeAnchor(deps, req);
    expect(first).toEqual({ repoKey: REPO, commitSha: 'h7' });
    // Second run still returns the anchor (head contracts exist) but promotes nothing new.
    expect(second).toEqual({ repoKey: REPO, commitSha: 'h7' });
    expect((await getDecisions(REPO)).relations).toHaveLength(1);
  });
});
