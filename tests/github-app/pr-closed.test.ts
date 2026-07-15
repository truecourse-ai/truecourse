/**
 * pull_request.closed handling: a merged PR promotes its decisions overlay onto
 * the repo row (and drops the overlay); an unmerged close discards the overlay
 * without touching the repo row. Both clean up the PR-scoped Code Quality diff.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { PgSpecStore, PgAnalysisStore } from '../../ee/packages/data-store/src/index';
import { setSpecStore, resetSpecStore } from '@truecourse/core/lib/spec-store';
import {
  setAnalysisStore,
  resetAnalysisStore,
  readDiff,
  writeDiff,
} from '@truecourse/core/lib/analysis-store';
// Bare specifiers so the store singletons match the ones the github-app source
// reads through (it imports core via `@truecourse/core/...`, not the src path).
import {
  getDecisions,
  addManualInclude,
} from '@truecourse/core/commands/spec-in-process';
import { handlePullRequestClosed } from '../../ee/packages/github-app/src/index';
import type { PullRequestPayload } from '../../ee/packages/github-app/src/webhook';

const REPO = 'acme/api';

function closedPayload(prNumber: number, merged: boolean): PullRequestPayload {
  return {
    action: 'closed',
    number: prNumber,
    pull_request: {
      head: { sha: 'h', ref: 'f' },
      base: { sha: 'b', ref: 'main' },
      merged,
    },
    repository: { full_name: REPO, default_branch: 'main' },
    installation: { id: 5 },
  };
}

let client: PGlite;

beforeEach(async () => {
  client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  setSpecStore(new PgSpecStore(db as unknown as EeDb));
  setAnalysisStore(new PgAnalysisStore(db as unknown as EeDb));
});

afterEach(async () => {
  resetSpecStore();
  resetAnalysisStore();
  await client.close();
});

describe('handlePullRequestClosed', () => {
  it('merged: promotes the overlay onto the repo row and drops it', async () => {
    await addManualInclude(REPO, 'a.md', { pr: 7 });
    // Repo row is still empty before merge.
    expect((await getDecisions(REPO)).manualIncludes).toEqual([]);

    await handlePullRequestClosed(closedPayload(7, true));

    // Repo row now carries the promoted include; the overlay is gone.
    expect((await getDecisions(REPO)).manualIncludes).toEqual(['a.md']);
    expect((await getDecisions(REPO, { pr: 7 })).manualIncludes).toEqual(['a.md']);
  });

  it('unmerged: discards the overlay and leaves the repo row untouched', async () => {
    await addManualInclude(REPO, 'repo.md'); // repo-scope
    await addManualInclude(REPO, 'pr.md', { pr: 7 }); // overlay

    await handlePullRequestClosed(closedPayload(7, false));

    // Overlay gone → effective == repo row (the PR's include did not promote).
    expect((await getDecisions(REPO, { pr: 7 })).manualIncludes).toEqual(['repo.md']);
    expect((await getDecisions(REPO)).manualIncludes).toEqual(['repo.md']);
  });

  it('merged with no overlay is a no-op (never throws)', async () => {
    await expect(handlePullRequestClosed(closedPayload(99, true))).resolves.toBeUndefined();
    expect((await getDecisions(REPO)).manualIncludes).toEqual([]);
  });

  it('cleans up the PR-scoped Code Quality diff on close', async () => {
    const prKey = `${REPO}::pr/7`;
    await writeDiff(prKey, { summary: { newCount: 1 } } as never);
    expect(await readDiff(prKey)).not.toBeNull();

    await handlePullRequestClosed(closedPayload(7, false));

    expect(await readDiff(prKey)).toBeNull();
  });
});
